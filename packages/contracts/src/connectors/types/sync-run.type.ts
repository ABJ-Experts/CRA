import type { z } from "zod";

import type {
  beginSyncRunInputSchema,
  cancelSyncRunInputSchema,
  requestSyncRunCommitInputSchema,
  retrySyncRunInputSchema,
  syncEntityTypeSchema,
  syncPermittedFieldActionSchema,
  syncProposedActionSchema,
  syncReconciliationKindSchema,
  syncRunCountsSchema,
  syncRunListQuerySchema,
  syncRunParamsSchema,
  syncRunPlanItemSchema,
  syncRunSchema,
  syncRunStatusSchema,
  syncWorkKindSchema,
} from "../schemas/index.js";

export type SyncReconciliationKind = z.output<
  typeof syncReconciliationKindSchema
>;
export type SyncWorkKind = z.output<typeof syncWorkKindSchema>;
export type SyncRunStatus = z.output<typeof syncRunStatusSchema>;
export type SyncEntityType = z.output<typeof syncEntityTypeSchema>;
export type SyncProposedAction = z.output<typeof syncProposedActionSchema>;
export type SyncPermittedFieldAction = z.output<
  typeof syncPermittedFieldActionSchema
>;
export type SyncRunParams = z.output<typeof syncRunParamsSchema>;
export type SyncRunCounts = z.output<typeof syncRunCountsSchema>;
export type SyncRun = z.output<typeof syncRunSchema>;
export type SyncRunPlanItem = z.output<typeof syncRunPlanItemSchema>;
export type BeginSyncRunInput = z.output<typeof beginSyncRunInputSchema>;
export type RequestSyncRunCommitInput = z.output<
  typeof requestSyncRunCommitInputSchema
>;
export type CancelSyncRunInput = z.output<typeof cancelSyncRunInputSchema>;
export type RetrySyncRunInput = z.output<typeof retrySyncRunInputSchema>;
export type SyncRunListQuery = z.output<typeof syncRunListQuerySchema>;
