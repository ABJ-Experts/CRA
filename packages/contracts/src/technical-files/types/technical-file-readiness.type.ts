import type {
  recalculateTechnicalFileReadinessRequestSchema,
  reviewTechnicalFileSourceRequestSchema,
  signalTechnicalFileSourceMaterialChangeRequestSchema,
  technicalFileEvidenceLinkSchema,
  technicalFileEvidenceReviewResponseSchema,
  technicalFileEvidenceReverseLinksResponseSchema,
  technicalFileReadinessConflictResponseSchema,
  technicalFileReadinessResponseSchema,
  technicalFileReadinessSchema,
} from "../schemas/technical-file-readiness.schema.js";
import type { z } from "zod";

export type TechnicalFileReadiness = z.output<
  typeof technicalFileReadinessSchema
>;
export type TechnicalFileEvidenceLink = z.output<
  typeof technicalFileEvidenceLinkSchema
>;
export type TechnicalFileReadinessResponse = z.output<
  typeof technicalFileReadinessResponseSchema
>;
export type TechnicalFileEvidenceReviewResponse = z.output<
  typeof technicalFileEvidenceReviewResponseSchema
>;
export type TechnicalFileEvidenceReverseLinksResponse = z.output<
  typeof technicalFileEvidenceReverseLinksResponseSchema
>;
export type TechnicalFileReadinessConflictResponse = z.output<
  typeof technicalFileReadinessConflictResponseSchema
>;
export type ReviewTechnicalFileSourceRequest = z.output<
  typeof reviewTechnicalFileSourceRequestSchema
>;
export type SignalTechnicalFileSourceMaterialChangeRequest = z.output<
  typeof signalTechnicalFileSourceMaterialChangeRequestSchema
>;
export type RecalculateTechnicalFileReadinessRequest = z.output<
  typeof recalculateTechnicalFileReadinessRequestSchema
>;
