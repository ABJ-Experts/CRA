import {
  completeSbomUploadInputSchema,
  createSbomCiCredentialInputSchema,
  createSbomCiCredentialResponseSchema,
  initializeSbomUploadInputSchema,
  replaySbomJobInputSchema,
  revokeSbomCiCredentialInputSchema,
  sbomCiCredentialListResponseSchema,
  sbomCiCredentialParamsSchema,
  sbomCiCredentialResponseSchema,
  sbomComponentSearchQuerySchema,
  sbomComponentSearchResponseSchema,
  sbomDependencyTreeQuerySchema,
  sbomDependencyTreeResponseSchema,
  sbomDocumentDetailResponseSchema,
  sbomDocumentListQuerySchema,
  sbomDocumentListResponseSchema,
  sbomDocumentParamsSchema,
  sbomJobParamsSchema,
  sbomJobResponseSchema,
  sbomOriginalDownloadResponseSchema,
  sbomSourceHistoryQuerySchema,
  sbomSourceHistoryResponseSchema,
  sbomSourceParamsSchema,
  sbomValidationReportResponseSchema,
  sbomUploadInitializationResponseSchema,
  sbomUploadParamsSchema,
  type CompleteSbomUploadInput,
  type CreateSbomCiCredentialInput,
  type InitializeSbomUploadInput,
  type ReplaySbomJobInput,
  type RevokeSbomCiCredentialInput,
  type SbomSourceHistoryQuery,
  type SbomComponentSearchQuery,
  type SbomDependencyTreeQuery,
  type SbomDocumentListQuery,
} from "@repo/contracts/sboms";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

type InitializeSbomUploadRequest = Omit<InitializeSbomUploadInput, "source"> &
  Readonly<{ source?: "manual_upload" }>;

function invalidIdentifier(message: string): ApiClientError {
  return new ApiClientError("invalid_request", message, 400);
}

