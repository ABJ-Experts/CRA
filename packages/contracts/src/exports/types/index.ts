import type { z } from "zod";
import type {
  createExportJobSchema,
  createReadinessExportSchema,
  exportJobSchema,
  exportArtifactSchema,
  exportColumnSchema,
  exportDownloadGrantSchema,
  exportDownloadGrantInputSchema,
  exportJobListQuerySchema,
  exportManifestSchema,
  exportManifestResponseSchema,
  exportMutationSchema,
  exportReadinessReportSchema,
  exportSnapshotRowSchema,
  exportSourceIdSchema,
  exportScopeSchema,
} from "../schemas/index.js";
export type CreateExportJobInput = z.output<typeof createExportJobSchema>;
export type CreateReadinessExportInput = z.output<
  typeof createReadinessExportSchema
>;
export type ExportJob = z.output<typeof exportJobSchema>;
export type ExportArtifact = z.output<typeof exportArtifactSchema>;
export type ExportColumn = z.output<typeof exportColumnSchema>;
export type ExportDownloadGrant = z.output<typeof exportDownloadGrantSchema>;
export type ExportDownloadGrantInput = z.output<
  typeof exportDownloadGrantInputSchema
>;
export type ExportJobListQuery = z.output<typeof exportJobListQuerySchema>;
export type ExportManifest = z.output<typeof exportManifestSchema>;
export type ExportManifestResponse = z.output<
  typeof exportManifestResponseSchema
>;
export type ExportMutation = z.output<typeof exportMutationSchema>;
export type ExportReadinessReport = z.output<
  typeof exportReadinessReportSchema
>;
export type ExportSnapshotRow = z.output<typeof exportSnapshotRowSchema>;
export type ExportSourceId = z.output<typeof exportSourceIdSchema>;
export type ExportScope = z.output<typeof exportScopeSchema>;
