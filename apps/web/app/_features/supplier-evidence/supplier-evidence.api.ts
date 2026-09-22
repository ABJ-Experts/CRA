import {
  closeSupplierEvidenceRequestInputSchema,
  completeSupplierEvidencePortalUploadInputSchema,
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  issueSupplierEvidenceRequestInputSchema,
  previewSupplierEvidenceRequestInputSchema,
  reissueSupplierEvidenceRequestInputSchema,
  revokeSupplierEvidenceRequestInputSchema,
  reviseSupplierEvidenceRequestInputSchema,
  supplierEvidenceIssuedResponseSchema,
  supplierEvidencePortalSessionInputSchema,
  supplierEvidencePortalSessionResponseSchema,
  supplierEvidencePortalRequestSchema,
  supplierEvidencePortalSubmissionParamsSchema,
  supplierEvidencePortalUploadCompletionResponseSchema,
  supplierEvidencePortalUploadInitializationResponseSchema,
  supplierEvidencePreviewResponseSchema,
  supplierEvidenceRequestParamsSchema,
  supplierEvidenceRequestResponseSchema,
  supplierEvidenceRequestsResponseSchema,
  type CloseSupplierEvidenceRequestInput,
  type CompleteSupplierEvidencePortalUploadInput,
  type CreateSupplierEvidenceRequestInput,
  type InitializeSupplierEvidencePortalUploadInput,
  type IssueSupplierEvidenceRequestInput,
  type PreviewSupplierEvidenceRequestInput,
  type ReissueSupplierEvidenceRequestInput,
  type RevokeSupplierEvidenceRequestInput,
  type ReviseSupplierEvidenceRequestInput,
  type SupplierEvidencePortalSessionInput,
} from "@repo/contracts/supplier-evidence";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, requestJson } from "../../_lib/http/api-client";

function requestPath(requestId?: string, suffix = ""): `/${string}` {
  if (requestId === undefined) return "/api/v1/supplier-evidence-requests";
  const parsed = supplierEvidenceRequestParamsSchema.safeParse({ requestId });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The evidence request identifier is invalid.",
      400,
    );
  return `/api/v1/supplier-evidence-requests/${parsed.data.requestId}${suffix}`;
}

function portalSubmissionPath(versionId: string, suffix = ""): `/${string}` {
  const parsed = supplierEvidencePortalSubmissionParamsSchema.safeParse({
    versionId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The portal submission identifier is invalid.",
      400,
    );
  return `/api/v1/supplier-evidence-portal/submissions/${parsed.data.versionId}${suffix}`;
}

/** Typed feature-local boundary for internal request management and public portal calls. */
export class SupplierEvidenceApi {
  list(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: requestPath(),
      schema: supplierEvidenceRequestsResponseSchema,
      signal,
    });
  }

  detail(requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: requestPath(requestId),
      schema: supplierEvidenceRequestResponseSchema,
      signal,
    });
  }

  create(input: CreateSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(),
      method: "POST",
      body: input,
      inputSchema: createSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceRequestResponseSchema,
    });
  }

  preview(input: PreviewSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: "/api/v1/supplier-evidence-requests/preview",
      method: "POST",
      body: input,
      inputSchema: previewSupplierEvidenceRequestInputSchema,
      schema: supplierEvidencePreviewResponseSchema,
    });
  }

  revise(requestId: string, input: ReviseSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/revise"),
      method: "POST",
      body: input,
      inputSchema: reviseSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceRequestResponseSchema,
    });
  }

  issue(requestId: string, input: IssueSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/issue"),
      method: "POST",
      body: input,
      inputSchema: issueSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceIssuedResponseSchema,
    });
  }

  reissue(requestId: string, input: ReissueSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/reissue"),
      method: "POST",
      body: input,
      inputSchema: reissueSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceIssuedResponseSchema,
    });
  }

  revoke(requestId: string, input: RevokeSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/revoke"),
      method: "POST",
      body: input,
      inputSchema: revokeSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceRequestResponseSchema,
    });
  }

  close(requestId: string, input: CloseSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/close"),
      method: "POST",
      body: input,
      inputSchema: closeSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceRequestResponseSchema,
    });
  }

  /** Invitation redemption is one-shot; the raw invitation never enters local storage. */
  openPortal(input: SupplierEvidencePortalSessionInput, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/supplier-evidence-portal/sessions",
      method: "POST",
      body: input,
      inputSchema: supplierEvidencePortalSessionInputSchema,
      schema: supplierEvidencePortalSessionResponseSchema,
      signal,
    });
  }

  /** Revalidates an existing scoped session without putting its bearer in a URL. */
  portalRequest(sessionToken: string, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/supplier-evidence-portal/request",
      schema: supplierEvidencePortalRequestSchema,
      signal,
      credentials: "omit",
      headers: { "x-supplier-evidence-session": sessionToken },
    });
  }

  initializePortalUpload(
    input: InitializeSupplierEvidencePortalUploadInput,
    signal?: AbortSignal,
  ) {
    return requestJson({
      path: "/api/v1/supplier-evidence-portal/submissions",
      method: "POST",
      body: input,
      inputSchema: initializeSupplierEvidencePortalUploadInputSchema,
      schema: supplierEvidencePortalUploadInitializationResponseSchema,
      signal,
    });
  }

  completePortalUpload(
    versionId: string,
    input: CompleteSupplierEvidencePortalUploadInput,
    signal?: AbortSignal,
  ) {
    return requestJson({
      path: portalSubmissionPath(versionId, "/complete"),
      method: "POST",
      body: input,
      inputSchema: completeSupplierEvidencePortalUploadInputSchema,
      schema: supplierEvidencePortalUploadCompletionResponseSchema,
      signal,
    });
  }

  uploadPrivateObject(
    uploadUrl: string,
    file: File,
    onProgress?: (value: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const abort = () => request.abort();
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
            "The private upload could not reach storage.",
          ),
        );
      request.onabort = () =>
        reject(new ApiClientError("network", "The upload was cancelled."));
      request.onload = () =>
        request.status >= 200 && request.status < 300
          ? resolve()
          : reject(
              new ApiClientError(
                "api",
                "Private storage rejected the upload.",
                request.status,
              ),
            );
      signal?.addEventListener("abort", abort, { once: true });
      request.onloadend = () => signal?.removeEventListener("abort", abort);
      request.send(file);
    });
  }
}

export const supplierEvidenceApi = Object.freeze(new SupplierEvidenceApi());
