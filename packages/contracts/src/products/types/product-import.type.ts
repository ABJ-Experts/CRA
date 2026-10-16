import type { z } from "zod";

import type {
  productImportCancelInputSchema,
  productImportCommitInputSchema,
  productImportCountsSchema,
  productImportFieldIssueSchema,
  productImportFieldSchema,
  productImportIssueCodeSchema,
  productImportIssueSeveritySchema,
  productImportListQuerySchema,
  productImportParamsSchema,
  productImportReportLinkResponseSchema,
  productImportResponseSchema,
  productImportRowsQuerySchema,
  productImportRowsResponseSchema,
  productImportRowOperationSchema,
  productImportRowSchema,
  productImportRowResultSchema,
  productImportRowTypeSchema,
  productImportSchema,
  productImportSchemaVersionSchema,
  productImportStatusSchema,
  productImportProposedActionSchema,
  productImportsResponseSchema,
  productImportTemplateResponseSchema,
  productImportUploadFieldsSchema,
} from "../schemas/index.js";

export type ProductImportSchemaVersion = z.output<
  typeof productImportSchemaVersionSchema
>;
export type ProductImportStatus = z.output<typeof productImportStatusSchema>;
export type ProductImportRowType = z.output<typeof productImportRowTypeSchema>;
export type ProductImportRowOperation = z.output<
  typeof productImportRowOperationSchema
>;
export type ProductImportProposedAction = z.output<
  typeof productImportProposedActionSchema
>;
export type ProductImportRowResult = z.output<
  typeof productImportRowResultSchema
>;
export type ProductImportIssueSeverity = z.output<
  typeof productImportIssueSeveritySchema
>;
export type ProductImportIssueCode = z.output<
  typeof productImportIssueCodeSchema
>;
export type ProductImportField = z.output<typeof productImportFieldSchema>;
export type ProductImportFieldIssue = z.output<
  typeof productImportFieldIssueSchema
>;
export type ProductImportCounts = z.output<typeof productImportCountsSchema>;
export type ProductImport = z.output<typeof productImportSchema>;
export type ProductImportRow = z.output<typeof productImportRowSchema>;
export type ProductImportResponse = z.output<
  typeof productImportResponseSchema
>;
export type ProductImportsResponse = z.output<
  typeof productImportsResponseSchema
>;
export type ProductImportRowsResponse = z.output<
  typeof productImportRowsResponseSchema
>;
export type ProductImportUploadFields = z.output<
  typeof productImportUploadFieldsSchema
>;
export type ProductImportCommitInput = z.output<
  typeof productImportCommitInputSchema
>;
export type ProductImportCancelInput = z.output<
  typeof productImportCancelInputSchema
>;
export type ProductImportParams = z.output<typeof productImportParamsSchema>;
export type ProductImportListQuery = z.output<
  typeof productImportListQuerySchema
>;
export type ProductImportRowsQuery = z.output<
  typeof productImportRowsQuerySchema
>;
export type ProductImportTemplateResponse = z.output<
  typeof productImportTemplateResponseSchema
>;
export type ProductImportReportLinkResponse = z.output<
  typeof productImportReportLinkResponseSchema
>;
