import type { z } from "zod";

import type {
  cancelReportingObligationInputSchema,
  correctReportingObligationAnchorInputSchema,
  createReportingObligationInputSchema,
  createReportingRehearsalInputSchema,
  replayReportingRehearsalInputSchema,
  recordReportingObligationStageSubmissionInputSchema,
  reportingObligationAnchorKindSchema,
  reportingObligationDetailResponseSchema,
  reportingObligationSchema,
  reportingObligationListQuerySchema,
  reportingObligationListResponseSchema,
  reportingObligationMutationResponseSchema,
  reportingObligationParamsSchema,
  reportingObligationScopeSchema,
  reportingDeadlineSummaryResponseSchema,
  reportingDeadlineSummaryQuerySchema,
} from "../schemas/reporting-obligations.schema.js";

export type CreateReportingObligationInput = z.output<
  typeof createReportingObligationInputSchema
>;
export type CreateReportingRehearsalInput = z.output<
  typeof createReportingRehearsalInputSchema
>;
export type ReplayReportingRehearsalInput = z.output<
  typeof replayReportingRehearsalInputSchema
>;
export type CorrectReportingObligationAnchorInput = z.output<
  typeof correctReportingObligationAnchorInputSchema
>;
export type RecordReportingObligationStageSubmissionInput = z.output<
  typeof recordReportingObligationStageSubmissionInputSchema
>;
export type CancelReportingObligationInput = z.output<
  typeof cancelReportingObligationInputSchema
>;
export type ReportingObligationListQuery = z.output<
  typeof reportingObligationListQuerySchema
>;
export type ReportingObligationParams = z.output<
  typeof reportingObligationParamsSchema
>;
export type ReportingObligationAnchorKind = z.output<
  typeof reportingObligationAnchorKindSchema
>;
export type ReportingObligationScope = z.output<
  typeof reportingObligationScopeSchema
>;
export type ReportingObligation = z.output<typeof reportingObligationSchema>;
export type ReportingObligationListResponse = z.output<
  typeof reportingObligationListResponseSchema
>;
export type ReportingObligationDetailResponse = z.output<
  typeof reportingObligationDetailResponseSchema
>;
export type ReportingObligationMutationResponse = z.output<
  typeof reportingObligationMutationResponseSchema
>;
export type ReportingDeadlineSummaryQuery = z.output<
  typeof reportingDeadlineSummaryQuerySchema
>;
export type ReportingDeadlineSummaryResponse = z.output<
  typeof reportingDeadlineSummaryResponseSchema
>;
