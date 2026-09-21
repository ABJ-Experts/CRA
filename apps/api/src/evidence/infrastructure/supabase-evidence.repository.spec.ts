import { SupabaseEvidenceRepository } from "./supabase-evidence.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const versionId = "00000000-0000-4000-8000-000000000004";
const productId = "00000000-0000-4000-8000-000000000005";

describe("SupabaseEvidenceRepository retention review", () => {
  it("maps the durable review projection to the public Zod shape without exposing storage", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: {
            documentId,
            currentVersionId: versionId,
            lifecycleState: "active",
            reviewedAt: "2026-09-21T00:00:00Z",
            reviewFingerprint: "a".repeat(64),
            eligibleForDeletion: true,
            linkedProductIds: [productId],
            activeHolds: [],
            blockingReasons: [],
            retentionIncomplete: false,
            productLegalHoldActive: false,
            retentionUntil: "2020-01-01T00:00:00Z",
            retentionProtectionUntil: "2020-01-01T00:00:00Z",
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseEvidenceRepository({
      admin: () => ({ rpc }),
    } as never);

    const result = await repository.retentionReview(organizationId, {
      actorId,
      documentId,
    });

    expect(result).toMatchObject({
      documentId,
      currentVersionId: versionId,
      lifecycle: "active",
      eligibleForDeletion: true,
      linkedProductIds: [productId],
      protection: {
        status: "current",
        legalHoldActive: false,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_evidence_document_retention_review_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_document_id: documentId,
      }),
    );
  });

  it("turns an invisible product blocker into the safe generic explanation", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: {
            documentId,
            currentVersionId: versionId,
            lifecycleState: "active",
            reviewedAt: "2026-09-21T00:00:00Z",
            reviewFingerprint: "a".repeat(64),
            eligibleForDeletion: false,
            linkedProductIds: [productId],
            activeHolds: [],
            blockingReasons: [
              {
                kind: "retention",
                productId,
                productName: null,
                retentionProtectionUntil: "2030-01-01T00:00:00Z",
              },
            ],
            retentionIncomplete: false,
            productLegalHoldActive: false,
            retentionUntil: "2030-01-01T00:00:00Z",
            retentionProtectionUntil: "2030-01-01T00:00:00Z",
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseEvidenceRepository({
      admin: () => ({ rpc }),
    } as never);

    const result = await repository.retentionReview(organizationId, {
      actorId,
      documentId,
    });

    expect(result?.blockers).toEqual([
      {
        visibility: "restricted",
        kind: "protected_reference",
        message: "A protected related record prevents deletion.",
      },
    ]);
  });
});
