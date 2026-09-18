import {
  completeEvidenceUploadInputSchema,
  createEvidenceReplacementInputSchema,
  evidenceDocumentAccessInputSchema,
  evidenceDocumentAccessResponseSchema,
  evidenceDocumentAccessParamsSchema,
  evidenceDocumentListQuerySchema,
  evidenceDocumentListResponseSchema,
  evidenceDocumentVersionParamsSchema,
  evidenceDocumentVersionsResponseSchema,
  evidenceExtractedTextResponseSchema,
  evidenceProductParamsSchema,
  evidenceSearchQuerySchema,
  evidenceSearchResponseSchema,
  evidenceUploadCompletionResponseSchema,
  evidenceUploadInitializationResponseSchema,
  initializeEvidenceUploadInputSchema,
  retryEvidenceExtractionInputSchema,
  retryEvidenceExtractionResponseSchema,
  type CompleteEvidenceUploadInput,
  type CreateEvidenceReplacementInput,
  type EvidenceDocumentAccessInput,
  type EvidenceDocumentListQuery,
  type EvidenceSearchQuery,
  type InitializeEvidenceUploadInput,
  type RetryEvidenceExtractionInput,
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

  versions(productId: string, documentId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceDocumentVersionsResponseSchema
    >({
      path: versionsPath(productId, documentId),
      schema: evidenceDocumentVersionsResponseSchema,
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
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
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
      request.send(file);
    });
  }
}

export const evidenceApi = Object.freeze(new EvidenceApi());
