import {
  findingImpactSummaryQuerySchema,
  findingImpactSummaryResponseSchema,
  type FindingImpactSummaryQuery,
} from "@repo/contracts/findings";
import { productParamsSchema } from "@repo/contracts/products";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function productFindingImpactSummaryPath(
  productId: string,
  query: FindingImpactSummaryQuery,
): `/${string}` {
  const product = productParamsSchema.safeParse({ productId });
  if (!product.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product identifier is invalid.",
      400,
    );
  }

  const params = new URLSearchParams();
  if (query.releaseId !== undefined) params.set("releaseId", query.releaseId);
  const suffix = params.toString();
  return `/api/v1/products/${product.data.productId}/finding-impact-summary${
    suffix === "" ? "" : `?${suffix}`
  }`;
}

/**
 * Typed read boundary for aggregate-only finding impact status. It deliberately
 * never requests finding evidence, SBOM contents, or analyst assessments.
 */
export class FindingImpactApi {
  async getProductSummary(
    productId: string,
    input: FindingImpactSummaryQuery = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(findingImpactSummaryQuerySchema, input);
    return authenticatedRequestJson({
      path: productFindingImpactSummaryPath(productId, query),
      schema: findingImpactSummaryResponseSchema,
      signal,
    });
  }
}

export const findingImpactApi = Object.freeze(new FindingImpactApi());
