import {
  frameworkCatalogResponseSchema,
  frameworkSelectionParamsSchema,
  frameworkSelectionResponseSchema,
  frameworkTreeParamsSchema,
  frameworkTreeQuerySchema,
  frameworkTreeResponseSchema,
  selectFrameworkInputSchema,
  type SelectFrameworkInput,
  frameworkCrosswalkParamsSchema,
  frameworkCrosswalkQuerySchema,
  frameworkCrosswalkResponseSchema,
  frameworkUpgradePreviewParamsSchema,
  frameworkUpgradePreviewQuerySchema,
  frameworkUpgradePreviewResponseSchema,
  frameworkUpgradeReviewParamsSchema,
  frameworkUpgradeReviewQuerySchema,
  frameworkUpgradeReviewResponseSchema,
  frameworkUpgradeDecisionParamsSchema,
  createFrameworkUpgradeReviewInputSchema,
  createFrameworkUpgradeReviewResponseSchema,
  upsertFrameworkUpgradeDecisionInputSchema,
  frameworkUpgradeDecisionResponseSchema,
  commitFrameworkUpgradeInputSchema,
  commitFrameworkUpgradeResponseSchema,
  frameworkCrosswalkEvidenceReuseParamsSchema,
  frameworkCrosswalkEvidenceReuseQuerySchema,
  frameworkCrosswalkEvidenceReuseResponseSchema,
} from "@repo/contracts/frameworks";
import type { z } from "zod";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function packPath(packKey: string): `/${string}` {
  const parsed = frameworkSelectionParamsSchema.safeParse({ packKey });
  if (!parsed.success)
    throw new ApiClientError("invalid_request", "Invalid framework key.", 400);
  return `/api/v1/frameworks/${encodeURIComponent(parsed.data.packKey)}`;
}

export class FrameworksApi {
  catalog(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/frameworks",
      schema: frameworkCatalogResponseSchema,
      signal,
    });
  }

  tree(
    packKey: string,
    versionKey: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const parsed = frameworkTreeParamsSchema.safeParse({ packKey, versionKey });
    if (!parsed.success)
      throw new ApiClientError(
        "invalid_request",
        "Invalid framework version.",
        400,
      );
    const query = apiClient.parseInput(frameworkTreeQuerySchema, {
      limit: 100,
      cursor,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `${packPath(parsed.data.packKey)}/versions/${encodeURIComponent(parsed.data.versionKey)}/tree?${search}`,
      schema: frameworkTreeResponseSchema,
      signal,
    });
  }

  select(packKey: string, input: SelectFrameworkInput) {
    return authenticatedRequestJson({
      path: `${packPath(packKey)}/selection`,
      method: "PUT",
      body: input,
      inputSchema: selectFrameworkInputSchema,
      schema: frameworkSelectionResponseSchema,
    });
  }

  crosswalks(
    packKey: string,
    versionKey: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const params = apiClient.parseInput(frameworkCrosswalkParamsSchema, {
      packKey,
      versionKey,
    });
    const query = apiClient.parseInput(frameworkCrosswalkQuerySchema, {
      limit: 50,
      cursor,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `${packPath(params.packKey)}/versions/${encodeURIComponent(params.versionKey)}/crosswalks?${search}`,
      schema: frameworkCrosswalkResponseSchema,
      signal,
    });
  }

  upgradePreview(
    packKey: string,
    targetVersionKey: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const params = apiClient.parseInput(frameworkUpgradePreviewParamsSchema, {
      packKey,
      targetVersionKey,
    });
    const query = apiClient.parseInput(frameworkUpgradePreviewQuerySchema, {
      limit: 50,
      cursor,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `${packPath(params.packKey)}/upgrades/${encodeURIComponent(params.targetVersionKey)}/preview?${search}`,
      schema: frameworkUpgradePreviewResponseSchema,
      signal,
    });
  }

  createUpgradeReview(
    packKey: string,
    input: z.output<typeof createFrameworkUpgradeReviewInputSchema>,
  ) {
    return authenticatedRequestJson({
      path: `${packPath(packKey)}/upgrade-reviews`,
      method: "POST",
      body: input,
      inputSchema: createFrameworkUpgradeReviewInputSchema,
      schema: createFrameworkUpgradeReviewResponseSchema,
    });
  }

  upgradeReview(
    packKey: string,
    reviewId: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const params = apiClient.parseInput(frameworkUpgradeReviewParamsSchema, {
      packKey,
      reviewId,
    });
    const query = apiClient.parseInput(frameworkUpgradeReviewQuerySchema, {
      limit: 50,
      cursor,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `${packPath(params.packKey)}/upgrade-reviews/${params.reviewId}?${search}`,
      schema: frameworkUpgradeReviewResponseSchema,
      signal,
    });
  }

  upgradeDecision(
    packKey: string,
    reviewId: string,
    mappingId: string,
    input: z.output<typeof upsertFrameworkUpgradeDecisionInputSchema>,
  ) {
    const params = apiClient.parseInput(frameworkUpgradeDecisionParamsSchema, {
      packKey,
      reviewId,
      mappingId,
    });
    return authenticatedRequestJson({
      path: `${packPath(params.packKey)}/upgrade-reviews/${params.reviewId}/decisions/${params.mappingId}`,
      method: "PUT",
      body: input,
      inputSchema: upsertFrameworkUpgradeDecisionInputSchema,
      schema: frameworkUpgradeDecisionResponseSchema,
    });
  }

  commitUpgrade(
    packKey: string,
    reviewId: string,
    input: z.output<typeof commitFrameworkUpgradeInputSchema>,
  ) {
    const params = apiClient.parseInput(frameworkUpgradeReviewParamsSchema, {
      packKey,
      reviewId,
    });
    return authenticatedRequestJson({
      path: `${packPath(params.packKey)}/upgrade-reviews/${params.reviewId}/commit`,
      method: "POST",
      body: input,
      inputSchema: commitFrameworkUpgradeInputSchema,
      schema: commitFrameworkUpgradeResponseSchema,
    });
  }

  crosswalkEvidenceReuse(
    evidenceVersionId: string,
    productId: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const params = apiClient.parseInput(
      frameworkCrosswalkEvidenceReuseParamsSchema,
      { evidenceVersionId },
    );
    const query = apiClient.parseInput(
      frameworkCrosswalkEvidenceReuseQuerySchema,
      { productId, limit: 50, cursor },
    );
    const search = new URLSearchParams({
      productId: query.productId,
      limit: String(query.limit),
    });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `/api/v1/frameworks/evidence/${params.evidenceVersionId}/crosswalk-reuse?${search}`,
      schema: frameworkCrosswalkEvidenceReuseResponseSchema,
      signal,
    });
  }
}

export const frameworksApi = new FrameworksApi();
