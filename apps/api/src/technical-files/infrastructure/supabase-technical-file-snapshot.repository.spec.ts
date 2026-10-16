import { SupabaseTechnicalFileSnapshotRepository } from "./supabase-technical-file-snapshot.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const snapshotId = "00000000-0000-4000-8000-000000000004";
const exportId = "00000000-0000-4000-8000-000000000005";
const idempotencyKey = "00000000-0000-4000-8000-000000000006";

describe("SupabaseTechnicalFileSnapshotRepository download audit", () => {
  const input = {
    actorId,
    productId,
    snapshotId,
    exportId,
    artifact: "pdf" as const,
  };

  it("records an access audit only after storage has issued the signed URL", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          outcome: "found",
          result: { objectPath: `${organizationId}/safe.pdf` },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { outcome: "recorded", result: {} },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { outcome: "found", result: { export: readyExport() } },
        error: null,
      });
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    const repository = new SupabaseTechnicalFileSnapshotRepository({
      admin: () => ({
        rpc,
        storage: { from: () => ({ createSignedUrl }) },
      }),
    } as never);

    await expect(
      repository.getDownload(organizationId, input),
    ).resolves.toMatchObject({
      download: { downloadUrl: "https://storage.test/signed" },
    });
    expect(rpc.mock.calls.map(([name]) => name as unknown)).toEqual([
      "get_technical_file_snapshot_export_download_atomic",
      "record_technical_file_snapshot_export_download_atomic",
      "get_technical_file_snapshot_export",
    ]);
  });

  it("does not record a successful download when signing fails", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        outcome: "found",
        result: { objectPath: `${organizationId}/safe.pdf` },
      },
      error: null,
    });
    const repository = new SupabaseTechnicalFileSnapshotRepository({
      admin: () => ({
        rpc,
        storage: {
          from: () => ({
            createSignedUrl: jest.fn().mockResolvedValue({
              data: null,
              error: { message: "storage unavailable" },
            }),
          }),
        },
      }),
    } as never);

    await expect(repository.getDownload(organizationId, input)).rejects.toThrow(
      "snapshot storage unavailable",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

function readyExport() {
  const generatedAt = "2026-09-14T10:00:00.000Z";
  const hash = "a".repeat(64);
  return {
    id: exportId,
    snapshotId,
    status: "ready",
    failureCode: null,
    cancellationReason: null,
    idempotencyKey,
    createdAt: generatedAt,
    startedAt: generatedAt,
    completedAt: generatedAt,
    manifestSha256: hash,
    artifacts: [
      {
        kind: "pdf",
        fileName: "technical-file.pdf",
        mimeType: "application/pdf",
        byteLength: 1,
        sha256: hash,
        generatedAt,
      },
      {
        kind: "archive",
        fileName: "technical-file.zip",
        mimeType: "application/zip",
        byteLength: 1,
        sha256: hash,
        generatedAt,
      },
      {
        kind: "manifest",
        fileName: "manifest.json",
        mimeType: "application/json",
        byteLength: 1,
        sha256: hash,
        generatedAt,
      },
    ],
  };
}
