import type { ProductRetentionProjectionPort } from "../../products/application/product-retention-reader.port";
import type { EvidenceRetentionReview as EvidenceRetentionReviewProjection } from "@repo/contracts/evidence";

export const EVIDENCE_RETENTION_REPOSITORY = Symbol(
  "EVIDENCE_RETENTION_REPOSITORY",
);

/** Internal repository projection. linkedProductIds never crosses the HTTP boundary. */
export type EvidenceRetentionReview = EvidenceRetentionReviewProjection &
  Readonly<{
    linkedProductIds: readonly string[];
  }>;

export interface EvidenceRetentionRepository {
  retentionReview(
    organizationId: string,
    input: Readonly<{ actorId: string; documentId: string }>,
  ): Promise<EvidenceRetentionReview | null>;
  legalHolds(
    organizationId: string,
    input: Readonly<{ actorId: string; documentId: string }>,
  ): Promise<Readonly<{ legalHolds: readonly unknown[] }> | null>;
  placeLegalHold(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<EvidenceRetentionMutationResult>;
  releaseLegalHold(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      holdId: string;
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<EvidenceRetentionMutationResult>;
  confirmDeletion(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      expectedCurrentVersionId: string;
      reviewFingerprint: string;
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<EvidenceRetentionMutationResult>;
}

export type EvidenceRetentionMutationResult = Readonly<{
  outcome:
    | "placed"
    | "released"
    | "queued"
    | "replayed"
    | "idempotency_mismatch"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "blocked"
    | "invalid_request";
  value?: Record<string, unknown>;
}>;

type ReviewCommand = Readonly<{
  organizationId: string;
  actorId: string;
  documentId: string;
}>;

/**
 * Evidence does not calculate legal dates. The database holds the durable
 * per-version high watermark and the product projection is consumed here as a
 * fail-closed freshness boundary before a review can say deletion is eligible.
 * The deletion RPC performs the authoritative locked recheck, so a product or
 * hold change racing this read can never make cleanup permissible.
 */
export class EvidenceRetentionUseCases {
  constructor(
    private readonly repository: EvidenceRetentionRepository,
    private readonly productRetention: ProductRetentionProjectionPort,
  ) {}

  async review(input: ReviewCommand): Promise<EvidenceRetentionReview | null> {
    const review = await this.repository.retentionReview(input.organizationId, {
      actorId: input.actorId,
      documentId: input.documentId,
    });
    if (!review || !review.eligibleForDeletion) return review;

    const projections = await Promise.all(
      review.linkedProductIds.map(async (productId) => {
        try {
          return await this.productRetention.getRetentionProjection({
            organizationId: input.organizationId,
            actorId: input.actorId,
            productId,
          });
        } catch {
          return null;
        }
      }),
    );
    const protectionUncertain = projections.some((projection) => {
      if (!projection) return true;
      if (!projection.ok) return true;
      const retention = projection.value.retention;
      return (
        retention.status !== "current" ||
        retention.retentionUntil === null ||
        retention.retentionProtectionUntil === null ||
        retention.legalHoldActive
      );
    });
    if (!protectionUncertain) return review;
    return Object.freeze({
      ...review,
      eligibleForDeletion: false,
      blockers: [
        ...review.blockers,
        Object.freeze({
          visibility: "visible" as const,
          kind: "retention",
          obligation: "Retention protection could not be verified.",
          productId: null,
          productName: null,
          protectThrough: null,
        }),
      ],
    });
  }

  placeLegalHold(
    input: Parameters<EvidenceRetentionRepository["placeLegalHold"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.placeLegalHold(organizationId, request);
  }

  legalHolds(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      documentId: string;
    }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.legalHolds(organizationId, request);
  }

  releaseLegalHold(
    input: Parameters<EvidenceRetentionRepository["releaseLegalHold"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.releaseLegalHold(organizationId, request);
  }

  confirmDeletion(
    input: Parameters<EvidenceRetentionRepository["confirmDeletion"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.confirmDeletion(organizationId, request);
  }
}
