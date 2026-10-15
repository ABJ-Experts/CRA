import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import { NativeBackupProcess } from "../capture/native-backup-process";
import { storageObjectPath } from "../capture/native-backup-capture.adapter";
import { EncryptedBackupRepository } from "../repository/encrypted-backup.repository";
import type {
  AuthenticatedRecovery,
  IsolatedRecoveryTarget,
  RecoveryDependencies,
} from "./isolated-backup-verifier";

import { assertFreshTarget, assertRecoveryProfile } from "./restore-safety";
import {
  verifyRecoveryHistory,
  type RecoveryCatalog,
} from "./recovery-historical-checks";
import {
  assertRecoveryKeyDependencies,
  prepareExternalRecoveryKeys,
  type ExternalRecoveryKeyMount,
} from "./external-recovery-keys";
import {
  resolveRecoveryConfiguration,
  assertStageOutsideSourceMounts,
  type BackupRecoveryProfile,
  type RecoveryApplicationTarget,
  type RecoveryApplicationProbes,
  type RecoveryExternalKeyProbe,
} from "./restore-configuration";
export type {
  BackupRecoveryProfile,
  RecoveryApplicationTarget,
  RecoveryApplicationProbes,
  RecoveryExternalKeyProbe,
} from "./restore-configuration";
import {
  recoveryOwnershipLabels,
  recordRecoveryStagingOwnership,
} from "./recovery-reconciliation";
import { writeRecoveryConfiguration } from "./recovery-target-files";
import { extractRecoveryTar } from "./safe-tar-extractor";
import { removeOwnedRecoveryResources } from "./recovery-owned-cleanup";
import {
  prepareRecoveryObjectVolume,
  checkRecoveryObjectVolume,
} from "./recovery-object-volume";

