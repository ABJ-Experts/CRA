import {
  cancelEvidenceBulkIntakeItemInputSchema,
  completeEvidenceBulkIntakeItemInputSchema,
  completeEvidenceUploadInputSchema,
  createEvidenceBulkIntakeBatchInputSchema,
  createEvidenceDeletionIntentInputSchema,
  createEvidenceReplacementInputSchema,
  createEvidenceWatermarkExportInputSchema,
  evidenceBulkIntakeBatchParamsSchema,
  evidenceBulkIntakeBatchResponseSchema,
  evidenceBulkIntakeItemInitializationResponseSchema,
  evidenceBulkIntakeItemParamsSchema,
  evidenceBulkIntakeItemResponseSchema,
  evidenceDocumentAccessInputSchema,
  evidenceDocumentAccessResponseSchema,
  evidenceDocumentAccessParamsSchema,
  evidenceDocumentListQuerySchema,
  evidenceDocumentListResponseSchema,
  evidenceExpiryAlertIntervalsResponseSchema,
  evidenceDocumentVersionParamsSchema,
  evidenceDocumentVersionsResponseSchema,
  evidenceDeletionIntentResponseSchema,
  evidenceExtractedTextResponseSchema,
  evidenceLegalHoldListParamsSchema,
  evidenceLegalHoldListResponseSchema,
  evidenceLegalHoldParamsSchema,
  evidenceProductParamsSchema,
  evidenceRetentionReviewParamsSchema,
  evidenceRetentionReviewResponseSchema,
  evidenceSearchQuerySchema,
  evidenceSearchResponseSchema,
  evidenceUploadCompletionResponseSchema,
  evidenceUploadInitializationResponseSchema,
  initializeEvidenceUploadInputSchema,
  placeEvidenceLegalHoldInputSchema,
  placeEvidenceLegalHoldResponseSchema,
  releaseEvidenceLegalHoldInputSchema,
  releaseEvidenceLegalHoldResponseSchema,
  retryEvidenceExtractionInputSchema,
  retryEvidenceExtractionResponseSchema,
  updateEvidenceExpiryAlertIntervalsInputSchema,
  evidenceVersionReuseParamsSchema,
  evidenceVersionReuseResponseSchema,
  evidenceWatermarkExportCollectionParamsSchema,
  evidenceWatermarkExportDeliveryInputSchema,
  evidenceWatermarkExportDeliveryResponseSchema,
  evidenceWatermarkExportParamsSchema,
  evidenceWatermarkExportPreviewInputSchema,
  evidenceWatermarkExportPreviewResponseSchema,
  evidenceWatermarkExportResponseSchema,
  initializeEvidenceBulkIntakeItemInputSchema,
  retryEvidenceBulkIntakeItemInputSchema,
  type CancelEvidenceBulkIntakeItemInput,
  type CompleteEvidenceBulkIntakeItemInput,
  type CompleteEvidenceUploadInput,
  type CreateEvidenceBulkIntakeBatchInput,
  type CreateEvidenceDeletionIntentInput,
  type CreateEvidenceReplacementInput,
  type CreateEvidenceWatermarkExportInput,
  type EvidenceDocumentAccessInput,
  type EvidenceDocumentListQuery,
  type UpdateEvidenceExpiryAlertIntervalsInput,
  type EvidenceSearchQuery,
  type EvidenceWatermarkExportDeliveryInput,
  type EvidenceWatermarkExportPreviewInput,
  type InitializeEvidenceBulkIntakeItemInput,
  type PlaceEvidenceLegalHoldInput,
  type ReleaseEvidenceLegalHoldInput,
  type InitializeEvidenceUploadInput,
  type RetryEvidenceExtractionInput,
  type RetryEvidenceBulkIntakeItemInput,
} from "@repo/contracts/evidence";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

