import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  BackupCaptureRequest,
  BackupEncryptedPart,
} from "../../application/backup-execution.port";
import { BackupExecutionError } from "../../application/backup-execution.port";
import {
  EncryptedBackupRepository,
  type EncryptedRepositoryConfiguration,
} from "../repository/encrypted-backup.repository";
import {
  resolveBackupMounts,
  type BackupMountedRuntime,
  type ResolvedBackupMounts,
} from "./backup-mounted-runtime";
import { NativeBackupProcess } from "./native-backup-process";
import { walEndLsn, walOrdinal } from "./wal-sequence";

import {
  WAL_SEGMENT_BYTES,
  validateWalJournal,
  partSchema,
  journalPartSchema,
  type WalJournal,
} from "./wal-journal";
export { WAL_SEGMENT_BYTES, validateWalJournal } from "./wal-journal";
const segmentName = /^[A-F0-9]{24}$/;
const historyName = /^[A-F0-9]{8}\.history$/;
type Repository = Pick<
  EncryptedBackupRepository,
  "sealPart" | "openPartToSink"
>;
export interface WalArchiveHandle {
  checkpoint(
    targetSegment?: string,
    cutSignal?: AbortSignal,
  ): Promise<readonly BackupEncryptedPart[]>;
  snapshot(): readonly BackupEncryptedPart[];
  stop(): Promise<void>;
}

