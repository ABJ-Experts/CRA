import type { z } from "zod";

import type {
  completeSupplierSbomUploadInputSchema,
  createSupplierSbomInvitationResponseSchema,
  createSupplierSbomInvitationInputSchema,
  createSupplierSbomRequestInputSchema,
  initializeSupplierSbomUploadInputSchema,
  reviewSupplierSbomSubmissionInputSchema,
  revokeSupplierSbomInvitationInputSchema,
  sbomSupplierInvitationParamsSchema,
  sbomSupplierRequestParamsSchema,
  sbomSupplierRequestReleaseParamsSchema,
  sbomSupplierSubmissionParamsSchema,
  supplierSbomInvitationResponseSchema,
  supplierSbomInvitationSchema,
  supplierSbomPortalSessionInputSchema,
  supplierSbomPortalSessionResponseSchema,
  supplierSbomPortalSubmissionResponseSchema,
  supplierSbomPortalSubmissionSchema,
  supplierSbomRequestResponseSchema,
  supplierSbomRequestSchema,
  supplierSbomRequestSummarySchema,
  supplierSbomSubmissionResponseSchema,
  supplierSbomSubmissionSchema,
  supplierSbomSubmissionsQuerySchema,
  supplierSbomSubmissionsResponseSchema,
  supplierSbomUploadCompletionResponseSchema,
  supplierSbomUploadInitializationResponseSchema,
  supplierSbomRequestsQuerySchema,
  supplierSbomRequestsResponseSchema,
} from "../schemas/index.js";

export type CreateSupplierSbomRequestInput = z.output<
  typeof createSupplierSbomRequestInputSchema
>;
export type CreateSupplierSbomInvitationInput = z.output<
  typeof createSupplierSbomInvitationInputSchema
>;
export type RevokeSupplierSbomInvitationInput = z.output<
  typeof revokeSupplierSbomInvitationInputSchema
>;
export type SupplierSbomPortalSessionInput = z.output<
  typeof supplierSbomPortalSessionInputSchema
>;
export type InitializeSupplierSbomUploadInput = z.output<
  typeof initializeSupplierSbomUploadInputSchema
>;
export type CompleteSupplierSbomUploadInput = z.output<
  typeof completeSupplierSbomUploadInputSchema
>;
export type ReviewSupplierSbomSubmissionInput = z.output<
  typeof reviewSupplierSbomSubmissionInputSchema
>;
export type SbomSupplierRequestParams = z.output<
  typeof sbomSupplierRequestParamsSchema
>;
export type SbomSupplierInvitationParams = z.output<
  typeof sbomSupplierInvitationParamsSchema
>;
export type SbomSupplierSubmissionParams = z.output<
  typeof sbomSupplierSubmissionParamsSchema
>;
export type SbomSupplierRequestReleaseParams = z.output<
  typeof sbomSupplierRequestReleaseParamsSchema
>;
export type SupplierSbomRequest = z.output<typeof supplierSbomRequestSchema>;
export type SupplierSbomInvitation = z.output<
  typeof supplierSbomInvitationSchema
>;
export type SupplierSbomSubmission = z.output<
  typeof supplierSbomSubmissionSchema
>;
export type SupplierSbomPortalSubmission = z.output<
  typeof supplierSbomPortalSubmissionSchema
>;
export type SupplierSbomRequestResponse = z.output<
  typeof supplierSbomRequestResponseSchema
>;
export type SupplierSbomRequestSummary = z.output<
  typeof supplierSbomRequestSummarySchema
>;
export type SupplierSbomInvitationResponse = z.output<
  typeof supplierSbomInvitationResponseSchema
>;
export type CreateSupplierSbomInvitationResponse = z.output<
  typeof createSupplierSbomInvitationResponseSchema
>;
export type SupplierSbomSubmissionResponse = z.output<
  typeof supplierSbomSubmissionResponseSchema
>;
export type SupplierSbomPortalSubmissionResponse = z.output<
  typeof supplierSbomPortalSubmissionResponseSchema
>;
export type SupplierSbomPortalSessionResponse = z.output<
  typeof supplierSbomPortalSessionResponseSchema
>;
export type SupplierSbomUploadInitializationResponse = z.output<
  typeof supplierSbomUploadInitializationResponseSchema
>;
export type SupplierSbomUploadCompletionResponse = z.output<
  typeof supplierSbomUploadCompletionResponseSchema
>;
export type SupplierSbomRequestsQuery = z.output<
  typeof supplierSbomRequestsQuerySchema
>;
export type SupplierSbomRequestsResponse = z.output<
  typeof supplierSbomRequestsResponseSchema
>;
export type SupplierSbomSubmissionsQuery = z.output<
  typeof supplierSbomSubmissionsQuerySchema
>;
export type SupplierSbomSubmissionsResponse = z.output<
  typeof supplierSbomSubmissionsResponseSchema
>;
