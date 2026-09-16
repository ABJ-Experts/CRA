import type {
  completeEvidenceUploadInputSchema,
  evidenceDocumentListQuerySchema,
  evidenceDocumentListResponseSchema,
  evidenceDocumentParamsSchema,
  evidenceDocumentResponseSchema,
  evidenceDocumentSchema,
  evidenceDocumentVersionParamsSchema,
  evidenceUploadVersionParamsSchema,
  evidenceDocumentVersionSchema,
  evidenceDocumentVersionsResponseSchema,
  evidenceOriginalDownloadResponseSchema,
  evidenceProductParamsSchema,
  evidenceUploadCompletionResponseSchema,
  evidenceUploadInitializationResponseSchema,
  initializeEvidenceUploadInputSchema,
} from "../schemas/index.js";
import type { z } from "zod";

export type InitializeEvidenceUploadInput = z.output<
  typeof initializeEvidenceUploadInputSchema
>;
export type CompleteEvidenceUploadInput = z.output<
  typeof completeEvidenceUploadInputSchema
>;
export type EvidenceDocumentParams = z.output<
  typeof evidenceDocumentParamsSchema
>;
export type EvidenceDocumentVersionParams = z.output<
  typeof evidenceDocumentVersionParamsSchema
>;
export type EvidenceUploadVersionParams = z.output<
  typeof evidenceUploadVersionParamsSchema
>;
export type EvidenceProductParams = z.output<
  typeof evidenceProductParamsSchema
>;
export type EvidenceDocumentListQuery = z.output<
  typeof evidenceDocumentListQuerySchema
>;
export type EvidenceDocument = z.output<typeof evidenceDocumentSchema>;
export type EvidenceDocumentVersion = z.output<
  typeof evidenceDocumentVersionSchema
>;
export type EvidenceUploadInitializationResponse = z.output<
  typeof evidenceUploadInitializationResponseSchema
>;
export type EvidenceUploadCompletionResponse = z.output<
  typeof evidenceUploadCompletionResponseSchema
>;
export type EvidenceDocumentResponse = z.output<
  typeof evidenceDocumentResponseSchema
>;
export type EvidenceDocumentVersionsResponse = z.output<
  typeof evidenceDocumentVersionsResponseSchema
>;
export type EvidenceDocumentListResponse = z.output<
  typeof evidenceDocumentListResponseSchema
>;
export type EvidenceOriginalDownloadResponse = z.output<
  typeof evidenceOriginalDownloadResponseSchema
>;
