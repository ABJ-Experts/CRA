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
  reportingDeadlineSummaryResponseSchema,
  acquireReportingStageDraftLockInputSchema,
  acquireReportingStageDraftLockResponseSchema,
  applyReportingFamilyTemplateInputSchema,
  approveReportingStageDraftInputSchema,
  createReportingFamilyTemplateInputSchema,
  createReportingStageDraftInputSchema,
  reportingFamilyTemplateListQuerySchema,
  reportingFamilyTemplateParamsSchema,
  reportingFamilyTemplateResponseSchema,
  reportingFamilyTemplatesResponseSchema,
  reportingStageDraftParamsSchema,
  reportingStageDraftResponseSchema,
  reportingStageSubmissionSnapshotResponseSchema,
  reportingStageDraftApprovalResponseSchema,
  reauthenticateReportingStageApprovalInputSchema,
  reauthenticateReportingStageApprovalResponseSchema,
  saveReportingStageDraftInputSchema,
  submitReportingStageDraftInputSchema,
  type CancelReportingObligationInput,
  type CorrectReportingObligationAnchorInput,
  type CreateReportingObligationInput,
  type RecordReportingObligationStageSubmissionInput,
  type ReportingObligationListQuery,
  type AcquireReportingStageDraftLockInput,
  type ApplyReportingFamilyTemplateInput,
  type CreateReportingFamilyTemplateInput,
  type CreateReportingStageDraftInput,
  type ReportingFamilyTemplateListQuery,
  type SaveReportingStageDraftInput,
  type SubmitReportingStageDraftInput,
  type ApproveReportingStageDraftInput,
  type ReauthenticateReportingStageApprovalInput,
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

function stageDraftPath(obligationId: string, stageId: string) {
  const parsed = reportingStageDraftParamsSchema.safeParse({
    obligationId,
    stageId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The reporting stage identifier is invalid.",
      400,
    );
  }
  return `/api/v1/reporting/obligations/${parsed.data.obligationId}/stages/${parsed.data.stageId}/draft` as const;
}

function familyTemplatePath(templateId?: string) {
  if (templateId === undefined) return "/api/v1/reporting/templates" as const;
  const parsed = reportingFamilyTemplateParamsSchema.safeParse({ templateId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The family template identifier is invalid.",
      400,
    );
  }
  return `/api/v1/reporting/templates/${parsed.data.templateId}` as const;
}

export const reportingApi = Object.freeze({
  deadlineSummary(signal?: AbortSignal) {
    return apiClient.request({
      path: "/api/v1/reporting/obligations/deadline-summary",
      schema: reportingDeadlineSummaryResponseSchema,
      signal,
    });
  },
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
  stageDraft(obligationId: string, stageId: string, signal?: AbortSignal) {
    return apiClient.request({
      path: stageDraftPath(obligationId, stageId),
      schema: reportingStageDraftResponseSchema,
      signal,
    });
  },
  createStageDraft(
    obligationId: string,
    stageId: string,
    input: CreateReportingStageDraftInput,
  ) {
    return apiClient.request({
      path: stageDraftPath(obligationId, stageId),
      method: "POST",
      inputSchema: createReportingStageDraftInputSchema,
      body: input,
      schema: reportingStageDraftResponseSchema,
    });
  },
  acquireStageDraftLock(
    obligationId: string,
    stageId: string,
    input: AcquireReportingStageDraftLockInput,
  ) {
    return apiClient.request({
      path: `${stageDraftPath(obligationId, stageId)}/lock`,
      method: "POST",
      inputSchema: acquireReportingStageDraftLockInputSchema,
      body: input,
      schema: acquireReportingStageDraftLockResponseSchema,
    });
  },
  saveStageDraft(
    obligationId: string,
    stageId: string,
    input: SaveReportingStageDraftInput,
  ) {
    return apiClient.request({
      path: `${stageDraftPath(obligationId, stageId)}/save`,
      method: "PATCH",
      inputSchema: saveReportingStageDraftInputSchema,
      body: input,
      schema: reportingStageDraftResponseSchema,
    });
  },
  submitStageDraft(
    obligationId: string,
    stageId: string,
    input: SubmitReportingStageDraftInput,
  ) {
    return apiClient.request({
      path: `${stageDraftPath(obligationId, stageId)}/submit`,
      method: "POST",
      inputSchema: submitReportingStageDraftInputSchema,
      body: input,
      schema: reportingStageSubmissionSnapshotResponseSchema,
    });
  },
  reauthenticateStageApproval(
    obligationId: string,
    stageId: string,
    input: ReauthenticateReportingStageApprovalInput,
  ) {
    return apiClient.request({
      path: `${stageDraftPath(obligationId, stageId)}/reauthentication`,
      method: "POST",
      inputSchema: reauthenticateReportingStageApprovalInputSchema,
      body: input,
      schema: reauthenticateReportingStageApprovalResponseSchema,
    });
  },
  approveStageDraft(
    obligationId: string,
    stageId: string,
    input: ApproveReportingStageDraftInput,
  ) {
    return apiClient.request({
      path: `${stageDraftPath(obligationId, stageId)}/approve`,
      method: "POST",
      inputSchema: approveReportingStageDraftInputSchema,
      body: input,
      schema: reportingStageDraftApprovalResponseSchema,
    });
  },
  familyTemplates(
    query: ReportingFamilyTemplateListQuery,
    signal?: AbortSignal,
  ) {
    const parsed = reportingFamilyTemplateListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid_request",
        "The family template filters are invalid.",
        400,
      );
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) params.set(key, value);
    }
    return apiClient.request({
      path: `${familyTemplatePath()}?${params.toString()}` as `/${string}`,
      schema: reportingFamilyTemplatesResponseSchema,
      signal,
    });
  },
  createFamilyTemplate(input: CreateReportingFamilyTemplateInput) {
    return apiClient.request({
      path: familyTemplatePath(),
      method: "POST",
      inputSchema: createReportingFamilyTemplateInputSchema,
      body: input,
      schema: reportingFamilyTemplateResponseSchema,
    });
  },
  applyFamilyTemplate(
    obligationId: string,
    stageId: string,
    input: ApplyReportingFamilyTemplateInput,
  ) {
    return apiClient.request({
      path: `${stageDraftPath(obligationId, stageId)}/templates/apply`,
      method: "POST",
      inputSchema: applyReportingFamilyTemplateInputSchema,
      body: input,
      schema: reportingStageDraftResponseSchema,
    });
  },
});
