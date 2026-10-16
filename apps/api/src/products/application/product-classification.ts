import {
  PRODUCT_CLASSIFICATION_POLICY,
  deriveProductClassification,
  saveProductClassificationInputSchema,
  saveProductClassificationResponseSchema,
  productClassificationHistoryResponseSchema,
  productClassificationsResponseSchema,
  type ProductClassificationPolicy,
  type SaveProductClassificationInput,
  type SaveProductClassificationResponse,
  type ProductClassificationHistoryQuery,
  type ProductClassificationHistoryResponse,
  type ProductClassificationLatestQuery,
  type ProductClassificationsResponse,
} from "@repo/contracts/products";
export const PRODUCT_CLASSIFICATION_REPOSITORY = Symbol(
  "PRODUCT_CLASSIFICATION_REPOSITORY",
);
export type ClassificationFailureCode =
  | "not_found"
  | "forbidden"
  | "invalid_request"
  | "conflict"
  | "invalid_state"
  | "idempotency_mismatch"
  | "unavailable"
  | "malformed_provider";
export class ClassificationFailure extends Error {
  constructor(readonly code: ClassificationFailureCode) {
    super("Product classification request could not be completed.");
  }
}
export interface ProductClassificationRepository {
  save(
    orgId: string,
    actorId: string,
    productId: string,
    input: SaveProductClassificationInput,
    policy: ProductClassificationPolicy,
  ): Promise<SaveProductClassificationResponse>;
  history(
    orgId: string,
    actorId: string,
    productId: string,
    query: ProductClassificationHistoryQuery,
  ): Promise<Omit<ProductClassificationHistoryResponse, "policy">>;
  latest(
    orgId: string,
    actorId: string,
    query: ProductClassificationLatestQuery,
  ): Promise<ProductClassificationsResponse>;
}
export class ProductClassificationUseCases {
  constructor(private readonly repository: ProductClassificationRepository) {}
  policy() {
    return { policy: PRODUCT_CLASSIFICATION_POLICY };
  }
  async save(
    orgId: string,
    actorId: string,
    productId: string,
    input: SaveProductClassificationInput,
  ) {
    const parsed = saveProductClassificationInputSchema.safeParse(input);
    if (!parsed.success) throw new ClassificationFailure("invalid_request");
    if (
      parsed.data.policyHash !== PRODUCT_CLASSIFICATION_POLICY.hash ||
      parsed.data.policyVersion !== PRODUCT_CLASSIFICATION_POLICY.version
    )
      throw new ClassificationFailure("conflict");
    deriveProductClassification(parsed.data.answers);
    return saveProductClassificationResponseSchema.parse(
      await this.repository.save(
        orgId,
        actorId,
        productId,
        parsed.data,
        PRODUCT_CLASSIFICATION_POLICY,
      ),
    );
  }
  async history(
    orgId: string,
    actorId: string,
    productId: string,
    query: ProductClassificationHistoryQuery,
  ) {
    return productClassificationHistoryResponseSchema.parse({
      ...(await this.repository.history(orgId, actorId, productId, query)),
      policy: PRODUCT_CLASSIFICATION_POLICY,
    });
  }
  async latest(
    orgId: string,
    actorId: string,
    query: ProductClassificationLatestQuery,
  ) {
    return productClassificationsResponseSchema.parse(
      await this.repository.latest(orgId, actorId, query),
    );
  }
}
