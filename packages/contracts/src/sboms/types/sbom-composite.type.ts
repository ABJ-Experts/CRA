import type { z } from "zod";

import type {
  createSbomCompositeReviewInputSchema,
  generateSbomCompositeInputSchema,
  resolveSbomCompositeConflictInputSchema,
  resolveSbomCompositeRelationshipInputSchema,
  sbomCompositeConflictParamsSchema,
  sbomCompositeConflictSchema,
  sbomCompositeDependencyProvenanceSchema,
  sbomCompositeGenerationResponseSchema,
  sbomCompositeProvenanceManifestSchema,
  sbomCompositeRelationshipParamsSchema,
  sbomCompositeRelationshipSchema,
  sbomCompositeReleaseParamsSchema,
  sbomCompositeReviewParamsSchema,
  sbomCompositeReviewResponseSchema,
  sbomCompositeReviewSchema,
  sbomCompositeReviewsQuerySchema,
  sbomCompositeReviewsResponseSchema,
} from "../schemas/index.js";

export type CreateSbomCompositeReviewInput = z.output<
  typeof createSbomCompositeReviewInputSchema
>;
export type SbomCompositeReleaseParams = z.output<
  typeof sbomCompositeReleaseParamsSchema
>;
export type SbomCompositeReviewParams = z.output<
  typeof sbomCompositeReviewParamsSchema
>;
export type SbomCompositeConflictParams = z.output<
  typeof sbomCompositeConflictParamsSchema
>;
export type SbomCompositeRelationshipParams = z.output<
  typeof sbomCompositeRelationshipParamsSchema
>;
export type ResolveSbomCompositeConflictInput = z.output<
  typeof resolveSbomCompositeConflictInputSchema
>;
export type ResolveSbomCompositeRelationshipInput = z.output<
  typeof resolveSbomCompositeRelationshipInputSchema
>;
export type GenerateSbomCompositeInput = z.output<
  typeof generateSbomCompositeInputSchema
>;
export type SbomCompositeConflict = z.output<
  typeof sbomCompositeConflictSchema
>;
export type SbomCompositeRelationship = z.output<
  typeof sbomCompositeRelationshipSchema
>;
export type SbomCompositeProvenanceManifest = z.output<
  typeof sbomCompositeProvenanceManifestSchema
>;
export type SbomCompositeDependencyProvenance = z.output<
  typeof sbomCompositeDependencyProvenanceSchema
>;
export type SbomCompositeReview = z.output<typeof sbomCompositeReviewSchema>;
export type SbomCompositeReviewResponse = z.output<
  typeof sbomCompositeReviewResponseSchema
>;
export type SbomCompositeGenerationResponse = z.output<
  typeof sbomCompositeGenerationResponseSchema
>;
export type SbomCompositeReviewsQuery = z.output<
  typeof sbomCompositeReviewsQuerySchema
>;
export type SbomCompositeReviewsResponse = z.output<
  typeof sbomCompositeReviewsResponseSchema
>;
