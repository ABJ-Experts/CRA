import {
  closeSupplierEvidenceRequestInputSchema,
  completeSupplierEvidencePortalUploadInputSchema,
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  issueSupplierEvidenceRequestInputSchema,
  previewSupplierEvidenceRequestInputSchema,
  reRequestSupplierEvidenceRequestInputSchema,
  reissueSupplierEvidenceRequestInputSchema,
  retrySupplierEvidenceReminderDeliveryInputSchema,
  reviewSupplierEvidenceSubmissionInputSchema,
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
  supplierEvidenceMetricsQuerySchema,
  supplierEvidenceMetricsResponseSchema,
  supplierEvidenceOverdueListQuerySchema,
  supplierEvidenceOverdueListResponseSchema,
  supplierEvidenceReminderDeliveryParamsSchema,
  supplierEvidenceReminderDeliveryResponseSchema,
  supplierEvidenceReminderSettingsInputSchema,
  supplierEvidenceReminderSettingsResponseSchema,
  supplierEvidenceRequestListQuerySchema,
  supplierEvidenceRequestParamsSchema,
  supplierEvidenceRequestResponseSchema,
  supplierEvidenceRequestsResponseSchema,
  supplierEvidenceReviewResponseSchema,
  supplierEvidenceSubmissionParamsSchema,
  startSupplierDocumentExtractionInputSchema,
  supplierDocumentExtractionQuerySchema,
  supplierDocumentExtractionResponseSchema,
  supplierDocumentFieldParamsSchema,
  supplierDocumentFieldResponseSchema,
  decideSupplierDocumentFieldInputSchema,
  createManualSupplierDocumentFieldInputSchema,
  type CloseSupplierEvidenceRequestInput,
  type CompleteSupplierEvidencePortalUploadInput,
  type CreateSupplierEvidenceRequestInput,
  type InitializeSupplierEvidencePortalUploadInput,
  type IssueSupplierEvidenceRequestInput,
  type PreviewSupplierEvidenceRequestInput,
  type ReRequestSupplierEvidenceRequestInput,
  type ReissueSupplierEvidenceRequestInput,
  type ReviewSupplierEvidenceSubmissionInput,
  type RevokeSupplierEvidenceRequestInput,
  type ReviseSupplierEvidenceRequestInput,
  type SupplierEvidencePortalSessionInput,
  type SupplierEvidenceMetricsQuery,
  type SupplierEvidenceOverdueListQuery,
  type SupplierEvidenceReminderSettingsInput,
  type RetrySupplierEvidenceReminderDeliveryInput,
  type SupplierEvidenceRequestListQuery,
  type StartSupplierDocumentExtractionInput,
  type DecideSupplierDocumentFieldInput,
  type CreateManualSupplierDocumentFieldInput,
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

function requestListPath(
  query: Partial<SupplierEvidenceRequestListQuery>,
): `/${string}` {
  const parsed = supplierEvidenceRequestListQuerySchema.safeParse(query);
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The evidence request filters are invalid.",
      400,
    );
  const search = new URLSearchParams();
  if (parsed.data.productId) search.set("productId", parsed.data.productId);
  if (parsed.data.supplierId) search.set("supplierId", parsed.data.supplierId);
  if (parsed.data.state) search.set("state", parsed.data.state);
  search.set("limit", String(parsed.data.limit));
  if (parsed.data.cursor) search.set("cursor", parsed.data.cursor);
  return `${requestPath()}?${search.toString()}`;
}

function queryPath(
  path: `/${string}`,
  values: Readonly<Record<string, string | number | undefined>>,
): `/${string}` {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.size === 0 ? path : `${path}?${search.toString()}`;
}

