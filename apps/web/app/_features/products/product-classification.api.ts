import {
  productParamsSchema,
  productClassificationHistoryQuerySchema,
  productClassificationLatestQuerySchema,
  productClassificationPolicyResponseSchema,
  productClassificationHistoryResponseSchema,
  productClassificationsResponseSchema,
  saveProductClassificationInputSchema,
  saveProductClassificationResponseSchema,
  type ProductClassificationHistoryQuery,
  type SaveProductClassificationInput,
} from "@repo/contracts/products";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { apiClient } from "../../_lib/http/api-client";
function path(productId: string): `/api/v1/products/${string}/classifications` {
  const parsed = apiClient.parseInput(productParamsSchema, { productId });
  return `/api/v1/products/${parsed.productId}/classifications`;
}
/** Injected web transport validates both directions; identity remains server-owned. */
export class ProductClassificationApi {
  async policy(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/products/classification-policy",
      schema: productClassificationPolicyResponseSchema,
      signal,
    });
  }
  async latest(productIds: readonly string[], signal?: AbortSignal) {
    const query = apiClient.parseInput(productClassificationLatestQuerySchema, {
      productIds: productIds.join(","),
    });
    return authenticatedRequestJson({
      path: `/api/v1/products/classifications?${new URLSearchParams({ productIds: query.productIds.join(",") })}`,
      schema: productClassificationsResponseSchema,
      signal,
    });
  }
  async history(
    productId: string,
    input: Partial<ProductClassificationHistoryQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(
      productClassificationHistoryQuerySchema,
      input,
    );
    return authenticatedRequestJson({
      path: `${path(productId)}?${new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })}`,
      schema: productClassificationHistoryResponseSchema,
      signal,
    });
  }
  async save(
    productId: string,
    input: SaveProductClassificationInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: path(productId),
      method: "POST",
      body: input,
      inputSchema: saveProductClassificationInputSchema,
      schema: saveProductClassificationResponseSchema,
      signal,
    });
  }
}
export const productClassificationApi = Object.freeze(
  new ProductClassificationApi(),
);