function uploadPath(productId: string, releaseId: string): `/${string}` {
  const parsed = sbomUploadParamsSchema.safeParse({
    productId,
    releaseId,
    sourceId: "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success)
    throw invalidIdentifier("The release identifier is invalid.");
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}/sbom-uploads`;
}

function sourceHistoryPath(
  productId: string,
  releaseId: string,
  query: Readonly<Partial<SbomSourceHistoryQuery>>,
): `/${string}` {
  const parsed = sbomUploadParamsSchema.safeParse({
    productId,
    releaseId,
    sourceId: "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success)
    throw invalidIdentifier("The release identifier is invalid.");
  const parsedQuery = apiClient.parseInput(sbomSourceHistoryQuerySchema, query);
  const search = new URLSearchParams({ limit: String(parsedQuery.limit) });
  if (parsedQuery.cursor) search.set("cursor", parsedQuery.cursor);
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}/sbom-sources?${search.toString()}`;
}

function sourcePath(sourceId: string, suffix = ""): `/${string}` {
  const parsed = sbomSourceParamsSchema.safeParse({ sourceId });
  if (!parsed.success)
    throw invalidIdentifier("The SBOM source identifier is invalid.");
  return `/api/v1/sbom-sources/${parsed.data.sourceId}${suffix}`;
}

function completionPath(sourceId: string): `/${string}` {
  const parsed = sbomSourceParamsSchema.safeParse({ sourceId });
  if (!parsed.success)
    throw invalidIdentifier("The SBOM upload identifier is invalid.");
  return `/api/v1/sbom-uploads/${parsed.data.sourceId}/complete`;
}

function jobPath(jobId: string, suffix = ""): `/${string}` {
  const parsed = sbomJobParamsSchema.safeParse({ jobId });
  if (!parsed.success)
    throw invalidIdentifier("The SBOM job identifier is invalid.");
  return `/api/v1/sbom-jobs/${parsed.data.jobId}${suffix}`;
}

function credentialPath(credentialId: string, suffix = ""): `/${string}` {
  const parsed = sbomCiCredentialParamsSchema.safeParse({ credentialId });
  if (!parsed.success) {
    throw invalidIdentifier("The CI credential identifier is invalid.");
  }
  return `/api/v1/organizations/current/sbom-ci-credentials/${parsed.data.credentialId}${suffix}`;
}

function documentPath(documentId: string, suffix = ""): `/${string}` {
  const parsed = sbomDocumentParamsSchema.safeParse({ documentId });
  if (!parsed.success) {
    throw invalidIdentifier("The SBOM document identifier is invalid.");
  }
  return `/api/v1/sbom-documents/${parsed.data.documentId}${suffix}`;
}

function documentListPath(
  productId: string,
  releaseId: string,
  query: Readonly<Partial<SbomDocumentListQuery>>,
): `/${string}` {
  const parsed = sbomUploadParamsSchema.safeParse({
    productId,
    releaseId,
    sourceId: "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success) {
    throw invalidIdentifier("The release identifier is invalid.");
  }
  const parsedQuery = apiClient.parseInput(sbomDocumentListQuerySchema, query);
  const search = new URLSearchParams({ limit: String(parsedQuery.limit) });
  if (parsedQuery.cursor) search.set("cursor", parsedQuery.cursor);
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}/sbom-documents?${search.toString()}`;
}

function documentQueryPath(
  documentId: string,
  suffix: "/components" | "/dependency-tree",
  query: Readonly<Record<string, string | number | undefined>>,
): `/${string}` {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `${documentPath(documentId, suffix)}?${search.toString()}`;
}

/**
 * Feature gateway for parsed API calls and the one permitted external upload
 * transport. Rendering components never see unparsed API payloads or call
 * Supabase directly.
 */
export class SbomsApi {
  initializeUpload(input: InitializeSbomUploadRequest, signal?: AbortSignal) {
    const parsed = apiClient.parseInput(initializeSbomUploadInputSchema, input);
    return authenticatedRequestJson<
      typeof sbomUploadInitializationResponseSchema,
      typeof initializeSbomUploadInputSchema
    >({
      path: uploadPath(parsed.productId, parsed.releaseId),
      method: "POST",
      body: parsed,
      inputSchema: initializeSbomUploadInputSchema,
      schema: sbomUploadInitializationResponseSchema,
      signal,
    });
  }

  completeUpload(
    sourceId: string,
    input: CompleteSbomUploadInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomJobResponseSchema,
      typeof completeSbomUploadInputSchema
    >({
      path: completionPath(sourceId),
      method: "POST",
      body: input,
      inputSchema: completeSbomUploadInputSchema,
      schema: sbomJobResponseSchema,
      signal,
    });
  }

  getJob(jobId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomJobResponseSchema>({
      path: jobPath(jobId),
      schema: sbomJobResponseSchema,
      signal,
    });
  }

  listSourcesForRelease(
    productId: string,
    releaseId: string,
    query: Readonly<Partial<SbomSourceHistoryQuery>> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<typeof sbomSourceHistoryResponseSchema>({
      path: sourceHistoryPath(productId, releaseId, query),
      schema: sbomSourceHistoryResponseSchema,
      signal,
    });
  }

  downloadOriginal(sourceId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomOriginalDownloadResponseSchema>({
      path: sourcePath(sourceId, "/download"),
      schema: sbomOriginalDownloadResponseSchema,
      signal,
    });
  }

  getValidationReport(sourceId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomValidationReportResponseSchema>({
      path: sourcePath(sourceId, "/validation-report"),
      schema: sbomValidationReportResponseSchema,
      signal,
    });
  }

  listDocumentsForRelease(
    productId: string,
    releaseId: string,
    query: Readonly<Partial<SbomDocumentListQuery>> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<typeof sbomDocumentListResponseSchema>({
      path: documentListPath(productId, releaseId, query),
      schema: sbomDocumentListResponseSchema,
      signal,
    });
  }

  getDocument(documentId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomDocumentDetailResponseSchema>({
      path: documentPath(documentId),
      schema: sbomDocumentDetailResponseSchema,
      signal,
    });
  }

  searchComponents(
    documentId: string,
    query: Readonly<Partial<SbomComponentSearchQuery>> = {},
    signal?: AbortSignal,
  ) {
    const parsedQuery = apiClient.parseInput(sbomComponentSearchQuerySchema, query);
    return authenticatedRequestJson<typeof sbomComponentSearchResponseSchema>({
      path: documentQueryPath(documentId, "/components", parsedQuery),
      schema: sbomComponentSearchResponseSchema,
      signal,
    });
  }

  listDependencyTreeChildren(
    documentId: string,
    query: Readonly<Partial<SbomDependencyTreeQuery>> = {},
    signal?: AbortSignal,
  ) {
    const parsedQuery = apiClient.parseInput(sbomDependencyTreeQuerySchema, query);
    return authenticatedRequestJson<typeof sbomDependencyTreeResponseSchema>({
      path: documentQueryPath(documentId, "/dependency-tree", parsedQuery),
      schema: sbomDependencyTreeResponseSchema,
      signal,
    });
  }

  replayJob(jobId: string, input: ReplaySbomJobInput, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof sbomJobResponseSchema,
      typeof replaySbomJobInputSchema
    >({
      path: jobPath(jobId, "/replay"),
      method: "POST",
      body: input,
      inputSchema: replaySbomJobInputSchema,
      schema: sbomJobResponseSchema,
      signal,
    });
  }

  listCiCredentials(signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomCiCredentialListResponseSchema>({
      path: "/api/v1/organizations/current/sbom-ci-credentials",
      schema: sbomCiCredentialListResponseSchema,
      signal,
    });
  }

  createCiCredential(input: CreateSbomCiCredentialInput, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof createSbomCiCredentialResponseSchema,
      typeof createSbomCiCredentialInputSchema
    >({
      path: "/api/v1/organizations/current/sbom-ci-credentials",
      method: "POST",
      body: input,
      inputSchema: createSbomCiCredentialInputSchema,
      schema: createSbomCiCredentialResponseSchema,
      signal,
    });
  }

  revokeCiCredential(
    credentialId: string,
    input: RevokeSbomCiCredentialInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomCiCredentialResponseSchema,
      typeof revokeSbomCiCredentialInputSchema
    >({
      path: credentialPath(credentialId, "/revoke"),
      method: "POST",
      body: input,
      inputSchema: revokeSbomCiCredentialInputSchema,
      schema: sbomCiCredentialResponseSchema,
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
            "The SBOM upload could not reach storage.",
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
            "The SBOM upload was rejected by storage.",
            request.status,
          ),
        );
      };
      request.send(file);
    });
  }
}

export const sbomsApi = new SbomsApi();