/** Continuous receiver acknowledgements never release WAL: only the durable encrypted journal advances the independent hold slot. */
export class NativeWalSupervisor {
  private startup: Promise<WalArchiveHandle> | null = null;
  private active: { binding: string; handle: WalArchiveHandle } | null = null;
  constructor(
    private readonly runtime: BackupMountedRuntime,
    private readonly process = new NativeBackupProcess(),
    private readonly repositoryFactory: (
      configuration: EncryptedRepositoryConfiguration,
    ) => Repository = (c) => new EncryptedBackupRepository(c),
  ) {}
  async start(
    request: BackupCaptureRequest,
    shutdownSignal?: AbortSignal,
  ): Promise<WalArchiveHandle> {
    shutdownSignal?.throwIfAborted();
    if (this.startup) {
      await this.startup;
      return this.start(request, shutdownSignal);
    }
    const binding = JSON.stringify([
      request.instanceId,
      request.sourceAlias,
      request.repositoryAlias,
      request.repositoryGeneration,
      request.keyAlias,
      request.keyId,
      request.stagingAlias,
    ]);
    if (this.active) {
      if (this.active.binding !== binding) {
        const previous = JSON.parse(this.active.binding) as string[];
        const next = JSON.parse(binding) as string[];
        if (
          [0, 1, 2, 3, 6].some((index) => previous[index] !== next[index]) ||
          !Object.values(this.runtime.keys ?? {}).some(
            (key) => key.keyId === request.keyId,
          ) ||
          !Object.values(this.runtime.keys ?? {}).some(
            (key) => key.keyId === previous[5],
          )
        )
          throw new BackupExecutionError("configuration_changed");
        await resolveBackupMounts(this.runtime, request);
        await this.stop();
        return this.start(request, shutdownSignal);
      }
      return this.active.handle;
    }
    const task = (async () => {
      const mounts = await resolveBackupMounts(this.runtime, request);
      const handle = await this.launch(request, mounts, shutdownSignal);
      this.active = { binding, handle };
      return handle;
    })();
    this.startup = task;
    try {
      return await task;
    } finally {
      this.startup = null;
    }
  }
  async stop(): Promise<void> {
    if (this.startup) await this.startup.catch(() => undefined);
    const active = this.active;
    this.active = null;
    if (active) await active.handle.stop();
  }
  private async launch(
    request: BackupCaptureRequest,
    mounts: ResolvedBackupMounts,
    shutdownSignal?: AbortSignal,
  ): Promise<WalArchiveHandle> {
    const controller = new AbortController();
    const signal = controller.signal;
    const source = mounts.source;
    const instance = z.uuid().parse(request.instanceId);
    const tool = `cra-backup-wal-${instance.replaceAll("-", "")}`;
    const slot = `cra_backup_wal_${instance.replaceAll("-", "")}`;
    const repository = this.repositoryFactory({
      repository: mounts.repository.path,
      keyFile: mounts.key.path,
      keyId: mounts.key.keyId,
      keyFilesById: Object.fromEntries(
        Object.values(this.runtime.keys ?? {}).map((key) => [
          key.keyId,
          key.path,
        ]),
      ),
      gpgBinary: this.runtime.gpgBinary,
      maximumPartBytes: mounts.staging.maximumBytes,
    });
    const directory = join(mounts.repository.path, "wal");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      (directoryStat.mode & 0o077) !== 0
    )
      throw new BackupExecutionError("repository_unavailable");
    const pointer = join(directory, `${instance}.json`);
    const sql = (query: string) =>
      this.process.run(
        "docker",
        [
          "exec",
          source.databaseContainer,
          "psql",
          "-X",
          "-U",
          source.databaseUser,
          "-d",
          source.databaseName,
          "-Atq",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          query,
        ],
        signal,
      );
    const identity = JSON.parse(
      await sql(
        "select json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,'segmentBytes',pg_size_bytes(current_setting('wal_segment_size')));",
      ),
    ) as { systemIdentifier: string; timeline: number; segmentBytes: number };
    if (identity.segmentBytes !== WAL_SEGMENT_BYTES)
      throw new BackupExecutionError("incompatible_runtime");
    let journal: WalJournal = {
      version: 1,
      instanceId: instance,
      sourceSystemIdentifier: identity.systemIdentifier,
      timeline: identity.timeline,
      repositoryGeneration: request.repositoryGeneration,
      keyId: request.keyId,
      sourceAlias: request.sourceAlias,
      parts: [],
    };
    const restored = await this.readJournal(pointer, repository, signal);
    if (restored) {
      journal = restored;
      if (
        journal.instanceId !== instance ||
        journal.sourceSystemIdentifier !== identity.systemIdentifier ||
        journal.timeline !== identity.timeline ||
        journal.repositoryGeneration !== request.repositoryGeneration ||
        journal.sourceAlias !== request.sourceAlias
      )
        throw new BackupExecutionError("source_identity_changed");
      if (
        journal.keyId !== request.keyId &&
        !Object.values(this.runtime.keys ?? {}).some(
          (key) => key.keyId === journal.keyId,
        )
      )
        throw new BackupExecutionError("historical_key_unavailable");
      journal = {
        ...journal,
        keyId: request.keyId,
        parts: journal.parts.map((part) => ({
          ...part,
          keyId: part.keyId ?? restored.keyId,
        })),
        ...(journal.previousWindow
          ? {
              previousWindow: {
                ...journal.previousWindow,
                part: {
                  ...journal.previousWindow.part,
                  keyId: journal.previousWindow.part.keyId ?? restored.keyId,
                },
              },
            }
          : {}),
      };
    }
    const existing = JSON.parse(
      await sql(
        `select coalesce((select json_build_object('type',slot_type,'lsn',restart_lsn::text) from pg_replication_slots where slot_name='${slot}'),'null'::json);`,
      ),
    ) as { type: string; lsn: string } | null;
    if (
      existing &&
      (existing.type !== "physical" || !restored || !existing.lsn)
    )
      throw new BackupExecutionError("repository_discontinuity");
    if (!existing && restored && restored.parts.length > 0)
      throw new BackupExecutionError("repository_discontinuity");
    const staging =
      mounts.staging.kind === "encrypted"
        ? join(mounts.staging.path, `${tool}-${randomUUID()}`)
        : null;
    if (staging) await mkdir(staging, { mode: 0o700 });
    const args = [
      "run",
      "--pull=never",
      "--detach",
      "--name",
      tool,
      "--network",
      source.network,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user",
      "0:0",
      "--env",
      `PGHOST=${source.host}`,
      "--env",
      `PGPORT=${source.port}`,
      "--env",
      `PGUSER=${source.databaseUser}`,
      "--env",
      `PGDATABASE=${source.databaseName}`,
      "--env",
      "PGPASSFILE=/run/pgpass",
      "--mount",
      `type=bind,src=${source.pgpassFile},dst=/run/pgpass,readonly`,
      ...(staging
        ? ["--mount", `type=bind,src=${staging},dst=/stage`]
        : [
            "--tmpfs",
            `/stage:rw,noexec,nosuid,nodev,size=${mounts.staging.maximumBytes},mode=0700`,
          ]),
      "--label",
      `cra.backup.wal.instance=${instance}`,
      "--label",
      `cra.backup.wal.generation=${request.repositoryGeneration}`,
      "--entrypoint",
      "sleep",
      source.postgresImage,
      "infinity",
    ];
    let receiver: ReturnType<NativeBackupProcess["start"]> | null = null;
    let lock: ReturnType<NativeBackupProcess["start"]> | null = null;
    let ownsTool = false;
    let fault: Error | null = null;
    let stopped = false;
    let ticking: Promise<void> = Promise.resolve();
    let loop: Promise<void> = Promise.resolve();
    const save = async (next: WalJournal) => {
      const checked = validateWalJournal(next);
      const sealed = await repository.sealPart(
        instance,
        "inventory",
        "wal-journal.json",
        Readable.from([JSON.stringify(checked)]),
        signal,
      );
      await this.writePointer(pointer, sealed);
      journal = checked;
    };
    const check = () => {
      if (fault) throw fault;
      signal.throwIfAborted();
    };
    const archive = async () => {
      check();
      const listing = await this.process.run(
        "docker",
        [
          "exec",
          tool,
          "find",
          "/stage/wal",
          "-maxdepth",
          "1",
          "-type",
          "f",
          "-print",
        ],
        signal,
      );
      const names = listing
        .split("\n")
        .map((name) => (name.startsWith("/stage/wal/") ? name.slice(11) : ""))
        .filter((n) => segmentName.test(n) || historyName.test(n))
        .sort();
      for (const name of names) {
        if (journal.parts.some((p) => p.name === name)) continue;
        if (journal.parts.length >= 4096) {
          // Preserve the complete immutable predecessor before publishing a bounded current window.
          // Every certificate retains its exact WAL part IDs; no historical ciphertext is removed.
          const history = await repository.sealPart(
            instance,
            "inventory",
            "wal-journal.json",
            Readable.from([JSON.stringify(journal)]),
            signal,
          );
          const endSegment = journal.parts
            .filter((part) => segmentName.test(part.name))
            .at(-1)?.name;
          if (!endSegment) throw new BackupExecutionError("wal_gap");
          await save({
            ...journal,
            version: 2,
            previousWindow: {
              part: journalPartSchema.parse({
                ...history,
                keyId: history.keyId ?? journal.keyId,
              }),
              endSegment,
            },
            parts: journal.parts.slice(-2048),
          });
        }
        const stream = this.process.start(
          "docker",
          ["exec", tool, "cat", "--", `/stage/wal/${name}`],
          signal,
        );
        stream.stdin.end();
        stream.stderr.resume();
        const exited = this.process.wait(stream);
        const part = await repository.sealPart(
          instance,
          "wal",
          name,
          stream.stdout,
          signal,
        );
        if ((await exited) !== 0)
          throw new BackupExecutionError("wal_receiver_failed");
        await save({
          ...journal,
          parts: [...journal.parts, part as z.output<typeof partSchema>],
        });
        if (segmentName.test(name)) {
          await sql(
            `select pg_replication_slot_advance('${slot}','${walEndLsn(name)}'::pg_lsn);`,
          );
          const older = journal.parts
            .filter((p) => segmentName.test(p.name) && p.name !== name)
            .map((p) => `/stage/wal/${p.name}`);
          if (older.length)
            await this.process.run(
              "docker",
              ["exec", tool, "rm", "-f", "--", ...older],
              signal,
            );
        }
      }
    };
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      receiver?.kill("SIGTERM");
      await loop.catch(() => undefined);
      await ticking.catch(() => undefined);
      lock?.stdin.end();
      lock?.kill("SIGTERM");
      if (ownsTool)
        await this.process
          .run("docker", ["rm", "--force", tool], new AbortController().signal)
          .catch(() => undefined);
      if (staging) await rm(staging, { recursive: true, force: true });
      this.active = null;
    };
    try {
      lock = this.process.start(
        "docker",
        [
          "exec",
          "-i",
          source.databaseContainer,
          "psql",
          "-X",
          "-U",
          source.databaseUser,
          "-d",
          source.databaseName,
          "-Atq",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        signal,
      );
      lock.stderr.resume();
      const locked = this.acquireLock(lock, slot);
      await locked;
      void this.process.wait(lock).then(
        () => {
          if (!stopped) fault = new BackupExecutionError("lease_lost");
        },
        () => {
          if (!stopped) fault = new BackupExecutionError("lease_lost");
        },
      );
      const prior = await this.process.run(
        "docker",
        ["ps", "-a", "--filter", `name=^${tool}$`, "--format", "{{.ID}}"],
        signal,
      );
      if (prior) {
        const labels = JSON.parse(
          await this.process.run(
            "docker",
            ["inspect", "--format", "{{json .Config.Labels}}", tool],
            signal,
          ),
        ) as Record<string, string>;
        if (
          labels["cra.backup.wal.instance"] !== instance ||
          labels["cra.backup.wal.generation"] !== request.repositoryGeneration
        )
          throw new BackupExecutionError("target_unsafe");
        await this.process.run("docker", ["rm", "--force", tool], signal);
      }
      if (staging && mounts.staging.kind === "encrypted") {
        const prefix = `${tool}-`;
        for (const entry of await readdir(mounts.staging.path, {
          withFileTypes: true,
        })) {
          if (
            !entry.isDirectory() ||
            !entry.name.startsWith(prefix) ||
            !z.uuid().safeParse(entry.name.slice(prefix.length)).success
          )
            continue;
          const abandoned = join(mounts.staging.path, entry.name);
          if (abandoned === staging) continue;
          const stat = await lstat(abandoned);
          if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) continue;
          await rm(abandoned, { recursive: true, force: true });
        }
      }
      await this.process.run("docker", args, signal);
      ownsTool = true;
      await this.process.run(
        "docker",
        ["exec", tool, "mkdir", "-m", "700", "/stage/wal"],
        signal,
      );
      const last = journal.parts.filter((p) => segmentName.test(p.name)).at(-1);
      if (last) {
        const seed = this.process.start(
          "docker",
          [
            "exec",
            "-i",
            tool,
            "sh",
            "-c",
            'umask 077; cat > "$1"',
            "sh",
            `/stage/wal/${last.name}`,
          ],
          signal,
        );
        seed.stderr.resume();
        seed.stdout.resume();
        const done = this.process.wait(seed);
        await repository.openPartToSink(last, seed.stdin, signal);
        if ((await done) !== 0)
          throw new BackupExecutionError("wal_receiver_failed");
      }
      let restartLsn = existing?.lsn;
      if (!existing) {
        await save(journal);
        await sql(
          `select pg_create_physical_replication_slot('${slot}',true);`,
        );
        const created = JSON.parse(
          await sql(
            `select json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,'restartLsn',restart_lsn::text) from pg_replication_slots where slot_name='${slot}';`,
          ),
        ) as {
          systemIdentifier: string;
          timeline: number;
          restartLsn: string | null;
        } | null;
        if (
          !created ||
          created.systemIdentifier !== identity.systemIdentifier ||
          created.timeline !== identity.timeline
        )
          throw new BackupExecutionError("source_identity_changed");
        restartLsn = created.restartLsn ?? undefined;
      }
      if (!last) {
        if (!restartLsn || !/^[A-F0-9]+\/[A-F0-9]+$/i.test(restartLsn))
          throw new BackupExecutionError("repository_discontinuity");
        const name = await sql(
          `select pg_walfile_name('${restartLsn}'::pg_lsn);`,
        );
        if (!segmentName.test(name)) throw new BackupExecutionError("wal_gap");
        // PG17 FindStreamingStart replays partial files from the segment beginning.
        // This empty position marker is never archived or treated as valid WAL bytes.
        await this.process.run(
          "docker",
          ["exec", tool, "touch", "--", `/stage/wal/${name}.partial`],
          signal,
        );
      }
      receiver = this.process.start(
        "docker",
        [
          "exec",
          tool,
          "pg_receivewal",
          "--directory=/stage/wal",
          "--synchronous",
          "--no-loop",
          "--status-interval=1",
          "--no-password",
        ],
        signal,
      );
      receiver.stdin.end();
      receiver.stdout.resume();
      receiver.stderr.resume();
      void this.process.wait(receiver).then(
        (code) => {
          if (!stopped)
            fault = new BackupExecutionError(
              code === 0 ? "wal_receiver_failed" : "wal_gap",
            );
        },
        () => {
          if (!stopped) fault = new BackupExecutionError("wal_receiver_failed");
        },
      );
      loop = (async () => {
        while (!stopped) {
          await delay(250, undefined, { signal });
          ticking = ticking.then(archive);
          await ticking;
        }
      })().catch((error) => {
        if (!stopped)
          fault =
            error instanceof Error
              ? error
              : new BackupExecutionError("wal_receiver_failed");
      });
      if (shutdownSignal?.aborted) await stop();
      else
        shutdownSignal?.addEventListener(
          "abort",
          () => {
            void stop();
          },
          { once: true },
        );
      return {
        stop,
        snapshot: () => {
          check();
          return [...journal.parts];
        },
        checkpoint: async (targetSegment, cutSignal) => {
          check();
          const observed = JSON.parse(
            await sql(
              "select json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,'segment',pg_walfile_name(pg_switch_wal()-1));",
            ),
          ) as { systemIdentifier: string; timeline: number; segment: string };
          if (
            observed.systemIdentifier !== journal.sourceSystemIdentifier ||
            observed.timeline !== journal.timeline ||
            !segmentName.test(observed.segment)
          )
            throw new BackupExecutionError("source_identity_changed");
          const target = targetSegment ?? observed.segment;
          if (!segmentName.test(target))
            throw new BackupExecutionError("wal_gap");
          const end = Date.now() + 110000;
          while (!journal.parts.some((p) => p.name === target)) {
            check();
            cutSignal?.throwIfAborted();
            const first = journal.parts.find((part) =>
              segmentName.test(part.name),
            );
            if (first && walOrdinal(target) < walOrdinal(first.name))
              throw new BackupExecutionError("wal_gap");
            if (Date.now() > end)
              throw new BackupExecutionError("wal_receiver_failed");
            await delay(100, undefined, { signal });
          }
          return journal.parts;
        },
      };
    } catch (error) {
      await stop();
      throw error;
    }
  }
  private acquireLock(
    child: ReturnType<NativeBackupProcess["start"]>,
    slot: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new BackupExecutionError("lease_lost"));
      }, 10000);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.off("data", received);
        child.off("error", failed);
        child.off("close", failed);
      };
      const failed = () => {
        cleanup();
        reject(new BackupExecutionError("lease_lost"));
      };
      let output = "";
      const received = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (!output.includes("\n")) return;
        cleanup();
        child.stdout.resume();
        if (output.trim() === "t") resolve();
        else reject(new BackupExecutionError("lease_lost"));
      };
      child.stdout.on("data", received);
      child.once("error", failed);
      child.once("close", failed);
      child.stdin.write(
        `select pg_try_advisory_lock(hashtextextended('${slot}',0));\n`,
      );
    });
  }
  private async readJournal(
    pointer: string,
    repository: Repository,
    signal: AbortSignal,
  ): Promise<WalJournal | null> {
    let descriptor: unknown;
    try {
      const file = await open(
        pointer,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if ((await file.stat()).size > 4096)
          throw new BackupExecutionError("repository_discontinuity");
        descriptor = JSON.parse(await file.readFile("utf8"));
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new BackupExecutionError("repository_discontinuity");
    }
    const journal = await this.readJournalPart(
      journalPartSchema.parse(descriptor),
      repository,
      signal,
    );
    if (journal.previousWindow) {
      const previous = await this.readJournalPart(
        journal.previousWindow.part,
        repository,
        signal,
      );
      const last = previous.parts
        .filter((part) => segmentName.test(part.name))
        .at(-1)?.name;
      if (!last) throw new BackupExecutionError("repository_discontinuity");
      const byName = new Map(previous.parts.map((part) => [part.name, part]));
      if (
        last !== journal.previousWindow.endSegment ||
        [
          "instanceId",
          "sourceSystemIdentifier",
          "timeline",
          "repositoryGeneration",
          "sourceAlias",
        ].some(
          (key) =>
            previous[key as keyof WalJournal] !==
            journal[key as keyof WalJournal],
        ) ||
        journal.parts
          .filter(
            (part) =>
              segmentName.test(part.name) &&
              walOrdinal(part.name) <= walOrdinal(last),
          )
          .some((part) => {
            const old = byName.get(part.name);
            return (
              !old ||
              old.id !== part.id ||
              old.sha256 !== part.sha256 ||
              old.cipherSha256 !== part.cipherSha256
            );
          })
      )
        throw new BackupExecutionError("repository_discontinuity");
    }
    return journal;
  }
  private async readJournalPart(
    descriptor: BackupEncryptedPart,
    repository: Repository,
    signal: AbortSignal,
  ): Promise<WalJournal> {
    const part = journalPartSchema.parse(descriptor);
    const chunks: Buffer[] = [];
    let length = 0;
    await repository.openPartToSink(
      part,
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) {
            done(new BackupExecutionError("manifest_invalid"));
            return;
          }
          chunks.push(Buffer.from(chunk));
          done();
        },
      }),
      signal,
    );
    return validateWalJournal(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  }
  private async writePointer(
    pointer: string,
    part: BackupEncryptedPart,
  ): Promise<void> {
    const temporary = `${pointer}.${randomUUID()}.partial`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(part));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, pointer);
    const directory = await open(join(pointer, ".."), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