function productPath(productId: string): `/${string}` {
  const parsed = evidenceProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/evidence-documents`;
}

function completionPath(versionId: string): `/${string}` {
  const parsed = evidenceDocumentVersionParamsSchema.safeParse({
    documentId: "00000000-0000-4000-8000-000000000000",
    versionId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence version identifier is invalid.",
      400,
    );
  }
  return `/api/v1/evidence-uploads/${parsed.data.versionId}/complete`;
}

function downloadPath(documentId: string, versionId: string): `/${string}` {
  const parsed = evidenceDocumentVersionParamsSchema.safeParse({
    documentId,
    versionId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence document identifier is invalid.",
      400,
    );
  }
  return `/api/v1/evidence-documents/${parsed.data.documentId}/versions/${parsed.data.versionId}`;
}

function versionsPath(productId: string, documentId: string): `/${string}` {
  const parsed = evidenceDocumentVersionParamsSchema.safeParse({
    documentId,
    versionId: "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence document identifier is invalid.",
      400,
    );
  }
  return `${productPath(productId)}/${parsed.data.documentId}/versions`;
}

function evidenceDocumentPath(
  documentId: string,
): `/api/v1/evidence/${string}` {
  const parsed = evidenceRetentionReviewParamsSchema.safeParse({ documentId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence document identifier is invalid.",
      400,
    );
  }
  return `/api/v1/evidence/${parsed.data.documentId}`;
}

function bulkIntakeBatchPath(
  productId: string,
  batchId?: string,
): `/${string}` {
  const parsed = evidenceBulkIntakeBatchParamsSchema.safeParse({
    productId,
    batchId: batchId ?? "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product or bulk-intake batch identifier is invalid.",
      400,
    );
  }
  const root = `/api/v1/products/${parsed.data.productId}/evidence-bulk-intake-batches`;
  return (batchId ? `${root}/${parsed.data.batchId}` : root) as `/${string}`;
}

function bulkIntakeItemPath(
  productId: string,
  batchId: string,
  itemId: string,
  suffix: "initialize" | "complete" | "cancel" | "retry",
): `/${string}` {
  const parsed = evidenceBulkIntakeItemParamsSchema.safeParse({
    productId,
    batchId,
    itemId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The bulk-intake item identifier is invalid.",
      400,
    );
  }
  return `${bulkIntakeBatchPath(parsed.data.productId, parsed.data.batchId)}/items/${parsed.data.itemId}/${suffix}` as `/${string}`;
}

function watermarkExportsPath(
  productId: string,
  documentId: string,
  versionId: string,
  exportId?: string,
): `/${string}` {
  const parsed = (
    exportId
      ? evidenceWatermarkExportParamsSchema
      : evidenceWatermarkExportCollectionParamsSchema
  ).safeParse({
    productId,
    documentId,
    versionId,
    ...(exportId ? { exportId } : {}),
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product, evidence document, version, or export identifier is invalid.",
      400,
    );
  }
  const root = `/api/v1/products/${parsed.data.productId}/evidence-documents/${parsed.data.documentId}/versions/${parsed.data.versionId}/watermark-exports`;
  return (exportId ? `${root}/${exportId}` : root) as `/${string}`;
}

function retentionReviewPath(documentId: string): `/${string}` {
  return `${evidenceDocumentPath(documentId)}/retention-review`;
}

function legalHoldsPath(documentId: string): `/${string}` {
  const parsed = evidenceLegalHoldListParamsSchema.safeParse({ documentId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence document identifier is invalid.",
      400,
    );
  }
  return `${evidenceDocumentPath(parsed.data.documentId)}/legal-holds`;
}

function releaseLegalHoldPath(
  documentId: string,
  holdId: string,
): `/${string}` {
  const parsed = evidenceLegalHoldParamsSchema.safeParse({
    documentId,
    holdId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence document or legal hold identifier is invalid.",
      400,
    );
  }
  return `${legalHoldsPath(parsed.data.documentId)}/${parsed.data.holdId}/release`;
}

function queryString(query: Partial<EvidenceDocumentListQuery>): string {
  const parsed = evidenceDocumentListQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence query is invalid.",
      400,
    );
  }
  const parameters = new URLSearchParams();
  if (parsed.data.status) parameters.set("status", parsed.data.status);
  if (parsed.data.documentClass)
    parameters.set("documentClass", parsed.data.documentClass);
  if (parsed.data.validity) parameters.set("validity", parsed.data.validity);
  if (parsed.data.cursor) parameters.set("cursor", parsed.data.cursor);
  if (parsed.data.limit !== 50)
    parameters.set("limit", String(parsed.data.limit));
  const value = parameters.toString();
  return value === "" ? "" : `?${value}`;
}

function evidenceSearchPath(productId: string): `/${string}` {
  const parsed = evidenceProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/evidence-search`;
}

function extractionPath(
  productId: string,
  documentId: string,
  versionId: string,
  suffix: "extracted-text" | "extraction/retry",
): `/${string}` {
  const parsed = evidenceDocumentAccessParamsSchema.safeParse({
    productId,
    documentId,
    versionId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product, evidence document, or version identifier is invalid.",
      400,
    );
  }
  return `${productPath(parsed.data.productId)}/${parsed.data.documentId}/versions/${parsed.data.versionId}/${suffix}`;
}

