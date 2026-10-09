import type { ProductRetentionCalculation } from "@repo/contracts/products";

import type { Result } from "../../common/domain/result";
import type { ProductError } from "./product-use-cases";

export type ProductRetentionReadCommand = Readonly<{
  organizationId: string;
  actorId: string;
  productId: string;
}>;

/**
 * Published query boundary for product pages, reporting, and future evidence
 * owners. Consumers receive the safe projection rather than querying product
 * tables or reimplementing the legal calendar rule.
 */
export interface ProductRetentionReaderPort {
  getProductRetentionCalculation(
    command: ProductRetentionReadCommand,
  ): Promise<
    Result<Readonly<{ retention: ProductRetentionCalculation }>, ProductError>
  >;
}

/**
 * Inward-owned projection boundary for deletion/evidence integrations. It is
 * intentionally read-only: no consumer can lower legal protection itself.
 */
export interface ProductRetentionProjectionPort {
  getRetentionProjection(
    command: ProductRetentionReadCommand,
  ): Promise<
    Result<Readonly<{ retention: ProductRetentionCalculation }>, ProductError>
  >;
}

export const PRODUCT_RETENTION_READER = Symbol("PRODUCT_RETENTION_READER");
export const PRODUCT_RETENTION_PROJECTION = Symbol(
  "PRODUCT_RETENTION_PROJECTION",
);
