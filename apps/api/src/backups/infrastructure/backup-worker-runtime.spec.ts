import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupWorkerConfigurationSchema,
  loadBackupWorkerRuntime,
} from "./backup-worker-runtime";
it("defaults off, uses private mounted config and rejects instance substitution", async () => {
  expect(await loadBackupWorkerRuntime({})).toBeNull();
  const directory = await mkdtemp(join(tmpdir(), "backup-runtime-"));
  try {
    const path = join(directory, "config.json");
    const credential = join(directory, "control");
    await writeFile(credential, "dedicated", { mode: 0o600 });
    const config = {
      instanceId: "20000000-0000-4000-8000-000000000001",
      databaseUrl: "http://localhost:54321",
      projectApiKey: "anon",
      controlCredentialPath: credential,
      runtime: {
        sources: {},
        repositories: {},
        staging: {},
        keys: {},
        gpgBinary: "/usr/bin/gpg",
      },
      targetProfiles: {},
    };
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    const env = {
      BACKUP_WORKER_ENABLED: "true",
      BACKUP_WORKER_CONFIGURATION_PATH: path,
      LICENSING_INSTANCE_ID: config.instanceId,
    };
    expect((await loadBackupWorkerRuntime(env))?.credential).toBe("dedicated");
    await expect(
      loadBackupWorkerRuntime({ ...env, LICENSING_INSTANCE_ID: "another" }),
    ).rejects.toThrow("Backup instance binding invalid");
    await writeFile(path, JSON.stringify({ ...config, command: "rm" }));
    await expect(loadBackupWorkerRuntime(env)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("preserves explicit source external recovery-key references without accepting arbitrary container paths", () => {
  const source = {
    databaseContainer: "db",
    databaseName: "postgres",
    databaseUser: "postgres",
    network: "internal",
    host: "db",
    port: 5432,
    postgresImage: "supabase/postgres:17.6.1.156",
    pgpassFile: "/key",
    storageContainer: "storage",
    storageRoot: "/mnt",
    storageTenantPrefix: "stub/stub",
    externalRecoveryKeys: {
      vault: { containerPath: "/etc/postgresql-custom/pgsodium_root.key" },
    },
  };
  const config = {
    instanceId: "20000000-0000-4000-8000-000000000001",
    databaseUrl: "http://localhost:54321",
    projectApiKey: "anon",
    controlCredentialPath: "/credential",
    runtime: {
      sources: { source },
      repositories: {},
      staging: {},
      keys: {},
      gpgBinary: "/usr/bin/gpg",
    },
    targetProfiles: {},
  };
  expect(
    backupWorkerConfigurationSchema.parse(config).runtime.sources.source
      ?.externalRecoveryKeys,
  ).toEqual(source.externalRecoveryKeys);
  expect(
    backupWorkerConfigurationSchema.safeParse({
      ...config,
      runtime: {
        ...config.runtime,
        sources: {
          source: {
            ...source,
            externalRecoveryKeys: { vault: { containerPath: "/etc/shadow" } },
          },
        },
      },
    }).success,
  ).toBe(false);
});
it("requires a closed encrypted Docker backing attestation for each restore profile", () => {
  const objectVolumeBacking = {
    encryptedAtRest: true,
    daemonId: "docker-daemon_01:profile",
    maximumBytes: 2147483648,
  };
  const isolated = {
    image: "public.ecr.aws/supabase/postgres:17.6.1.156",
    stagingAlias: "private",
    maxExpandedBytes: 2147483648,
    maxEntries: 5000,
    deadlineMs: 300000,
    objectVolumeBacking,
  };
  const config = {
    instanceId: "20000000-0000-4000-8000-000000000001",
    databaseUrl: "http://localhost:54321",
    projectApiKey: "anon",
    controlCredentialPath: "/credential",
    runtime: {
      sources: {},
      repositories: {},
      staging: {},
      keys: {},
      gpgBinary: "/usr/bin/gpg",
    },
    targetProfiles: { isolated },
  };
  expect(
    backupWorkerConfigurationSchema.parse(config).targetProfiles.isolated
      ?.objectVolumeBacking,
  ).toEqual(objectVolumeBacking);
  for (const backing of [
    undefined,
    { ...objectVolumeBacking, encryptedAtRest: false },
    { ...objectVolumeBacking, daemonId: "" },
    { ...objectVolumeBacking, daemonId: "daemon\nother" },
    { ...objectVolumeBacking, maximumBytes: 0 },
    { ...objectVolumeBacking, maximumBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...objectVolumeBacking, path: "/untrusted" },
  ]) {
    expect(
      backupWorkerConfigurationSchema.safeParse({
        ...config,
        targetProfiles: {
          isolated: { ...isolated, objectVolumeBacking: backing },
        },
      }).success,
    ).toBe(false);
  }
});
