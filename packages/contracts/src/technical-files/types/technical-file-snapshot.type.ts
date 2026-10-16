import type {
  cancelTechnicalFileSnapshotExportRequestSchema,
  createTechnicalFileSnapshotExportRequestSchema,
  createTechnicalFileSnapshotRequestSchema,
  technicalFileSnapshotDownloadResponseSchema,
  technicalFileSnapshotDownloadQuerySchema,
  technicalFileSnapshotExportResponseSchema,
  technicalFileSnapshotExportSchema,
  technicalFileSnapshotExportParamsSchema,
  technicalFileSnapshotParamsSchema,
  technicalFileSnapshotSchema,
  technicalFileSnapshotResponseSchema,
  technicalFileSnapshotsResponseSchema,
} from "../schemas/technical-file-snapshot.schema.js";
import type { z } from "zod";

export type TechnicalFileSnapshot = z.output<typeof technicalFileSnapshotSchema>;
export type TechnicalFileSnapshotExport = z.output<
  typeof technicalFileSnapshotExportSchema
>;
export type TechnicalFileSnapshotParams = z.output<
  typeof technicalFileSnapshotParamsSchema
>;
export type TechnicalFileSnapshotExportParams = z.output<
  typeof technicalFileSnapshotExportParamsSchema
>;
export type TechnicalFileSnapshotDownloadQuery = z.output<
  typeof technicalFileSnapshotDownloadQuerySchema
>;
export type TechnicalFileSnapshotResponse = z.output<
  typeof technicalFileSnapshotResponseSchema
>;
export type TechnicalFileSnapshotsResponse = z.output<
  typeof technicalFileSnapshotsResponseSchema
>;
export type TechnicalFileSnapshotExportResponse = z.output<
  typeof technicalFileSnapshotExportResponseSchema
>;
export type TechnicalFileSnapshotDownloadResponse = z.output<
  typeof technicalFileSnapshotDownloadResponseSchema
>;
export type CreateTechnicalFileSnapshotRequest = z.output<
  typeof createTechnicalFileSnapshotRequestSchema
>;
export type CreateTechnicalFileSnapshotExportRequest = z.output<
  typeof createTechnicalFileSnapshotExportRequestSchema
>;
export type CancelTechnicalFileSnapshotExportRequest = z.output<
  typeof cancelTechnicalFileSnapshotExportRequestSchema
>;
