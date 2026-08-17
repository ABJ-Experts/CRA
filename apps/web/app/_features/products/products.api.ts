import {
  addReleaseMarketAvailabilityInputSchema,
  appendSoftwareBaselineRevisionInputSchema,
  archiveProductInputSchema,
  archiveReleaseInputSchema,
  archiveSoftwareBaselineInputSchema,
  assignSoftwareBaselineMembershipInputSchema,
  createProductComponentLinkInputSchema,
  createProductVariantRelationshipInputSchema,
  correctPlacedOnMarketDateInputSchema,
  correctReleaseMarketAvailabilityInputSchema,
  createSupportPeriodRequestSchema,
  createProductInputSchema,
  createReleaseInputSchema,
  createSoftwareBaselineInputSchema,
  endProductComponentLinkInputSchema,
  endProductVariantRelationshipInputSchema,
  endSoftwareBaselineMembershipInputSchema,
  memberStatesResponseSchema,
  moveProductLegalEntityInputSchema,
  productListQuerySchema,
  productParamsSchema,
  productComponentLinkResponseSchema,
  productComponentLinksResponseSchema,
  productImportCancelInputSchema,
  productImportCommitInputSchema,
  productImportListQuerySchema,
  productImportParamsSchema,
  productImportReportLinkResponseSchema,
  productImportResponseSchema,
  productImportRowsQuerySchema,
  productImportRowsResponseSchema,
  productImportTemplateResponseSchema,
  productImportUploadFieldsSchema,
  productImportsResponseSchema,
  productRelationshipGraphQuerySchema,
  productRelationshipGraphResponseSchema,
  productRelationshipParamsSchema,
  productRelationshipPreviewResponseSchema,
  productVariantRelationshipResponseSchema,
  productVariantRelationshipsResponseSchema,
  previewProductComponentLinkInputSchema,
  requestRelationshipReevaluationInputSchema,
  requestRelationshipReevaluationResponseSchema,
  productResponseSchema,
  productsResponseSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseMarketAvailabilityParamsSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseListQuerySchema,
  releaseParamsSchema,
  releaseResponseSchema,
  releasesResponseSchema,
  relationshipPropagationEventsQuerySchema,
  relationshipPropagationEventsResponseSchema,
  softwareBaselineMembershipParamsSchema,
  softwareBaselineMembershipResponseSchema,
  softwareBaselineMembershipsResponseSchema,
  softwareBaselineListQuerySchema,
  softwareBaselineListResponseSchema,
  softwareBaselineParamsSchema,
  softwareBaselineResponseSchema,
  softwareBaselinesResponseSchema,
  supersedeProductComponentLinkInputSchema,
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
  type AppendSoftwareBaselineRevisionInput,
  type ArchiveProductInput,
  type ArchiveReleaseInput,
  type ArchiveSoftwareBaselineInput,
  type AssignSoftwareBaselineMembershipInput,
  type CreateProductComponentLinkInput,
  type CreateProductVariantRelationshipInput,
  type CorrectPlacedOnMarketDateInput,
  type CorrectReleaseMarketAvailabilityInput,
  type CreateSupportPeriodRequest,
  type CreateProductInput,
  type CreateReleaseInput,
  type CreateSoftwareBaselineInput,
  type EndProductComponentLinkInput,
  type EndProductVariantRelationshipInput,
  type EndSoftwareBaselineMembershipInput,
  type MoveProductLegalEntityInput,
  type ProductListQuery,
  type ProductImportCancelInput,
  type ProductImportCommitInput,
  type ProductImportReportLinkResponse,
  type ProductImportResponse,
  type ProductImportRowsResponse,
  type ProductImportsResponse,
  type ProductImportListQuery,
  type ProductImportRowsQuery,
  type ProductImportTemplateResponse,
  type ProductImportUploadFields,
  type ProductRelationshipGraphQuery,
  type PreviewProductComponentLinkInput,
  type RequestRelationshipReevaluationInput,
  type RemoveReleaseMarketAvailabilityInput,
  type ReleaseListQuery,
  type RelationshipPropagationEventsQuery,
  type SoftwareBaselineListQuery,
  type SupersedeSupportPeriodRequest,
  type SupersedeProductComponentLinkInput,
  type PreviewSupportPeriodChangeRequest,
  type TransitionReleaseLifecycleInput,
  type UpdateSupportAlertIntervalsRequest,
  type UpdateProductInput,
  type UpdateReleaseInput,
} from "@repo/contracts/products";

import {
  authenticatedRequestJson,
  authenticatedRequestMultipart,
} from "../../_lib/http/authenticated-request";
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

