import { OfflineBundleImportUseCases } from "./offline-bundle-import-use-cases";
import type { VulnerabilityOfflineBundleRepository } from "./offline-bundle-import.port";
import type { VulnerabilityOfflineBundleImport } from "@repo/contracts/vulnerabilities";

const bundleImport: VulnerabilityOfflineBundleImport = {
  id: "c0a80168-0000-4000-8000-000000000001",
  status: "awaiting_confirmation",
  bundleSha256: "a".repeat(64),
  manifest: {
    format: "cra.vulnerability.offline-bundle",
    schemaVersion: "1.0",
    bundleVersion: "1.0.0",
    createdAt: "2026-08-27T00:00:00.000Z",
    signingKeyId: "root",
    compatibility: {
      minimumApplicationVersion: "1.0.0",
      maximumApplicationVersionExclusive: "2.0.0",
    },
    payloads: [],
  },
  signature: {
    algorithm: "Ed25519",
    keyId: "root",
    status: "verified",
    verifiedAt: "2026-08-27T00:00:00.000Z",
  },
  compatibility: { status: "compatible", reason: null },
  estimatedChanges: {
    recordsToCreate: 0,
    recordsToUpdate: 0,
    recordsToWithdraw: 0,
  },
  sourceSnapshotAt: null,
  sourceSnapshotAgeSeconds: null,
  failureCode: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  completedAt: null,
};

function repository(
  overrides: Partial<VulnerabilityOfflineBundleRepository> = {},
): jest.Mocked<VulnerabilityOfflineBundleRepository> {
  const value: VulnerabilityOfflineBundleRepository = {
    preflight: jest.fn().mockResolvedValue({ import: bundleImport, runs: [] }),
    confirm: jest.fn().mockResolvedValue(bundleImport),
    get: jest.fn().mockResolvedValue(bundleImport),
    csafReconciliation: jest.fn().mockResolvedValue(null),
    stage: jest.fn().mockResolvedValue(undefined),
    completeStaging: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return value as jest.Mocked<VulnerabilityOfflineBundleRepository>;
}

describe("OfflineBundleImportUseCases", () => {
  it("delegates durable state changes to its inward repository port", async () => {
    const store = repository();
    const useCases = new OfflineBundleImportUseCases(store);
    const preflight = {
      bundleId: "a".repeat(64),
      bundleVersion: "1.0.0",
      manifestSha256: "a".repeat(64),
      signingKeyId: "root",
      manifest: bundleImport.manifest,
      verificationReceipt: bundleImport.signature,
      actorId: "c0a80168-0000-4000-8000-000000000002",
      idempotencyKey: "c0a80168-0000-4000-8000-000000000003",
      correlationId: "c0a80168-0000-4000-8000-000000000004",
      payloads: [],
      stagingWorkerId: "offline-bundle-test",
    };

    await expect(useCases.preflight(preflight)).resolves.toEqual({
      import: bundleImport,
      runs: [],
    });
    await expect(
      useCases.confirm({
        importId: bundleImport.id,
        actorId: preflight.actorId,
        idempotencyKey: preflight.idempotencyKey,
      }),
    ).resolves.toEqual(bundleImport);
    await expect(useCases.get(bundleImport.id)).resolves.toEqual(bundleImport);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest spy assertion.
    expect(store.preflight).toHaveBeenCalledWith(preflight);
  });

  it("redacts infrastructure failures", async () => {
    const useCases = new OfflineBundleImportUseCases(
      repository({
        get: jest.fn().mockRejectedValue(new Error("token=secret")),
      }),
    );

    await expect(useCases.get(bundleImport.id)).rejects.toMatchObject({
      message: "offline bundle import unavailable",
    });
  });
});
