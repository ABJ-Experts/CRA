import {
  addReleaseMarketAvailabilityInputSchema,
  archiveProductInputSchema,
  archiveReleaseInputSchema,
  correctPlacedOnMarketDateInputSchema,
  correctReleaseMarketAvailabilityInputSchema,
  createSupportPeriodRequestSchema,
  createProductInputSchema,
  createReleaseInputSchema,
  memberStatesResponseSchema,
  moveProductLegalEntityInputSchema,
  productListQuerySchema,
  productParamsSchema,
  productResponseSchema,
  productsResponseSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseMarketAvailabilityParamsSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseListQuerySchema,
  releaseParamsSchema,
  releaseResponseSchema,
  releasesResponseSchema,
  removeReleaseMarketAvailabilityInputSchema,
  supportAlertIntervalsResponseSchema,
  supportAlertHistoryResponseSchema,
  supportPeriodHistoryResponseSchema,
  supportPeriodIdParamsSchema,
  previewSupportPeriodChangeRequestSchema,
  supportPeriodChangePreviewResponseSchema,
  supportPeriodResponseSchema,
  productRetentionResponseSchema,
  supersedeSupportPeriodRequestSchema,
  transitionReleaseLifecycleInputSchema,
  updateSupportAlertIntervalsRequestSchema,
  updateProductInputSchema,
  updateReleaseInputSchema,
  type AddReleaseMarketAvailabilityInput,
  type ArchiveProductInput,
  type ArchiveReleaseInput,
  type CorrectPlacedOnMarketDateInput,
  type CorrectReleaseMarketAvailabilityInput,
  type CreateSupportPeriodRequest,
  type CreateProductInput,
  type CreateReleaseInput,
  type MoveProductLegalEntityInput,
  type ProductListQuery,
  type RemoveReleaseMarketAvailabilityInput,
  type ReleaseListQuery,
  type SupersedeSupportPeriodRequest,
  type PreviewSupportPeriodChangeRequest,
  type TransitionReleaseLifecycleInput,
  type UpdateSupportAlertIntervalsRequest,
  type UpdateProductInput,
  type UpdateReleaseInput,
} from "@repo/contracts/products";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function productPath(productId: string, suffix = ""): `/${string}` {
  const parsed = productParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}${suffix}`;
}

function releasePath(
  productId: string,
  releaseId: string,
  suffix = "",
): `/${string}` {
  const parsed = releaseParamsSchema.safeParse({ productId, releaseId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The release identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}${suffix}`;
}

