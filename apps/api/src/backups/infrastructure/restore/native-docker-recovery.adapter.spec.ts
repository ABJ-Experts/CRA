/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Asynchronous port doubles are asserted as mocks. */
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedBackupRepository } from "../repository/encrypted-backup.repository";
import {
  NativeDockerRecoveryTarget,
  createDockerRecoveryDependencies,
  type RecoveryApplicationTarget,
} from "./native-docker-recovery.adapter";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import type { BackupEncryptedPart } from "../../application/backup-execution.port";
import type { AuthenticatedRecovery } from "./isolated-backup-verifier";
import {
  RECOVERY_AUDIT_HEADS_SQL,
  RECOVERY_AUDIT_INTEGRITY_SQL,
  RECOVERY_CATALOG_SQL,
  RECOVERY_MIGRATIONS_SQL,
  RECOVERY_OBJECT_METADATA_SQL,
} from "./restore-inventory";
import { fixture, tar, profile } from "./native-recovery-test.fixture";
describe("native isolated Docker recovery", () => {
  let root: string;
  const signal = () => AbortSignal.timeout(10000);
  beforeEach(async () => {
    root = await realpath(
      await mkdtemp(join(tmpdir(), "m15-05-restore-test-")),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("provisions internal network before postgres, restores authenticated parts and runs all historical checks before quarantine", async () => {
    const f = fixture();
    let probe: RecoveryApplicationTarget | undefined;
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      ["source"],
      f.process,
      signal(),
      async (value) => {
        probe = value;
        return ["authentication"];
      },
    );
    await target.assertIsolated(signal());
    await target.restore(f.recovery, signal());
    expect(await target.verifyHistorical(f.recovery, signal())).toHaveLength(7);
    expect(await target.quarantine(signal())).toHaveLength(3);
    expect(await target.probeApplication(signal())).toEqual(["authentication"]);
    expect(probe?.databasePassword).toMatch(/^[a-f0-9]{64}$/);
    expect(await probe!.sql("select true", signal())).toBe("true");
    expect(await probe!.run(["version"], signal())).toBe("");
    expect(await probe!.cleanupRun(["version"], signal())).toBe("");
    const launch = f.observed.find(
      (args) =>
        args.includes("postgres") &&
        args[0] === "run" &&
        args.includes("--detach"),
    )!;
    expect(launch).toContain("--read-only");
    expect(launch).not.toContain("--publish");
    expect(f.observed[1]).toContain("--internal");
    const config = await readFile(
      join(probe!.directory, "pgdata/recovery-target.conf"),
      "utf8",
    );
    expect(config).toContain("shared_preload_libraries='' ".trim());
    expect(config).toContain("primary_conninfo=''");
    expect(config).toContain("recovery_target_name='cra_backup_");
    await target.destroy();
    expect(
      f.observed.some((args) => args[0] === "network" && args[1] === "rm"),
    ).toBe(true);
  });
  it("does not report application checks when no isolated application adapter is mounted", async () => {
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
    );
    expect(await target.probeApplication(signal())).toEqual([]);
    await target.destroy();
  });
  it("rejects historical certificates that omit required external-key recovery checks", async () => {
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
    );
    const catalog = f.recovery.inventory.catalog as {
      databases: Record<string, Record<string, unknown>>;
    };
    const recovery = {
      ...f.recovery,
      inventory: {
        ...f.recovery.inventory,
        catalog: {
          ...catalog,
          databases: {
            ...catalog.databases,
            postgres: {
              ...catalog.databases.postgres,
              extensions: [{ name: "supabase_vault" }],
            },
          },
        },
      },
    };
    await expect(target.restore(recovery, signal())).rejects.toThrow(
      "recovery_key_unavailable",
    );
    expect(f.observed.some((args) => args.includes("--detach"))).toBe(false);
    await target.destroy();
  });
  it("rejects invalid metadata and unexpected base/WAL entries before starting postgres", async () => {
    for (const change of [
      {
        inventory: {
          catalog: null,
          auditHeads: [],
          objects: [],
          externalKeyChecks: [],
        },
      },
      { certificate: { ...fixture().recovery.certificate, parts: [] } },
      {
        certificate: {
          ...fixture().recovery.certificate,
          parts: [
            ...fixture().recovery.certificate.parts,
            {
              ...fixture().recovery.certificate.parts[0]!,
              kind: "wal" as const,
              name: "../secret",
            },
          ],
        },
      },
    ]) {
      const f = fixture();
      const target = await NativeDockerRecoveryTarget.create(
        root,
        profile,
        [],
        f.process,
        signal(),
      );
      await expect(
        target.restore({ ...f.recovery, ...change }, signal()),
      ).rejects.toThrow();
      expect(
        f.observed.some(
          (args) => args[0] === "run" && args.includes("--detach"),
        ),
      ).toBe(false);
      await target.destroy();
    }
  });
  it("rejects catalog, migrations, audit discontinuity and unavailable external keys", async () => {
    for (const input of [
      RECOVERY_CATALOG_SQL,
      RECOVERY_MIGRATIONS_SQL,
      RECOVERY_OBJECT_METADATA_SQL,
      RECOVERY_AUDIT_HEADS_SQL,
      RECOVERY_AUDIT_INTEGRITY_SQL,
    ]) {
      const f = fixture();
      const target = await NativeDockerRecoveryTarget.create(
        root,
        profile,
        [],
        f.process,
        signal(),
      );
      await target.restore(f.recovery, signal());
      const original = f.sql.getMockImplementation()!;
      f.sql.mockImplementation(async (query) =>
        query === input
          ? input === RECOVERY_AUDIT_INTEGRITY_SQL
            ? "false"
            : JSON.stringify({ changed: true })
          : original(query),
      );
      await expect(
        target.verifyHistorical(f.recovery, signal()),
      ).rejects.toThrow();
      await target.destroy();
    }
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
    );
    await target.restore(f.recovery, signal());
    await expect(
      target.verifyHistorical(
        {
          ...f.recovery,
          inventory: {
            ...f.recovery.inventory,
            externalKeyChecks: [{ alias: "missing", canaryPartId: "key" }],
          },
        },
        signal(),
      ),
    ).rejects.toMatchObject({
      failedCheck: "external_keys",
      completedChecks: expect.arrayContaining([
        "schema_migrations",
        "object_integrity",
      ]) as unknown,
    });
    await target.destroy();
  });
  it("uses the certified Supabase bootstrap administrator before creating a fresh target-only login", async () => {
    const f = fixture();
    const roles = [
      { rolname: "supabase_admin", rolsuper: true, rolcanlogin: true },
      { rolname: "postgres", rolsuper: false, rolcanlogin: true },
    ];
    const recovery = {
      ...f.recovery,
      inventory: {
        ...f.recovery.inventory,
        catalog: {
          databaseName: "postgres",
          databases: { postgres: { sequences: [], roles } },
          migrations: [],
        },
      },
    };
    const original = f.sql.getMockImplementation()!;
    f.sql.mockImplementation(async (q) =>
      q === RECOVERY_CATALOG_SQL
        ? JSON.stringify({ sequences: [], roles })
        : original(q),
    );
    let user = "";
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
      async (value) => {
        user = value.databaseUser;
        return [];
      },
    );
    await target.restore(recovery, signal());
    await target.verifyHistorical(recovery, signal());
    await target.quarantine(signal());
    await target.probeApplication(signal());
    expect(
      f.observed.some(
        (args) => args.includes("psql") && args.includes("supabase_admin"),
      ),
    ).toBe(true);
    expect(user).toMatch(/^cra_restore_admin_[a-f0-9]{32}$/);
    expect(
      f.sql.mock.calls.some(([query]) =>
        query.includes("set local session authorization postgres"),
      ),
    ).toBe(true);
    await target.destroy();
  });
  it("fails promptly when a provisioned target exits before replay reaches its certified point", async () => {
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
    );
    const originalSql = f.sql.getMockImplementation()!;
    f.sql.mockImplementation(async (q) => {
      if (q === "select (not pg_is_in_recovery())::text")
        throw new Error("not ready");
      return originalSql(q);
    });
    const originalRun = jest.mocked(f.process.run).getMockImplementation()!;
    jest
      .mocked(f.process.run)
      .mockImplementation(async (binary, args, current, input, max) =>
        args.includes("{{.State.Running}}")
          ? "false"
          : originalRun(binary, args, current, input, max),
      );
    await expect(target.restore(f.recovery, signal())).rejects.toThrow(
      "recovery_checkpoint_unreached",
    );
    await target.destroy();
  });
  it("fails closed for unmapped or unsafe mounted aliases", async () => {
    const deps = createDockerRecoveryDependencies(
      {
        sources: {},
        repositories: {},
        staging: {},
        keys: {},
        gpgBinary: "gpg",
      },
      { local: profile },
    );
    await expect(
      deps.createTarget({ targetProfile: "local" } as never, signal()),
    ).rejects.toThrow("unknown_mount_alias");
  });
  it("validates mounted staging, repository and key authority before opening an independently sealed certificate", async () => {
    const stage = join(root, "stage"),
      repo = join(root, "repo"),
      key = join(root, "key");
    await mkdir(stage, { mode: 0o700 });
    await chmod(stage, 0o700);
    await mkdir(repo, { mode: 0o700 });
    await chmod(repo, 0o700);
    await writeFile(key, "test-key", { mode: 0o600 });
    await chmod(key, 0o600);
    const runtime: BackupMountedRuntime = {
      sources: {},
      repositories: {
        repo: {
          path: repo,
          generation: "generation",
          offHost: true,
          residency: "test",
        },
      },
      staging: {
        stage: {
          kind: "encrypted",
          path: stage,
          maximumBytes: 1024 ** 2,
          attestedMount: true,
          mountDevice: (await lstat(stage)).dev,
        },
      },
      keys: { key: { path: key, keyId: "key" } },
      gpgBinary: "gpg",
    };
    const f = fixture();
    const request = {
      runId: "11111111-1111-4111-8111-111111111111",
      instanceId: "22222222-2222-4222-8222-222222222222",
      parentRunId: "capture",
      certificate: f.recovery.certificate,
      repositoryAlias: "repo",
      stagingAlias: "stage",
      keyAlias: "key",
      targetProfile: "local",
    };
    const opened = jest
      .spyOn(EncryptedBackupRepository.prototype, "openCertificate")
      .mockResolvedValue({
        inventory: f.recovery.inventory,
        openPart: async () => {},
      });
    const part = jest
      .spyOn(EncryptedBackupRepository.prototype, "openPart")
      .mockResolvedValue();
    try {
      const deps = createDockerRecoveryDependencies(
        runtime,
        { local: profile },
        undefined,
        undefined,
        f.process,
      );
      const certified = await deps.openCertified(request, signal());
      expect(certified.inventory).toEqual(f.recovery.inventory);
      await certified.materialize(
        f.recovery.certificate.parts[0]!,
        join(stage, "part"),
        signal(),
      );
      expect(part).toHaveBeenCalled();
      const target = await deps.createTarget(request, signal());
      await target.destroy();
      const originalRun = jest.mocked(f.process.run).getMockImplementation()!;
      jest
        .mocked(f.process.run)
        .mockImplementation(async (binary, args, current, input, max) =>
          args.includes("{{json .Mounts}}")
            ? "[]\n[]"
            : originalRun(binary, args, current, input, max),
        );
      const withSources: BackupMountedRuntime = {
        ...runtime,
        sources: {
          local: {
            databaseContainer: "source-db",
            storageContainer: "source-storage",
            network: "source-network",
            databaseName: "postgres",
            databaseUser: "postgres",
            host: "source-db",
            port: 5432,
            postgresImage: profile.image,
            pgpassFile: key,
            storageRoot: "/mnt",
            storageTenantPrefix: "stub/stub",
          },
        },
      };
      const sourceDeps = createDockerRecoveryDependencies(
        withSources,
        { local: profile },
        undefined,
        undefined,
        f.process,
      );
      await sourceDeps.openCertified(request, signal());
      const sourceTarget = await sourceDeps.createTarget(request, signal());
      await sourceTarget.destroy();
      for (const change of [
        { stagingAlias: "other" },
        { keyAlias: "other" },
        { repositoryAlias: "other" },
        { targetProfile: "other" },
      ])
        await expect(
          deps.openCertified({ ...request, ...change }, signal()),
        ).rejects.toThrow();
      const unsafe = [
        {
          ...runtime,
          staging: {
            stage: { kind: "tmpfs" as const, maximumBytes: 1024 ** 2 },
          },
        },
        {
          ...runtime,
          repositories: {
            repo: { ...runtime.repositories.repo!, offHost: false },
          },
        },
        { ...runtime, keys: { key: { path: key, keyId: "wrong" } } },
        {
          ...runtime,
          staging: { stage: { ...runtime.staging.stage!, maximumBytes: 1 } },
        },
        {
          ...runtime,
          staging: {
            stage: {
              kind: "encrypted" as const,
              path: stage,
              attestedMount: false,
              maximumBytes: 1024 ** 2,
              mountDevice: (await lstat(stage)).dev,
            },
          },
        },
      ];
      for (const value of unsafe)
        await expect(
          createDockerRecoveryDependencies(value, {
            local: profile,
          }).openCertified(request, signal()),
        ).rejects.toThrow();
      await writeFile(join(repo, "key"), "test", { mode: 0o600 });
      await expect(
        createDockerRecoveryDependencies(
          {
            ...runtime,
            keys: { key: { path: join(repo, "key"), keyId: "key" } },
          },
          { local: profile },
        ).openCertified(request, signal()),
      ).rejects.toThrow("unsafe_key_mount");
      await symlink(stage, join(root, "stage-link"));
      await expect(
        createDockerRecoveryDependencies(
          {
            ...runtime,
            staging: {
              stage: {
                kind: "encrypted",
                path: join(root, "stage-link"),
                maximumBytes: 1024 ** 2,
                attestedMount: true,
                mountDevice: (await lstat(stage)).dev,
              },
            },
          },
          { local: profile },
        ).openCertified(request, signal()),
      ).rejects.toThrow("unsafe_plaintext_staging");
    } finally {
      opened.mockRestore();
      part.mockRestore();
    }
  });
  it("restores exact committed object versions and native WAL names, verifies bytes and checks external key recovery", async () => {
    const f = fixture();
    const payload = Buffer.from("private-evidence");
    const object = {
      ...f.recovery.certificate.parts[0]!,
      id: "object",
      kind: "objects" as const,
      name: "objects/00000000",
      bytes: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
    };
    const wal = {
      ...object,
      id: "wal",
      kind: "wal" as const,
      name: "000000010000000000000001",
    };
    const rootKey = join(root, "mounted-root-key");
    await writeFile(rootKey, "historical-root-key", { mode: 0o600 });
    const keyCanary = Buffer.from(
      JSON.stringify({
        alias: "vault",
        sha256: createHash("sha256")
          .update("historical-root-key")
          .digest("hex"),
      }),
    );
    const canary = {
      ...object,
      id: "canary",
      kind: "recovery-key" as const,
      name: "key-check",
      bytes: keyCanary.length,
    };
    const recovery = {
      ...f.recovery,
      certificate: {
        ...f.recovery.certificate,
        parts: [...f.recovery.certificate.parts, object, wal, canary],
      },
      inventory: {
        ...f.recovery.inventory,
        objects: [
          {
            bucketId: "evidence-documents",
            name: "tenant/document",
            version: "v1",
            entry: object.name,
            bytes: payload.length,
            sha256: object.sha256,
          },
        ],
        externalKeyChecks: [{ alias: "vault", canaryPartId: "canary" }],
      },
      materialize: jest.fn(
        async (part: BackupEncryptedPart, destination: string) => {
          await writeFile(
            destination,
            part.kind === "base"
              ? tar()
              : part.kind === "recovery-key"
                ? keyCanary
                : payload,
            {
              flag: "wx",
              mode: 0o600,
            },
          );
        },
      ),
    };
    const originalSql = f.sql.getMockImplementation()!;
    f.sql.mockImplementation(async (query) =>
      query === RECOVERY_OBJECT_METADATA_SQL
        ? JSON.stringify(
            recovery.inventory.objects.map(
              ({ bucketId, name, version, bytes }) => ({
                bucketId,
                name,
                version,
                bytes,
              }),
            ),
          )
        : originalSql(query),
    );
    const target = await NativeDockerRecoveryTarget.create(
      root,
      {
        ...profile,
        externalRecoveryKeys: {
          vault: {
            path: rootKey,
            targetPath: "/etc/postgresql-custom/pgsodium_root.key",
          },
        },
      },
      [],
      f.process,
      signal(),
      undefined,
      async () => true,
    );
    await target.restore(recovery, signal());
    expect(await target.verifyHistorical(recovery, signal())).toContain(
      "external_keys",
    );
    await expect(
      target.verifyHistorical(
        {
          ...recovery,
          inventory: {
            ...recovery.inventory,
            objects: [
              { ...recovery.inventory.objects[0]!, sha256: "a".repeat(64) },
            ],
          },
        },
        signal(),
      ),
    ).rejects.toMatchObject({
      failedCheck: "object_integrity",
      completedChecks: expect.arrayContaining([
        "schema_migrations",
        "audit_continuity",
      ]) as unknown,
    });
    await target.destroy();
  });
  it("rejects mismatched object receipts and unsafe certified checkpoint names", async () => {
    for (const mutate of [
      (r: AuthenticatedRecovery) => ({
        ...r,
        inventory: {
          ...r.inventory,
          objects: [
            {
              bucketId: "bucket",
              name: "file",
              version: null,
              entry: "objects/unknown",
              sha256: "a".repeat(64),
              bytes: 1,
            },
          ],
        },
      }),
      (r: AuthenticatedRecovery) => ({
        ...r,
        certificate: {
          ...r.certificate,
          checkpoint: {
            ...r.certificate.checkpoint,
            restorePoint: "arbitrary",
          },
        },
      }),
    ]) {
      const f = fixture();
      const target = await NativeDockerRecoveryTarget.create(
        root,
        profile,
        [],
        f.process,
        signal(),
      );
      await expect(
        target.restore(mutate(f.recovery), signal()),
      ).rejects.toThrow();
      await target.destroy();
    }
  });
  it("does not certify failed quarantine or isolation and never removes a foreign-labelled target", async () => {
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
    );
    await target.restore(f.recovery, signal());
    const original = f.sql.getMockImplementation()!;
    f.sql.mockImplementation(async (q) =>
      q.startsWith("select ((") ? "false" : original(q),
    );
    await expect(target.quarantine(signal())).rejects.toThrow(
      "recovery_quarantine_failed",
    );
    const run = jest.mocked(f.process.run);
    const originalRun = run.getMockImplementation()!;
    run.mockImplementation(async (binary, args, signal, input, max) =>
      args[0] === "inspect"
        ? "foreign"
        : originalRun(binary, args, signal, input, max),
    );
    await expect(target.destroy()).rejects.toThrow("recovery_cleanup_unsafe");
    run.mockImplementation(originalRun);
    await target.destroy();
    const g = fixture();
    const isolated = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      g.process,
      signal(),
    );
    jest.mocked(g.process.run).mockResolvedValue("false foreign");
    await expect(isolated.assertIsolated(signal())).rejects.toThrow(
      "recovery_isolation_failed",
    );
  });
  it("retries short Docker endpoint-detach races during owned-network cleanup", async () => {
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      signal(),
    );
    const original = jest.mocked(f.process.run).getMockImplementation()!;
    let attempts = 0;
    jest
      .mocked(f.process.run)
      .mockImplementation((binary, args, current, input, max) => {
        if (args[0] === "network" && args[1] === "rm" && ++attempts < 3)
          return Promise.reject(new Error("endpoint detaching"));
        return original(binary, args, current, input, max);
      });
    await expect(target.destroy()).resolves.toBeUndefined();
    expect(attempts).toBe(3);
  });
});
