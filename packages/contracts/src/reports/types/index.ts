import type { z } from "zod";
import type * as schemas from "../schemas/index.js";
export type ReportConfiguration = z.output<
  typeof schemas.reportConfigurationSchema
>;
export type ReportSelection = z.output<typeof schemas.reportSelectionSchema>;
export type ReportSchedule = z.output<typeof schemas.reportScheduleSchema>;
export type ReportDefinition = z.output<typeof schemas.reportDefinitionSchema>;
export type ReportRun = z.output<typeof schemas.reportRunSchema>;
export type ReportRunRecipient = z.output<
  typeof schemas.reportRunRecipientSchema
>;
export type ReportManifest = z.output<typeof schemas.reportManifestSchema>;
export type CreateReportDefinition = z.output<
  typeof schemas.createReportDefinitionSchema
>;
export type UpdateReportDefinition = z.output<
  typeof schemas.updateReportDefinitionSchema
>;
export type ReportMutation = z.output<typeof schemas.reportMutationSchema>;
export type ReportListQuery = z.output<typeof schemas.reportListQuerySchema>;
export type ReportRunsQuery = z.output<typeof schemas.reportRunsQuerySchema>;
export type ReportGrantInput = z.output<typeof schemas.reportGrantInputSchema>;
export type ReportEmailPreferenceInput = z.output<
  typeof schemas.reportEmailPreferenceInputSchema
>;
export type ReportEmailPreference = z.output<
  typeof schemas.reportEmailPreferenceSchema
>;
export type ReportDefinitionResponse = z.output<
  typeof schemas.reportDefinitionResponseSchema
>;
export type ReportDefinitionListResponse = z.output<
  typeof schemas.reportDefinitionListResponseSchema
>;
export type ReportRunDetailResponse = z.output<
  typeof schemas.reportRunDetailResponseSchema
>;
export type ReportRunListResponse = z.output<
  typeof schemas.reportRunListResponseSchema
>;
export type ReportRecipientsResponse = z.output<
  typeof schemas.reportRecipientsResponseSchema
>;
export type ReportManifestResponse = z.output<
  typeof schemas.reportManifestResponseSchema
>;
export type ReportDownloadGrantResponse = z.output<
  typeof schemas.reportDownloadGrantResponseSchema
>;
export type ReportAdministrationSummary = z.output<
  typeof schemas.reportAdministrationSummarySchema
>;
export type ReportAdministrationListResponse = z.output<
  typeof schemas.reportAdministrationListResponseSchema
>;
export type ReportAdministrationMutationResponse = z.output<
  typeof schemas.reportAdministrationMutationResponseSchema
>;

export type ReportRecipientEligibility = z.output<
  typeof schemas.reportRecipientEligibilitySchema
>;
