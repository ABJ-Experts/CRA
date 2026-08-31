import type { z } from "zod";

import type {
  archiveProductInputSchema,
  archiveReleaseInputSchema,
  addReleaseMarketAvailabilityInputSchema,
  correctPlacedOnMarketDateInputSchema,
  correctReleaseMarketAvailabilityInputSchema,
  createProductInputSchema,
  createReleaseInputSchema,
  memberStateCountryCodeSchema,
  memberStateReferenceSchema,
  memberStatesResponseSchema,
  moveProductLegalEntityInputSchema,
  productListQuerySchema,
  productParamsSchema,
  productResponseSchema,
  productSchema,
  productsResponseSchema,
  productTypeSchema,
  releaseLifecycleStateSchema,
  releaseLifecycleTimelineEventSchema,
  releaseLifecycleTimelineEventTypeSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseMarketAvailabilityParamsSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseMarketAvailabilitySchema,
  releaseMarketAvailabilityWarningSchema,
  releaseMarketLifecycleDomainErrorCodeSchema,
  releaseMarketLifecycleDomainErrorSchema,
  releaseLifecycleSchema,
  releaseListQuerySchema,
  releaseParamsSchema,
  releaseResponseSchema,
  releaseSchema,
  releasesResponseSchema,
  removeReleaseMarketAvailabilityInputSchema,
  transitionReleaseLifecycleInputSchema,
  utcZDateTimeSchema,
  updateProductInputSchema,
  updateReleaseInputSchema,
} from "../schemas/index.js";

export type ProductType = z.output<typeof productTypeSchema>;
export type ReleaseLifecycle = z.output<typeof releaseLifecycleSchema>;
export type ReleaseLifecycleState = z.output<
  typeof releaseLifecycleStateSchema
>;
export type UtcZDateTime = z.output<typeof utcZDateTimeSchema>;
export type MemberStateCountryCode = z.output<
  typeof memberStateCountryCodeSchema
>;
export type MemberStateReference = z.output<typeof memberStateReferenceSchema>;
export type MemberStatesResponse = z.output<typeof memberStatesResponseSchema>;
export type ReleaseMarketAvailability = z.output<
  typeof releaseMarketAvailabilitySchema
>;
export type ReleaseMarketAvailabilityResponse = z.output<
  typeof releaseMarketAvailabilityResponseSchema
>;
export type ReleaseMarketAvailabilityParams = z.output<
  typeof releaseMarketAvailabilityParamsSchema
>;
export type AddReleaseMarketAvailabilityInput = z.output<
  typeof addReleaseMarketAvailabilityInputSchema
>;
export type RemoveReleaseMarketAvailabilityInput = z.output<
  typeof removeReleaseMarketAvailabilityInputSchema
>;
export type CorrectReleaseMarketAvailabilityInput = z.output<
  typeof correctReleaseMarketAvailabilityInputSchema
>;
export type TransitionReleaseLifecycleInput = z.output<
  typeof transitionReleaseLifecycleInputSchema
>;
export type CorrectPlacedOnMarketDateInput = z.output<
  typeof correctPlacedOnMarketDateInputSchema
>;
export type ReleaseMarketAvailabilityWarning = z.output<
  typeof releaseMarketAvailabilityWarningSchema
>;
export type ReleaseLifecycleTimelineEventType = z.output<
  typeof releaseLifecycleTimelineEventTypeSchema
>;
export type ReleaseLifecycleTimelineEvent = z.output<
  typeof releaseLifecycleTimelineEventSchema
>;
export type ReleaseLifecycleTimelineResponse = z.output<
  typeof releaseLifecycleTimelineResponseSchema
>;
export type ReleaseMarketLifecycleDomainErrorCode = z.output<
  typeof releaseMarketLifecycleDomainErrorCodeSchema
>;
export type ReleaseMarketLifecycleDomainError = z.output<
  typeof releaseMarketLifecycleDomainErrorSchema
>;
export type ProductParams = z.output<typeof productParamsSchema>;
export type ReleaseParams = z.output<typeof releaseParamsSchema>;
export type ProductListQuery = z.output<typeof productListQuerySchema>;
export type ReleaseListQuery = z.output<typeof releaseListQuerySchema>;
export type CreateProductInput = z.output<typeof createProductInputSchema>;
export type UpdateProductInput = z.output<typeof updateProductInputSchema>;
export type ArchiveProductInput = z.output<typeof archiveProductInputSchema>;
export type MoveProductLegalEntityInput = z.output<
  typeof moveProductLegalEntityInputSchema
>;
export type CreateReleaseInput = z.output<typeof createReleaseInputSchema>;
export type UpdateReleaseInput = z.output<typeof updateReleaseInputSchema>;
export type ArchiveReleaseInput = z.output<typeof archiveReleaseInputSchema>;
export type Product = z.output<typeof productSchema>;
export type Release = z.output<typeof releaseSchema>;
export type ProductResponse = z.output<typeof productResponseSchema>;
export type ProductsResponse = z.output<typeof productsResponseSchema>;
export type ReleaseResponse = z.output<typeof releaseResponseSchema>;
export type ReleasesResponse = z.output<typeof releasesResponseSchema>;
