import type { z } from "zod";

import type {
  appendSoftwareBaselineRevisionInputSchema,
  archiveSoftwareBaselineInputSchema,
  assignSoftwareBaselineMembershipInputSchema,
  createProductComponentLinkInputSchema,
  createProductVariantRelationshipInputSchema,
  createSoftwareBaselineInputSchema,
  endProductComponentLinkInputSchema,
  endProductVariantRelationshipInputSchema,
  endSoftwareBaselineMembershipInputSchema,
  previewProductComponentLinkInputSchema,
  requestRelationshipReevaluationInputSchema,
  productComponentLinkSchema,
  productComponentLinkParamsSchema,
  productRelationshipGraphQuerySchema,
  productRelationshipGraphNodeSchema,
  productRelationshipGraphSchema,
  productRelationshipPreviewSchema,
  productRelationshipParamsSchema,
  productRelationshipTypeSchema,
  productVariantRelationshipSchema,
  productVariantSourceTypeSchema,
  relationshipPropagationCandidateSchema,
  relationshipPropagationEventSchema,
  relationshipPropagationEventsResponseSchema,
  relationshipPropagationEventsQuerySchema,
  relationshipPropagationCandidatesResponseSchema,
  relationshipPropagationQuerySchema,
  requestRelationshipReevaluationResponseSchema,
  softwareBaselineReleaseMembershipSchema,
  softwareBaselineMembershipParamsSchema,
  softwareBaselineMembershipResponseSchema,
  softwareBaselineMembershipsResponseSchema,
  softwareBaselineRevisionSchema,
  softwareBaselineRevisionResponseSchema,
  softwareBaselineRevisionsResponseSchema,
  softwareBaselineSchema,
  softwareBaselineParamsSchema,
  softwareBaselineResponseSchema,
  softwareBaselinesResponseSchema,
  supersedeProductComponentLinkInputSchema,
  updateProductComponentLinkInputSchema,
  productComponentLinkResponseSchema,
  productComponentLinksResponseSchema,
  productRelationshipGraphResponseSchema,
  productRelationshipPreviewResponseSchema,
  productVariantRelationshipParamsSchema,
  productVariantRelationshipResponseSchema,
  productVariantRelationshipsResponseSchema,
} from "../schemas/index.js";

export type ProductRelationshipType = z.output<
  typeof productRelationshipTypeSchema
>;
export type ProductVariantSourceType = z.output<
  typeof productVariantSourceTypeSchema
>;
export type SoftwareBaseline = z.output<typeof softwareBaselineSchema>;
export type SoftwareBaselineRevision = z.output<
  typeof softwareBaselineRevisionSchema
>;
export type SoftwareBaselineReleaseMembership = z.output<
  typeof softwareBaselineReleaseMembershipSchema
>;
export type ProductVariantRelationship = z.output<
  typeof productVariantRelationshipSchema
>;
export type ProductComponentLink = z.output<typeof productComponentLinkSchema>;
export type ProductRelationshipGraphNode = z.output<
  typeof productRelationshipGraphNodeSchema
>;
export type ProductRelationshipGraph = z.output<
  typeof productRelationshipGraphSchema
>;
export type ProductRelationshipGraphQuery = z.output<
  typeof productRelationshipGraphQuerySchema
>;
export type ProductRelationshipPreview = z.output<
  typeof productRelationshipPreviewSchema
>;
export type RelationshipPropagationCandidate = z.output<
  typeof relationshipPropagationCandidateSchema
>;
export type RelationshipPropagationEvent = z.output<
  typeof relationshipPropagationEventSchema
>;
export type RelationshipPropagationQuery = z.output<
  typeof relationshipPropagationQuerySchema
>;
export type RelationshipPropagationEventsQuery = z.output<
  typeof relationshipPropagationEventsQuerySchema
>;
export type CreateSoftwareBaselineInput = z.output<
  typeof createSoftwareBaselineInputSchema
>;
export type AppendSoftwareBaselineRevisionInput = z.output<
  typeof appendSoftwareBaselineRevisionInputSchema
>;
export type ArchiveSoftwareBaselineInput = z.output<
  typeof archiveSoftwareBaselineInputSchema
>;
export type AssignSoftwareBaselineMembershipInput = z.output<
  typeof assignSoftwareBaselineMembershipInputSchema
>;
export type EndSoftwareBaselineMembershipInput = z.output<
  typeof endSoftwareBaselineMembershipInputSchema
>;
export type CreateProductVariantRelationshipInput = z.output<
  typeof createProductVariantRelationshipInputSchema
>;
export type EndProductVariantRelationshipInput = z.output<
  typeof endProductVariantRelationshipInputSchema
>;
export type PreviewProductComponentLinkInput = z.output<
  typeof previewProductComponentLinkInputSchema
>;
export type CreateProductComponentLinkInput = z.output<
  typeof createProductComponentLinkInputSchema
>;
export type EndProductComponentLinkInput = z.output<
  typeof endProductComponentLinkInputSchema
>;
export type SupersedeProductComponentLinkInput = z.output<
  typeof supersedeProductComponentLinkInputSchema
>;
export type UpdateProductComponentLinkInput = z.output<
  typeof updateProductComponentLinkInputSchema
>;
export type RequestRelationshipReevaluationInput = z.output<
  typeof requestRelationshipReevaluationInputSchema
>;
export type SoftwareBaselineParams = z.output<
  typeof softwareBaselineParamsSchema
>;
export type SoftwareBaselineMembershipParams = z.output<
  typeof softwareBaselineMembershipParamsSchema
>;
export type ProductRelationshipParams = z.output<
  typeof productRelationshipParamsSchema
>;
export type ProductVariantRelationshipParams = z.output<
  typeof productVariantRelationshipParamsSchema
>;
export type ProductComponentLinkParams = z.output<
  typeof productComponentLinkParamsSchema
>;
export type SoftwareBaselineResponse = z.output<
  typeof softwareBaselineResponseSchema
>;
export type SoftwareBaselinesResponse = z.output<
  typeof softwareBaselinesResponseSchema
>;
export type SoftwareBaselineRevisionResponse = z.output<
  typeof softwareBaselineRevisionResponseSchema
>;
export type SoftwareBaselineRevisionsResponse = z.output<
  typeof softwareBaselineRevisionsResponseSchema
>;
export type SoftwareBaselineMembershipResponse = z.output<
  typeof softwareBaselineMembershipResponseSchema
>;
export type SoftwareBaselineMembershipsResponse = z.output<
  typeof softwareBaselineMembershipsResponseSchema
>;
export type ProductVariantRelationshipResponse = z.output<
  typeof productVariantRelationshipResponseSchema
>;
export type ProductVariantRelationshipsResponse = z.output<
  typeof productVariantRelationshipsResponseSchema
>;
export type ProductComponentLinkResponse = z.output<
  typeof productComponentLinkResponseSchema
>;
export type ProductComponentLinksResponse = z.output<
  typeof productComponentLinksResponseSchema
>;
export type ProductRelationshipGraphResponse = z.output<
  typeof productRelationshipGraphResponseSchema
>;
export type ProductRelationshipPreviewResponse = z.output<
  typeof productRelationshipPreviewResponseSchema
>;
export type RelationshipPropagationCandidatesResponse = z.output<
  typeof relationshipPropagationCandidatesResponseSchema
>;
export type RelationshipPropagationEventsResponse = z.output<
  typeof relationshipPropagationEventsResponseSchema
>;
export type RequestRelationshipReevaluationResponse = z.output<
  typeof requestRelationshipReevaluationResponseSchema
>;
