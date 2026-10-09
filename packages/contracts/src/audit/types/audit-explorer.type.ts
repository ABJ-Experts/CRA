import type { z } from "zod";
import type {
  auditSearchFiltersSchema,
  auditSearchInputSchema,
  auditSnapshotSchema,
  auditSnapshotParamsSchema,
  auditDetailParamsSchema,
  auditOperationQuerySchema,
  auditPageQuerySchema,
  auditEventViewSchema,
  auditPageSchema,
  auditDetailSchema,
  auditVerificationInputSchema,
  auditVerificationResultSchema,
  auditExportInputSchema,
  auditExportParamsSchema,
  auditExportJobSchema,
  auditDownloadGrantInputSchema,
  auditDownloadGrantSchema,
  auditEventProofSchema,
  auditExportManifestSchema,
  auditExportFormatSchema,
} from "../schemas/audit-explorer.schema.js";
export type AuditSearchFilters = z.output<typeof auditSearchFiltersSchema>;
export type AuditSearchInput = z.output<typeof auditSearchInputSchema>;
export type AuditSnapshot = z.output<typeof auditSnapshotSchema>;
export type AuditSnapshotParams = z.output<typeof auditSnapshotParamsSchema>;
export type AuditDetailParams = z.output<typeof auditDetailParamsSchema>;
export type AuditOperationQuery = z.output<typeof auditOperationQuerySchema>;
export type AuditPageQuery = z.output<typeof auditPageQuerySchema>;
export type AuditEventView = z.output<typeof auditEventViewSchema>;
export type AuditPage = z.output<typeof auditPageSchema>;
export type AuditDetail = z.output<typeof auditDetailSchema>;
export type AuditVerificationInput = z.output<
  typeof auditVerificationInputSchema
>;
export type AuditVerificationResult = z.output<
  typeof auditVerificationResultSchema
>;
export type AuditExportInput = z.output<typeof auditExportInputSchema>;
export type AuditExportParams = z.output<typeof auditExportParamsSchema>;
export type AuditExportJob = z.output<typeof auditExportJobSchema>;
export type AuditExportFormat = z.output<typeof auditExportFormatSchema>;
export type AuditDownloadGrantInput = z.output<
  typeof auditDownloadGrantInputSchema
>;
export type AuditDownloadGrant = z.output<typeof auditDownloadGrantSchema>;
export type AuditEventProof = z.output<typeof auditEventProofSchema>;
export type AuditExportManifest = z.output<typeof auditExportManifestSchema>;
