import type {
  completeEvidenceUploadInputSchema,
  evidenceDocumentListQuerySchema,
  createEvidenceReplacementInputSchema,
  evidenceDocumentAccessInputSchema,
  evidenceDocumentAccessResponseSchema,
  evidenceExtractedTextParamsSchema,
  evidenceExtractedTextResponseSchema,
  evidenceExtractionFailureCodeSchema,
  evidenceExtractionMetadataSchema,
  evidenceExtractionQualitySchema,
  evidenceExtractionRetryParamsSchema,
  evidenceExtractionStatusSchema,
  evidenceDocumentListResponseSchema,
  evidenceDocumentParamsSchema,
  evidenceDocumentResponseSchema,
  evidenceDocumentSchema,
  evidenceDocumentVersionParamsSchema,
  evidenceVersionReuseParamsSchema,
  evidenceDocumentAccessParamsSchema,
  evidenceUploadVersionParamsSchema,
  evidenceDocumentVersionSchema,
  evidenceDocumentVersionsResponseSchema,
  evidenceOriginalDownloadResponseSchema,
  evidenceValidityFilterSchema,
  evidenceValidityStatusSchema,
  evidenceExpiryAlertIntervalsSchema,
  evidenceExpiryAlertIntervalsResponseSchema,
  updateEvidenceExpiryAlertIntervalsInputSchema,
  evidenceTechnicalFileReuseLinkSchema,
  evidenceVersionReuseSchema,
  evidenceVersionReuseResponseSchema,
  evidenceProductParamsSchema,
  evidenceSearchCoverageSchema,
  evidenceSearchFacetSchema,
  evidenceSearchQuerySchema,
  evidenceSearchResponseSchema,
  evidenceSearchResultSchema,
  evidenceSearchSnippetSchema,
  evidenceSearchSnippetSegmentSchema,
  retryEvidenceExtractionInputSchema,
  retryEvidenceExtractionResponseSchema,
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
export type CreateEvidenceReplacementInput = z.output<
  typeof createEvidenceReplacementInputSchema
>;
export type EvidenceDocumentAccessInput = z.output<
  typeof evidenceDocumentAccessInputSchema
>;
export type EvidenceDocumentAccessResponse = z.output<
  typeof evidenceDocumentAccessResponseSchema
>;
export type EvidenceDocumentParams = z.output<
  typeof evidenceDocumentParamsSchema
>;
export type EvidenceDocumentVersionParams = z.output<
  typeof evidenceDocumentVersionParamsSchema
>;
export type EvidenceVersionReuseParams = z.output<
  typeof evidenceVersionReuseParamsSchema
>;
export type EvidenceDocumentAccessParams = z.output<
  typeof evidenceDocumentAccessParamsSchema
>;
export type EvidenceUploadVersionParams = z.output<
  typeof evidenceUploadVersionParamsSchema
>;
export type EvidenceProductParams = z.output<
  typeof evidenceProductParamsSchema
>;
export type EvidenceExtractedTextParams = z.output<
  typeof evidenceExtractedTextParamsSchema
>;
export type EvidenceExtractionRetryParams = z.output<
  typeof evidenceExtractionRetryParamsSchema
>;
export type RetryEvidenceExtractionInput = z.output<
  typeof retryEvidenceExtractionInputSchema
>;
export type RetryEvidenceExtractionResponse = z.output<
  typeof retryEvidenceExtractionResponseSchema
>;
export type EvidenceDocumentListQuery = z.output<
  typeof evidenceDocumentListQuerySchema
>;
export type EvidenceValidityStatus = z.output<typeof evidenceValidityStatusSchema>;
export type EvidenceValidityFilter = z.output<typeof evidenceValidityFilterSchema>;
export type EvidenceExpiryAlertIntervals = z.output<
  typeof evidenceExpiryAlertIntervalsSchema
>;
export type UpdateEvidenceExpiryAlertIntervalsInput = z.output<
  typeof updateEvidenceExpiryAlertIntervalsInputSchema
>;
export type EvidenceExpiryAlertIntervalsResponse = z.output<
  typeof evidenceExpiryAlertIntervalsResponseSchema
>;
export type EvidenceTechnicalFileReuseLink = z.output<
  typeof evidenceTechnicalFileReuseLinkSchema
>;
export type EvidenceVersionReuse = z.output<typeof evidenceVersionReuseSchema>;
export type EvidenceVersionReuseResponse = z.output<
  typeof evidenceVersionReuseResponseSchema
>;
export type EvidenceExtractionMetadata = z.output<
  typeof evidenceExtractionMetadataSchema
>;
export type EvidenceExtractionStatus = z.output<
  typeof evidenceExtractionStatusSchema
>;
export type EvidenceExtractionFailureCode = z.output<
  typeof evidenceExtractionFailureCodeSchema
>;
export type EvidenceExtractionQuality = z.output<
  typeof evidenceExtractionQualitySchema
>;
export type EvidenceSearchQuery = z.output<typeof evidenceSearchQuerySchema>;
export type EvidenceSearchSnippetSegment = z.output<
  typeof evidenceSearchSnippetSegmentSchema
>;
export type EvidenceSearchSnippet = z.output<
  typeof evidenceSearchSnippetSchema
>;
export type EvidenceSearchCoverage = z.output<
  typeof evidenceSearchCoverageSchema
>;
export type EvidenceSearchFacet = z.output<typeof evidenceSearchFacetSchema>;
export type EvidenceSearchResult = z.output<typeof evidenceSearchResultSchema>;
export type EvidenceSearchResponse = z.output<
  typeof evidenceSearchResponseSchema
>;
export type EvidenceExtractedTextResponse = z.output<
  typeof evidenceExtractedTextResponseSchema
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
