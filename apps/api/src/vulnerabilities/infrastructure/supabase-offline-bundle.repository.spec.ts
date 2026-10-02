import { SupabaseOfflineBundleRepository } from "./supabase-offline-bundle.repository";

const importRecord = {
  id: "c0a80168-0000-4000-8000-000000000001",
  status: "rejected",
  bundle_sha256: "a".repeat(64),
  manifest: {
    format: "cra.vulnerability.offline-bundle",
    schemaVersion: "1.0",
    bundleVersion: "1.0.0",
    createdAt: "2026-08-27T00:00:00.000Z",
    signingKeyId: "offline-root",
    compatibility: {
      minimumApplicationVersion: "1.0.0",
      maximumApplicationVersionExclusive: "2.0.0",
    },
    payloads: [
      {
        feedKey: "nvd",
        path: "nvd.json",
        sha256: "b".repeat(64),
        byteLength: 1,
        schemaVersion: "1.0",
        sourceSnapshotAt: "2026-08-27T00:00:00.000Z",
      },
    ],
  },
  signature: {
    algorithm: "Ed25519",
    keyId: "offline-root",
    status: "verified",
    verifiedAt: "2026-08-27T00:00:00.000Z",
  },
  compatibility: { status: "compatible", reason: null },
  estimated_changes: {
    recordsToCreate: 0,
    recordsToUpdate: 0,
    recordsToWithdraw: 0,
  },
  source_snapshot_at: "2026-08-27T00:00:00.000Z",
  source_snapshot_age_seconds: 0,
  failure_code: "bundle_rollback_rejected",
  created_at: "2026-08-27T00:00:00.000Z",
  updated_at: "2026-08-27T00:00:00.000Z",
  completed_at: "2026-08-27T00:00:00.000Z",
};

describe("SupabaseOfflineBundleRepository", () => {
  it("returns the durable rejected import report for a rollback-rejected confirmation", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "rollback_rejected", import: importRecord }],
      error: null,
    });
    const repository = new SupabaseOfflineBundleRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.confirm({
        importId: importRecord.id,
        actorId: "c0a80168-0000-4000-8000-000000000002",
        idempotencyKey: "c0a80168-0000-4000-8000-000000000003",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      failureCode: "bundle_rollback_rejected",
    });
  });

  it("preserves a durable incomplete-staging report for the operator", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "incomplete_staging",
          import: {
            ...importRecord,
            status: "awaiting_confirmation",
            failure_code: null,
            completed_at: null,
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseOfflineBundleRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.confirm({
        importId: importRecord.id,
        actorId: "c0a80168-0000-4000-8000-000000000002",
        idempotencyKey: "c0a80168-0000-4000-8000-000000000003",
      }),
    ).resolves.toMatchObject({ status: "awaiting_confirmation" });
  });
});
