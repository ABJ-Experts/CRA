import type {
  cancelEvidenceBulkIntakeItemInputSchema,
  completeEvidenceBulkIntakeItemInputSchema,
  createEvidenceBulkIntakeBatchInputSchema,
  evidenceBulkIntakeBatchCountsSchema,
  evidenceBulkIntakeBatchParamsSchema,
  evidenceBulkIntakeBatchResponseSchema,
  evidenceBulkIntakeBatchSchema,
  evidenceBulkIntakeBatchStatusSchema,
  evidenceBulkIntakeClassificationDecisionSchema,
  evidenceBulkIntakeClassificationSourceSchema,
  evidenceBulkIntakeFailureCodeSchema,
  evidenceBulkIntakeItemClassificationSchema,
  evidenceBulkIntakeItemInitializationResponseSchema,
  evidenceBulkIntakeItemParamsSchema,
  evidenceBulkIntakeItemResponseSchema,
  evidenceBulkIntakeItemSchema,
  evidenceBulkIntakeItemStatusSchema,
  initializeEvidenceBulkIntakeItemInputSchema,
  retryEvidenceBulkIntakeItemInputSchema,
} from "../schemas/index.js";
import type { z } from "zod";

export type CreateEvidenceBulkIntakeBatchInput = z.output<
  typeof createEvidenceBulkIntakeBatchInputSchema
>;
export type EvidenceBulkIntakeBatchStatus = z.output<
  typeof evidenceBulkIntakeBatchStatusSchema
>;
export type EvidenceBulkIntakeItemStatus = z.output<
  typeof evidenceBulkIntakeItemStatusSchema
>;
export type EvidenceBulkIntakeClassificationSource = z.output<
  typeof evidenceBulkIntakeClassificationSourceSchema
>;
export type EvidenceBulkIntakeClassificationDecision = z.output<
  typeof evidenceBulkIntakeClassificationDecisionSchema
>;
export type EvidenceBulkIntakeFailureCode = z.output<
  typeof evidenceBulkIntakeFailureCodeSchema
>;
export type EvidenceBulkIntakeItemClassification = z.output<
  typeof evidenceBulkIntakeItemClassificationSchema
>;
export type EvidenceBulkIntakeItem = z.output<typeof evidenceBulkIntakeItemSchema>;
export type EvidenceBulkIntakeBatchCounts = z.output<
  typeof evidenceBulkIntakeBatchCountsSchema
>;
export type EvidenceBulkIntakeBatch = z.output<typeof evidenceBulkIntakeBatchSchema>;
export type EvidenceBulkIntakeBatchResponse = z.output<
  typeof evidenceBulkIntakeBatchResponseSchema
>;
export type EvidenceBulkIntakeBatchParams = z.output<
  typeof evidenceBulkIntakeBatchParamsSchema
>;
export type EvidenceBulkIntakeItemParams = z.output<
  typeof evidenceBulkIntakeItemParamsSchema
>;
export type InitializeEvidenceBulkIntakeItemInput = z.output<
  typeof initializeEvidenceBulkIntakeItemInputSchema
>;
export type CompleteEvidenceBulkIntakeItemInput = z.output<
  typeof completeEvidenceBulkIntakeItemInputSchema
>;
export type CancelEvidenceBulkIntakeItemInput = z.output<
  typeof cancelEvidenceBulkIntakeItemInputSchema
>;
export type RetryEvidenceBulkIntakeItemInput = z.output<
  typeof retryEvidenceBulkIntakeItemInputSchema
>;
export type EvidenceBulkIntakeItemResponse = z.output<
  typeof evidenceBulkIntakeItemResponseSchema
>;
export type EvidenceBulkIntakeItemInitializationResponse = z.output<
  typeof evidenceBulkIntakeItemInitializationResponseSchema
>;
