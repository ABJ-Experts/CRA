import {
  completeSbomUploadInputSchema,
  createSbomCompositeReviewInputSchema,
  createSbomDiffInputSchema,
  createSupplierSbomInvitationInputSchema,
  createSupplierSbomInvitationResponseSchema,
  createSupplierSbomRequestInputSchema,
  createSbomCiCredentialInputSchema,
  createSbomCiCredentialResponseSchema,
  initializeSbomUploadInputSchema,
  generateSbomCompositeInputSchema,
  replaySbomJobInputSchema,
  resolveSbomCompositeConflictInputSchema,
  resolveSbomCompositeRelationshipInputSchema,
  reviewSupplierSbomSubmissionInputSchema,
  retrySbomDiffInputSchema,
  revokeSbomCiCredentialInputSchema,
  sbomCiCredentialListResponseSchema,
  sbomCiCredentialParamsSchema,
  sbomCiCredentialResponseSchema,
  sbomCompositeConflictParamsSchema,
  sbomCompositeGenerationResponseSchema,
  sbomCompositeRelationshipParamsSchema,
  sbomCompositeReleaseParamsSchema,
  sbomCompositeReviewParamsSchema,
  sbomCompositeReviewResponseSchema,
  sbomComponentSearchQuerySchema,
  sbomComponentSearchResponseSchema,
  sbomDependencyTreeQuerySchema,
  sbomDependencyTreeResponseSchema,
  sbomDiffComponentsQuerySchema,
  sbomDiffComponentsResponseSchema,
  sbomDiffFindingsQuerySchema,
  sbomDiffFindingsResponseSchema,
  sbomDiffParamsSchema,
  sbomDiffReportResponseSchema,
  sbomDiffStartResponseSchema,
  sbomDocumentDetailResponseSchema,
  sbomDocumentListQuerySchema,
  sbomDocumentListResponseSchema,
  sbomDocumentParamsSchema,
  sbomJobParamsSchema,
  sbomJobResponseSchema,
  sbomOriginalDownloadResponseSchema,
  sbomQualityFindingsQuerySchema,
  sbomQualityFindingsResponseSchema,
  sbomQualityReportResponseSchema,
  sbomSourceDiffQuerySchema,
  sbomSourceDiffResponseSchema,
  sbomSourceHistoryQuerySchema,
  sbomSourceHistoryResponseSchema,
  sbomSourceParamsSchema,
  sbomSupplierRequestParamsSchema,
  sbomSupplierRequestReleaseParamsSchema,
  sbomSupplierSubmissionParamsSchema,
  sbomValidationReportResponseSchema,
  supplierSbomRequestResponseSchema,
  supplierSbomRequestsQuerySchema,
  supplierSbomRequestsResponseSchema,
  supplierSbomSubmissionResponseSchema,
  sbomUploadInitializationResponseSchema,
  sbomUploadParamsSchema,
  type CompleteSbomUploadInput,
  type CreateSbomCompositeReviewInput,
  type CreateSbomDiffInput,
  type CreateSupplierSbomInvitationInput,
  type CreateSupplierSbomRequestInput,
  type CreateSbomCiCredentialInput,
  type InitializeSbomUploadInput,
  type GenerateSbomCompositeInput,
  type ReplaySbomJobInput,
  type ResolveSbomCompositeConflictInput,
  type ResolveSbomCompositeRelationshipInput,
  type ReviewSupplierSbomSubmissionInput,
  type SupplierSbomRequestsQuery,
  type RetrySbomDiffInput,
  type RevokeSbomCiCredentialInput,
  type SbomSourceHistoryQuery,
  type SbomComponentSearchQuery,
  type SbomDependencyTreeQuery,
  type SbomDiffComponentsQuery,
  type SbomDiffFindingsQuery,
  type SbomDocumentListQuery,
  type SbomQualityFindingsQuery,
  type SbomSourceDiffQuery,
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

function diffPath(diffId: string, suffix = ""): `/${string}` {
  const parsed = sbomDiffParamsSchema.safeParse({ diffId });
  if (!parsed.success)
    throw invalidIdentifier("The SBOM diff identifier is invalid.");
  return `/api/v1/sbom-diffs/${parsed.data.diffId}${suffix}`;
}

function compositeReleasePath(
  productId: string,
  releaseId: string,
): `/${string}` {
  const parsed = sbomCompositeReleaseParamsSchema.safeParse({
    productId,
    releaseId,
  });
  if (!parsed.success) {
    throw invalidIdentifier("The release identifier is invalid.");
  }
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}/sbom-composite-reviews`;
}

function compositeReviewPath(reviewId: string, suffix = ""): `/${string}` {
  const parsed = sbomCompositeReviewParamsSchema.safeParse({ reviewId });
  if (!parsed.success) {
    throw invalidIdentifier("The composite review identifier is invalid.");
  }
  return `/api/v1/sbom-composite-reviews/${parsed.data.reviewId}${suffix}`;
}

function compositeConflictPath(
  reviewId: string,
  conflictId: string,
): `/${string}` {
  const parsed = sbomCompositeConflictParamsSchema.safeParse({
    reviewId,
    conflictId,
  });
  if (!parsed.success) {
    throw invalidIdentifier("The composite conflict identifier is invalid.");
  }
  return `/api/v1/sbom-composite-reviews/${parsed.data.reviewId}/conflicts/${parsed.data.conflictId}/resolve`;
}

function compositeRelationshipPath(
  reviewId: string,
  relationshipId: string,
): `/${string}` {
  const parsed = sbomCompositeRelationshipParamsSchema.safeParse({
    reviewId,
    relationshipId,
  });
  if (!parsed.success) {
    throw invalidIdentifier(
      "The composite relationship identifier is invalid.",
    );
  }
  return `/api/v1/sbom-composite-reviews/${parsed.data.reviewId}/relationships/${parsed.data.relationshipId}/resolve`;
}

function supplierRequestReleasePath(
  productId: string,
  releaseId: string,
): `/${string}` {
  const parsed = sbomSupplierRequestReleaseParamsSchema.safeParse({
    productId,
    releaseId,
  });
  if (!parsed.success) {
    throw invalidIdentifier(
      "The supplier request release identifier is invalid.",
    );
  }
  return `/api/v1/products/${parsed.data.productId}/releases/${parsed.data.releaseId}/supplier-sbom-requests`;
}

function supplierRequestPath(requestId: string, suffix = ""): `/${string}` {
  const parsed = sbomSupplierRequestParamsSchema.safeParse({ requestId });
  if (!parsed.success) {
    throw invalidIdentifier("The supplier request identifier is invalid.");
  }
  return `/api/v1/supplier-sbom-requests/${parsed.data.requestId}${suffix}`;
}

function supplierSubmissionPath(
  submissionId: string,
  suffix = "",
): `/${string}` {
  const parsed = sbomSupplierSubmissionParamsSchema.safeParse({ submissionId });
  if (!parsed.success) {
    throw invalidIdentifier("The supplier submission identifier is invalid.");
  }
  return `/api/v1/supplier-sbom-submissions/${parsed.data.submissionId}${suffix}`;
}

function supplierRequestsPath(
  query: Readonly<Partial<SupplierSbomRequestsQuery>>,
): `/${string}` {
  const parsed = apiClient.parseInput(supplierSbomRequestsQuerySchema, query);
  const search = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) search.set("cursor", parsed.cursor);
  if (parsed.productId) search.set("productId", parsed.productId);
  if (parsed.releaseId) search.set("releaseId", parsed.releaseId);
  if (parsed.state) search.set("state", parsed.state);
  return `/api/v1/supplier-sbom-requests?${search.toString()}`;
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
  createCompositeReview(
    productId: string,
    releaseId: string,
    input: CreateSbomCompositeReviewInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomCompositeReviewResponseSchema,
      typeof createSbomCompositeReviewInputSchema
    >({
      path: compositeReleasePath(productId, releaseId),
      method: "POST",
      body: input,
      inputSchema: createSbomCompositeReviewInputSchema,
      schema: sbomCompositeReviewResponseSchema,
      signal,
    });
  }

  getCompositeReview(reviewId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomCompositeReviewResponseSchema>({
      path: compositeReviewPath(reviewId),
      schema: sbomCompositeReviewResponseSchema,
      signal,
    });
  }

  resolveCompositeConflict(
    reviewId: string,
    conflictId: string,
    input: ResolveSbomCompositeConflictInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomCompositeReviewResponseSchema,
      typeof resolveSbomCompositeConflictInputSchema
    >({
      path: compositeConflictPath(reviewId, conflictId),
      method: "POST",
      body: input,
      inputSchema: resolveSbomCompositeConflictInputSchema,
      schema: sbomCompositeReviewResponseSchema,
      signal,
    });
  }

  resolveCompositeRelationship(
    reviewId: string,
    relationshipId: string,
    input: ResolveSbomCompositeRelationshipInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomCompositeReviewResponseSchema,
      typeof resolveSbomCompositeRelationshipInputSchema
    >({
      path: compositeRelationshipPath(reviewId, relationshipId),
      method: "POST",
      body: input,
      inputSchema: resolveSbomCompositeRelationshipInputSchema,
      schema: sbomCompositeReviewResponseSchema,
      signal,
    });
  }

  generateComposite(
    reviewId: string,
    input: GenerateSbomCompositeInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomCompositeGenerationResponseSchema,
      typeof generateSbomCompositeInputSchema
    >({
      path: compositeReviewPath(reviewId, "/generate"),
      method: "POST",
      body: input,
      inputSchema: generateSbomCompositeInputSchema,
      schema: sbomCompositeGenerationResponseSchema,
      signal,
    });
  }

  createSupplierRequest(
    productId: string,
    releaseId: string,
    input: CreateSupplierSbomRequestInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof supplierSbomRequestResponseSchema,
      typeof createSupplierSbomRequestInputSchema
    >({
      path: supplierRequestReleasePath(productId, releaseId),
      method: "POST",
      body: input,
      inputSchema: createSupplierSbomRequestInputSchema,
      schema: supplierSbomRequestResponseSchema,
      signal,
    });
  }

  listSupplierRequests(
    query: Readonly<Partial<SupplierSbomRequestsQuery>> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<typeof supplierSbomRequestsResponseSchema>({
      path: supplierRequestsPath(query),
      schema: supplierSbomRequestsResponseSchema,
      signal,
    });
  }

  createSupplierInvitation(
    requestId: string,
    input: CreateSupplierSbomInvitationInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof createSupplierSbomInvitationResponseSchema,
      typeof createSupplierSbomInvitationInputSchema
    >({
      path: supplierRequestPath(requestId, "/invitations"),
      method: "POST",
      body: input,
      inputSchema: createSupplierSbomInvitationInputSchema,
      schema: createSupplierSbomInvitationResponseSchema,
      signal,
    });
  }

  reviewSupplierSubmission(
    submissionId: string,
    input: ReviewSupplierSbomSubmissionInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof supplierSbomSubmissionResponseSchema,
      typeof reviewSupplierSbomSubmissionInputSchema
    >({
      path: supplierSubmissionPath(submissionId, "/review"),
      method: "POST",
      body: input,
      inputSchema: reviewSupplierSbomSubmissionInputSchema,
      schema: supplierSbomSubmissionResponseSchema,
      signal,
    });
  }

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

  getQualityReport(sourceId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomQualityReportResponseSchema>({
      path: sourcePath(sourceId, "/quality-report"),
      schema: sbomQualityReportResponseSchema,
      signal,
    });
  }

  startDiff(
    sourceId: string,
    input: CreateSbomDiffInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson<
      typeof sbomDiffStartResponseSchema,
      typeof createSbomDiffInputSchema
    >({
      path: sourcePath(sourceId, "/diff"),
      method: "POST",
      body: input,
      inputSchema: createSbomDiffInputSchema,
      schema: sbomDiffStartResponseSchema,
      signal,
    });
  }

  getSourceDiff(
    sourceId: string,
    query: Readonly<Partial<SbomSourceDiffQuery>> = {},
    signal?: AbortSignal,
  ) {
    const parsedQuery = apiClient.parseInput(sbomSourceDiffQuerySchema, query);
    const search = new URLSearchParams();
    if (parsedQuery.baseSourceId) {
      search.set("baseSourceId", parsedQuery.baseSourceId);
    }
    const suffix = search.size === 0 ? "/diff" : `/diff?${search.toString()}`;
    return authenticatedRequestJson<typeof sbomSourceDiffResponseSchema>({
      path: sourcePath(sourceId, suffix),
      schema: sbomSourceDiffResponseSchema,
      signal,
    });
  }

  getDiff(diffId: string, signal?: AbortSignal) {
    return authenticatedRequestJson<typeof sbomDiffReportResponseSchema>({
      path: diffPath(diffId),
      schema: sbomDiffReportResponseSchema,
      signal,
    });
  }

  listDiffComponents(
    diffId: string,
    query: Readonly<Partial<SbomDiffComponentsQuery>> = {},
    signal?: AbortSignal,
  ) {
    const parsedQuery = apiClient.parseInput(
      sbomDiffComponentsQuerySchema,
      query,
    );
    const search = new URLSearchParams({ limit: String(parsedQuery.limit) });
    if (parsedQuery.cursor) search.set("cursor", parsedQuery.cursor);
    if (parsedQuery.change) search.set("change", parsedQuery.change);
    if (parsedQuery.ecosystem) search.set("ecosystem", parsedQuery.ecosystem);
    if (parsedQuery.q) search.set("q", parsedQuery.q);
    return authenticatedRequestJson<typeof sbomDiffComponentsResponseSchema>({
      path: diffPath(diffId, `/components?${search.toString()}`),
      schema: sbomDiffComponentsResponseSchema,
      signal,
    });
  }

  listDiffFindings(
    diffId: string,
    query: Readonly<Partial<SbomDiffFindingsQuery>> = {},
    signal?: AbortSignal,
  ) {
    const parsedQuery = apiClient.parseInput(
      sbomDiffFindingsQuerySchema,
      query,
    );
    const search = new URLSearchParams({ limit: String(parsedQuery.limit) });
    if (parsedQuery.cursor) search.set("cursor", parsedQuery.cursor);
    return authenticatedRequestJson<typeof sbomDiffFindingsResponseSchema>({
      path: diffPath(diffId, `/findings?${search.toString()}`),
      schema: sbomDiffFindingsResponseSchema,
      signal,
    });
  }

  retryDiff(diffId: string, input: RetrySbomDiffInput, signal?: AbortSignal) {
    return authenticatedRequestJson<
      typeof sbomDiffStartResponseSchema,
      typeof retrySbomDiffInputSchema
    >({
      path: diffPath(diffId, "/retry"),
      method: "POST",
      body: input,
      inputSchema: retrySbomDiffInputSchema,
      schema: sbomDiffStartResponseSchema,
      signal,
    });
  }

  listQualityFindings(
    sourceId: string,
    query: Readonly<Partial<SbomQualityFindingsQuery>> = {},
    signal?: AbortSignal,
  ) {
    const parsedQuery = apiClient.parseInput(
      sbomQualityFindingsQuerySchema,
      query,
    );
    const search = new URLSearchParams({ limit: String(parsedQuery.limit) });
    if (parsedQuery.cursor) search.set("cursor", parsedQuery.cursor);
    if (parsedQuery.severity) search.set("severity", parsedQuery.severity);
    if (parsedQuery.kind) search.set("kind", parsedQuery.kind);
    return authenticatedRequestJson<typeof sbomQualityFindingsResponseSchema>({
      path: sourcePath(sourceId, `/quality-findings?${search.toString()}`),
      schema: sbomQualityFindingsResponseSchema,
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
    const parsedQuery = apiClient.parseInput(
      sbomComponentSearchQuerySchema,
      query,
    );
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
    const parsedQuery = apiClient.parseInput(
      sbomDependencyTreeQuerySchema,
      query,
    );
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
