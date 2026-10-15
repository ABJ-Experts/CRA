import {
  BackupEncryptedPart,
  BackupExecutionError,
} from "../../application/backup-execution.port";
import { EncryptedBackupRepository } from "../repository/encrypted-backup.repository";
import {
  BackupSourceMount,
  ResolvedBackupMounts,
} from "./backup-mounted-runtime";
import { NativeBackupProcess } from "./native-backup-process";
import { assertWalSequence } from "./wal-sequence";
import { randomUUID } from "node:crypto";

/** Native source operations share a bounded process boundary and never construct shell input from requests. */
export class NativeBackupSourceTools {
  constructor(private readonly process: NativeBackupProcess) {}
  async startTool(
    name: string,
    mounts: ResolvedBackupMounts,
    directory: string | null,
    signal: AbortSignal,
    ownership: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    const source = mounts.source;
    const stagingArgs = directory
      ? ["--mount", `type=bind,src=${directory},dst=/stage`]
      : [
          "--tmpfs",
          `/stage:rw,noexec,nosuid,size=${mounts.staging.maximumBytes},mode=0700`,
        ];
    await this.process.run(
      "docker",
      [
        "run",
        "--pull=never",
        "--detach",
        "--name",
        name,
        ...Object.entries(ownership).flatMap(([key, value]) => [
          "--label",
          `${key}=${value}`,
        ]),
        "--network",
        source.network,
        "--read-only",
        ...stagingArgs,
        "--mount",
        `type=bind,src=${source.pgpassFile},dst=/run/backup.pgpass,readonly`,
        "--env",
        "PGPASSFILE=/run/backup.pgpass",
        "--env",
        `PGHOST=${source.host}`,
        "--env",
        `PGPORT=${source.port}`,
        "--env",
        `PGUSER=${source.databaseUser}`,
        "--env",
        `PGDATABASE=${source.databaseName}`,
        "--entrypoint",
        "/bin/sh",
        source.postgresImage,
        "-c",
        "mkdir -m 700 /stage/wal && exec sleep infinity",
      ],
      signal,
    );
  }

  async sql(
    source: BackupSourceMount,
    database: string,
    query: string,
    signal: AbortSignal,
  ): Promise<string> {
    return this.process.run(
      "docker",
      [
        "exec",
        "-i",
        source.databaseContainer,
        "psql",
        "-XAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        source.databaseUser,
        "-d",
        database,
      ],
      signal,
      query,
    );
  }
  async jsonSql(
    source: BackupSourceMount,
    database: string,
    query: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    return JSON.parse(await this.sql(source, database, query, signal));
  }
  async databases(
    source: BackupSourceMount,
    signal: AbortSignal,
  ): Promise<string[]> {
    return (
      await this.sql(
        source,
        source.databaseName,
        "SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname",
        signal,
      )
    )
      .split("\n")
      .filter(Boolean);
  }

  async sealCommand(
    repository: EncryptedBackupRepository,
    runId: string,
    kind: BackupEncryptedPart["kind"],
    name: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<BackupEncryptedPart> {
    const child = this.process.start("docker", args, signal);
    child.stdin.end();
    child.stderr.resume();
    const exited = this.process.wait(child);
    try {
      const part = await repository.sealPart(
        runId,
        kind,
        name,
        child.stdout,
        signal,
      );
      if ((await exited) !== 0)
        throw new BackupExecutionError(
          kind === "objects" ? "object_missing" : "native_tool_failed",
        );
      return part;
    } finally {
      child.kill("SIGKILL");
      await exited.catch(() => undefined);
    }
  }

  async acquireFence(
    source: BackupSourceMount,
    database: string,
    seconds: number,
    signal: AbortSignal,
    databaseDeadline: string,
  ): Promise<{
    release: () => Promise<void>;
    alive: () => boolean;
    verify: () => Promise<void>;
  }> {
    if (
      !databaseDeadline ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(databaseDeadline)
    )
      throw new BackupExecutionError("write_fence_unavailable");
    const child = this.process.start(
      "docker",
      [
        "exec",
        "-i",
        source.databaseContainer,
        "psql",
        "-XqAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        source.databaseUser,
        "-d",
        database,
      ],
      signal,
    );
    child.stderr.resume();
    let alive = true;
    const notAlive = () => {
      alive = false;
    };
    const exited = this.process.wait(child).then(notAlive, notAlive);
    const ready = new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("FENCE_READY")) resolve();
      });
      child.once("close", () =>
        reject(new BackupExecutionError("write_fence_unavailable")),
      );
      child.once("error", () =>
        reject(new BackupExecutionError("write_fence_unavailable")),
      );
    });
    const deadline = databaseDeadline
      ? `DO $backup_deadline$ DECLARE remaining_ms integer:=floor(extract(epoch FROM ('${databaseDeadline}'::timestamptz-clock_timestamp()))*1000); BEGIN IF remaining_ms<=0 THEN RAISE EXCEPTION 'backup_fence_expired'; END IF; PERFORM set_config('statement_timeout',least(remaining_ms,${seconds * 1000})::text||'ms',true); PERFORM set_config('idle_in_transaction_session_timeout',least(remaining_ms,${seconds * 1000})::text||'ms',true); END $backup_deadline$;`
      : "";
    child.stdin.write(
      `SET transaction_timeout='${seconds}s';\nBEGIN;\nSET LOCAL statement_timeout='${seconds}s';\nSET LOCAL lock_timeout='5s';\n${deadline}\nSELECT 'LOCK TABLE '||string_agg(format('%I.%I',n.nspname,c.relname),',')||' IN SHARE MODE' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND NOT (n.nspname='public' AND c.relname IN ('backup_runs','backup_policies')) \\gexec\n${deadline}\nSELECT 'FENCE_READY';\n`,
    );
    await ready;
    return {
      alive: () => alive && !signal.aborted,
      verify: async () => {
        signal.throwIfAborted();
        if (!alive) throw new BackupExecutionError("write_fence_expired");
        const marker = `FENCE_CHECK_${randomUUID().replaceAll("-", "")}`;
        await new Promise<void>((resolve, reject) => {
          let output = "";
          const done = (error?: Error) => {
            clearTimeout(timer);
            child.stdout.off("data", data);
            child.off("close", closed);
            child.stdin.off("error", closed);
            signal.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve();
          };
          const closed = () =>
            done(new BackupExecutionError("write_fence_expired"));
          const aborted = () => closed();
          const data = (chunk: Buffer) => {
            output += chunk.toString();
            if (output.includes(marker)) done();
          };
          const timer = setTimeout(closed, 2000);
          child.stdout.on("data", data);
          child.once("close", closed);
          child.stdin.once("error", closed);
          signal.addEventListener("abort", aborted, { once: true });
          child.stdin.write(`${deadline}\nSELECT '${marker}';\n`);
        });
      },
      release: async () => {
        if (alive) child.stdin.end("ROLLBACK;\n");
        await exited;
      },
    };
  }

  async awaitWal(
    tool: string,
    last: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const names = (
        await this.process.run(
          "docker",
          ["exec", tool, "ls", "-1", "/stage/wal"],
          signal,
        )
      )
        .split("\n")
        .filter((name) => /^[A-F0-9]{24}$/.test(name))
        .sort();
      if (names.includes(last)) {
        assertWalSequence(names);
        return names.filter((name) => name <= last);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      signal.throwIfAborted();
    }
    throw new BackupExecutionError("wal_gap");
  }
}