function releaseMarketAvailabilityPath(
  productId: string,
  releaseId: string,
  countryCode: string,
): `/${string}` {
  const parsed = releaseMarketAvailabilityParamsSchema.safeParse({
    productId,
    releaseId,
    countryCode,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The Member State identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}/market-availability/${parsed.data.countryCode}`;
}

function supportPeriodPath(
  productId: string,
  supportPeriodId: string,
  suffix = "",
): `/${string}` {
  const parsed = supportPeriodIdParamsSchema.safeParse({
    productId,
    supportPeriodId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The support period identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/support-periods/${parsed.data.supportPeriodId}${suffix}`;
}

function queryPath(
  path: `/${string}`,
  query: Record<string, unknown>,
): `/${string}` {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}

/** Typed browser boundary for the authoritative M2 API, never dashboard mocks. */
export class ProductsApi {
  async listMemberStates(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/products/member-states",
      schema: memberStatesResponseSchema,
      signal,
    });
  }

  async list(input: Partial<ProductListQuery> = {}, signal?: AbortSignal) {
    const query = apiClient.parseInput(productListQuerySchema, {
      ...input,
      archived:
        input.archived === undefined ? undefined : String(input.archived),
    });
    return authenticatedRequestJson({
      path: queryPath("/api/v1/products", query),
      schema: productsResponseSchema,
      signal,
    });
  }

  async get(productId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: productPath(productId),
      schema: productResponseSchema,
      signal,
    });
  }

  async create(input: CreateProductInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/products",
      method: "POST",
      body: input,
      inputSchema: createProductInputSchema,
      schema: productResponseSchema,
      signal,
    });
  }

  async update(
    productId: string,
    input: UpdateProductInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId),
      method: "PATCH",
      body: input,
      inputSchema: updateProductInputSchema,
      schema: productResponseSchema,
      signal,
    });
  }

  async archive(
    productId: string,
    input: ArchiveProductInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/archive"),
      method: "POST",
      body: input,
      inputSchema: archiveProductInputSchema,
      schema: productResponseSchema,
      signal,
    });
  }

  async moveLegalEntity(
    productId: string,
    input: MoveProductLegalEntityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/legal-entity-assignment"),
      method: "POST",
      body: input,
      inputSchema: moveProductLegalEntityInputSchema,
      schema: productResponseSchema,
      signal,
    });
  }

  async listReleases(
    productId: string,
    input: Partial<ReleaseListQuery> = {},
    signal?: AbortSignal,
  ) {
    const params = apiClient.parseInput(releaseListQuerySchema, {
      ...input,
      archived:
        input.archived === undefined ? undefined : String(input.archived),
    });
    return authenticatedRequestJson({
      path: queryPath(productPath(productId, "/releases"), params),
      schema: releasesResponseSchema,
      signal,
    });
  }

  async getRelease(productId: string, releaseId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId),
      schema: releaseResponseSchema,
      signal,
    });
  }

  async createRelease(
    productId: string,
    input: CreateReleaseInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/releases"),
      method: "POST",
      body: input,
      inputSchema: createReleaseInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async updateRelease(
    productId: string,
    releaseId: string,
    input: UpdateReleaseInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId),
      method: "PATCH",
      body: input,
      inputSchema: updateReleaseInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async archiveRelease(
    productId: string,
    releaseId: string,
    input: ArchiveReleaseInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId, "/archive"),
      method: "POST",
      body: input,
      inputSchema: archiveReleaseInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async getReleaseMarketAvailability(
    productId: string,
    releaseId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId, "/market-availability"),
      schema: releaseMarketAvailabilityResponseSchema,
      signal,
    });
  }

  async addReleaseMarketAvailability(
    productId: string,
    releaseId: string,
    input: AddReleaseMarketAvailabilityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId, "/market-availability"),
      method: "POST",
      body: input,
      inputSchema: addReleaseMarketAvailabilityInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async removeReleaseMarketAvailability(
    productId: string,
    releaseId: string,
    countryCode: string,
    input: RemoveReleaseMarketAvailabilityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releaseMarketAvailabilityPath(productId, releaseId, countryCode),
      method: "DELETE",
      body: input,
      inputSchema: removeReleaseMarketAvailabilityInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async correctReleaseMarketAvailability(
    productId: string,
    releaseId: string,
    input: CorrectReleaseMarketAvailabilityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(
        productId,
        releaseId,
        "/market-availability/corrections",
      ),
      method: "POST",
      body: input,
      inputSchema: correctReleaseMarketAvailabilityInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async transitionReleaseLifecycle(
    productId: string,
    releaseId: string,
    input: TransitionReleaseLifecycleInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId, "/lifecycle-transitions"),
      method: "POST",
      body: input,
      inputSchema: transitionReleaseLifecycleInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async correctPlacedOnMarketDate(
    productId: string,
    releaseId: string,
    input: CorrectPlacedOnMarketDateInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(
        productId,
        releaseId,
        "/placed-on-market-date-corrections",
      ),
      method: "POST",
      body: input,
      inputSchema: correctPlacedOnMarketDateInputSchema,
      schema: releaseResponseSchema,
      signal,
    });
  }

  async getReleaseLifecycleTimeline(
    productId: string,
    releaseId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: releasePath(productId, releaseId, "/lifecycle-timeline"),
      schema: releaseLifecycleTimelineResponseSchema,
      signal,
    });
  }

  async listSupportPeriods(
    productId: string,
    releaseId: string,
    signal?: AbortSignal,
  ) {
    const parsed = releaseParamsSchema.safeParse({ productId, releaseId });
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid_request",
        "The release identifier is invalid.",
        400,
      );
    }
    return authenticatedRequestJson({
      path: queryPath(productPath(productId, "/support-periods"), {
        releaseId: parsed.data.releaseId,
      }),
      schema: supportPeriodHistoryResponseSchema,
      signal,
    });
  }

  async previewSupportPeriod(
    productId: string,
    input: PreviewSupportPeriodChangeRequest,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/support-period-preview"),
      method: "POST",
      body: input,
      inputSchema: previewSupportPeriodChangeRequestSchema,
      schema: supportPeriodChangePreviewResponseSchema,
      signal,
    });
  }

  async createSupportPeriod(
    productId: string,
    input: CreateSupportPeriodRequest,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/support-periods"),
      method: "POST",
      body: input,
      inputSchema: createSupportPeriodRequestSchema,
      schema: supportPeriodResponseSchema,
      signal,
    });
  }

  async supersedeSupportPeriod(
    productId: string,
    supportPeriodId: string,
    input: SupersedeSupportPeriodRequest,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: supportPeriodPath(productId, supportPeriodId, "/supersessions"),
      method: "POST",
      body: input,
      inputSchema: supersedeSupportPeriodRequestSchema,
      schema: supportPeriodResponseSchema,
      signal,
    });
  }

  async getSupportRetention(productId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: productPath(productId, "/retention"),
      schema: productRetentionResponseSchema,
      signal,
    });
  }

  async getSupportAlerts(productId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: productPath(productId, "/support-alerts"),
      schema: supportAlertHistoryResponseSchema,
      signal,
    });
  }

  async getSupportAlertIntervals(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/products/support-alert-intervals",
      schema: supportAlertIntervalsResponseSchema,
      signal,
    });
  }

  async updateSupportAlertIntervals(
    input: UpdateSupportAlertIntervalsRequest,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/products/support-alert-intervals",
      method: "PATCH",
      body: input,
      inputSchema: updateSupportAlertIntervalsRequestSchema,
      schema: supportAlertIntervalsResponseSchema,
      signal,
    });
  }
}

export const productsApi = Object.freeze(new ProductsApi());
