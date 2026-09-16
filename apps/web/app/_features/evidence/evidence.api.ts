import {
  completeEvidenceUploadInputSchema,
  evidenceDocumentListQuerySchema,
  evidenceDocumentListResponseSchema,
  evidenceDocumentVersionParamsSchema,
  evidenceOriginalDownloadResponseSchema,
  evidenceProductParamsSchema,
  evidenceUploadCompletionResponseSchema,
  evidenceUploadInitializationResponseSchema,
  initializeEvidenceUploadInputSchema,
  type CompleteEvidenceUploadInput,
  type EvidenceDocumentListQuery,
  type InitializeEvidenceUploadInput,
} from "@repo/contracts/evidence";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

function productPath(productId: string): `/${string}` {
  const parsed = evidenceProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The product identifier is invalid.", 400);
  }
  return `/api/v1/products/${parsed.data.productId}/evidence-documents`;
}

function completionPath(versionId: string): `/${string}` {
  const parsed = evidenceDocumentVersionParamsSchema.safeParse({
    documentId: "00000000-0000-4000-8000-000000000000",
    versionId,
  });
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The evidence version identifier is invalid.", 400);
  }
  return `/api/v1/evidence-uploads/${parsed.data.versionId}/complete`;
}

function downloadPath(documentId: string, versionId: string): `/${string}` {
  const parsed = evidenceDocumentVersionParamsSchema.safeParse({ documentId, versionId });
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The evidence document identifier is invalid.", 400);
  }
  return `/api/v1/evidence-documents/${parsed.data.documentId}/versions/${parsed.data.versionId}/download`;
}

function queryString(query: Partial<EvidenceDocumentListQuery>): string {
  const parsed = evidenceDocumentListQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The evidence query is invalid.", 400);
  }
  const parameters = new URLSearchParams();
  if (parsed.data.status) parameters.set("status", parsed.data.status);
  if (parsed.data.documentClass) parameters.set("documentClass", parsed.data.documentClass);
  if (parsed.data.cursor) parameters.set("cursor", parsed.data.cursor);
  if (parsed.data.limit !== 50) parameters.set("limit", String(parsed.data.limit));
  const value = parameters.toString();
  return value === "" ? "" : `?${value}`;
}

/** Focused gateway for parsed evidence HTTP and direct signed-storage transfer. */
export class EvidenceApi {
  list(
    productId: string,
    query: Partial<EvidenceDocumentListQuery> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof evidenceDocumentListResponseSchema
    >({
      path: `${productPath(productId)}${queryString(query)}` as `/${string}`,
      schema: evidenceDocumentListResponseSchema,
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

  complete(versionId: string, input: CompleteEvidenceUploadInput, signal?: AbortSignal) {
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

  download(documentId: string, versionId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof evidenceOriginalDownloadResponseSchema
    >({
      path: downloadPath(documentId, versionId),
      schema: evidenceOriginalDownloadResponseSchema,
      signal,
    });
  }

  uploadOriginal(uploadUrl: string, file: File, onProgress?: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PUT", uploadUrl);
      request.setRequestHeader("content-type", file.type || "application/octet-stream");
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      request.onerror = () => reject(new ApiClientError("network", "The evidence upload could not reach private storage."));
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          resolve();
          return;
        }
        reject(new ApiClientError("api", "Private storage rejected the evidence upload.", request.status));
      };
      request.send(file);
    });
  }
}

export const evidenceApi = Object.freeze(new EvidenceApi());
