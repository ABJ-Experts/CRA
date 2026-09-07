import {
  createVulnerabilitySavedViewInputSchema,
  deleteVulnerabilitySavedViewInputSchema,
  approveVulnerabilityFindingAssessmentInputSchema,
  rejectVulnerabilityFindingAssessmentInputSchema,
  setDefaultVulnerabilitySavedViewInputSchema,
  submitVulnerabilityFindingAssessmentInputSchema,
  updateVulnerabilitySavedViewInputSchema,
  updateVulnerabilityAssessmentApprovalPolicyInputSchema,
  vulnerabilityAssessmentApprovalPolicyListResponseSchema,
  vulnerabilityAssessmentApprovalPolicyParamsSchema,
  vulnerabilityAssessmentApprovalPolicyResponseSchema,
  vulnerabilityFindingAssessmentMutationResponseSchema,
  vulnerabilityFindingAssessmentResponseSchema,
  vulnerabilityFindingAssessmentRevisionParamsSchema,
  vulnerabilitySavedViewMutationResponseSchema,
  vulnerabilitySavedViewParamsSchema,
  vulnerabilitySavedViewsResponseSchema,
  vulnerabilityTriageDetailResponseSchema,
  vulnerabilityTriageFindingParamsSchema,
  vulnerabilityTriageQueueQuerySchema,
  vulnerabilityTriageQueueResponseSchema,
  type CreateVulnerabilitySavedViewInput,
  type DeleteVulnerabilitySavedViewInput,
  type ApproveVulnerabilityFindingAssessmentInput,
  type RejectVulnerabilityFindingAssessmentInput,
  type SetDefaultVulnerabilitySavedViewInput,
  type SubmitVulnerabilityFindingAssessmentInput,
  type UpdateVulnerabilitySavedViewInput,
  type UpdateVulnerabilityAssessmentApprovalPolicyInput,
  type VulnerabilityTriageQueueQuery,
} from "@repo/contracts/vulnerabilities";

import { ApiClientError, apiClient } from "../../_lib/http/api-client";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

