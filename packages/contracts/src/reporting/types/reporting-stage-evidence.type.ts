import type { z } from "zod";

import type {
  createReportingStageAcknowledgementInputSchema,
  generateReportingObligationEvidencePackInputSchema,
  generateReportingStageSubmissionPackageInputSchema,
  reauthenticateReportingStageFilingInputSchema,
  reauthenticateReportingStageFilingResponseSchema,
  recordReportingStageExternalFilingFieldsSchema,
  recordReportingStageRehearsalFilingFieldsSchema,
  reportingEvidencePublicVerificationKeySchema,
  reportingEvidencePublicVerificationKeysResponseSchema,
  reportingObligationEvidencePackDownloadResponseSchema,
  reportingObligationEvidencePackParamsSchema,
  reportingObligationEvidencePackResponseSchema,
  reportingStageAcknowledgementResponseSchema,
  reportingStageEvidencePackageDownloadResponseSchema,
  reportingStageEvidencePackageParamsSchema,
  reportingStageEvidencePackageResponseSchema,
  reportingStageEvidencePackageSchema,
  reportingStageEvidenceTimelineResponseSchema,
  reportingStageExternalFilingResponseSchema,
  reportingStageRehearsalFilingResponseSchema,
} from "../schemas/reporting-stage-evidence.schema.js";

export type GenerateReportingStageSubmissionPackageInput = z.output<
  typeof generateReportingStageSubmissionPackageInputSchema
>;
export type ReportingStageEvidencePackage = z.output<
  typeof reportingStageEvidencePackageSchema
>;
export type ReportingStageEvidencePackageParams = z.output<
  typeof reportingStageEvidencePackageParamsSchema
>;
export type ReportingStageEvidencePackageResponse = z.output<
  typeof reportingStageEvidencePackageResponseSchema
>;
export type ReportingStageEvidencePackageDownloadResponse = z.output<
  typeof reportingStageEvidencePackageDownloadResponseSchema
>;
export type ReauthenticateReportingStageFilingInput = z.output<
  typeof reauthenticateReportingStageFilingInputSchema
>;
export type ReauthenticateReportingStageFilingResponse = z.output<
  typeof reauthenticateReportingStageFilingResponseSchema
>;
/** Unparsed non-file multipart values from the browser transport. */
export type RecordReportingStageExternalFilingFieldsInput = z.input<
  typeof recordReportingStageExternalFilingFieldsSchema
>;
/** Trusted non-file multipart values after controller parsing. */
export type RecordReportingStageExternalFilingFields = z.output<
  typeof recordReportingStageExternalFilingFieldsSchema
>;
export type RecordReportingStageRehearsalFilingFields = z.output<
  typeof recordReportingStageRehearsalFilingFieldsSchema
>;
export type ReportingStageExternalFilingResponse = z.output<
  typeof reportingStageExternalFilingResponseSchema
>;
export type ReportingStageRehearsalFilingResponse = z.output<
  typeof reportingStageRehearsalFilingResponseSchema
>;
export type CreateReportingStageAcknowledgementInput = z.output<
  typeof createReportingStageAcknowledgementInputSchema
>;
export type ReportingStageAcknowledgementResponse = z.output<
  typeof reportingStageAcknowledgementResponseSchema
>;
export type ReportingStageEvidenceTimelineResponse = z.output<
  typeof reportingStageEvidenceTimelineResponseSchema
>;
export type GenerateReportingObligationEvidencePackInput = z.output<
  typeof generateReportingObligationEvidencePackInputSchema
>;
export type ReportingObligationEvidencePackParams = z.output<
  typeof reportingObligationEvidencePackParamsSchema
>;
export type ReportingObligationEvidencePackResponse = z.output<
  typeof reportingObligationEvidencePackResponseSchema
>;
export type ReportingObligationEvidencePackDownloadResponse = z.output<
  typeof reportingObligationEvidencePackDownloadResponseSchema
>;
export type ReportingEvidencePublicVerificationKey = z.output<
  typeof reportingEvidencePublicVerificationKeySchema
>;
export type ReportingEvidencePublicVerificationKeysResponse = z.output<
  typeof reportingEvidencePublicVerificationKeysResponseSchema
>;
