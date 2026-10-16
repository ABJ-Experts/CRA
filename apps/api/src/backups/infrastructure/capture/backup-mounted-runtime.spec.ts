import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupCaptureRequest } from "../../application/backup-execution.port";
import {
  BackupMountedRuntime,
  resolveBackupMounts,
} from "./backup-mounted-runtime";

describe("mounted backup authority", () => {
  let directory: string;
  let runtime: BackupMountedRuntime;
  const request: BackupCaptureRequest = {
    runId: "11111111-1111-4111-8111-111111111111",
    instanceId: "22222222-2222-4222-8222-222222222222",
    configurationRevision: 1,
    repositoryGeneration: "generation",
    sourceAlias: "source",
    repositoryAlias: "repository",
    stagingAlias: "staging",
    keyAlias: "key",
    keyId: "key-v1",
    pauseLimitSeconds: 120,
  };
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "m15-mount-")));
    await mkdir(join(directory, "repo"), { mode: 0o700 });
    await mkdir(join(directory, "stage"), { mode: 0o700 });
    await writeFile(join(directory, "key"), "synthetic-only-key", {
      mode: 0o600,
    });
    await writeFile(join(directory, "pgpass"), "fixture", { mode: 0o600 });
    runtime = {
      sources: {
        source: {
          databaseContainer: "db",
          databaseName: "postgres",
          databaseUser: "postgres",
          network: "private",
          host: "db",
          port: 5432,
          postgresImage: "public.ecr.aws/supabase/postgres:17.6.1.156",
          pgpassFile: join(directory, "pgpass"),
          storageContainer: "objects",
          storageRoot: "/mnt",
          storageTenantPrefix: "stub/stub",
        },
      },
      repositories: {
        repository: {
          path: join(directory, "repo"),
          generation: "generation",
          residency: "local",
          offHost: true,
        },
      },
      staging: {
        staging: {
          kind: "encrypted",
          path: join(directory, "stage"),
          maximumBytes: 1e9,
          attestedMount: true,
          mountDevice: (await lstat(join(directory, "stage"))).dev,
        },
      },
      keys: { key: { path: join(directory, "key"), keyId: "key-v1" } },
      gpgBinary: "gpg",
    };
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("resolves only mounted aliases and binds encrypted staging device, key and repository generation", async () => {
    expect((await resolveBackupMounts(runtime, request)).key.keyId).toBe(
      "key-v1",
    );
    expect(
      (
        await resolveBackupMounts(
          {
            ...runtime,
            staging: { staging: { kind: "tmpfs", maximumBytes: 1e9 } },
          },
          request,
        )
      ).staging.kind,
    ).toBe("tmpfs");
  });
  it.each([0, 121, 1.5])(
    "rejects unsafe pause %s",
    async (pauseLimitSeconds) => {
      await expect(
        resolveBackupMounts(runtime, { ...request, pauseLimitSeconds }),
      ).rejects.toThrow("unsafe_pause_limit");
    },
  );
  it("fails closed for unknown aliases, binding changes and unsafe source commands", async () => {
    await expect(
      resolveBackupMounts(runtime, { ...request, keyAlias: "other" }),
    ).rejects.toThrow("unknown_mount_alias");
    await expect(
      resolveBackupMounts(runtime, { ...request, keyId: "other" }),
    ).rejects.toThrow("repository_binding");
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          repositories: {
            repository: { ...runtime.repositories.repository!, offHost: false },
          },
        },
        request,
      ),
    ).rejects.toThrow("repository_binding");
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          sources: {
            source: {
              ...runtime.sources.source!,
              postgresImage: "postgres:latest",
            },
          },
        },
        request,
      ),
    ).rejects.toThrow("incompatible_runtime");
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          sources: { source: { ...runtime.sources.source!, host: "db; rm" } },
        },
        request,
      ),
    ).rejects.toThrow("unsafe_mount_configuration");
  });
  it("rejects unencrypted or replaced staging, weak keys, repository-key co-location and symlinks", async () => {
    const stage = runtime.staging.staging!;
    if (stage.kind !== "encrypted") throw Error();
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          staging: { staging: { ...stage, attestedMount: false } },
        },
        request,
      ),
    ).rejects.toThrow("unsafe_plaintext_staging");
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          staging: {
            staging: { ...stage, mountDevice: stage.mountDevice + 1 },
          },
        },
        request,
      ),
    ).rejects.toThrow("unsafe_plaintext_staging");
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          staging: { staging: { kind: "tmpfs", maximumBytes: 1 } },
        },
        request,
      ),
    ).rejects.toThrow("insufficient_staging");
    await chmod(join(directory, "key"), 0o644);
    await expect(resolveBackupMounts(runtime, request)).rejects.toThrow(
      "unsafe_key_mount",
    );
    await chmod(join(directory, "key"), 0o600);
    await writeFile(join(directory, "repo", "key"), "fixture", { mode: 0o600 });
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          keys: {
            key: { path: join(directory, "repo", "key"), keyId: "key-v1" },
          },
        },
        request,
      ),
    ).rejects.toThrow("unsafe_key_mount");
    await symlink(join(directory, "repo"), join(directory, "linked"));
    await expect(
      resolveBackupMounts(
        {
          ...runtime,
          repositories: {
            repository: {
              ...runtime.repositories.repository!,
              path: join(directory, "linked"),
            },
          },
        },
        request,
      ),
    ).rejects.toThrow("unsafe_mount_configuration");
  });
});