function reusePath(
  productId: string,
  documentId: string,
  versionId: string,
): `/${string}` {
  const parsed = evidenceVersionReuseParamsSchema.safeParse({
    productId,
    documentId,
    versionId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product, evidence document, or version identifier is invalid.",
      400,
    );
  }
  return `${productPath(parsed.data.productId)}/${parsed.data.documentId}/versions/${parsed.data.versionId}/reuse`;
}

function searchQueryString(query: EvidenceSearchQuery): string {
  const parsed = evidenceSearchQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The evidence search query is invalid.",
      400,
    );
  }
  const parameters = new URLSearchParams({ q: parsed.data.q });
  if (parsed.data.documentClass)
    parameters.set("documentClass", parsed.data.documentClass);
  if (parsed.data.includeHistorical)
    parameters.set("includeHistorical", "true");
  if (parsed.data.limit !== 25)
    parameters.set("limit", String(parsed.data.limit));
  if (parsed.data.cursor) parameters.set("cursor", parsed.data.cursor);
  return `?${parameters.toString()}`;
}

/** Focused gateway for parsed evidence HTTP and private-storage transfer. */
export class EvidenceApi {
  list(
    productId: string,
    query: Partial<EvidenceDocumentListQuery> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<typeof evidenceDocumentListResponseSchema>({
      path: `${productPath(productId)}${queryString(query)}` as `/${string}`,
      schema: evidenceDocumentListResponseSchema,
      signal,
    });
  }

  reuse(
    productId: string,
    documentId: string,
    versionId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<typeof evidenceVersionReuseResponseSchema>({
      path: reusePath(productId, documentId, versionId),
      schema: evidenceVersionReuseResponseSchema,
      signal,
    });
  }

  expiryAlertIntervals(signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceExpiryAlertIntervalsResponseSchema
    >({
      path: "/api/v1/evidence-expiry-alert-intervals",
      schema: evidenceExpiryAlertIntervalsResponseSchema,
      signal,
    });
  }

  updateExpiryAlertIntervals(
    input: UpdateEvidenceExpiryAlertIntervalsInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceExpiryAlertIntervalsResponseSchema,
      typeof updateEvidenceExpiryAlertIntervalsInputSchema
    >({
      path: "/api/v1/evidence-expiry-alert-intervals",
      method: "PATCH",
      body: input,
      inputSchema: updateEvidenceExpiryAlertIntervalsInputSchema,
      schema: evidenceExpiryAlertIntervalsResponseSchema,
      signal,
    });
  }

  search(productId: string, query: EvidenceSearchQuery, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof evidenceSearchResponseSchema>({
      path: `${evidenceSearchPath(productId)}${searchQueryString(query)}` as `/${string}`,
      schema: evidenceSearchResponseSchema,
      signal,
    });
  }

  initialize(input: InitializeEvidenceUploadInput, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceUploadInitializationResponseSchema,
      typeof initializeEvidenceUploadInputSchema
    >({
      path: "/api/v1/evidence-uploads",
      method: "POST",
      body: input,
      inputSchema: initializeEvidenceUploadInputSchema,
      schema: evidenceUploadInitializationResponseSchema,
      signal,
    });
  }

  complete(
    versionId: string,
    input: CompleteEvidenceUploadInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceUploadCompletionResponseSchema,
      typeof completeEvidenceUploadInputSchema
    >({
      path: completionPath(versionId),
      method: "POST",
      body: input,
      inputSchema: completeEvidenceUploadInputSchema,
      schema: evidenceUploadCompletionResponseSchema,
      signal,
    });
  }

  createBulkIntakeBatch(
    productId: string,
    input: CreateEvidenceBulkIntakeBatchInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceBulkIntakeBatchResponseSchema,
      typeof createEvidenceBulkIntakeBatchInputSchema
    >({
      path: bulkIntakeBatchPath(productId),
      method: "POST",
      body: input,
      inputSchema: createEvidenceBulkIntakeBatchInputSchema,
      schema: evidenceBulkIntakeBatchResponseSchema,
      signal,
    });
  }

  bulkIntakeBatch(productId: string, batchId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceBulkIntakeBatchResponseSchema
    >({
      path: bulkIntakeBatchPath(productId, batchId),
      schema: evidenceBulkIntakeBatchResponseSchema,
      signal,
    });
  }

