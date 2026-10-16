import { randomUUID } from "node:crypto";
import { mkdir, rm, statfs } from "node:fs/promises";
import { join, posix } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  BackupCaptureRequest,
  BackupCaptureResult,
  BackupCertificate,
  BackupEncryptedPart,
  BackupExecutionContext,
  BackupExecutionError,
  BackupInventory,
  BackupObjectInventoryEntry,
} from "../../application/backup-execution.port";
import {
  EncryptedBackupRepository,
  backupDigest,
} from "../repository/encrypted-backup.repository";
import {
  RECOVERY_AUDIT_HEADS_SQL,
  RECOVERY_CATALOG_SQL,
  RECOVERY_MIGRATIONS_SQL,
} from "../restore/restore-inventory";
import {
  BackupMountedRuntime,
  ResolvedBackupMounts,
  resolveBackupMounts,
} from "./backup-mounted-runtime";
import { NativeBackupProcess } from "./native-backup-process";
import { NativeBackupSourceTools } from "./native-backup-source";
import { NativeWalSupervisor } from "./native-wal-supervisor";
import { reusableBackupBase } from "./reusable-backup-base";
import { assertWalSequence } from "./wal-sequence";
import { assertStageOutsideSourceMounts } from "../restore/restore-configuration";
import {
  recordCaptureResourceOwnership,
  temporaryCaptureSlotNames,
} from "./capture-resource-reconciliation";

interface StorageRow {
  readonly bucket_id: string;
  readonly name: string;
  readonly version: string | null;
  readonly bytes: number;
}

// openat walks each component with O_NOFOLLOW; neither parents nor final entries may be symlinks.
const READ_OBJECT =
  "import os,sys,stat\np=sys.argv[1]; parts=p.split('/')[1:]; fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)\ntry:\n for part in parts[:-1]:\n  n=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd); os.close(fd); fd=n\n f=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)\n if not stat.S_ISREG(os.fstat(f).st_mode): raise RuntimeError('invalid')\n with os.fdopen(f,'rb') as source:\n  while True:\n   chunk=source.read(1048576)\n   if not chunk: break\n   sys.stdout.buffer.write(chunk)\nfinally: os.close(fd)";

const containsControl = (value: string): boolean =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );

export function storageObjectPath(
  root: string,
  prefix: string,
  bucket: string,
  name: string,
  version: string | null,
): string {
  const safe = (value: string, nested: boolean) =>
    value.length > 0 &&
    value.length <= 4096 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !containsControl(value) &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..") &&
    (nested || !value.includes("/"));
  if (
    !root.startsWith("/") ||
    !safe(prefix, true) ||
    !safe(bucket, false) ||
    !safe(name, true) ||
    (version !== null && !safe(version, false))
  )
    throw new BackupExecutionError("unsafe_object_identity");
  return posix.join(
    root,
    prefix,
    bucket,
    name,
    ...(version === null ? [] : [version]),
  );
}