function baselinePath(baselineId: string, suffix = ""): `/${string}` {
  const parsed = softwareBaselineParamsSchema.safeParse({ baselineId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The software baseline identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/baselines/${parsed.data.baselineId}${suffix}`;
}

function relationshipPath(
  productId: string,
  relationshipId: string,
  suffix = "",
): `/${string}` {
  const parsed = productRelationshipParamsSchema.safeParse({
    productId,
    relationshipId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The relationship identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}${suffix.replace(
    ":relationshipId",
    parsed.data.relationshipId,
  )}`;
}

function membershipPath(
  productId: string,
  membershipId: string,
  suffix = "",
): `/${string}` {
  const parsed = softwareBaselineMembershipParamsSchema.safeParse({
    productId,
    membershipId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The baseline membership identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/baseline-memberships/${parsed.data.membershipId}${suffix}`;
}

function importPath(importId: string, suffix = ""): `/${string}` {
  const parsed = productImportParamsSchema.safeParse({ importId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The import identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/imports/${parsed.data.importId}${suffix}`;
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
  getImportTemplate(
    signal?: AbortSignal,
  ): Promise<ProductImportTemplateResponse> {
    return authenticatedRequestJson<typeof productImportTemplateResponseSchema>(
      {
        path: "/api/v1/products/imports/template",
        schema: productImportTemplateResponseSchema,
        signal,
      },
    );
  }

  uploadImport(
    fields: ProductImportUploadFields,
    file: File,
    signal?: AbortSignal,
  ): Promise<ProductImportResponse> {
    return authenticatedRequestMultipart<
      typeof productImportResponseSchema,
      typeof productImportUploadFieldsSchema
    >({
      path: "/api/v1/products/imports",
      method: "POST",
      fields,
      fieldsSchema: productImportUploadFieldsSchema,
      file: { name: "file", value: file },
      schema: productImportResponseSchema,
      signal,
    });
  }

  getImport(
    importId: string,
    signal?: AbortSignal,
  ): Promise<ProductImportResponse> {
    return authenticatedRequestJson<typeof productImportResponseSchema>({
      path: importPath(importId),
      schema: productImportResponseSchema,
      signal,
    });
  }

  listImportRows(
    importId: string,
    query: Partial<ProductImportRowsQuery> = {},
    signal?: AbortSignal,
  ): Promise<ProductImportRowsResponse> {
    const parsed = apiClient.parseInput(productImportRowsQuerySchema, query);
    return authenticatedRequestJson<typeof productImportRowsResponseSchema>({
      path: queryPath(importPath(importId, "/rows"), parsed),
      schema: productImportRowsResponseSchema,
      signal,
    });
  }

  commitImport(
    importId: string,
    input: ProductImportCommitInput,
    signal?: AbortSignal,
  ): Promise<ProductImportResponse> {
    return authenticatedRequestJson<
      typeof productImportResponseSchema,
      typeof productImportCommitInputSchema
    >({
      path: importPath(importId, "/commit"),
      method: "POST",
      body: input,
      inputSchema: productImportCommitInputSchema,
      schema: productImportResponseSchema,
      signal,
    });
  }

  cancelImport(
    importId: string,
    input: ProductImportCancelInput,
    signal?: AbortSignal,
  ): Promise<ProductImportResponse> {
    return authenticatedRequestJson<
      typeof productImportResponseSchema,
      typeof productImportCancelInputSchema
    >({
      path: importPath(importId, "/cancel"),
      method: "POST",
      body: input,
      inputSchema: productImportCancelInputSchema,
      schema: productImportResponseSchema,
      signal,
    });
  }

  listImports(
    query: Partial<ProductImportListQuery> = {},
    signal?: AbortSignal,
  ): Promise<ProductImportsResponse> {
    const parsed = apiClient.parseInput(productImportListQuerySchema, query);
    return authenticatedRequestJson<typeof productImportsResponseSchema>({
      path: queryPath("/api/v1/products/imports", parsed),
      schema: productImportsResponseSchema,
      signal,
    });
  }

  getImportReportLink(
    importId: string,
    signal?: AbortSignal,
  ): Promise<ProductImportReportLinkResponse> {
    return authenticatedRequestJson<
      typeof productImportReportLinkResponseSchema
    >({
      path: importPath(importId, "/report"),
      schema: productImportReportLinkResponseSchema,
      signal,
    });
  }

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

  async listSoftwareBaselines(
    input: Partial<SoftwareBaselineListQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(softwareBaselineListQuerySchema, {
      ...input,
      includeArchived:
        input.includeArchived === undefined
          ? undefined
          : String(input.includeArchived),
    });
    return authenticatedRequestJson({
      path: queryPath("/api/v1/products/baselines", query),
      schema: softwareBaselineListResponseSchema,
      signal,
    });
  }

  async createSoftwareBaseline(
    input: CreateSoftwareBaselineInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/products/baselines",
      method: "POST",
      body: input,
      inputSchema: createSoftwareBaselineInputSchema,
      schema: softwareBaselineResponseSchema,
      signal,
    });
  }

  async listSoftwareBaselineRevisions(
    baselineId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: baselinePath(baselineId, "/revisions"),
      // The API deliberately returns the immutable baseline rows under the
      // established `baselines` envelope. Keep the gateway aligned with that
      // strict wire contract rather than accepting a second, look-alike shape.
      schema: softwareBaselinesResponseSchema,
      signal,
    });
  }

  async appendSoftwareBaselineRevision(
    baselineId: string,
    input: AppendSoftwareBaselineRevisionInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: baselinePath(baselineId, "/revisions"),
      method: "POST",
      body: input,
      inputSchema: appendSoftwareBaselineRevisionInputSchema,
      schema: softwareBaselineResponseSchema,
      signal,
    });
  }

  async archiveSoftwareBaseline(
    baselineId: string,
    input: ArchiveSoftwareBaselineInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: baselinePath(baselineId, "/archive"),
      method: "POST",
      body: input,
      inputSchema: archiveSoftwareBaselineInputSchema,
      schema: softwareBaselineResponseSchema,
      signal,
    });
  }

  async listSoftwareBaselineMemberships(
    productId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/baseline-memberships"),
      schema: softwareBaselineMembershipsResponseSchema,
      signal,
    });
  }

  async assignSoftwareBaselineMembership(
    productId: string,
    input: AssignSoftwareBaselineMembershipInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/baseline-memberships"),
      method: "POST",
      body: input,
      inputSchema: assignSoftwareBaselineMembershipInputSchema,
      schema: softwareBaselineMembershipResponseSchema,
      signal,
    });
  }

  async endSoftwareBaselineMembership(
    productId: string,
    membershipId: string,
    input: EndSoftwareBaselineMembershipInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: membershipPath(productId, membershipId, "/end"),
      method: "POST",
      body: input,
      inputSchema: endSoftwareBaselineMembershipInputSchema,
      schema: softwareBaselineMembershipResponseSchema,
      signal,
    });
  }

  async listProductVariantRelationships(
    productId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/variant-relationships"),
      schema: productVariantRelationshipsResponseSchema,
      signal,
    });
  }

  async createProductVariantRelationship(
    productId: string,
    input: CreateProductVariantRelationshipInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/variant-relationships"),
      method: "POST",
      body: input,
      inputSchema: createProductVariantRelationshipInputSchema,
      schema: productVariantRelationshipResponseSchema,
      signal,
    });
  }

  async endProductVariantRelationship(
    productId: string,
    relationshipId: string,
    input: EndProductVariantRelationshipInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: relationshipPath(
        productId,
        relationshipId,
        "/variant-relationships/:relationshipId/end",
      ),
      method: "POST",
      body: input,
      inputSchema: endProductVariantRelationshipInputSchema,
      schema: productVariantRelationshipResponseSchema,
      signal,
    });
  }

  async listProductComponentLinks(productId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: productPath(productId, "/component-links"),
      schema: productComponentLinksResponseSchema,
      signal,
    });
  }

  async previewProductComponentLink(
    productId: string,
    input: PreviewProductComponentLinkInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/component-links/preview"),
      method: "POST",
      body: input,
      inputSchema: previewProductComponentLinkInputSchema,
      schema: productRelationshipPreviewResponseSchema,
      signal,
    });
  }

  async createProductComponentLink(
    productId: string,
    input: CreateProductComponentLinkInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/component-links"),
      method: "POST",
      body: input,
      inputSchema: createProductComponentLinkInputSchema,
      schema: productComponentLinkResponseSchema,
      signal,
    });
  }

  async supersedeProductComponentLink(
    productId: string,
    relationshipId: string,
    input: SupersedeProductComponentLinkInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: relationshipPath(
        productId,
        relationshipId,
        "/component-links/:relationshipId/supersessions",
      ),
      method: "POST",
      body: input,
      inputSchema: supersedeProductComponentLinkInputSchema,
      schema: productComponentLinkResponseSchema,
      signal,
    });
  }

  async endProductComponentLink(
    productId: string,
    relationshipId: string,
    input: EndProductComponentLinkInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: relationshipPath(
        productId,
        relationshipId,
        "/component-links/:relationshipId/end",
      ),
      method: "POST",
      body: input,
      inputSchema: endProductComponentLinkInputSchema,
      schema: productComponentLinkResponseSchema,
      signal,
    });
  }

  async getProductRelationshipGraph(
    productId: string,
    input: Partial<ProductRelationshipGraphQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(productRelationshipGraphQuerySchema, {
      ...input,
      includeEnded:
        input.includeEnded === undefined
          ? undefined
          : String(input.includeEnded),
    });
    return authenticatedRequestJson({
      path: queryPath(productPath(productId, "/relationship-graph"), query),
      schema: productRelationshipGraphResponseSchema,
      signal,
    });
  }

  async listRelationshipPropagationEvents(
    productId: string,
    input: Partial<RelationshipPropagationEventsQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(
      relationshipPropagationEventsQuerySchema,
      input,
    );
    return authenticatedRequestJson({
      path: queryPath(
        productPath(productId, "/relationship-propagation-events"),
        query,
      ),
      schema: relationshipPropagationEventsResponseSchema,
      signal,
    });
  }

  async requestRelationshipReevaluation(
    productId: string,
    input: RequestRelationshipReevaluationInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: productPath(productId, "/relationship-reevaluations"),
      method: "POST",
      body: input,
      inputSchema: requestRelationshipReevaluationInputSchema,
      schema: requestRelationshipReevaluationResponseSchema,
      signal,
    });
  }
}

export const productsApi = Object.freeze(new ProductsApi());
