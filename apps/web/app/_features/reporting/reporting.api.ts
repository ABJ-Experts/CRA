import {
  cancelReportingObligationInputSchema,
  correctReportingObligationAnchorInputSchema,
  createReportingObligationInputSchema,
  recordReportingObligationStageSubmissionInputSchema,
  reportingObligationDetailResponseSchema,
  reportingObligationListQuerySchema,
  reportingObligationListResponseSchema,
  reportingObligationMutationResponseSchema,
  reportingObligationParamsSchema,
  type CancelReportingObligationInput,
  type CorrectReportingObligationAnchorInput,
  type CreateReportingObligationInput,
  type RecordReportingObligationStageSubmissionInput,
  type ReportingObligationListQuery,
} from "@repo/contracts/reporting";

import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function obligationPath(obligationId?: string): `/${string}` {
  if (obligationId === undefined) return "/api/v1/reporting/obligations";
  const parsed = reportingObligationParamsSchema.safeParse({ obligationId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The reporting obligation identifier is invalid.",
      400,
    );
  }
  return `/api/v1/reporting/obligations/${parsed.data.obligationId}`;
}

function queryString(query: Readonly<Partial<ReportingObligationListQuery>>) {
  const parsed = reportingObligationListQuerySchema.safeParse({
    limit: 50,
    ...query,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The reporting obligation filters are invalid.",
      400,
    );
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? (`?${serialized}` as const) : "";
}

export const reportingApi = Object.freeze({
  list(
    query: Readonly<Partial<ReportingObligationListQuery>>,
    signal?: AbortSignal,
  ) {
    return apiClient.request({
      path: `${obligationPath()}${queryString(query)}` as `/${string}`,
      schema: reportingObligationListResponseSchema,
      signal,
    });
  },
  detail(obligationId: string, signal?: AbortSignal) {
    return apiClient.request({
      path: obligationPath(obligationId),
      schema: reportingObligationDetailResponseSchema,
      signal,
    });
  },
  create(input: CreateReportingObligationInput) {
    return apiClient.request({
      path: obligationPath(),
      method: "POST",
      inputSchema: createReportingObligationInputSchema,
      body: input,
      schema: reportingObligationMutationResponseSchema,
    });
  },
  correctAnchor(
    obligationId: string,
    input: CorrectReportingObligationAnchorInput,
  ) {
    return apiClient.request({
      path: `${obligationPath(obligationId)}/anchors`,
      method: "PATCH",
      inputSchema: correctReportingObligationAnchorInputSchema,
      body: input,
      schema: reportingObligationMutationResponseSchema,
    });
  },
  recordSubmission(
    obligationId: string,
    input: RecordReportingObligationStageSubmissionInput,
  ) {
    return apiClient.request({
      path: `${obligationPath(obligationId)}/stage-submissions`,
      method: "POST",
      inputSchema: recordReportingObligationStageSubmissionInputSchema,
      body: input,
      schema: reportingObligationMutationResponseSchema,
    });
  },
  cancel(obligationId: string, input: CancelReportingObligationInput) {
    return apiClient.request({
      path: `${obligationPath(obligationId)}/cancellation`,
      method: "POST",
      inputSchema: cancelReportingObligationInputSchema,
      body: input,
      schema: reportingObligationMutationResponseSchema,
    });
  },
});
