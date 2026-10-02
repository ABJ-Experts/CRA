import type { z } from "zod";

import type {
  conflictParamsSchema,
  resolveSyncConflictInputSchema,
  syncConflictChosenActionSchema,
  syncConflictEntityTypeSchema,
  syncConflictKindSchema,
  syncConflictParamsSchema,
  syncConflictResolutionStatusSchema,
  syncConflictSchema,
  syncConflictValueSourceSchema,
} from "../schemas/index.js";

export type SyncConflictEntityType = z.output<
  typeof syncConflictEntityTypeSchema
>;
export type SyncConflictKind = z.output<typeof syncConflictKindSchema>;
export type SyncConflictValueSource = z.output<
  typeof syncConflictValueSourceSchema
>;
export type SyncConflictResolutionStatus = z.output<
  typeof syncConflictResolutionStatusSchema
>;
export type SyncConflictChosenAction = z.output<
  typeof syncConflictChosenActionSchema
>;
export type SyncConflictParams = z.output<typeof syncConflictParamsSchema>;
export type ConflictParams = z.output<typeof conflictParamsSchema>;
export type SyncConflict = z.output<typeof syncConflictSchema>;
export type ResolveSyncConflictInput = z.output<
  typeof resolveSyncConflictInputSchema
>;