  initializeBulkIntakeItem(
    productId: string,
    batchId: string,
    itemId: string,
    input: InitializeEvidenceBulkIntakeItemInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceBulkIntakeItemInitializationResponseSchema,
      typeof initializeEvidenceBulkIntakeItemInputSchema
    >({
      path: bulkIntakeItemPath(productId, batchId, itemId, "initialize"),
      method: "POST",
      body: input,
      inputSchema: initializeEvidenceBulkIntakeItemInputSchema,
      schema: evidenceBulkIntakeItemInitializationResponseSchema,
      signal,
    });
  }

  completeBulkIntakeItem(
    productId: string,
    batchId: string,
    itemId: string,
    input: CompleteEvidenceBulkIntakeItemInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceBulkIntakeItemResponseSchema,
      typeof completeEvidenceBulkIntakeItemInputSchema
    >({
      path: bulkIntakeItemPath(productId, batchId, itemId, "complete"),
      method: "POST",
      body: input,
      inputSchema: completeEvidenceBulkIntakeItemInputSchema,
      schema: evidenceBulkIntakeItemResponseSchema,
      signal,
    });
  }

  cancelBulkIntakeItem(
    productId: string,
    batchId: string,
    itemId: string,
    input: CancelEvidenceBulkIntakeItemInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceBulkIntakeItemResponseSchema,
      typeof cancelEvidenceBulkIntakeItemInputSchema
    >({
      path: bulkIntakeItemPath(productId, batchId, itemId, "cancel"),
      method: "POST",
      body: input,
      inputSchema: cancelEvidenceBulkIntakeItemInputSchema,
      schema: evidenceBulkIntakeItemResponseSchema,
      signal,
    });
  }

  retryBulkIntakeItem(
    productId: string,
    batchId: string,
    itemId: string,
    input: RetryEvidenceBulkIntakeItemInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceBulkIntakeItemInitializationResponseSchema,
      typeof retryEvidenceBulkIntakeItemInputSchema
    >({
      path: bulkIntakeItemPath(productId, batchId, itemId, "retry"),
      method: "POST",
      body: input,
      inputSchema: retryEvidenceBulkIntakeItemInputSchema,
      schema: evidenceBulkIntakeItemInitializationResponseSchema,
      signal,
    });
  }

  createWatermarkExport(
    productId: string,
    documentId: string,
    versionId: string,
    input: CreateEvidenceWatermarkExportInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceWatermarkExportResponseSchema,
      typeof createEvidenceWatermarkExportInputSchema
    >({
      path: watermarkExportsPath(productId, documentId, versionId),
      method: "POST",
      body: input,
      inputSchema: createEvidenceWatermarkExportInputSchema,
      schema: evidenceWatermarkExportResponseSchema,
      signal,
    });
  }

  watermarkExport(
    productId: string,
    documentId: string,
    versionId: string,
    exportId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceWatermarkExportResponseSchema
    >({
      path: watermarkExportsPath(productId, documentId, versionId, exportId),
      schema: evidenceWatermarkExportResponseSchema,
      signal,
    });
  }

  previewWatermarkExport(
    productId: string,
    documentId: string,
    versionId: string,
    exportId: string,
    input: EvidenceWatermarkExportPreviewInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceWatermarkExportPreviewResponseSchema,
      typeof evidenceWatermarkExportPreviewInputSchema
    >({
      path: `${watermarkExportsPath(productId, documentId, versionId, exportId)}/preview` as `/${string}`,
      method: "POST",
      body: input,
      inputSchema: evidenceWatermarkExportPreviewInputSchema,
      schema: evidenceWatermarkExportPreviewResponseSchema,
      signal,
    });
  }

  deliverWatermarkExport(
    productId: string,
    documentId: string,
    versionId: string,
    exportId: string,
    input: EvidenceWatermarkExportDeliveryInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceWatermarkExportDeliveryResponseSchema,
      typeof evidenceWatermarkExportDeliveryInputSchema
    >({
      path: `${watermarkExportsPath(productId, documentId, versionId, exportId)}/delivery` as `/${string}`,
      method: "POST",
      body: input,
      inputSchema: evidenceWatermarkExportDeliveryInputSchema,
      schema: evidenceWatermarkExportDeliveryResponseSchema,
      signal,
    });
  }

  versions(productId: string, documentId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceDocumentVersionsResponseSchema
    >({
      path: versionsPath(productId, documentId),
      schema: evidenceDocumentVersionsResponseSchema,
      signal,
    });
  }

  retentionReview(documentId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceRetentionReviewResponseSchema
    >({
      path: retentionReviewPath(documentId),
      schema: evidenceRetentionReviewResponseSchema,
      signal,
    });
  }

