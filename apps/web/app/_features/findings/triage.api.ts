import {
  createVulnerabilitySavedViewInputSchema,
  createVulnerabilityAssessmentBulkPreviewInputSchema,
  createVulnerabilityAssessmentPropagationPreviewInputSchema,
  deleteVulnerabilitySavedViewInputSchema,
  executeVulnerabilityAssessmentBulkOperationInputSchema,
  approveVulnerabilityFindingAssessmentInputSchema,
  rejectVulnerabilityFindingAssessmentInputSchema,
  setDefaultVulnerabilitySavedViewInputSchema,
  retryVulnerabilityAssessmentBulkOperationInputSchema,
  submitVulnerabilityFindingAssessmentInputSchema,
  updateVulnerabilitySavedViewInputSchema,
  updateVulnerabilityAssessmentApprovalPolicyInputSchema,
  undoVulnerabilityAssessmentBulkOperationInputSchema,
  assignVulnerabilityTriageFindingInputSchema,
  correctVulnerabilityRemediationAnchorInputSchema,
  recordVulnerabilityRemediationAnchorInputSchema,
  suppressVulnerabilityTriageFindingInputSchema,
  updateVulnerabilityTriageSlaPolicyInputSchema,
  createVulnerabilityVexExportInputSchema,
  enqueueVulnerabilityVexPublicationInputSchema,
  previewVulnerabilityVexExportQuerySchema,
  retryVulnerabilityVexPublicationInputSchema,
  updateVulnerabilityVexPublicationTargetInputSchema,
  vulnerabilityVexExportListResponseSchema,
  vulnerabilityVexExportDownloadResponseSchema,
  vulnerabilityVexExportParamsSchema,
  vulnerabilityVexExportPreviewSchema,
  vulnerabilityVexExportResponseSchema,
  vulnerabilityVexPublicationJobParamsSchema,
  vulnerabilityVexPublicationListResponseSchema,
  vulnerabilityVexPublicationResponseSchema,
  vulnerabilityVexPublicationTargetListResponseSchema,
  vulnerabilityVexPublicationTargetKeyParamsSchema,
  vulnerabilityVexPublicationTargetResponseSchema,
  withdrawVulnerabilityVexPublicationInputSchema,
  vulnerabilityAssessmentBulkOperationMutationResponseSchema,
  vulnerabilityAssessmentBulkOperationParamsSchema,
  vulnerabilityAssessmentBulkOperationResponseSchema,
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
  vulnerabilityTriageOperationalMutationResponseSchema,
  vulnerabilityTriageSlaPoliciesResponseSchema,
  vulnerabilityTriageSlaPolicyMutationResponseSchema,
  vulnerabilityRemediationHistoryResponseSchema,
  vulnerabilityRemediationMutationResponseSchema,
  type CreateVulnerabilitySavedViewInput,
  type CreateVulnerabilityAssessmentBulkPreviewInput,
  type CreateVulnerabilityAssessmentPropagationPreviewInput,
  type DeleteVulnerabilitySavedViewInput,
  type ExecuteVulnerabilityAssessmentBulkOperationInput,
  type ApproveVulnerabilityFindingAssessmentInput,
  type RejectVulnerabilityFindingAssessmentInput,
  type SetDefaultVulnerabilitySavedViewInput,
  type RetryVulnerabilityAssessmentBulkOperationInput,
  type SubmitVulnerabilityFindingAssessmentInput,
  type UpdateVulnerabilitySavedViewInput,
  type UpdateVulnerabilityAssessmentApprovalPolicyInput,
  type UndoVulnerabilityAssessmentBulkOperationInput,
  type AssignVulnerabilityTriageFindingInput,
  type CorrectVulnerabilityRemediationAnchorInput,
  type RecordVulnerabilityRemediationAnchorInput,
  type SuppressVulnerabilityTriageFindingInput,
  type UpdateVulnerabilityTriageSlaPolicyInput,
  type VulnerabilityTriageQueueQuery,
  type CreateVulnerabilityVexExportInput,
  type EnqueueVulnerabilityVexPublicationInput,
  type PreviewVulnerabilityVexExportQuery,
  type RetryVulnerabilityVexPublicationInput,
  type UpdateVulnerabilityVexPublicationTargetInput,
  type WithdrawVulnerabilityVexPublicationInput,
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

function bulkOperationPath(operationId: string): `/${string}` {
  const parsed = vulnerabilityAssessmentBulkOperationParamsSchema.safeParse({
    operationId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The bulk operation identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/assessment-bulk/${parsed.data.operationId}`;
}

function vexExportPath(exportId: string): `/${string}` {
  const parsed = vulnerabilityVexExportParamsSchema.safeParse({ exportId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The VEX export identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/vex-exports/${parsed.data.exportId}`;
}

function vexPublicationPath(publicationId: string): `/${string}` {
  const parsed = vulnerabilityVexPublicationJobParamsSchema.safeParse({
    publicationId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The VEX publication identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/vex-exports/publications/${parsed.data.publicationId}`;
}

function vexPublicationTargetPath(targetKey: string): `/${string}` {
  const parsed = vulnerabilityVexPublicationTargetKeyParamsSchema.safeParse({
    targetKey,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The VEX publication target is invalid.",
      400,
    );
  }
  return `/api/v1/findings/vex-exports/publication-targets/${parsed.data.targetKey}`;
}

function vexPreviewPath(
  query: PreviewVulnerabilityVexExportQuery,
): `/${string}` {
  const search = new URLSearchParams({
    productId: query.productId,
    releaseId: query.releaseId,
  });
  return `/api/v1/findings/vex-exports/preview?${search.toString()}`;
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
  appendMany(search, "suppressionStates", query.suppressionStates);
  appendMany(search, "internalSlaStates", query.internalSlaStates);
  appendMany(
    search,
    "notificationDeliveryStates",
    query.notificationDeliveryStates,
  );
  appendMany(search, "remediationStates", query.remediationStates);
  appendMany(search, "reintroductionStates", query.reintroductionStates);
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
  vexExportPreview(
    input: PreviewVulnerabilityVexExportQuery,
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(
      previewVulnerabilityVexExportQuerySchema,
      input,
    );
    return authenticatedRequestJson({
      path: vexPreviewPath(query),
      schema: vulnerabilityVexExportPreviewSchema,
      signal,
    });
  }

  vexExports(input: PreviewVulnerabilityVexExportQuery, signal?: AbortSignal) {
    const query = apiClient.parseInput(
      previewVulnerabilityVexExportQuerySchema,
      input,
    );
    const search = new URLSearchParams({
      productId: query.productId,
      releaseId: query.releaseId,
    });
    return authenticatedRequestJson({
      path: `/api/v1/findings/vex-exports?${search.toString()}`,
      schema: vulnerabilityVexExportListResponseSchema,
      signal,
    });
  }

  createVexExport(input: CreateVulnerabilityVexExportInput) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/vex-exports",
      method: "POST",
      inputSchema: createVulnerabilityVexExportInputSchema,
      body: input,
      schema: vulnerabilityVexExportResponseSchema,
    });
  }

  vexExportDownload(exportId: string) {
    return authenticatedRequestJson({
      path: `${vexExportPath(exportId)}/download`,
      schema: vulnerabilityVexExportDownloadResponseSchema,
    });
  }

  vexPublicationTargets(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/vex-exports/publication-targets",
      schema: vulnerabilityVexPublicationTargetListResponseSchema,
      signal,
    });
  }

  updateVexPublicationTarget(
    input: UpdateVulnerabilityVexPublicationTargetInput,
  ) {
    const parsed = apiClient.parseInput(
      updateVulnerabilityVexPublicationTargetInputSchema,
      input,
    );
    return authenticatedRequestJson({
      path: vexPublicationTargetPath(parsed.targetKey),
      method: "PUT",
      inputSchema: updateVulnerabilityVexPublicationTargetInputSchema,
      body: parsed,
      schema: vulnerabilityVexPublicationTargetResponseSchema,
    });
  }

  vexPublications(exportId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${vexExportPath(exportId)}/publications`,
      schema: vulnerabilityVexPublicationListResponseSchema,
      signal,
    });
  }

  enqueueVexPublication(
    exportId: string,
    input: EnqueueVulnerabilityVexPublicationInput,
  ) {
    return authenticatedRequestJson({
      path: `${vexExportPath(exportId)}/publications`,
      method: "POST",
      inputSchema: enqueueVulnerabilityVexPublicationInputSchema,
      body: input,
      schema: vulnerabilityVexPublicationResponseSchema,
    });
  }

  retryVexPublication(
    publicationId: string,
    input: RetryVulnerabilityVexPublicationInput,
  ) {
    return authenticatedRequestJson({
      path: `${vexPublicationPath(publicationId)}/retry`,
      method: "POST",
      inputSchema: retryVulnerabilityVexPublicationInputSchema,
      body: input,
      schema: vulnerabilityVexPublicationResponseSchema,
    });
  }

  withdrawVexPublication(
    publicationId: string,
    input: WithdrawVulnerabilityVexPublicationInput,
  ) {
    return authenticatedRequestJson({
      path: `${vexPublicationPath(publicationId)}/withdraw`,
      method: "POST",
      inputSchema: withdrawVulnerabilityVexPublicationInputSchema,
      body: input,
      schema: vulnerabilityVexPublicationResponseSchema,
    });
  }

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

  assign(findingId: string, input: AssignVulnerabilityTriageFindingInput) {
    return authenticatedRequestJson({
      path: `${findingPath(findingId)}/assignee`,
      method: "PATCH",
      inputSchema: assignVulnerabilityTriageFindingInputSchema,
      body: input,
      schema: vulnerabilityTriageOperationalMutationResponseSchema,
    });
  }

  suppress(findingId: string, input: SuppressVulnerabilityTriageFindingInput) {
    return authenticatedRequestJson({
      path: `${findingPath(findingId)}/suppression`,
      method: "POST",
      inputSchema: suppressVulnerabilityTriageFindingInputSchema,
      body: input,
      schema: vulnerabilityTriageOperationalMutationResponseSchema,
    });
  }

  remediationHistory(findingId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${findingPath(findingId)}/remediation`,
      schema: vulnerabilityRemediationHistoryResponseSchema,
      signal,
    });
  }

  recordRemediation(
    findingId: string,
    input: RecordVulnerabilityRemediationAnchorInput,
  ) {
    return authenticatedRequestJson({
      path: `${findingPath(findingId)}/remediation`,
      method: "POST",
      inputSchema: recordVulnerabilityRemediationAnchorInputSchema,
      body: input,
      schema: vulnerabilityRemediationMutationResponseSchema,
    });
  }

  correctRemediation(
    findingId: string,
    input: CorrectVulnerabilityRemediationAnchorInput,
  ) {
    return authenticatedRequestJson({
      path: `${findingPath(findingId)}/remediation`,
      method: "PATCH",
      inputSchema: correctVulnerabilityRemediationAnchorInputSchema,
      body: input,
      schema: vulnerabilityRemediationMutationResponseSchema,
    });
  }

  triageSlaPolicies(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/triage-sla-policies",
      schema: vulnerabilityTriageSlaPoliciesResponseSchema,
      signal,
    });
  }

  updateTriageSlaPolicy(input: UpdateVulnerabilityTriageSlaPolicyInput) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/triage-sla-policies",
      method: "PUT",
      inputSchema: updateVulnerabilityTriageSlaPolicyInputSchema,
      body: input,
      schema: vulnerabilityTriageSlaPolicyMutationResponseSchema,
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

  createAssessmentBulkPreview(
    input: CreateVulnerabilityAssessmentBulkPreviewInput,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/assessment-bulk/previews",
      method: "POST",
      inputSchema: createVulnerabilityAssessmentBulkPreviewInputSchema,
      body: input,
      schema: vulnerabilityAssessmentBulkOperationMutationResponseSchema,
    });
  }

  createAssessmentPropagationPreview(
    input: CreateVulnerabilityAssessmentPropagationPreviewInput,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/assessment-propagation/previews",
      method: "POST",
      inputSchema: createVulnerabilityAssessmentPropagationPreviewInputSchema,
      body: input,
      schema: vulnerabilityAssessmentBulkOperationMutationResponseSchema,
    });
  }

  assessmentBulkOperation(operationId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: bulkOperationPath(operationId),
      schema: vulnerabilityAssessmentBulkOperationResponseSchema,
      signal,
    });
  }

  executeAssessmentBulkOperation(
    operationId: string,
    input: ExecuteVulnerabilityAssessmentBulkOperationInput,
  ) {
    return authenticatedRequestJson({
      path: `${bulkOperationPath(operationId)}/execute`,
      method: "POST",
      inputSchema: executeVulnerabilityAssessmentBulkOperationInputSchema,
      body: input,
      schema: vulnerabilityAssessmentBulkOperationMutationResponseSchema,
    });
  }

  retryAssessmentBulkOperation(
    operationId: string,
    input: RetryVulnerabilityAssessmentBulkOperationInput,
  ) {
    return authenticatedRequestJson({
      path: `${bulkOperationPath(operationId)}/retry`,
      method: "POST",
      inputSchema: retryVulnerabilityAssessmentBulkOperationInputSchema,
      body: input,
      schema: vulnerabilityAssessmentBulkOperationMutationResponseSchema,
    });
  }

  undoAssessmentBulkOperation(
    operationId: string,
    input: UndoVulnerabilityAssessmentBulkOperationInput,
  ) {
    return authenticatedRequestJson({
      path: `${bulkOperationPath(operationId)}/undo`,
      method: "POST",
      inputSchema: undoVulnerabilityAssessmentBulkOperationInputSchema,
      body: input,
      schema: vulnerabilityAssessmentBulkOperationMutationResponseSchema,
    });
  }
}

export const vulnerabilityTriageApi = Object.freeze(
  new VulnerabilityTriageApi(),
);
