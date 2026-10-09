import { SupabaseProductImportRepository } from "./supabase-product-import.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const importId = "00000000-0000-4000-8000-000000000003";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: importId,
    schemaVersion: "m2-product-release-import-v1",
    status: "dry_run_completed",
    contentHash: "a".repeat(64),
    byteSize: 100,
    rowCount: 1,
    processedRowCount: 1,
    counts: {
      create: 1,
      update: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      warnings: 0,
    },
    errorCode: null,
    expiresAt: "2026-08-18T00:00:00.000Z",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    committedAt: null,
    ...overrides,
  };
}

describe("SupabaseProductImportRepository", () => {
  it("uses the canonical bucket MIME type for CSV storage uploads", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const rpc = jest.fn((_name: string, args: Record<string, unknown>) =>
      Promise.resolve({
        data: [
          {
            outcome: "created",
            job: job({
              id: args.p_import_id,
              status: "queued",
              contentHash: "a".repeat(64),
              byteSize: 3,
              rowCount: 0,
              processedRowCount: 0,
              counts: {
                create: 0,
                update: 0,
                unchanged: 0,
                skipped: 0,
                failed: 0,
                warnings: 0,
              },
            }),
          },
        ],
        error: null,
      }),
    );
    const repository = new SupabaseProductImportRepository({
      admin: () => ({
        rpc,
        storage: { from: () => ({ upload }) },
      }),
    } as never);

    await repository.begin(organizationId, {
      actorId,
      fields: { idempotencyKey: importId },
      originalFilename: "import.csv",
      contentHash: "a".repeat(64),
      byteSize: 3,
      bytes: Buffer.from("csv"),
    });

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${organizationId}/[0-9a-f-]+/source\\.csv$`),
      ),
      Buffer.from("csv"),
      { contentType: "text/csv", upsert: false },
    );
  });

  it("parses every job RPC response and fails closed on malformed provider data", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "found", job: job({ contentHash: "not-a-hash" }) }],
      error: null,
    });
    const repository = new SupabaseProductImportRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.get(organizationId, actorId, importId),
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledWith("get_product_import_job", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_import_id: importId,
    });
  });

  it("audits report access before returning a short-lived signed URL", async () => {
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl: "http://127.0.0.1:54321/storage/v1/object/sign/report",
      },
      error: null,
    });
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "found",
          object_path: `${organizationId}/${importId}/report.csv`,
        },
      ],
      error: null,
    });
    const repository = new SupabaseProductImportRepository({
      admin: () => ({
        rpc,
        storage: { from: () => ({ createSignedUrl }) },
      }),
    } as never);

    const result = await repository.report(organizationId, actorId, importId);

    expect(result?.report).toMatchObject({
      filename: "product-release-import-report.csv",
      contentType: "text/csv; charset=utf-8",
      downloadUrl: "http://127.0.0.1:54321/storage/v1/object/sign/report",
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${organizationId}/${importId}/report.csv`,
      300,
      { download: "product-release-import-report.csv" },
    );
  });

  it("rejects a claimed storage path outside the claimed organization", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "claimed",
          job: job({ status: "parsing" }),
          work: {
            kind: "dry_run",
            sourceObjectPath: `ffffffff-ffff-4fff-8fff-ffffffffffff/${importId}/source.csv`,
            reportObjectPath: null,
            checkpointRowNumber: 0,
            commitActorId: null,
            commitIdempotencyKey: null,
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseProductImportRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.claim(organizationId, {
        workerId: "worker-1",
        leaseSeconds: 60,
      }),
    ).rejects.toThrow();
  });
});
