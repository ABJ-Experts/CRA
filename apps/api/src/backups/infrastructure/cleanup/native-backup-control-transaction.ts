import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BackupExecutionError } from "../../application/backup-execution.port";
import { NativeBackupProcess } from "../capture/native-backup-process";

const operationSchema = z.enum([
  "cleanup/authorize",
  "cleanup/review",
  "cleanup/finish",
]);
const envelopeSchema = z
  .object({
    outcome: z.enum(["ok", "blocked", "conflict", "invalid", "not_found"]),
    result: z.unknown().optional(),
  })
  .strict();
interface PendingQuery {
  readonly marker: string;
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  output: string;
}
/** One executor-owned connection retains transaction advisory/row locks across reversible filesystem work. */
export class NativeBackupControlTransaction {
  private pending: PendingQuery | null = null;
  private buffer = "";
  private exited = false;
  private finished = false;
  private readonly exit: Promise<number>;
  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    process: NativeBackupProcess,
  ) {
    child.once("close", () => {
      this.exited = true;
      this.pending?.reject(
        new BackupExecutionError("cleanup_transaction_lost"),
      );
      this.pending = null;
    });
    child.stdin.on("error", () => {
      this.pending?.reject(
        new BackupExecutionError("cleanup_transaction_lost"),
      );
      this.pending = null;
    });
    child.stderr.resume();
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    this.exit = process
      .wait(child)
      .catch(() => -1)
      .then((code) => {
        this.exited = true;
        this.pending?.reject(
          new BackupExecutionError("cleanup_transaction_lost"),
        );
        this.pending = null;
        return code;
      });
  }
  static async open(
    this: void,
    source: Readonly<{
      databaseContainer: string;
      databaseName: string;
      databaseUser: string;
    }>,
    process: NativeBackupProcess,
    signal: AbortSignal,
  ): Promise<NativeBackupControlTransaction> {
    if (
      [source.databaseContainer, source.databaseName, source.databaseUser].some(
        (value) => !/^[A-Za-z0-9_.-]{1,128}$/.test(value),
      )
    )
      throw new BackupExecutionError("cleanup_configuration");
    signal.throwIfAborted();
    const child = process.start(
      "docker",
      [
        "exec",
        "--interactive",
        source.databaseContainer,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        source.databaseUser,
        "-d",
        source.databaseName,
      ],
      signal,
    );
    const session = new NativeBackupControlTransaction(child, process);
    try {
      await session.query(
        "begin; set local standard_conforming_strings=on; set local transaction_timeout='45s'; set local statement_timeout='5s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='45s'; set local role cra_backup_control;",
      );
      return session;
    } catch {
      await session.close();
      throw new BackupExecutionError("cleanup_transaction_lost");
    }
  }
  async execute(
    instanceId: string,
    actor: string,
    action: z.output<typeof operationSchema>,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (
      !z.string().uuid().safeParse(instanceId).success ||
      !/^[a-z0-9][a-z0-9:_/-]{0,199}$/.test(actor) ||
      !operationSchema.safeParse(action).success
    )
      throw new BackupExecutionError("cleanup_configuration");
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded) > 65536)
      throw new BackupExecutionError("cleanup_configuration");
    const raw = await this.query(
      `select public.m15_05_backup_control(${literal(instanceId)}::uuid,${literal(actor)},${literal(action)},${literal(encoded)}::jsonb)::text;`,
    );
    let parsed: z.output<typeof envelopeSchema>;
    try {
      parsed = envelopeSchema.parse(JSON.parse(raw));
    } catch {
      throw new BackupExecutionError("cleanup_transaction_result");
    }
    if (parsed.outcome !== "ok")
      throw new BackupExecutionError(
        parsed.outcome === "blocked" ? "cleanup_blocked" : "cleanup_conflict",
      );
    return parsed.result;
  }
  async commit(): Promise<void> {
    await this.query("commit;");
    this.finished = true;
  }
  async rollback(): Promise<void> {
    if (this.finished || this.exited) return;
    try {
      await this.query("rollback;");
    } finally {
      this.finished = true;
    }
  }
  async close(): Promise<void> {
    this.child.stdin.end();
    if (!this.exited) this.child.kill("SIGTERM");
    await this.exit;
  }
  private query(sql: string): Promise<string> {
    if (this.exited || this.finished || this.pending)
      return Promise.reject(
        new BackupExecutionError("cleanup_transaction_lost"),
      );
    const marker = `cra_cleanup_${randomUUID().replaceAll("-", "")}`;
    return new Promise((resolve, reject) => {
      this.pending = { marker, resolve, reject, output: "" };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`, (error) => {
        if (error) {
          this.pending?.reject(
            new BackupExecutionError("cleanup_transaction_lost"),
          );
          this.pending = null;
        }
      });
    });
  }
  private consume(chunk: Buffer) {
    this.buffer += chunk.toString("utf8");
    if (
      Buffer.byteLength(this.buffer) +
        (this.pending ? Buffer.byteLength(this.pending.output) : 0) >
      1024 * 1024
    ) {
      this.pending?.reject(
        new BackupExecutionError("cleanup_transaction_output_limit"),
      );
      this.pending = null;
      this.child.kill("SIGKILL");
      return;
    }
    for (
      let newline = this.buffer.indexOf("\n");
      newline >= 0;
      newline = this.buffer.indexOf("\n")
    ) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!this.pending) continue;
      if (line === this.pending.marker) {
        const pending = this.pending;
        this.pending = null;
        pending.resolve(pending.output.trim());
      } else this.pending.output += line + "\n";
    }
  }
}
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