function reminderDeliveryPath(
  requestId: string,
  deliveryId: string,
): `/${string}` {
  const parsed = supplierEvidenceReminderDeliveryParamsSchema.safeParse({
    requestId,
    deliveryId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The reminder delivery identifier is invalid.",
      400,
    );
  return requestPath(
    parsed.data.requestId,
    `/reminder-deliveries/${parsed.data.deliveryId}/retry`,
  );
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

function submissionPath(
  requestId: string,
  submissionId: string,
  suffix = "",
): `/${string}` {
  const parsed = supplierEvidenceSubmissionParamsSchema.safeParse({
    requestId,
    submissionId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The evidence submission identifier is invalid.",
      400,
    );
  return `/api/v1/supplier-evidence-requests/${parsed.data.requestId}/submissions/${parsed.data.submissionId}${suffix}`;
}

/** Typed feature-local boundary for internal request management and public portal calls. */
export class SupplierEvidenceApi {
  list(
    query: Partial<SupplierEvidenceRequestListQuery> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: requestListPath(query),
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

  reviewDetail(requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/review"),
      schema: supplierEvidenceReviewResponseSchema,
      signal,
    });
  }

  reminderSettings(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/supplier-evidence-requests/reminder-settings",
      schema: supplierEvidenceReminderSettingsResponseSchema,
      signal,
    });
  }

  updateReminderSettings(input: SupplierEvidenceReminderSettingsInput) {
    return authenticatedRequestJson({
      path: "/api/v1/supplier-evidence-requests/reminder-settings",
      method: "PATCH",
      body: input,
      inputSchema: supplierEvidenceReminderSettingsInputSchema,
      schema: supplierEvidenceReminderSettingsResponseSchema,
    });
  }

  metrics(input: SupplierEvidenceMetricsQuery, signal?: AbortSignal) {
    const parsed = supplierEvidenceMetricsQuerySchema.safeParse(input);
    if (!parsed.success)
      throw new ApiClientError(
        "invalid_request",
        "The supplier evidence metrics window is invalid.",
        400,
      );
    return authenticatedRequestJson({
      path: queryPath(
        "/api/v1/supplier-evidence-requests/metrics",
        parsed.data,
      ),
      schema: supplierEvidenceMetricsResponseSchema,
      signal,
    });
  }

  overdue(
    query: Partial<SupplierEvidenceOverdueListQuery> = {},
    signal?: AbortSignal,
  ) {
    const parsed = supplierEvidenceOverdueListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new ApiClientError(
        "invalid_request",
        "The supplier evidence overdue filters are invalid.",
        400,
      );
    return authenticatedRequestJson({
      path: queryPath(
        "/api/v1/supplier-evidence-requests/overdue",
        parsed.data,
      ),
      schema: supplierEvidenceOverdueListResponseSchema,
      signal,
    });
  }

  retryReminder(
    requestId: string,
    deliveryId: string,
    input: RetrySupplierEvidenceReminderDeliveryInput,
  ) {
    return authenticatedRequestJson({
      path: reminderDeliveryPath(requestId, deliveryId),
      method: "POST",
      body: input,
      inputSchema: retrySupplierEvidenceReminderDeliveryInputSchema,
      schema: supplierEvidenceReminderDeliveryResponseSchema,
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

  reviewSubmission(
    requestId: string,
    submissionId: string,
    input: ReviewSupplierEvidenceSubmissionInput,
  ) {
    return authenticatedRequestJson({
      path: submissionPath(requestId, submissionId, "/review"),
      method: "POST",
      body: input,
      inputSchema: reviewSupplierEvidenceSubmissionInputSchema,
      schema: supplierEvidenceReviewResponseSchema,
    });
  }

  extraction(
    requestId: string,
    submissionId: string,
    productId: string,
    signal?: AbortSignal,
    cursor?: string,
    limit = 25,
  ) {
    const query = supplierDocumentExtractionQuerySchema.safeParse({
      productId,
      cursor,
      limit,
    });
    if (!query.success)
      throw new ApiClientError(
        "invalid_request",
        "The product identifier is invalid.",
        400,
      );
    return authenticatedRequestJson({
      path: queryPath(
        submissionPath(requestId, submissionId, "/extraction"),
        query.data,
      ),
      schema: supplierDocumentExtractionResponseSchema,
      signal,
    });
  }

  startExtraction(
    requestId: string,
    submissionId: string,
    input: StartSupplierDocumentExtractionInput,
  ) {
    return authenticatedRequestJson({
      path: submissionPath(requestId, submissionId, "/extraction-runs"),
      method: "POST",
      body: input,
      inputSchema: startSupplierDocumentExtractionInputSchema,
      schema: supplierDocumentExtractionResponseSchema,
    });
  }

  decideField(
    requestId: string,
    submissionId: string,
    fieldId: string,
    input: DecideSupplierDocumentFieldInput,
  ) {
    const parsed = supplierDocumentFieldParamsSchema.safeParse({
      requestId,
      submissionId,
      fieldId,
    });
    if (!parsed.success)
      throw new ApiClientError(
        "invalid_request",
        "The field identifier is invalid.",
        400,
      );
    return authenticatedRequestJson({
      path: submissionPath(
        requestId,
        submissionId,
        `/fields/${parsed.data.fieldId}/decision`,
      ),
      method: "POST",
      body: input,
      inputSchema: decideSupplierDocumentFieldInputSchema,
      schema: supplierDocumentFieldResponseSchema,
    });
  }

  createManualField(
    requestId: string,
    submissionId: string,
    input: CreateManualSupplierDocumentFieldInput,
  ) {
    return authenticatedRequestJson({
      path: submissionPath(requestId, submissionId, "/fields/manual"),
      method: "POST",
      body: input,
      inputSchema: createManualSupplierDocumentFieldInputSchema,
      schema: supplierDocumentFieldResponseSchema,
    });
  }

  reRequest(requestId: string, input: ReRequestSupplierEvidenceRequestInput) {
    return authenticatedRequestJson({
      path: requestPath(requestId, "/re-request"),
      method: "POST",
      body: input,
      inputSchema: reRequestSupplierEvidenceRequestInputSchema,
      schema: supplierEvidenceIssuedResponseSchema,
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