/** Runs only inside the physical executor, never the public API or private ingress. */
export class NativeBackupCaptureAdapter {
  private readonly tools: NativeBackupSourceTools;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly runtime: BackupMountedRuntime,
    private readonly process = new NativeBackupProcess(),
    private readonly walSupervisor: Pick<
      NativeWalSupervisor,
      "start" | "stop"
    > = new NativeWalSupervisor(runtime, process),
  ) {
    this.tools = new NativeBackupSourceTools(this.process);
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    await this.walSupervisor.stop();
  }

  async reconcileAbandoned(
    request: BackupCaptureRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const mounts = await resolveBackupMounts(this.runtime, request);
    const repository = new EncryptedBackupRepository({
      repository: mounts.repository.path,
      keyFile: mounts.key.path,
      keyId: mounts.key.keyId,
      gpgBinary: this.runtime.gpgBinary,
      maximumPartBytes: mounts.staging.maximumBytes,
      keyFilesById: Object.fromEntries(
        Object.values(this.runtime.keys).map((key) => [key.keyId, key.path]),
      ),
    });
    await repository.reconcileUnpublished(
      request.instanceId,
      async (ownerRunId) =>
        (await this.tools.sql(
          mounts.source,
          mounts.source.databaseName,
          `SELECT EXISTS(SELECT 1 FROM public.backup_runs WHERE instance_id='${request.instanceId}'::uuid AND id='${ownerRunId}'::uuid AND state IN ('failed','incomplete','cancelled') AND lease_owner IS NULL)`,
          signal,
        )) === "t",
      signal,
      false,
      request.runId,
    );
  }

  async capture(
    request: BackupCaptureRequest,
    context: BackupExecutionContext,
  ): Promise<BackupCaptureResult> {
    const started = Date.now();
    const mounts = await resolveBackupMounts(this.runtime, request);
    const source = mounts.source;
    await context.assertAuthority();
    await context.checkpoint("inventory", 5);
    await this.preflight(mounts, context.signal);
    const tool = `cra-backup-${randomUUID()}`;
    const [holdSlot, receiverSlot] = temporaryCaptureSlotNames(tool);
    let ownershipPath: string | undefined;
    const repository = new EncryptedBackupRepository({
      repository: mounts.repository.path,
      keyFile: mounts.key.path,
      keyId: mounts.key.keyId,
      gpgBinary: this.runtime.gpgBinary,
      maximumPartBytes: mounts.staging.maximumBytes,
      instanceId: request.instanceId,
      trackRunOwnership: true,
      keyFilesById: Object.fromEntries(
        Object.values(this.runtime.keys).map((key) => [key.keyId, key.path]),
      ),
    });
    const directory =
      mounts.staging.kind === "encrypted"
        ? join(mounts.staging.path, tool)
        : null;
    const signal = context.signal;
    const fences: {
      release: () => Promise<void>;
      alive: () => boolean;
      verify: () => Promise<void>;
    }[] = [];
    let receiver: ReturnType<NativeBackupProcess["start"]> | null = null;
    let receiverExited: Promise<number> | null = null;
    const releasePublication = await repository.acquirePublicationLease(
      request.runId,
      async (ownerRunId) =>
        (await this.tools.sql(
          source,
          source.databaseName,
          `SELECT EXISTS(SELECT 1 FROM public.backup_runs WHERE instance_id='${request.instanceId}'::uuid AND id='${ownerRunId}'::uuid AND state IN ('failed','incomplete','cancelled','certified','verified') AND lease_owner IS NULL)`,
          signal,
        )) === "t",
    );
    try {
      await repository.reconcileUnpublished(
        request.instanceId,
        async (ownerRunId) =>
          (await this.tools.sql(
            source,
            source.databaseName,
            `SELECT EXISTS(SELECT 1 FROM public.backup_runs WHERE instance_id='${request.instanceId}'::uuid AND id='${ownerRunId}'::uuid AND state IN ('failed','incomplete','cancelled') AND lease_owner IS NULL)`,
            signal,
          )) === "t",
        signal,
        true,
      );
      const previous = await repository.latestCertificate(
        request.instanceId,
        null,
        signal,
      );
      if (
        previous &&
        previous.configurationRevision > request.configurationRevision
      )
        throw new BackupExecutionError("repository_discontinuity");
      const observedIdentity = (await this.tools.jsonSql(
        source,
        source.databaseName,
        "SELECT json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id)",
        signal,
      )) as { systemIdentifier: string; timeline: number };
      if (
        previous &&
        (previous.checkpoint.systemIdentifier !==
          observedIdentity.systemIdentifier ||
          previous.checkpoint.timeline > observedIdentity.timeline)
      )
        throw new BackupExecutionError("source_identity_changed");
      const ownership = await recordCaptureResourceOwnership(this.runtime, {
        instanceId: request.instanceId,
        runId: request.runId,
        sourceAlias: request.sourceAlias,
        repositoryAlias: request.repositoryAlias,
        stagingAlias: request.stagingAlias,
        tool,
        sourceContainerId: await this.process.run(
          "docker",
          ["inspect", "--format", "{{.Id}}", source.databaseContainer],
          signal,
        ),
        sourceSystemIdentifier: observedIdentity.systemIdentifier,
      });
      ownershipPath = ownership.path;
      const archive = await this.walSupervisor.start(
        request,
        this.shutdown.signal,
      );
      if (directory) await mkdir(directory, { mode: 0o700 });
      await this.tools.startTool(
        tool,
        mounts,
        directory,
        signal,
        ownership.labels,
      );
      const archivedBeforeCut = await archive.checkpoint(undefined, signal);
      const identity = (await this.tools.jsonSql(
        source,
        source.databaseName,
        "SELECT json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,'currentWalName',pg_walfile_name(pg_current_wal_insert_lsn()))",
        signal,
      )) as {
        systemIdentifier: string;
        timeline: number;
        currentWalName: string;
      };
      const reusable = reusableBackupBase(previous, {
        instanceId: request.instanceId,
        keyId: request.keyId,
        repositoryGeneration: request.repositoryGeneration,
        ...identity,
        now: Date.now(),
        intervalHours: request.baseIntervalHours ?? 24,
        archivedWal: archivedBeforeCut,
      });
      if (reusable)
        for (const part of [reusable.base, ...reusable.wal])
          await repository.verifyCiphertext(part, signal);
      await this.tools.sql(
        source,
        source.databaseName,
        `SELECT pg_create_physical_replication_slot('${holdSlot}', true)`,
        signal,
      );
      await this.tools.sql(
        source,
        source.databaseName,
        `SELECT pg_create_physical_replication_slot('${receiverSlot}', true)`,
        signal,
      );
      receiver = this.process.start(
        "docker",
        [
          "exec",
          tool,
          "pg_receivewal",
          "--directory=/stage/wal",
          `--slot=${receiverSlot}`,
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
      receiverExited = this.process.wait(receiver);
      await context.checkpoint("base_backup", 15);
      if (!reusable)
        await this.process.run(
          "docker",
          [
            "exec",
            tool,
            "pg_basebackup",
            "--pgdata=/stage/base",
            "--format=plain",
            "--wal-method=stream",
            "--checkpoint=fast",
            "--manifest-checksums=SHA256",
            "--no-password",
          ],
          signal,
        );
      if (!reusable)
        await this.process.run(
          "docker",
          ["exec", tool, "pg_verifybackup", "/stage/base"],
          signal,
        );
      if (!reusable) {
        const control = await this.process.run(
          "docker",
          ["exec", "--env", "LC_ALL=C", tool, "pg_controldata", "/stage/base"],
          signal,
        );
        if (
          control.match(/^Database system identifier:\s*(\d+)\s*$/m)?.[1] !==
          observedIdentity.systemIdentifier
        )
          throw new BackupExecutionError("source_identity_changed");
      }
      const base =
        reusable?.base ??
        (await this.tools.sealCommand(
          repository,
          request.runId,
          "base",
          "base.tar",
          ["exec", tool, "tar", "-C", "/stage/base", "-cf", "-", "."],
          signal,
        ));
      const databases = await this.tools.databases(source, signal);
      await context.assertAuthority();
      const monotonicDeadline =
        performance.now() + request.pauseLimitSeconds * 1000;
      const databaseDeadline = await this.tools.sql(
        source,
        source.databaseName,
        `SELECT to_char((clock_timestamp()+make_interval(secs=>${request.pauseLimitSeconds})) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        signal,
      );
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(databaseDeadline)
      )
        throw new BackupExecutionError("write_fence_unavailable");
      await context.checkpoint("write_pause", 45);
      signal.throwIfAborted();
      // A separate monotonic watchdog aborts all I/O; PostgreSQL independently ends every fence transaction.
      const cut = new AbortController();
      const abortCut = () => cut.abort();
      if (signal.aborted) cut.abort();
      else signal.addEventListener("abort", abortCut, { once: true });
      const timer = setTimeout(abortCut, request.pauseLimitSeconds * 1000);
      timer.unref();
      const assertCut = () => {
        if (
          cut.signal.aborted ||
          performance.now() >= monotonicDeadline ||
          !fences.every((fence) => fence.alive())
        )
          throw new BackupExecutionError("write_fence_expired");
      };
      try {
        for (const database of databases)
          fences.push(
            await this.tools.acquireFence(
              source,
              database,
              request.pauseLimitSeconds,
              cut.signal,
              databaseDeadline,
            ),
          );
        const databaseCatalogs = Object.fromEntries(
          await Promise.all(
            databases.map(
              async (database) =>
                [
                  database,
                  await this.tools.jsonSql(
                    source,
                    database,
                    RECOVERY_CATALOG_SQL,
                    cut.signal,
                  ),
                ] as const,
            ),
          ),
        );
        const catalog = {
          databases: databaseCatalogs,
          databaseName: source.databaseName,
          migrations: await this.tools.jsonSql(
            source,
            source.databaseName,
            RECOVERY_MIGRATIONS_SQL,
            cut.signal,
          ),
        };
        const auditHeads = await this.tools.jsonSql(
          source,
          source.databaseName,
          RECOVERY_AUDIT_HEADS_SQL,
          cut.signal,
        );
        const coveredOrganizationIds = (await this.tools.jsonSql(
          source,
          source.databaseName,
          "SELECT coalesce(json_agg(id ORDER BY id),'[]'::json) FROM public.organizations",
          cut.signal,
        )) as string[];
        const objectRows = (await this.tools.jsonSql(
          source,
          source.databaseName,
          "SELECT coalesce(json_agg(json_build_object('bucket_id',bucket_id,'name',name,'version',version,'bytes',coalesce((metadata->>'size')::bigint,0)) ORDER BY bucket_id,name,version), '[]'::json) FROM storage.objects",
          cut.signal,
        )) as StorageRow[];
        const objects: BackupObjectInventoryEntry[] = [];
        let parts: BackupEncryptedPart[] = [base, ...(reusable?.wal ?? [])];
        for (let index = 0; index < objectRows.length; index += 1) {
          await context.assertAuthority();
          assertCut();
          const row = objectRows[index]!;
          const path = storageObjectPath(
            source.storageRoot,
            source.storageTenantPrefix,
            row.bucket_id,
            row.name,
            row.version,
          );
          const entry = `objects/${String(index).padStart(8, "0")}`;
          const part = await this.tools.sealCommand(
            repository,
            request.runId,
            "objects",
            entry,
            [
              "exec",
              source.storageContainer,
              "python3",
              "-c",
              READ_OBJECT,
              path,
            ],
            cut.signal,
          );
          if (part.bytes !== Number(row.bytes))
            throw new BackupExecutionError("object_integrity");
          objects.push({
            bucketId: row.bucket_id,
            name: row.name,
            version: row.version,
            entry,
            sha256: part.sha256,
            bytes: part.bytes,
          });
          parts.push(part);
        }
        const restorePoint = `cra_backup_${request.runId.replaceAll("-", "")}`;
        const boundary = (await this.tools.jsonSql(
          source,
          source.databaseName,
          `SELECT json_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'timeline',(SELECT timeline_id FROM pg_control_checkpoint()),'lsn',pg_create_restore_point('${restorePoint}')::text)`,
          cut.signal,
        )) as { systemIdentifier: string; timeline: number; lsn: string };
        const lastWal = await this.tools.sql(
          source,
          source.databaseName,
          "SELECT pg_walfile_name(pg_switch_wal() - 1)",
          cut.signal,
        );
        if (!/^[A-F0-9]{24}$/.test(lastWal))
          throw new BackupExecutionError("wal_gap");
        const walNames = await this.tools.awaitWal(tool, lastWal, cut.signal);
        for (const name of walNames)
          parts.push(
            await this.tools.sealCommand(
              repository,
              request.runId,
              "wal",
              name,
              ["exec", tool, "cat", `--`, `/stage/wal/${name}`],
              cut.signal,
            ),
          );
        if (reusable) {
          const archived = await archive.checkpoint(lastWal, cut.signal);
          const first = reusable.wal[0]!.name;
          const merged = new Map(
            [
              ...parts.filter((part) => part.kind === "wal"),
              ...archived.filter(
                (part) =>
                  part.kind === "wal" &&
                  part.name >= first &&
                  part.name <= lastWal,
              ),
            ].map((part) => [part.name, part]),
          );
          const names = [...merged.keys()].sort();
          assertWalSequence(names);
          const retained = parts.filter((part) => part.kind !== "wal");
          parts = [...retained, ...names.map((name) => merged.get(name)!)];
        } else await archive.checkpoint(lastWal, cut.signal);
        const certifiedWal = [
          ...new Set(
            parts
              .filter((part) => part.kind === "wal")
              .map((part) => part.name),
          ),
        ].sort();
        assertWalSequence(certifiedWal);
        if (certifiedWal.at(-1) !== lastWal)
          throw new BackupExecutionError("wal_gap");
        const externalKeyChecks: { alias: string; canaryPartId: string }[] = [];
        for (const [alias, key] of Object.entries(
          source.externalRecoveryKeys ?? {},
        )) {
          if (
            !/^[a-z][a-z0-9_-]{0,63}$/.test(alias) ||
            !key.containerPath.startsWith("/") ||
            key.containerPath.includes("..") ||
            containsControl(key.containerPath)
          )
            throw new BackupExecutionError("unsafe_key_mount");
          const hash = (
            await this.process.run(
              "docker",
              [
                "exec",
                source.databaseContainer,
                "sha256sum",
                "--",
                key.containerPath,
              ],
              cut.signal,
            )
          ).split(/\s/)[0]!;
          if (!/^[a-f0-9]{64}$/.test(hash))
            throw new BackupExecutionError("external_key_unavailable");
          const canary = await repository.sealPart(
            request.runId,
            "recovery-key",
            `keys/${alias}.json`,
            Readable.from([JSON.stringify({ alias, sha256: hash })]),
            cut.signal,
          );
          parts.push(canary);
          externalKeyChecks.push({ alias, canaryPartId: canary.id });
        }
        const inventory: BackupInventory = {
          catalog,
          auditHeads,
          objects,
          externalKeyChecks,
        };
        const inventoryPart = await repository.sealPart(
          request.runId,
          "inventory",
          "inventory.json",
          Readable.from([JSON.stringify(inventory)]),
          cut.signal,
        );
        parts.push(inventoryPart);
        await context.assertAuthority();
        await Promise.all(fences.map((fence) => fence.verify()));
        assertCut();
        if (cut.signal.aborted || !fences.every((fence) => fence.alive()))
          throw new BackupExecutionError("write_fence_expired");
        const unsigned = {
          formatVersion: 1 as const,
          instanceId: request.instanceId,
          runId: request.runId,
          repositoryGeneration: request.repositoryGeneration,
          configurationRevision: request.configurationRevision,
          keyId: request.keyId,
          capturedAt: new Date().toISOString(),
          baseCapturedAt:
            reusable?.baseCapturedAt ?? new Date(started).toISOString(),
          baseRunId: reusable
            ? (previous!.baseRunId ?? previous!.runId)
            : request.runId,
          coveredOrganizationIds,
          checkpoint: {
            ...boundary,
            postgresVersion: "17.6" as const,
            restorePoint,
          },
          parts,
          inventoryDigest: backupDigest(inventory),
          auditHeadsDigest: backupDigest(auditHeads),
        };
        const certificate: BackupCertificate = {
          ...unsigned,
          certificateDigest: backupDigest(unsigned),
        };
        await repository.sealCertificate(certificate, inventory, cut.signal);
        await Promise.all(fences.map((fence) => fence.verify()));
        assertCut();
        if (cut.signal.aborted || !fences.every((fence) => fence.alive()))
          throw new BackupExecutionError("write_fence_expired");
        await context.checkpoint("certifying", 95);
        return {
          coveredOrganizationIds,
          certificate,
          bytes: parts.reduce((sum, part) => sum + part.cipherBytes, 0),
          objectCount: objects.length,
          durationMs: Date.now() - started,
        };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abortCut);
        for (const fence of fences) await fence.release();
      }
    } catch (error) {
      if (error instanceof BackupExecutionError) throw error;
      throw new BackupExecutionError(
        signal.aborted ? "cancelled" : "capture_incomplete",
      );
    } finally {
      receiver?.kill("SIGTERM");
      await receiverExited?.catch(() => undefined);
      const cleanupSignal = AbortSignal.timeout(10_000);
      const toolRemoved = await this.process
        .run("docker", ["rm", "-f", tool], cleanupSignal)
        .then(
          () => true,
          () => false,
        );
      const slotsRemoved = await this.tools
        .sql(
          source,
          source.databaseName,
          `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name IN ('${holdSlot}','${receiverSlot}') AND NOT active; SELECT count(*) FROM pg_replication_slots WHERE slot_name IN ('${holdSlot}','${receiverSlot}')`,
          cleanupSignal,
        )
        .then(
          (count) => count.trim() === "0",
          () => false,
        );
      if (directory) await rm(directory, { recursive: true, force: true });
      if (toolRemoved && slotsRemoved && ownershipPath)
        await rm(ownershipPath, { force: true });
      await releasePublication();
    }
  }

  async preflight(
    mounts: ResolvedBackupMounts,
    signal: AbortSignal,
  ): Promise<void> {
    const source = mounts.source;
    if (mounts.staging.kind === "encrypted")
      await assertStageOutsideSourceMounts(
        mounts.staging.path,
        Object.values(this.runtime.sources).flatMap((value) => [
          value.databaseContainer,
          value.storageContainer,
        ]),
        (containers) =>
          this.process.run(
            "docker",
            ["inspect", "--format", "{{json .Mounts}}", ...containers],
            signal,
          ),
      );
    const gpgOptions = await this.process.run(
      this.runtime.gpgBinary,
      ["--no-options", "--dump-options"],
      signal,
      undefined,
      65536,
    );
    if (
      ![
        "--force-ocb",
        "--symmetric",
        "--passphrase-fd",
        "--no-symkey-cache",
      ].every((option) => gpgOptions.split("\n").includes(option))
    )
      throw new BackupExecutionError("incompatible_runtime");
    const crypto = new EncryptedBackupRepository({
      repository: mounts.repository.path,
      keyFile: mounts.key.path,
      keyId: mounts.key.keyId,
      gpgBinary: this.runtime.gpgBinary,
      maximumPartBytes: 1024,
    });
    const canary = await crypto.sealPart(
      randomUUID(),
      "inventory",
      "runtime-canary.json",
      Readable.from(["m15-05-ocb-runtime-check"]),
      signal,
    );
    try {
      let plaintext = "";
      await crypto.openPartToSink(
        canary,
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            plaintext += chunk.toString();
            done();
          },
        }),
        signal,
      );
      if (plaintext !== "m15-05-ocb-runtime-check")
        throw new BackupExecutionError("incompatible_runtime");
    } finally {
      await rm(crypto.partPath(canary), { force: true });
    }
    const version = await this.tools.sql(
      source,
      source.databaseName,
      "SHOW server_version",
      signal,
    );
    if (!/^17\.6(?:\s|$)/.test(version))
      throw new BackupExecutionError("incompatible_runtime");
    const walSize = await this.tools.sql(
      source,
      source.databaseName,
      "SHOW wal_segment_size",
      signal,
    );
    if (walSize !== "16MB")
      throw new BackupExecutionError("incompatible_runtime");
    const needsRecoveryKey = await this.tools.sql(
      source,
      source.databaseName,
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN ('supabase_vault','pgsodium'))",
      signal,
    );
    if (needsRecoveryKey === "t" && !source.externalRecoveryKeys?.pgsodium)
      throw new BackupExecutionError("external_key_unavailable");
    if (
      (await this.tools.sql(
        source,
        source.databaseName,
        "SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')",
        signal,
      )) !== "0"
    )
      throw new BackupExecutionError("unsupported_tablespace");
    const bytes = Number(
      await this.tools.sql(
        source,
        source.databaseName,
        "SELECT sum(pg_database_size(oid)) FROM pg_database WHERE datallowconn",
        signal,
      ),
    );
    if (!Number.isFinite(bytes) || bytes * 1.1 > mounts.staging.maximumBytes)
      throw new BackupExecutionError("insufficient_staging");
    const free = await statfs(mounts.repository.path);
    if (Number(free.bavail) * Number(free.bsize) < bytes * 1.2)
      throw new BackupExecutionError("insufficient_repository");
  }
}
