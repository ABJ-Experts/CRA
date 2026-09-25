import type { RelationshipPropagationCandidate } from "@repo/contracts/products";

import type { Result } from "../../common/domain/result";
import type { ProductError } from "./product-use-cases";

/**
 * Scoped, read-only boundary for the finding owner. It resolves potential
 * affected releases/products, but never evaluates a finding's applicability.
 */
export interface ProductRelationshipResolverPort {
  getRelationshipPropagationCandidates(
    command: ProductRelationshipPropagationCommand,
  ): Promise<
    Result<
      Readonly<{
        candidates: readonly RelationshipPropagationCandidate[];
        nextCursor: string | null;
        graphVersion: number;
        evaluatedAt: string;
      }>,
      ProductError
    >
  >;
}

export type ProductRelationshipPropagationCommand = Readonly<{
  organizationId: string;
  actorId: string;
  sourceReleaseId?: string;
  sourceBaselineRevisionId?: string;
  graphVersion: number;
  asOf?: string;
  cursor?: string;
  pageSize?: number;
}>;

export const PRODUCT_RELATIONSHIP_RESOLVER = Symbol(
  "PRODUCT_RELATIONSHIP_RESOLVER",
);
