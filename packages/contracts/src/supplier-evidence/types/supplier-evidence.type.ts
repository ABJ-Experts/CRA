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
export type ReviewSupplierEvidenceSubmissionInput = z.output<
  typeof schemas.reviewSupplierEvidenceSubmissionInputSchema
>;
export type ReRequestSupplierEvidenceRequestInput = z.output<
  typeof schemas.reRequestSupplierEvidenceRequestInputSchema
>;
export type MarkSupplierEvidenceInvitationDeliveryInput = z.output<
  typeof schemas.markSupplierEvidenceInvitationDeliveryInputSchema
>;
export type SupplierEvidenceReminderSettingsInput = z.output<
  typeof schemas.supplierEvidenceReminderSettingsInputSchema
>;
export type RetrySupplierEvidenceReminderDeliveryInput = z.output<
  typeof schemas.retrySupplierEvidenceReminderDeliveryInputSchema
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
export type SupplierEvidenceSubmissionParams = z.output<
  typeof schemas.supplierEvidenceSubmissionParamsSchema
>;
export type SupplierEvidenceInvitationParams = z.output<
  typeof schemas.supplierEvidenceInvitationParamsSchema
>;
export type SupplierEvidenceReminderDeliveryParams = z.output<
  typeof schemas.supplierEvidenceReminderDeliveryParamsSchema
>;
export type SupplierEvidenceMetricsQuery = z.output<
  typeof schemas.supplierEvidenceMetricsQuerySchema
>;
export type SupplierEvidenceOverdueListQuery = z.output<
  typeof schemas.supplierEvidenceOverdueListQuerySchema
>;
export type SupplierEvidenceRequestDetail = z.output<
  typeof schemas.supplierEvidenceRequestDetailSchema
>;
export type SupplierEvidenceReviewRequestDetail = z.output<
  typeof schemas.supplierEvidenceReviewRequestDetailSchema
>;
export type SupplierEvidenceRequestSummary = z.output<
  typeof schemas.supplierEvidenceRequestSummarySchema
>;
export type SupplierEvidenceInvitation = z.output<
  typeof schemas.supplierEvidenceInvitationSchema
>;
export type SupplierEvidenceReminderSettings = z.output<
  typeof schemas.supplierEvidenceReminderSettingsSchema
>;
export type SupplierEvidenceReminderDelivery = z.output<
  typeof schemas.supplierEvidenceReminderDeliverySchema
>;
export type SupplierEvidenceMetricsSummary = z.output<
  typeof schemas.supplierEvidenceMetricsSummarySchema
>;
export type SupplierEvidenceOverdueRow = z.output<
  typeof schemas.supplierEvidenceOverdueRowSchema
>;
export type SupplierEvidenceInternalSubmission = z.output<
  typeof schemas.supplierEvidenceInternalSubmissionSchema
>;
export type SupplierEvidenceSubmissionReview = z.output<
  typeof schemas.supplierEvidenceSubmissionReviewSchema
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
