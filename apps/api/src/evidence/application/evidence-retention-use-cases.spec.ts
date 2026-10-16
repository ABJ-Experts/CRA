import {
  EvidenceRetentionUseCases,
  type EvidenceRetentionRepository,
} from "./evidence-retention-use-cases";
import type { ProductRetentionProjectionPort } from "../../products/application/product-retention-reader.port";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const productId = "00000000-0000-4000-8000-000000000004";

function review() {
  return {
    documentId,
    currentVersionId: "00000000-0000-4000-8000-000000000005",
    lifecycle: "active",
    reviewedAt: "2026-09-21T00:00:00.000Z",
    reviewFingerprint: "a".repeat(64),
    eligibleForDeletion: true,
    blockers: [],
    protection: {
      status: "current",
      retentionUntil: "2038-01-01T00:00:00.000Z",
      retentionProtectionUntil: "2038-01-01T00:00:00.000Z",
      legalHoldActive: false,
      identityHandling: "none",
    },
    linkedProductIds: [productId],
  } as const;
}

function projection(
  overrides: Partial<{
    status: "current" | "incomplete";
    retentionUntil: string | null;
    retentionProtectionUntil: string | null;
    legalHoldActive: boolean;
  }> = {},
): ProductRetentionProjectionPort {
  return {
    getRetentionProjection: jest.fn().mockResolvedValue({
      ok: true,
      value: {
        retention: {
          status: "current",
          retentionUntil: "2038-01-01T00:00:00.000Z",
          retentionProtectionUntil: "2038-01-01T00:00:00.000Z",
          legalHoldActive: false,
          ...overrides,
        },
      },
    }),
  };
}

describe("EvidenceRetentionUseCases", () => {
  it("fails closed when a linked product projection is incomplete", async () => {
    const repository = {
      retentionReview: jest.fn().mockResolvedValue(review()),
    } as unknown as EvidenceRetentionRepository;
    const productRetention = projection({ status: "incomplete" });

    const result = await new EvidenceRetentionUseCases(
      repository,
      productRetention,
    ).review({ organizationId, actorId, documentId });

    expect(result).toEqual(
      expect.objectContaining({
        eligibleForDeletion: false,
        blockers: [
          expect.objectContaining({
            obligation: "Retention protection could not be verified.",
          }),
        ],
      }),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest mock assertion.
    expect(productRetention.getRetentionProjection).toHaveBeenCalledWith({
      organizationId,
      actorId,
      productId,
    });
  });

  it("does not consult product projections after the durable review is blocked", async () => {
    const repository = {
      retentionReview: jest.fn().mockResolvedValue({
        ...review(),
        eligibleForDeletion: false,
      }),
    } as unknown as EvidenceRetentionRepository;
    const productRetention = projection();

    const result = await new EvidenceRetentionUseCases(
      repository,
      productRetention,
    ).review({ organizationId, actorId, documentId });

    expect(result?.eligibleForDeletion).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest mock assertion.
    expect(productRetention.getRetentionProjection).not.toHaveBeenCalled();
  });

  it("fails closed rather than surfacing an eligible deletion after projection failure", async () => {
    const repository = {
      retentionReview: jest.fn().mockResolvedValue(review()),
    } as unknown as EvidenceRetentionRepository;
    const productRetention = projection();
    (productRetention.getRetentionProjection as jest.Mock).mockRejectedValue(
      new Error("projection unavailable"),
    );

    const result = await new EvidenceRetentionUseCases(
      repository,
      productRetention,
    ).review({ organizationId, actorId, documentId });

    expect(result?.eligibleForDeletion).toBe(false);
  });
});