  createDeletionIntent(
    documentId: string,
    input: CreateEvidenceDeletionIntentInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceDeletionIntentResponseSchema,
      typeof createEvidenceDeletionIntentInputSchema
    >({
      path: `${evidenceDocumentPath(documentId)}/deletion-intents`,
      method: "POST",
      body: input,
      inputSchema: createEvidenceDeletionIntentInputSchema,
      schema: evidenceDeletionIntentResponseSchema,
      signal,
    });
  }

  legalHolds(documentId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof evidenceLegalHoldListResponseSchema>(
      {
        path: legalHoldsPath(documentId),
        schema: evidenceLegalHoldListResponseSchema,
        signal,
      },
    );
  }

  placeLegalHold(
    documentId: string,
    input: PlaceEvidenceLegalHoldInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof placeEvidenceLegalHoldResponseSchema,
      typeof placeEvidenceLegalHoldInputSchema
    >({
      path: legalHoldsPath(documentId),
      method: "POST",
      body: input,
      inputSchema: placeEvidenceLegalHoldInputSchema,
      schema: placeEvidenceLegalHoldResponseSchema,
      signal,
    });
  }

  releaseLegalHold(
    documentId: string,
    holdId: string,
    input: ReleaseEvidenceLegalHoldInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof releaseEvidenceLegalHoldResponseSchema,
      typeof releaseEvidenceLegalHoldInputSchema
    >({
      path: releaseLegalHoldPath(documentId, holdId),
      method: "POST",
      body: input,
      inputSchema: releaseEvidenceLegalHoldInputSchema,
      schema: releaseEvidenceLegalHoldResponseSchema,
      signal,
    });
  }

  replace(input: CreateEvidenceReplacementInput, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceUploadInitializationResponseSchema,
      typeof createEvidenceReplacementInputSchema
    >({
      path: `/api/v1/evidence-documents/${input.documentId}/versions`,
      method: "POST",
      body: input,
      inputSchema: createEvidenceReplacementInputSchema,
      schema: evidenceUploadInitializationResponseSchema,
      signal,
    });
  }

  access(
    productId: string,
    documentId: string,
    versionId: string,
    input: EvidenceDocumentAccessInput,
    signal?: AbortSignal,
  ) {
    downloadPath(documentId, versionId);
    return authenticatedRequestJson<
      typeof evidenceDocumentAccessResponseSchema,
      typeof evidenceDocumentAccessInputSchema
    >({
      path: `${productPath(productId)}/${documentId}/versions/${versionId}/access` as `/${string}`,
      method: "POST",
      body: input,
      inputSchema: evidenceDocumentAccessInputSchema,
      schema: evidenceDocumentAccessResponseSchema,
      signal,
    });
  }

  extractedText(
    productId: string,
    documentId: string,
    versionId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<typeof evidenceExtractedTextResponseSchema>(
      {
        path: extractionPath(
          productId,
          documentId,
          versionId,
          "extracted-text",
        ),
        schema: evidenceExtractedTextResponseSchema,
        signal,
      },
    );
  }

  retryExtraction(
    productId: string,
    documentId: string,
    versionId: string,
    input: RetryEvidenceExtractionInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof retryEvidenceExtractionResponseSchema,
      typeof retryEvidenceExtractionInputSchema
    >({
      path: extractionPath(
        productId,
        documentId,
        versionId,
        "extraction/retry",
      ),
      method: "POST",
      body: input,
      inputSchema: retryEvidenceExtractionInputSchema,
      schema: retryEvidenceExtractionResponseSchema,
      signal,
    });
  }

  uploadOriginal(
    uploadUrl: string,
    file: File,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const abort = () => {
        request.abort();
      };
      request.open("PUT", uploadUrl);
      request.setRequestHeader(
        "content-type",
        file.type || "application/octet-stream",
      );
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      request.onerror = () =>
        reject(
          new ApiClientError(
            "network",
            "The evidence upload could not reach private storage.",
          ),
        );
      request.onabort = () =>
        reject(
          new ApiClientError("network", "The evidence upload was cancelled."),
        );
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          resolve();
          return;
        }
        reject(
          new ApiClientError(
            "api",
            "Private storage rejected the evidence upload.",
            request.status,
          ),
        );
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      request.onloadend = () => signal?.removeEventListener("abort", abort);
      request.send(file);
    });
  }
}

export const evidenceApi = Object.freeze(new EvidenceApi());
