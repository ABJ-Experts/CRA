import type { z } from "zod";

import type {
  createSubstantialModificationAssessmentInputSchema,
  createSubstantialModificationAssessmentDraftInputSchema,
  finalizeSecurityUpdateArtifactInputSchema,
  publishSecurityUpdateArtifactInputSchema,
  reassessSubstantialModificationAssessmentInputSchema,
  replaceSecurityUpdateArtifactInputSchema,
  reserveSecurityUpdateArtifactInputSchema,
  reviewSecurityUpdateArtifactInputSchema,
  reviewSubstantialModificationAssessmentInputSchema,
  securityUpdateArtifactDownloadResponseSchema,
  securityUpdateArtifactListQuerySchema,
  securityUpdateArtifactListResponseSchema,
  securityUpdateArtifactParamsSchema,
  securityUpdateArtifactReserveResponseSchema,
  securityUpdateArtifactResponseSchema,
  securityUpdateArtifactSchema,
  substantialModificationAnswersSchema,
  substantialModificationAssessmentListQuerySchema,
  substantialModificationAssessmentListResponseSchema,
  substantialModificationAssessmentParamsSchema,
  substantialModificationAssessmentResponseSchema,
  substantialModificationAssessmentSchema,
  updateSecurityUpdateArtifactMetadataInputSchema,
  withdrawSecurityUpdateArtifactInputSchema,
} from "../schemas/index.js";

export type SubstantialModificationAnswers = z.output<
  typeof substantialModificationAnswersSchema
>;
export type SubstantialModificationAssessment = z.output<
  typeof substantialModificationAssessmentSchema
>;
export type SubstantialModificationAssessmentParams = z.output<
  typeof substantialModificationAssessmentParamsSchema
>;
export type SubstantialModificationAssessmentListQuery = z.output<
  typeof substantialModificationAssessmentListQuerySchema
>;
export type SubstantialModificationAssessmentResponse = z.output<
  typeof substantialModificationAssessmentResponseSchema
>;
export type SubstantialModificationAssessmentListResponse = z.output<
  typeof substantialModificationAssessmentListResponseSchema
>;
export type CreateSubstantialModificationAssessmentInput = z.output<
  typeof createSubstantialModificationAssessmentInputSchema
>;
export type CreateSubstantialModificationAssessmentDraftInput = z.output<
  typeof createSubstantialModificationAssessmentDraftInputSchema
>;
export type ReassessSubstantialModificationAssessmentInput = z.output<
  typeof reassessSubstantialModificationAssessmentInputSchema
>;
export type ReviewSubstantialModificationAssessmentInput = z.output<
  typeof reviewSubstantialModificationAssessmentInputSchema
>;
export type SecurityUpdateArtifact = z.output<
  typeof securityUpdateArtifactSchema
>;
export type SecurityUpdateArtifactParams = z.output<
  typeof securityUpdateArtifactParamsSchema
>;
export type SecurityUpdateArtifactListQuery = z.output<
  typeof securityUpdateArtifactListQuerySchema
>;
export type SecurityUpdateArtifactResponse = z.output<
  typeof securityUpdateArtifactResponseSchema
>;
export type SecurityUpdateArtifactListResponse = z.output<
  typeof securityUpdateArtifactListResponseSchema
>;
export type ReserveSecurityUpdateArtifactInput = z.output<
  typeof reserveSecurityUpdateArtifactInputSchema
>;
export type FinalizeSecurityUpdateArtifactInput = z.output<
  typeof finalizeSecurityUpdateArtifactInputSchema
>;
export type ReviewSecurityUpdateArtifactInput = z.output<
  typeof reviewSecurityUpdateArtifactInputSchema
>;
export type PublishSecurityUpdateArtifactInput = z.output<
  typeof publishSecurityUpdateArtifactInputSchema
>;
export type ReplaceSecurityUpdateArtifactInput = z.output<
  typeof replaceSecurityUpdateArtifactInputSchema
>;
export type WithdrawSecurityUpdateArtifactInput = z.output<
  typeof withdrawSecurityUpdateArtifactInputSchema
>;
export type UpdateSecurityUpdateArtifactMetadataInput = z.output<
  typeof updateSecurityUpdateArtifactMetadataInputSchema
>;
export type SecurityUpdateArtifactReserveResponse = z.output<
  typeof securityUpdateArtifactReserveResponseSchema
>;
export type SecurityUpdateArtifactDownloadResponse = z.output<
  typeof securityUpdateArtifactDownloadResponseSchema
>;
