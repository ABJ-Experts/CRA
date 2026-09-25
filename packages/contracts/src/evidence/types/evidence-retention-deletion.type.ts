import type {
  createEvidenceDeletionIntentInputSchema,
  evidenceDeletionIntentResponseSchema,
  evidenceDeletionIntentSchema,
  evidenceDeletionIntentStatusSchema,
  evidenceDeletionLifecycleSchema,
  evidenceIdentityHandlingSchema,
  evidenceLegalHoldListParamsSchema,
  evidenceLegalHoldListResponseSchema,
  evidenceLegalHoldParamsSchema,
  evidenceLegalHoldSchema,
  evidenceLegalHoldStatusSchema,
  evidenceRetentionBlockerSchema,
  evidenceRetentionProtectionSchema,
  evidenceRetentionReviewParamsSchema,
  evidenceRetentionReviewResponseSchema,
  evidenceRetentionReviewSchema,
  placeEvidenceLegalHoldInputSchema,
  placeEvidenceLegalHoldResponseSchema,
  releaseEvidenceLegalHoldInputSchema,
  releaseEvidenceLegalHoldResponseSchema,
} from "../schemas/index.js";
import type { z } from "zod";

export type EvidenceDeletionLifecycle = z.output<
  typeof evidenceDeletionLifecycleSchema
>;
export type EvidenceDeletionIntentStatus = z.output<
  typeof evidenceDeletionIntentStatusSchema
>;
export type EvidenceIdentityHandling = z.output<
  typeof evidenceIdentityHandlingSchema
>;
export type EvidenceRetentionProtection = z.output<
  typeof evidenceRetentionProtectionSchema
>;
export type EvidenceRetentionBlocker = z.output<
  typeof evidenceRetentionBlockerSchema
>;
export type EvidenceRetentionReview = z.output<
  typeof evidenceRetentionReviewSchema
>;
export type EvidenceRetentionReviewParams = z.output<
  typeof evidenceRetentionReviewParamsSchema
>;
export type EvidenceRetentionReviewResponse = z.output<
  typeof evidenceRetentionReviewResponseSchema
>;
export type CreateEvidenceDeletionIntentInput = z.output<
  typeof createEvidenceDeletionIntentInputSchema
>;
export type EvidenceDeletionIntent = z.output<
  typeof evidenceDeletionIntentSchema
>;
export type EvidenceDeletionIntentResponse = z.output<
  typeof evidenceDeletionIntentResponseSchema
>;
export type EvidenceLegalHoldStatus = z.output<
  typeof evidenceLegalHoldStatusSchema
>;
export type EvidenceLegalHold = z.output<typeof evidenceLegalHoldSchema>;
export type EvidenceLegalHoldParams = z.output<
  typeof evidenceLegalHoldParamsSchema
>;
export type EvidenceLegalHoldListParams = z.output<
  typeof evidenceLegalHoldListParamsSchema
>;
export type EvidenceLegalHoldListResponse = z.output<
  typeof evidenceLegalHoldListResponseSchema
>;
export type PlaceEvidenceLegalHoldInput = z.output<
  typeof placeEvidenceLegalHoldInputSchema
>;
export type PlaceEvidenceLegalHoldResponse = z.output<
  typeof placeEvidenceLegalHoldResponseSchema
>;
export type ReleaseEvidenceLegalHoldInput = z.output<
  typeof releaseEvidenceLegalHoldInputSchema
>;
export type ReleaseEvidenceLegalHoldResponse = z.output<
  typeof releaseEvidenceLegalHoldResponseSchema
>;
