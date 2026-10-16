import type { z } from "zod";
import type {
  auditRangeCreateInputSchema,
  auditRangeOperationInputSchema,
  auditRangeCheckpointSchema,
  auditRangeBreakSchema,
  auditRangeResultSchema,
  auditRangeJobSchema,
  auditRangeStatusSchema,
  auditRangeOutcomeSchema,
  auditRangeBoundarySchema,
  auditRangeBreakCategorySchema,
  auditRangeFailureCodeSchema,
  auditRangeParamsSchema,
  auditRangeStatusQuerySchema,
} from "../schemas/audit-range-verification.schema.js";
export type AuditRangeCreateInput = z.output<
  typeof auditRangeCreateInputSchema
>;
export type AuditRangeOperationInput = z.output<
  typeof auditRangeOperationInputSchema
>;
export type AuditRangeCheckpoint = z.output<typeof auditRangeCheckpointSchema>;
export type AuditRangeBreak = z.output<typeof auditRangeBreakSchema>;
export type AuditRangeResult = z.output<typeof auditRangeResultSchema>;
export type AuditRangeJob = z.output<typeof auditRangeJobSchema>;
export type AuditRangeStatus = z.output<typeof auditRangeStatusSchema>;
export type AuditRangeOutcome = z.output<typeof auditRangeOutcomeSchema>;
export type AuditRangeBoundary = z.output<typeof auditRangeBoundarySchema>;
export type AuditRangeBreakCategory = z.output<
  typeof auditRangeBreakCategorySchema
>;
export type AuditRangeFailureCode = z.output<
  typeof auditRangeFailureCodeSchema
>;

export type AuditRangeParams = z.output<typeof auditRangeParamsSchema>;
export type AuditRangeStatusQuery = z.output<
  typeof auditRangeStatusQuerySchema
>;
