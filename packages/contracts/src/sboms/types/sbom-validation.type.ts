import type { z } from "zod";

import type {
  sbomDetectedFormatSchema,
  sbomDetectedSerializationSchema,
  sbomSourceHistoryItemSchema,
  sbomSourceHistoryQuerySchema,
  sbomSourceHistoryResponseSchema,
  sbomValidationDiagnosticSchema,
  sbomValidationDiagnosticSeveritySchema,
  sbomValidationReportResponseSchema,
  sbomValidationReportSchema,
  sbomValidationStatusSchema,
  sbomValidationSummarySchema,
  sbomValidatorMetadataSchema,
} from "../schemas/index.js";

export type SbomValidationStatus = z.output<typeof sbomValidationStatusSchema>;
export type SbomDetectedFormat = z.output<typeof sbomDetectedFormatSchema>;
export type SbomDetectedSerialization = z.output<
  typeof sbomDetectedSerializationSchema
>;
export type SbomValidationDiagnosticSeverity = z.output<
  typeof sbomValidationDiagnosticSeveritySchema
>;
export type SbomValidationDiagnostic = z.output<
  typeof sbomValidationDiagnosticSchema
>;
export type SbomValidatorMetadata = z.output<
  typeof sbomValidatorMetadataSchema
>;
export type SbomValidationReport = z.output<typeof sbomValidationReportSchema>;
export type SbomValidationSummary = z.output<
  typeof sbomValidationSummarySchema
>;
export type SbomSourceHistoryQuery = z.output<
  typeof sbomSourceHistoryQuerySchema
>;
export type SbomSourceHistoryItem = z.output<
  typeof sbomSourceHistoryItemSchema
>;
export type SbomSourceHistoryResponse = z.output<
  typeof sbomSourceHistoryResponseSchema
>;
export type SbomValidationReportResponse = z.output<
  typeof sbomValidationReportResponseSchema
>;
