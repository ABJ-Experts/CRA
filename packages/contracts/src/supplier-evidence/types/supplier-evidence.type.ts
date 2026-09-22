import type { z } from "zod";
import type * as schemas from "../schemas/index.js";

export type CreateSupplierEvidenceRequestInput = z.output<
  typeof schemas.createSupplierEvidenceRequestInputSchema
>;
export type PreviewSupplierEvidenceRequestInput = z.output<
  typeof schemas.previewSupplierEvidenceRequestInputSchema
>;
export type ReviseSupplierEvidenceRequestInput = z.output<
  typeof schemas.reviseSupplierEvidenceRequestInputSchema
>;
export type IssueSupplierEvidenceRequestInput = z.output<
  typeof schemas.issueSupplierEvidenceRequestInputSchema
>;
export type ReissueSupplierEvidenceRequestInput = z.output<
  typeof schemas.reissueSupplierEvidenceRequestInputSchema
>;
export type RevokeSupplierEvidenceRequestInput = z.output<
  typeof schemas.revokeSupplierEvidenceRequestInputSchema
>;
export type CloseSupplierEvidenceRequestInput = z.output<
  typeof schemas.closeSupplierEvidenceRequestInputSchema
>;
export type SupplierEvidenceRequestParams = z.output<
  typeof schemas.supplierEvidenceRequestParamsSchema
>;
export type SupplierEvidenceRevisionParams = z.output<
  typeof schemas.supplierEvidenceRevisionParamsSchema
>;
export type SupplierEvidenceRequestListQuery = z.output<
  typeof schemas.supplierEvidenceRequestListQuerySchema
>;
export type SupplierEvidenceRequestDetail = z.output<
  typeof schemas.supplierEvidenceRequestDetailSchema
>;
export type SupplierEvidenceRequestSummary = z.output<
  typeof schemas.supplierEvidenceRequestSummarySchema
>;
export type SupplierEvidencePreview = z.output<
  typeof schemas.supplierEvidencePreviewSchema
>;
export type SupplierEvidencePortalSessionInput = z.output<
  typeof schemas.supplierEvidencePortalSessionInputSchema
>;
export type SupplierEvidencePortalSession = z.output<
  typeof schemas.supplierEvidencePortalSessionSchema
>;
export type InitializeSupplierEvidencePortalUploadInput = z.output<
  typeof schemas.initializeSupplierEvidencePortalUploadInputSchema
>;
export type CompleteSupplierEvidencePortalUploadInput = z.output<
  typeof schemas.completeSupplierEvidencePortalUploadInputSchema
>;
export type SupplierEvidencePortalSubmissionParams = z.output<
  typeof schemas.supplierEvidencePortalSubmissionParamsSchema
>;