function findingPath(findingId: string): `/${string}` {
  const parsed = vulnerabilityTriageFindingParamsSchema.safeParse({
    findingId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The finding identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/${parsed.data.findingId}`;
}

function assessmentPath(findingId: string): `/${string}` {
  return `${findingPath(findingId)}/assessment`;
}

function assessmentRevisionPath(
  findingId: string,
  assessmentId: string,
): `/${string}` {
  const parsed = vulnerabilityFindingAssessmentRevisionParamsSchema.safeParse({
    findingId,
    assessmentId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The assessment identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/${parsed.data.findingId}/assessment/${parsed.data.assessmentId}`;
}

function approvalPolicyPath(severity?: string): `/${string}` {
  if (severity === undefined)
    return "/api/v1/findings/assessment-approval-policy";
  const parsed = vulnerabilityAssessmentApprovalPolicyParamsSchema.safeParse({
    severity,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The approval-policy severity is invalid.",
      400,
    );
  }
  return `/api/v1/findings/assessment-approval-policy/${parsed.data.severity}`;
}

function savedViewPath(viewId: string): `/${string}` {
  const parsed = vulnerabilitySavedViewParamsSchema.safeParse({ viewId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The saved view identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/saved-views/${parsed.data.viewId}`;
}

function appendMany(
  search: URLSearchParams,
  key: string,
  values?: readonly string[],
) {
  values?.forEach((value) => search.append(key, value));
}

function queuePath(query: VulnerabilityTriageQueueQuery): `/${string}` {
  const search = new URLSearchParams({
    limit: String(query.limit),
    sort: query.sort,
    order: query.order,
  });
  if (query.cursor) search.set("cursor", query.cursor);
  appendMany(search, "productIds", query.productIds);
  appendMany(search, "releaseIds", query.releaseIds);
  appendMany(search, "severities", query.severities);
  appendMany(search, "kevStatuses", query.kevStatuses);
  appendMany(search, "findingStates", query.findingStates);
  appendMany(search, "assessmentStates", query.assessmentStates);
  appendMany(search, "vexStatuses", query.vexStatuses);
  appendMany(search, "approvalStates", query.approvalStates);
  appendMany(search, "reEvaluationStates", query.reEvaluationStates);
  appendMany(search, "assessedByUserIds", query.assessedByUserIds);
  appendMany(search, "reachability", query.reachability);
  if (query.epssState) search.set("epssState", query.epssState);
  if (query.epssMin !== undefined) search.set("epssMin", String(query.epssMin));
  if (query.epssMax !== undefined) search.set("epssMax", String(query.epssMax));
  if (query.ageDaysMin !== undefined)
    search.set("ageDaysMin", String(query.ageDaysMin));
  if (query.ageDaysMax !== undefined)
    search.set("ageDaysMax", String(query.ageDaysMax));
  return `/api/v1/findings?${search.toString()}`;
}

/** Typed browser boundary for the tenant-scoped, server-paginated queue. */
export class VulnerabilityTriageApi {
  list(
    input: Partial<VulnerabilityTriageQueueQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(
      vulnerabilityTriageQueueQuerySchema,
      input,
    );
    return authenticatedRequestJson({
      path: queuePath(query),
      schema: vulnerabilityTriageQueueResponseSchema,
      signal,
    });
  }

  detail(findingId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: findingPath(findingId),
      schema: vulnerabilityTriageDetailResponseSchema,
      signal,
    });
  }

  assessment(findingId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: assessmentPath(findingId),
      schema: vulnerabilityFindingAssessmentResponseSchema,
      signal,
    });
  }

  submitAssessment(
    findingId: string,
    input: SubmitVulnerabilityFindingAssessmentInput,
  ) {
    return authenticatedRequestJson({
      path: assessmentPath(findingId),
      method: "POST",
      inputSchema: submitVulnerabilityFindingAssessmentInputSchema,
      body: input,
      schema: vulnerabilityFindingAssessmentMutationResponseSchema,
    });
  }

  approveAssessment(
    findingId: string,
    assessmentId: string,
    input: ApproveVulnerabilityFindingAssessmentInput,
  ) {
    return authenticatedRequestJson({
      path: `${assessmentRevisionPath(findingId, assessmentId)}/approve`,
      method: "POST",
      inputSchema: approveVulnerabilityFindingAssessmentInputSchema,
      body: input,
      schema: vulnerabilityFindingAssessmentMutationResponseSchema,
    });
  }

  rejectAssessment(
    findingId: string,
    assessmentId: string,
    input: RejectVulnerabilityFindingAssessmentInput,
  ) {
    return authenticatedRequestJson({
      path: `${assessmentRevisionPath(findingId, assessmentId)}/reject`,
      method: "POST",
      inputSchema: rejectVulnerabilityFindingAssessmentInputSchema,
      body: input,
      schema: vulnerabilityFindingAssessmentMutationResponseSchema,
    });
  }

  assessmentApprovalPolicy(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: approvalPolicyPath(),
      schema: vulnerabilityAssessmentApprovalPolicyListResponseSchema,
      signal,
    });
  }

  updateAssessmentApprovalPolicy(
    severity: string,
    input: UpdateVulnerabilityAssessmentApprovalPolicyInput,
  ) {
    return authenticatedRequestJson({
      path: approvalPolicyPath(severity),
      method: "PUT",
      inputSchema: updateVulnerabilityAssessmentApprovalPolicyInputSchema,
      body: input,
      schema: vulnerabilityAssessmentApprovalPolicyResponseSchema,
    });
  }

  listSavedViews(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/saved-views",
      schema: vulnerabilitySavedViewsResponseSchema,
      signal,
    });
  }

  createSavedView(input: CreateVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/saved-views",
      method: "POST",
      inputSchema: createVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }

  updateSavedView(viewId: string, input: UpdateVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: savedViewPath(viewId),
      method: "PATCH",
      inputSchema: updateVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }

  deleteSavedView(viewId: string, input: DeleteVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: savedViewPath(viewId),
      method: "DELETE",
      inputSchema: deleteVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }

  setDefaultSavedView(input: SetDefaultVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/saved-views/default",
      method: "PUT",
      inputSchema: setDefaultVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }
}

export const vulnerabilityTriageApi = Object.freeze(
  new VulnerabilityTriageApi(),
);