/** Executable configuration is mounted; callers can select aliases, never supply paths or commands. */
export function createDockerRecoveryDependencies(
  runtime: BackupMountedRuntime,
  profiles: Readonly<Record<string, BackupRecoveryProfile>>,
  applicationProbes?: RecoveryApplicationProbes,
  externalKeyProbe?: RecoveryExternalKeyProbe,
  process = new NativeBackupProcess(),
): RecoveryDependencies {
  return {
    maximumDurationMs: (request) =>
      profiles[request.targetProfile]?.deadlineMs ?? 0,
    async openCertified(request, signal) {
      const mounts = await resolveRecoveryConfiguration(
        runtime,
        profiles,
        request,
      );
      await assertStageOutsideSourceMounts(
        mounts.staging,
        Object.values(runtime.sources).flatMap((source) => [
          source.databaseContainer,
          source.storageContainer,
        ]),
        (containers) =>
          process.run(
            "docker",
            ["inspect", "--format", "{{json .Mounts}}", ...containers],
            signal,
          ),
      );
      const scratchName = `cra-backup-restore-${randomUUID()}`;
      const scratch = await mkdtemp(join(mounts.staging, `${scratchName}-`));
      try {
        await recordRecoveryStagingOwnership(
          request.instanceId,
          request.runId,
          scratchName,
          scratch,
        );
        const repository = new EncryptedBackupRepository({
          repository: mounts.repository,
          keyFile: mounts.keyFile,
          keyId: mounts.keyId,
          gpgBinary: runtime.gpgBinary,
          maximumPartBytes: mounts.profile.maxExpandedBytes,
          keyFilesById: Object.fromEntries(
            Object.values(runtime.keys).map((key) => [key.keyId, key.path]),
          ),
        });
        const opened = await repository.openCertificate(
          {
            certificate: request.certificate,
            parentRunId: request.parentRunId,
          },
          scratch,
          signal,
        );
        return {
          certificate: request.certificate,
          inventory: opened.inventory,
          materialize: (part, destination, currentSignal) =>
            repository.openPart(part, destination, currentSignal),
        };
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
    async createTarget(request, signal) {
      const mounts = await resolveRecoveryConfiguration(
        runtime,
        profiles,
        request,
      );
      await assertStageOutsideSourceMounts(
        mounts.staging,
        Object.values(runtime.sources).flatMap((source) => [
          source.databaseContainer,
          source.storageContainer,
        ]),
        (containers) =>
          process.run(
            "docker",
            ["inspect", "--format", "{{json .Mounts}}", ...containers],
            signal,
          ),
      );
      return NativeDockerRecoveryTarget.create(
        mounts.staging,
        mounts.profile,
        Object.values(runtime.sources).flatMap((source) => [
          source.databaseContainer,
          source.storageContainer,
          source.network,
        ]),
        process,
        signal,
        applicationProbes,
        externalKeyProbe,
        { instanceId: request.instanceId, runId: request.runId },
      );
    },
  };
}

export class NativeDockerRecoveryTarget implements IsolatedRecoveryTarget {
  private databaseName = "postgres";
  private sqlUser = "postgres";
  private readonly probeAdmin = `cra_restore_admin_${randomUUID().replaceAll("-", "")}`;
  private readonly databasePassword = randomBytes(32).toString("hex");
  private objectVolumeAttempted = false;
  private objectCount = 0;
  private objectBytes = 0;
  private containerAttempted = false;
  private networkAttempted = false;
  private ownershipChanged = false;
  private externalKeyMounts: readonly ExternalRecoveryKeyMount[] = [];
  private readonly network: string;
  private readonly deadline: AbortSignal;

  private constructor(
    private readonly name: string,
    private readonly directory: string,
    private readonly profile: BackupRecoveryProfile,
    private readonly process: NativeBackupProcess,
    private readonly applicationProbes?: RecoveryApplicationProbes,
    private readonly externalKeyProbe?: RecoveryExternalKeyProbe,
    private readonly ownership: Readonly<Record<string, string>> = {
      "cra.backup.restore": name,
    },
  ) {
    this.network = `${name}-network`;
    this.deadline = AbortSignal.timeout(profile.deadlineMs);
  }

  static async create(
    staging: string,
    profile: BackupRecoveryProfile,
    sourceNames: readonly string[],
    process: NativeBackupProcess,
    signal: AbortSignal,
    applicationProbes?: RecoveryApplicationProbes,
    externalKeyProbe?: RecoveryExternalKeyProbe,
    identity?: { readonly instanceId: string; readonly runId: string },
  ): Promise<NativeDockerRecoveryTarget> {
    assertRecoveryProfile(profile);
    const name = `cra-backup-restore-${randomUUID()}`;
    const names = await process.run(
      "docker",
      ["ps", "--all", "--format", "{{.Names}}"],
      signal,
    );
    assertFreshTarget({ name, existingNames: names.split("\n"), sourceNames });
    const directory = await mkdtemp(join(staging, `${name}-`));
    const target = new NativeDockerRecoveryTarget(
      name,
      directory,
      profile,
      process,
      applicationProbes,
      externalKeyProbe,
      identity
        ? recoveryOwnershipLabels(
            identity.instanceId,
            identity.runId,
            name,
            basename(directory),
          )
        : { "cra.backup.restore": name },
    );
    try {
      if (identity)
        await recordRecoveryStagingOwnership(
          identity.instanceId,
          identity.runId,
          name,
          directory,
        );
      target.networkAttempted = true;
      await process.run(
        "docker",
        [
          "network",
          "create",
          "--internal",
          ...Object.entries(target.ownership).flatMap(([key, value]) => [
            "--label",
            `${key}=${value}`,
          ]),
          target.network,
        ],
        signal,
      );
      return target;
    } catch (error) {
      await target.destroy();
      throw error;
    }
  }

  async assertIsolated(signal: AbortSignal): Promise<void> {
    const value = await this.run(
      [
        "network",
        "inspect",
        "--format",
        '{{.Internal}} {{index .Labels "cra.backup.restore"}}',
        this.network,
      ],
      signal,
    );
    if (value !== `true ${this.name}`)
      throw new BackupExecutionError("recovery_isolation_failed");
  }

  async restore(
    recovery: AuthenticatedRecovery,
    signal: AbortSignal,
  ): Promise<void> {
    const catalog = recovery.inventory.catalog as RecoveryCatalog;
    if (
      !catalog ||
      typeof catalog.databaseName !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(catalog.databaseName) ||
      !catalog.databases
    )
      throw new BackupExecutionError("recovery_inventory_invalid");
    this.databaseName = catalog.databaseName;
    assertRecoveryKeyDependencies(
      catalog.databases,
      recovery.inventory.externalKeyChecks,
    );
    const roles = (catalog.databases[this.databaseName] as { roles?: unknown })
      ?.roles;
    if (!Array.isArray(roles))
      throw new BackupExecutionError("recovery_inventory_invalid");
    const bootstrap = ["supabase_admin", "postgres"].find((name) =>
      roles.some(
        (role: unknown) =>
          role !== null &&
          typeof role === "object" &&
          "rolname" in role &&
          role.rolname === name &&
          "rolsuper" in role &&
          role.rolsuper === true &&
          "rolcanlogin" in role &&
          role.rolcanlogin === true,
      ),
    );
    if (!bootstrap) throw new BackupExecutionError("incompatible_runtime");
    this.sqlUser = bootstrap;
    const pgdata = join(this.directory, "pgdata");
    const wal = join(this.directory, "wal");
    const objects = join(this.directory, "objects");
    await Promise.all([
      mkdir(pgdata, { mode: 0o700 }),
      mkdir(wal, { mode: 0o700 }),
      mkdir(objects, { mode: 0o700 }),
    ]);
    this.externalKeyMounts = await prepareExternalRecoveryKeys(
      recovery.inventory,
      recovery.certificate.parts,
      this.profile.externalRecoveryKeys ?? {},
      this.directory,
      (part, path, current) => recovery.materialize(part, path, current),
      this.combined(signal),
    );
    const bases = recovery.certificate.parts.filter(
      (part) => part.kind === "base" && part.name === "base.tar",
    );
    if (
      bases.length !== 1 ||
      recovery.certificate.parts.some(
        (part) => part.kind === "base" && part.name !== "base.tar",
      )
    )
      throw new BackupExecutionError("recovery_base_invalid");
    const archive = join(this.directory, "base.tar");
    await recovery.materialize(bases[0]!, archive, this.combined(signal));
    await extractRecoveryTar(
      archive,
      pgdata,
      this.profile,
      this.combined(signal),
    );
    await rm(archive);
    await this.run(
      [
        "run",
        "--pull=never",
        "--rm",
        "--network",
        "none",
        "--mount",
        `type=bind,src=${pgdata},dst=/restore,readonly`,
        "--entrypoint",
        "pg_verifybackup",
        this.profile.image,
        "/restore",
      ],
      signal,
    );
    for (const part of recovery.certificate.parts.filter(
      (part) => part.kind === "wal",
    )) {
      if (!/^(?:[A-F0-9]{24}|[A-F0-9]{8}\.history)$/.test(part.name))
        throw new BackupExecutionError("wal_gap");
      await recovery.materialize(
        part,
        join(wal, part.name),
        this.combined(signal),
      );
    }
    for (const object of recovery.inventory.objects) {
      const matches = recovery.certificate.parts.filter(
        (part) => part.kind === "objects" && part.name === object.entry,
      );
      if (
        matches.length !== 1 ||
        matches[0]!.sha256 !== object.sha256 ||
        matches[0]!.bytes !== object.bytes
      )
        throw new BackupExecutionError("object_integrity");
      const destination = storageObjectPath(
        objects,
        this.profile.storageTenantPrefix,
        object.bucketId,
        object.name,
        object.version,
      );
      await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
      await recovery.materialize(
        matches[0]!,
        destination,
        this.combined(signal),
      );
    }
    await prepareRecoveryObjectVolume(
      {
        ...this.objectVolumeOptions(),
        backing: this.profile.objectVolumeBacking,
        inventory: recovery.inventory.objects,
        prefix: this.profile.storageTenantPrefix,
        onAttempt: () => {
          this.objectVolumeAttempted = true;
        },
      },
      (args) => this.run(args, signal),
    );
    this.objectCount = recovery.inventory.objects.length;
    this.objectBytes = recovery.inventory.objects.reduce(
      (total, object) => total + object.bytes,
      0,
    );
    const point = recovery.certificate.checkpoint;
    if (
      !/^cra_backup_[a-f0-9]{32}$/.test(point.restorePoint) ||
      !Number.isInteger(point.timeline) ||
      point.timeline < 1
    )
      throw new BackupExecutionError("recovery_checkpoint_invalid");
    await writeRecoveryConfiguration(
      pgdata,
      point.restorePoint,
      point.timeline,
      this.externalKeyMounts.length > 0,
    );
    this.ownershipChanged = true;
    await this.run(
      [
        "run",
        "--pull=never",
        "--rm",
        "--network",
        "none",
        "--mount",
        `type=bind,src=${this.directory},dst=/restore`,
        "--entrypoint",
        "chown",
        this.profile.image,
        "-R",
        "100:101",
        "/restore/pgdata",
        "/restore/wal",
        ...this.externalKeyMounts.map(
          (mount) => `/restore/${mount.path.split("/").at(-1)!}`,
        ),
      ],
      signal,
    );
    this.ownershipChanged = true;
    await this.assertIsolated(signal);
    this.containerAttempted = true;
    await this.run(
      [
        "run",
        "--pull=never",
        "--detach",
        "--name",
        this.name,
        ...Object.entries(this.ownership).flatMap(([key, value]) => [
          "--label",
          `${key}=${value}`,
        ]),
        "--network",
        this.network,
        "--dns",
        "127.0.0.1",
        "--dns-search",
        ".",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16777216",
        "--mount",
        `type=bind,src=${pgdata},dst=/var/lib/postgresql/data`,
        "--mount",
        `type=bind,src=${wal},dst=/restore-wal,readonly`,
        ...this.externalKeyMounts.flatMap((mount) => [
          "--mount",
          `type=bind,src=${mount.path},dst=${mount.targetPath},readonly`,
        ]),
        "--user",
        "100:101",
        "--entrypoint",
        "postgres",
        this.profile.image,
        "-D",
        "/var/lib/postgresql/data",
        "-c",
        "config_file=/var/lib/postgresql/data/recovery-target.conf",
      ],
      signal,
    );
    await this.awaitReady(signal);
    if (
      (await this.sql("select pg_is_in_recovery()::text", signal)) !== "false"
    )
      throw new BackupExecutionError("recovery_checkpoint_unreached");
    if ((await this.sql("show server_version", signal)) !== "17.6")
      throw new BackupExecutionError("incompatible_runtime");
    if (
      (await this.sql(
        "select system_identifier::text from pg_control_system()",
        signal,
      )) !== point.systemIdentifier
    )
      throw new BackupExecutionError("recovery_source_identity_mismatch");
    await this.run(
      [
        "exec",
        this.name,
        "/bin/bash",
        "-c",
        "if timeout 3 bash -c 'echo > /dev/tcp/1.1.1.1/443' >/dev/null 2>&1; then exit 1; else exit 0; fi",
      ],
      signal,
    );
  }

  async verifyHistorical(
    recovery: AuthenticatedRecovery,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    return verifyRecoveryHistory(recovery, {
      sql: (query, database) => this.sql(query, signal, database),
      objectDirectory: join(this.directory, "objects"),
      prefix: this.profile.storageTenantPrefix,
      verifyObjectVolume: () =>
        checkRecoveryObjectVolume(
          this.objectVolumeOptions(),
          "verify",
          (args) => this.run(args, signal),
        ),
      externalKeyProbe: (alias) =>
        this.externalKeyProbe
          ? this.externalKeyProbe(
              alias,
              this.applicationTarget(),
              this.combined(signal),
            )
          : Promise.resolve(false),
      signal: this.combined(signal),
    });
  }

  async quarantine(signal: AbortSignal): Promise<readonly string[]> {
    await this.sql(
      `begin;
      create role ${this.probeAdmin} superuser login password '${this.databasePassword}';
      update public.users set is_active=false,session_epoch_at=greatest(session_epoch_at,clock_timestamp());
      update auth.users set encrypted_password='',banned_until='infinity';
      delete from auth.sessions; delete from auth.refresh_tokens;
      set local session authorization postgres;
      do $markers$ declare o record; begin for o in select id,audit_dataset_epoch from public.organizations order by id loop perform public.m13_04_rotate_dataset_marker(o.id,gen_random_uuid(),o.audit_dataset_epoch,'restored'); end loop; end $markers$;
      reset session authorization;
      do $quarantine$ declare r record; begin for r in select rolname from pg_roles where rolcanlogin and rolname<>'${this.probeAdmin}' loop execute format('alter role %I password null',r.rolname); execute format('alter role %I nologin',r.rolname); end loop; end $quarantine$;
      commit;`,
      signal,
    );
    this.sqlUser = this.probeAdmin;
    const checks = await this.sql(
      `select ((not exists(select 1 from public.users where is_active)) and (not exists(select 1 from auth.sessions)) and (not exists(select 1 from auth.refresh_tokens)) and (not exists(select 1 from auth.users where encrypted_password<>'' or banned_until is distinct from 'infinity'::timestamptz)) and (not exists(select 1 from pg_roles where rolcanlogin and rolname<>'${this.probeAdmin}')) and (not exists(select 1 from public.organizations where audit_dataset_context<>'restored')))::text`,
      signal,
    );
    if (checks !== "true")
      throw new BackupExecutionError("recovery_quarantine_failed");
    await this.run(
      [
        "exec",
        "--interactive",
        "--user",
        "0",
        this.name,
        "/bin/sh",
        "-c",
        "cat > /var/lib/postgresql/data/recovery-hba.conf && chown 100:101 /var/lib/postgresql/data/recovery-hba.conf",
      ],
      signal,
      "local all all trust\nhost all all 0.0.0.0/0 scram-sha-256\nhost all all ::/0 scram-sha-256\n",
    );
    await this.sql("select pg_reload_conf()", signal);
    return ["credential_quarantine", "session_revocation", "dataset_markers"];
  }

  async probeApplication(signal: AbortSignal): Promise<readonly string[]> {
    return this.applicationProbes
      ? this.applicationProbes(this.applicationTarget(), this.combined(signal))
      : [];
  }

  private objectVolumeOptions() {
    return {
      name: `${this.name}-objects`,
      directory: this.directory,
      objectDirectory: join(this.directory, "objects"),
      ownership: this.ownership,
      maximumBytes: this.profile.objectVolumeBacking?.maximumBytes ?? 0,
      maximumEntries: this.profile.maxEntries,
      expectedCount: this.objectCount,
      expectedBytes: this.objectBytes,
    };
  }
  private applicationTarget(): RecoveryApplicationTarget {
    return {
      databaseContainer: this.name,
      network: this.network,
      directory: this.directory,
      objectDirectory: join(this.directory, "objects"),
      objectVolume: `${this.name}-objects`,
      databaseName: this.databaseName,
      databaseUser: this.sqlUser,
      databasePassword: this.databasePassword,
      ownership: this.ownership,
      sql: (query, signal, database) => this.sql(query, signal, database),
      run: (args, signal, input) => this.run(args, signal, input),
      cleanupRun: (args, signal, input) =>
        this.process.run("docker", args, signal, input, 32 * 1024 * 1024),
    };
  }
  private async awaitReady(signal: AbortSignal): Promise<void> {
    while (!this.combined(signal).aborted) {
      try {
        if (
          (await this.sql("select (not pg_is_in_recovery())::text", signal)) ===
          "true"
        )
          return;
      } catch {
        this.combined(signal).throwIfAborted();
        if (
          (await this.run(
            ["inspect", "--format", "{{.State.Running}}", this.name],
            signal,
          )) !== "true"
        )
          throw new BackupExecutionError("recovery_checkpoint_unreached");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    throw new BackupExecutionError("recovery_checkpoint_unreached");
  }
  private sql(
    query: string,
    signal: AbortSignal,
    database = this.databaseName,
  ): Promise<string> {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(database))
      throw new BackupExecutionError("unsafe_database_identity");
    return this.run(
      [
        "exec",
        "--interactive",
        this.name,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "/tmp",
        "-U",
        this.sqlUser,
        "-d",
        database,
        "-At",
      ],
      signal,
      query,
    );
  }
  private combined(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, this.deadline]);
  }
  private run(
    args: readonly string[],
    signal: AbortSignal,
    input?: string,
  ): Promise<string> {
    return this.process.run(
      "docker",
      args,
      this.combined(signal),
      input,
      32 * 1024 * 1024,
    );
  }

  async destroy(): Promise<void> {
    const signal = AbortSignal.timeout(30000);
    await removeOwnedRecoveryResources(
      {
        name: this.name,
        network: this.network,
        ownership: this.ownership,
        containerAttempted: this.containerAttempted,
        objectVolumeAttempted: this.objectVolumeAttempted,
        networkAttempted: this.networkAttempted,
      },
      (args) => this.process.run("docker", args, signal),
    );
    if (this.ownershipChanged)
      await this.process.run(
        "docker",
        [
          "run",
          "--pull=never",
          "--rm",
          "--network",
          "none",
          "--mount",
          `type=bind,src=${this.directory},dst=/restore`,
          "--entrypoint",
          "chown",
          this.profile.image,
          "-R",
          `${process.getuid?.() ?? 501}:${process.getgid?.() ?? 20}`,
          "/restore/pgdata",
          "/restore/wal",
        ],
        signal,
      );
    await rm(this.directory, { recursive: true, force: true });
  }
}
