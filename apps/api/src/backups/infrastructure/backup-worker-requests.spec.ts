import { backupVerificationCheckSchema } from "@repo/contracts/backups/schemas";
import { MountedBackupWorkerRequests } from "./backup-worker-requests";
import { resolveBackupMounts } from "./capture/backup-mounted-runtime";
import { EncryptedBackupRepository } from "./repository/encrypted-backup.repository";
import type { BackupCaptureResult } from "../application/backup-execution.port";
import type {
  BackupRun,
  BackupPolicyConfiguration,
} from "@repo/contracts/backups/types";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
jest.mock("./capture/backup-mounted-runtime", () => ({
  resolveBackupMounts: jest.fn(),
}));
const configuration = {
  sourceAlias: "source",
  repositoryAlias: "repository",
  stagingAlias: "staging",
  keyAlias: "key",
  targetProfile: "isolated",
  residency: "local",
  pauseLimitSeconds: 120,
} as BackupPolicyConfiguration;
const run = {
  id: "20000000-0000-4000-8000-000000000001",
  instanceId: "30000000-0000-4000-8000-000000000001",
  configurationRevision: 1,
} as BackupRun;
const certificate: BackupCaptureResult["certificate"] = {
  formatVersion: 1,
  instanceId: run.instanceId,
  runId: run.id,
  repositoryGeneration: "40000000-0000-4000-8000-000000000001",
  configurationRevision: 1,
  keyId: "key",
  capturedAt: "2026-10-14T00:00:00.000Z",
  checkpoint: {
    systemIdentifier: "12345",
    timeline: 1,
    lsn: "0/ABC",
    postgresVersion: "17.6",
    restorePoint: "point",
  },
  parts: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      kind: "base",
      name: "base.tar",
      sha256: "a".repeat(64),
      bytes: 4,
      cipherSha256: "b".repeat(64),
      cipherBytes: 5,
    },
  ],
  inventoryDigest: "a".repeat(64),
  auditHeadsDigest: "b".repeat(64),
  certificateDigest: "c".repeat(64),
};
it("binds aliases and maps only safe measured wire certificate", async () => {
  const runtime = {
    sources: {},
    repositories: {
      repository: {
        path: "/repo",
        residency: "local",
        offHost: true,
        generation: certificate.repositoryGeneration,
      },
    },
    staging: {},
    keys: {
      key: { path: "/key", keyId: "key" },
      historical: { path: "/old-key", keyId: "historical" },
    },
    gpgBinary: "/gpg",
  };
  const requests = new MountedBackupWorkerRequests(runtime);
  jest.mocked(resolveBackupMounts).mockResolvedValue({} as never);
  expect(
    (await requests.capture(run, configuration)).repositoryGeneration,
  ).toBe(certificate.repositoryGeneration);
  const wire = requests.captured({
    certificate,
    bytes: 0,
    objectCount: 0,
    durationMs: 4,
  });
  expect(wire).toMatchObject({ checkpointId: run.id, integrity: "passed" });
  expect(wire).not.toHaveProperty("parts");
  await expect(
    requests.capture(run, { ...configuration, residency: "wrong" }),
  ).rejects.toThrow("configuration_invalid");
  await expect(
    requests.capture(run, { ...configuration, keyAlias: "missing" }),
  ).rejects.toThrow("configuration_invalid");
  await expect(
    requests.capture(run, { ...configuration, repositoryAlias: "missing" }),
  ).rejects.toThrow("configuration_invalid");
  await expect(requests.verification(run, configuration)).rejects.toThrow(
    "manifest_invalid",
  );
  jest
    .mocked(resolveBackupMounts)
    .mockResolvedValue({ staging: { kind: "tmpfs" } } as never);
  await expect(
    requests.verification({ ...run, parentRunId: run.id }, configuration),
  ).rejects.toThrow("staging_unsafe");
  const directory = await mkdtemp(join(tmpdir(), "backup-request-"));
  try {
    jest.mocked(resolveBackupMounts).mockResolvedValue({
      staging: { kind: "encrypted", path: directory, maximumBytes: 1024 },
      repository: { path: "/repo" },
      key: { path: "/key", keyId: "key" },
    } as never);
    const load = jest
      .spyOn(EncryptedBackupRepository.prototype, "loadCertificateInMemory")
      .mockImplementation(function (this: EncryptedBackupRepository) {
        expect(
          (this as unknown as { configuration: { keyFilesById: unknown } })
            .configuration.keyFilesById,
        ).toEqual({ key: "/key", historical: "/old-key" });
        return Promise.resolve(certificate);
      });
    const request = await requests.verification(
      { ...run, parentRunId: run.id },
      configuration,
    );
    expect(request.certificate).toBe(certificate);
    expect(
      requests.verified(
        {
          verified: true,
          completedAt: certificate.capturedAt,
          durationMs: 1,
          checks: backupVerificationCheckSchema.shape.code.options.map(
            (code) => ({ code, status: "passed" as const, durationMs: 1 }),
          ),
        },
        request,
      ),
    ).toMatchObject({ integrity: "passed", databaseBytes: 4 });
    load.mockRestore();
    expect(
      requests.verified(
        {
          verified: false,
          completedAt: certificate.capturedAt,
          durationMs: 1,
          checks: [{ code: "authentication", status: "failed", durationMs: 1 }],
        },
        request,
      ),
    ).toMatchObject({
      integrity: "failed",
      checks: expect.arrayContaining([
        expect.objectContaining({
          code: "authentication",
          failureCode: "restore_failed",
        }),
      ]) as unknown,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
