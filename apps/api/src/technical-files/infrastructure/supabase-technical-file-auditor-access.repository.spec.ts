import { TechnicalFileAuditorAccessConflictError } from "../application/technical-file-auditor-access.port";
import { SupabaseTechnicalFileAuditorAccessRepository } from "./supabase-technical-file-auditor-access.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const snapshotId = "00000000-0000-4000-8000-000000000004";

describe("SupabaseTechnicalFileAuditorAccessRepository", () => {
  it("uses the tenant-first grant RPC and maps idempotency conflicts", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { outcome: "idempotency_conflict", result: null },
      error: null,
    });
    const repository = new SupabaseTechnicalFileAuditorAccessRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.create(organizationId, {
        actorId,
        productId,
        snapshotId,
        grantId: "00000000-0000-4000-8000-000000000005",
        tokenHash: "a".repeat(64),
        requestDigest: "b".repeat(64),
        exportId: "00000000-0000-4000-8000-000000000006",
        recipientEmail: "auditor@example.test",
        recipientReference: null,
        purpose: "Independent assessment.",
        expiresAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: "00000000-0000-4000-8000-000000000007",
      }),
    ).rejects.toBeInstanceOf(TechnicalFileAuditorAccessConflictError);

    expect(rpc).toHaveBeenCalledWith(
      "create_technical_file_auditor_snapshot_grant_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_snapshot_id: snapshotId,
        p_recipient_email: "auditor@example.test",
        p_token_hash: "a".repeat(64),
      }),
    );
  });

  it("does not touch private storage when the scoped session is unavailable", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { outcome: "unavailable", result: null },
      error: null,
    });
    const download = jest.fn();
    const repository = new SupabaseTechnicalFileAuditorAccessRepository({
      admin: () => ({ rpc, storage: { from: () => ({ download }) } }),
    } as never);

    await expect(
      repository.artifact("a".repeat(64), "pdf"),
    ).resolves.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it("streams only an authorized private object without returning its path", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        outcome: "available",
        result: { objectPath: "tenant/export.pdf" },
      },
      error: null,
    });
    const download = jest.fn().mockResolvedValue({
      data: new Blob(["immutable bytes"]),
      error: null,
    });
    const repository = new SupabaseTechnicalFileAuditorAccessRepository({
      admin: () => ({ rpc, storage: { from: () => ({ download }) } }),
    } as never);

    await expect(
      repository.artifact("a".repeat(64), "pdf"),
    ).resolves.toMatchObject({
      mimeType: "application/pdf",
      fileName: "technical-file-snapshot.pdf",
    });
    expect(download).toHaveBeenCalledWith("tenant/export.pdf");
  });
});
