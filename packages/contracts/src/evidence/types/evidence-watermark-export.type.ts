import type {
  createEvidenceWatermarkExportInputSchema,
  evidenceWatermarkDerivativeSchema,
  evidenceWatermarkExportAccessSchema,
  evidenceWatermarkExportCollectionParamsSchema,
  evidenceWatermarkExportDeliveryInputSchema,
  evidenceWatermarkExportDeliveryParamsSchema,
  evidenceWatermarkExportDeliveryResponseSchema,
  evidenceWatermarkExportFailureCodeSchema,
  evidenceWatermarkExportParamsSchema,
  evidenceWatermarkExportPreviewInputSchema,
  evidenceWatermarkExportPreviewResponseSchema,
  evidenceWatermarkExportResponseSchema,
  evidenceWatermarkExportSchema,
  evidenceWatermarkExportStatusSchema,
  evidenceWatermarkMediaTypeSchema,
  evidenceWatermarkPurposeSchema,
  evidenceWatermarkRecipientSchema,
} from "../schemas/index.js";
import type { z } from "zod";

export type EvidenceWatermarkRecipient = z.output<typeof evidenceWatermarkRecipientSchema>;
export type EvidenceWatermarkPurpose = z.output<typeof evidenceWatermarkPurposeSchema>;
export type EvidenceWatermarkMediaType = z.output<typeof evidenceWatermarkMediaTypeSchema>;
export type EvidenceWatermarkExportStatus = z.output<
  typeof evidenceWatermarkExportStatusSchema
>;
export type EvidenceWatermarkExportFailureCode = z.output<
  typeof evidenceWatermarkExportFailureCodeSchema
>;
export type CreateEvidenceWatermarkExportInput = z.output<
  typeof createEvidenceWatermarkExportInputSchema
>;
export type EvidenceWatermarkExportCollectionParams = z.output<
  typeof evidenceWatermarkExportCollectionParamsSchema
>;
export type EvidenceWatermarkExportParams = z.output<
  typeof evidenceWatermarkExportParamsSchema
>;
export type EvidenceWatermarkExportPreviewInput = z.output<
  typeof evidenceWatermarkExportPreviewInputSchema
>;
export type EvidenceWatermarkExportDeliveryInput = z.output<
  typeof evidenceWatermarkExportDeliveryInputSchema
>;
export type EvidenceWatermarkExportDeliveryParams = z.output<
  typeof evidenceWatermarkExportDeliveryParamsSchema
>;
export type EvidenceWatermarkDerivative = z.output<typeof evidenceWatermarkDerivativeSchema>;
export type EvidenceWatermarkExport = z.output<typeof evidenceWatermarkExportSchema>;
export type EvidenceWatermarkExportResponse = z.output<
  typeof evidenceWatermarkExportResponseSchema
>;
export type EvidenceWatermarkExportAccess = z.output<
  typeof evidenceWatermarkExportAccessSchema
>;
export type EvidenceWatermarkExportPreviewResponse = z.output<
  typeof evidenceWatermarkExportPreviewResponseSchema
>;
export type EvidenceWatermarkExportDeliveryResponse = z.output<
  typeof evidenceWatermarkExportDeliveryResponseSchema
>;
