"use client";

import type {
  ApproveVulnerabilityFindingAssessmentInput,
  CreateVulnerabilityAssessmentBulkPreviewInput,
  CreateVulnerabilityAssessmentPropagationPreviewInput,
  CreateVulnerabilitySavedViewInput,
  DeleteVulnerabilitySavedViewInput,
  ExecuteVulnerabilityAssessmentBulkOperationInput,
  RejectVulnerabilityFindingAssessmentInput,
  SetDefaultVulnerabilitySavedViewInput,
  RetryVulnerabilityAssessmentBulkOperationInput,
  SubmitVulnerabilityFindingAssessmentInput,
  UpdateVulnerabilitySavedViewInput,
  UpdateVulnerabilityAssessmentApprovalPolicyInput,
  UndoVulnerabilityAssessmentBulkOperationInput,
  AssignVulnerabilityTriageFindingInput,
  CorrectVulnerabilityRemediationAnchorInput,
  RecordVulnerabilityRemediationAnchorInput,
  SuppressVulnerabilityTriageFindingInput,
  UpdateVulnerabilityTriageSlaPolicyInput,
  VulnerabilityTriageQueueQuery,
  CreateVulnerabilityVexExportInput,
  EnqueueVulnerabilityVexPublicationInput,
  PreviewVulnerabilityVexExportQuery,
  RetryVulnerabilityVexPublicationInput,
  UpdateVulnerabilityVexPublicationTargetInput,
  WithdrawVulnerabilityVexPublicationInput,
  CreateVulnerabilityTriageNoteInput,
  UpdateVulnerabilityTriageNoteInput,
  DeleteVulnerabilityTriageNoteInput,
} from "@repo/contracts/vulnerabilities";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { vulnerabilityTriageApi } from "./triage.api";
import { vulnerabilityTriageKeys } from "./triage.keys";

export function useVulnerabilityTriageQueueQuery(
  query: Readonly<Partial<VulnerabilityTriageQueueQuery>>,
  organizationId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: vulnerabilityTriageKeys.queueList(organizationId, query),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => vulnerabilityTriageApi.list(query, signal),
  });
}

export function useVulnerabilityTriageDetailQuery(
  findingId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      findingId === null
        ? vulnerabilityTriageKeys.all
        : vulnerabilityTriageKeys.detail(findingId),
    enabled: enabled && findingId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (findingId === null)
        throw new Error("A finding identifier is required.");
      return vulnerabilityTriageApi.detail(findingId, signal);
    },
  });
}

export function useVulnerabilityRemediationHistoryQuery(
  findingId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      findingId === null
        ? vulnerabilityTriageKeys.remediationHistory
        : vulnerabilityTriageKeys.remediationHistoryForFinding(findingId),
    enabled: enabled && findingId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (findingId === null)
        throw new Error("A finding identifier is required.");
      return vulnerabilityTriageApi.remediationHistory(findingId, signal);
    },
  });
}

export function useVulnerabilityTriageNotesQuery(
  findingId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      findingId === null
        ? vulnerabilityTriageKeys.notes
        : vulnerabilityTriageKeys.notesForFinding(findingId),
    enabled: enabled && findingId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (!findingId) throw new Error("A finding identifier is required.");
      return vulnerabilityTriageApi.notes(findingId, {}, signal);
    },
  });
}

function useInvalidateNotes() {
  const client = useQueryClient();
  return (findingId: string) =>
    client.invalidateQueries({
      queryKey: vulnerabilityTriageKeys.notesForFinding(findingId),
    });
}
export function useCreateVulnerabilityTriageNoteMutation() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (variables: {
      findingId: string;
      input: CreateVulnerabilityTriageNoteInput;
    }) =>
      vulnerabilityTriageApi.createNote(variables.findingId, variables.input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}
export function useUpdateVulnerabilityTriageNoteMutation() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (variables: {
      findingId: string;
      noteId: string;
      input: UpdateVulnerabilityTriageNoteInput;
    }) =>
      vulnerabilityTriageApi.updateNote(
        variables.findingId,
        variables.noteId,
        variables.input,
      ),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}
export function useDeleteVulnerabilityTriageNoteMutation() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (variables: {
      findingId: string;
      noteId: string;
      input: DeleteVulnerabilityTriageNoteInput;
    }) =>
      vulnerabilityTriageApi.deleteNote(
        variables.findingId,
        variables.noteId,
        variables.input,
      ),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useVulnerabilityFindingAssessmentQuery(
  findingId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      findingId === null
        ? vulnerabilityTriageKeys.assessments
        : vulnerabilityTriageKeys.assessment(findingId),
    enabled: enabled && findingId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (findingId === null)
        throw new Error("A finding identifier is required.");
      return vulnerabilityTriageApi.assessment(findingId, signal);
    },
  });
}

export function useVulnerabilityAssessmentApprovalPolicyQuery(
  enabled: boolean,
) {
  return useQuery({
    queryKey: vulnerabilityTriageKeys.assessmentApprovalPolicy,
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      vulnerabilityTriageApi.assessmentApprovalPolicy(signal),
  });
}

export function useVulnerabilityTriageSlaPoliciesQuery(enabled: boolean) {
  return useQuery({
    queryKey: vulnerabilityTriageKeys.triageSlaPolicies,
    enabled,
    retry: false,
    queryFn: ({ signal }) => vulnerabilityTriageApi.triageSlaPolicies(signal),
  });
}

export function useVulnerabilityVexExportPreviewQuery(
  scope: PreviewVulnerabilityVexExportQuery | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      scope === null
        ? vulnerabilityTriageKeys.vexExports
        : vulnerabilityTriageKeys.vexExportPreview(
            scope.productId,
            scope.releaseId,
          ),
    enabled: enabled && scope !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (scope === null)
        throw new Error("A product and release are required for VEX export.");
      return vulnerabilityTriageApi.vexExportPreview(scope, signal);
    },
  });
}

export function useVulnerabilityVexExportsQuery(
  scope: PreviewVulnerabilityVexExportQuery | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      scope === null
        ? vulnerabilityTriageKeys.vexExports
        : vulnerabilityTriageKeys.vexExportList(
            scope.productId,
            scope.releaseId,
          ),
    enabled: enabled && scope !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (scope === null)
        throw new Error("A product and release are required for VEX exports.");
      return vulnerabilityTriageApi.vexExports(scope, signal);
    },
  });
}

export function useVulnerabilityVexPublicationTargetsQuery(enabled: boolean) {
  return useQuery({
    queryKey: vulnerabilityTriageKeys.vexPublicationTargets,
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      vulnerabilityTriageApi.vexPublicationTargets(signal),
  });
}

export function useVulnerabilityVexPublicationsQuery(
  exportId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      exportId === null
        ? vulnerabilityTriageKeys.vexExports
        : vulnerabilityTriageKeys.vexPublications(exportId),
    enabled: enabled && exportId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (exportId === null) throw new Error("A VEX export is required.");
      return vulnerabilityTriageApi.vexPublications(exportId, signal);
    },
  });
}

export function useVulnerabilityAssessmentBulkOperationQuery(
  operationId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      operationId === null
        ? vulnerabilityTriageKeys.assessmentBulkOperations
        : vulnerabilityTriageKeys.assessmentBulkOperation(operationId),
    enabled: enabled && operationId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (operationId === null)
        throw new Error("A bulk operation identifier is required.");
      return vulnerabilityTriageApi.assessmentBulkOperation(
        operationId,
        signal,
      );
    },
  });
}

export function useVulnerabilitySavedViewsQuery(
  organizationId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: vulnerabilityTriageKeys.savedViews(organizationId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => vulnerabilityTriageApi.listSavedViews(signal),
  });
}

function useInvalidateTriage() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.queue }),
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.all,
      }),
    ]);
}

function useInvalidateFindingAssessment() {
  const client = useQueryClient();
  return (findingId: string) =>
    Promise.all([
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.assessment(findingId),
      }),
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.detail(findingId),
      }),
      client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.queue }),
    ]);
}

function useInvalidateFindingOperationalState() {
  const client = useQueryClient();
  return (findingId: string) =>
    Promise.all([
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.detail(findingId),
      }),
      client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.queue }),
    ]);
}

function useInvalidateFindingRemediation() {
  const client = useQueryClient();
  return (findingId: string) =>
    Promise.all([
      client.invalidateQueries({
        queryKey:
          vulnerabilityTriageKeys.remediationHistoryForFinding(findingId),
      }),
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.detail(findingId),
      }),
      client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.queue }),
    ]);
}

function useInvalidateVexExports() {
  const client = useQueryClient();
  return (productId?: string, releaseId?: string, exportId?: string) =>
    Promise.all([
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.vexExports,
      }),
      ...(productId !== undefined && releaseId !== undefined
        ? [
            client.invalidateQueries({
              queryKey: vulnerabilityTriageKeys.vexExportPreview(
                productId,
                releaseId,
              ),
            }),
            client.invalidateQueries({
              queryKey: vulnerabilityTriageKeys.vexExportList(
                productId,
                releaseId,
              ),
            }),
          ]
        : []),
      ...(exportId !== undefined
        ? [
            client.invalidateQueries({
              queryKey: vulnerabilityTriageKeys.vexPublications(exportId),
            }),
          ]
        : []),
    ]);
}

function useInvalidateBulkOperation() {
  const client = useQueryClient();
  return (operationId: string) =>
    Promise.all([
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.assessmentBulkOperation(operationId),
      }),
      client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.queue }),
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.assessments,
      }),
      client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.all }),
    ]);
}

export function useCreateVulnerabilitySavedViewMutation() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (input: CreateVulnerabilitySavedViewInput) =>
      vulnerabilityTriageApi.createSavedView(input),
    onSuccess: invalidate,
  });
}
export function useUpdateVulnerabilitySavedViewMutation() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: ({
      viewId,
      input,
    }: {
      viewId: string;
      input: UpdateVulnerabilitySavedViewInput;
    }) => vulnerabilityTriageApi.updateSavedView(viewId, input),
    onSuccess: invalidate,
  });
}
export function useDeleteVulnerabilitySavedViewMutation() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: ({
      viewId,
      input,
    }: {
      viewId: string;
      input: DeleteVulnerabilitySavedViewInput;
    }) => vulnerabilityTriageApi.deleteSavedView(viewId, input),
    onSuccess: invalidate,
  });
}
export function useSetDefaultVulnerabilitySavedViewMutation() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (input: SetDefaultVulnerabilitySavedViewInput) =>
      vulnerabilityTriageApi.setDefaultSavedView(input),
    onSuccess: invalidate,
  });
}

export function useSubmitVulnerabilityFindingAssessmentMutation() {
  const invalidate = useInvalidateFindingAssessment();
  return useMutation({
    mutationFn: ({
      findingId,
      input,
    }: {
      findingId: string;
      input: SubmitVulnerabilityFindingAssessmentInput;
    }) => vulnerabilityTriageApi.submitAssessment(findingId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useApproveVulnerabilityFindingAssessmentMutation() {
  const invalidate = useInvalidateFindingAssessment();
  return useMutation({
    mutationFn: ({
      findingId,
      assessmentId,
      input,
    }: {
      findingId: string;
      assessmentId: string;
      input: ApproveVulnerabilityFindingAssessmentInput;
    }) =>
      vulnerabilityTriageApi.approveAssessment(findingId, assessmentId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useRejectVulnerabilityFindingAssessmentMutation() {
  const invalidate = useInvalidateFindingAssessment();
  return useMutation({
    mutationFn: ({
      findingId,
      assessmentId,
      input,
    }: {
      findingId: string;
      assessmentId: string;
      input: RejectVulnerabilityFindingAssessmentInput;
    }) =>
      vulnerabilityTriageApi.rejectAssessment(findingId, assessmentId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useUpdateVulnerabilityAssessmentApprovalPolicyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      severity,
      input,
    }: {
      severity: string;
      input: UpdateVulnerabilityAssessmentApprovalPolicyInput;
    }) =>
      vulnerabilityTriageApi.updateAssessmentApprovalPolicy(severity, input),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.assessmentApprovalPolicy,
      }),
  });
}

export function useAssignVulnerabilityTriageFindingMutation() {
  const invalidate = useInvalidateFindingOperationalState();
  return useMutation({
    mutationFn: ({
      findingId,
      input,
    }: {
      findingId: string;
      input: AssignVulnerabilityTriageFindingInput;
    }) => vulnerabilityTriageApi.assign(findingId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useSuppressVulnerabilityTriageFindingMutation() {
  const invalidate = useInvalidateFindingOperationalState();
  return useMutation({
    mutationFn: ({
      findingId,
      input,
    }: {
      findingId: string;
      input: SuppressVulnerabilityTriageFindingInput;
    }) => vulnerabilityTriageApi.suppress(findingId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useRecordVulnerabilityRemediationMutation() {
  const invalidate = useInvalidateFindingRemediation();
  return useMutation({
    mutationFn: ({
      findingId,
      input,
    }: {
      findingId: string;
      input: RecordVulnerabilityRemediationAnchorInput;
    }) => vulnerabilityTriageApi.recordRemediation(findingId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useCorrectVulnerabilityRemediationMutation() {
  const invalidate = useInvalidateFindingRemediation();
  return useMutation({
    mutationFn: ({
      findingId,
      input,
    }: {
      findingId: string;
      input: CorrectVulnerabilityRemediationAnchorInput;
    }) => vulnerabilityTriageApi.correctRemediation(findingId, input),
    onSuccess: (_, variables) => invalidate(variables.findingId),
  });
}

export function useUpdateVulnerabilityTriageSlaPolicyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateVulnerabilityTriageSlaPolicyInput) =>
      vulnerabilityTriageApi.updateTriageSlaPolicy(input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({
          queryKey: vulnerabilityTriageKeys.triageSlaPolicies,
        }),
        client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.queue }),
        client.invalidateQueries({ queryKey: vulnerabilityTriageKeys.all }),
      ]),
  });
}

export function useCreateVulnerabilityVexExportMutation() {
  const invalidate = useInvalidateVexExports();
  return useMutation({
    mutationFn: (input: CreateVulnerabilityVexExportInput) =>
      vulnerabilityTriageApi.createVexExport(input),
    onSuccess: (_, input) => invalidate(input.productId, input.releaseId),
  });
}

export function useVulnerabilityVexExportDownloadMutation() {
  return useMutation({
    mutationFn: (exportId: string) =>
      vulnerabilityTriageApi.vexExportDownload(exportId),
  });
}

export function useUpdateVulnerabilityVexPublicationTargetMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateVulnerabilityVexPublicationTargetInput) =>
      vulnerabilityTriageApi.updateVexPublicationTarget(input),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: vulnerabilityTriageKeys.vexPublicationTargets,
      }),
  });
}

export function useEnqueueVulnerabilityVexPublicationMutation() {
  const invalidate = useInvalidateVexExports();
  return useMutation({
    mutationFn: ({
      exportId,
      input,
    }: {
      exportId: string;
      input: EnqueueVulnerabilityVexPublicationInput;
    }) => vulnerabilityTriageApi.enqueueVexPublication(exportId, input),
    onSuccess: (_, variables) =>
      invalidate(undefined, undefined, variables.exportId),
  });
}

export function useRetryVulnerabilityVexPublicationMutation() {
  const invalidate = useInvalidateVexExports();
  return useMutation({
    mutationFn: (variables: {
      exportId: string;
      publicationId: string;
      input: RetryVulnerabilityVexPublicationInput;
    }) =>
      vulnerabilityTriageApi.retryVexPublication(
        variables.publicationId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidate(undefined, undefined, variables.exportId),
  });
}

export function useWithdrawVulnerabilityVexPublicationMutation() {
  const invalidate = useInvalidateVexExports();
  return useMutation({
    mutationFn: (variables: {
      exportId: string;
      publicationId: string;
      input: WithdrawVulnerabilityVexPublicationInput;
    }) =>
      vulnerabilityTriageApi.withdrawVexPublication(
        variables.publicationId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidate(undefined, undefined, variables.exportId),
  });
}

export function useCreateVulnerabilityAssessmentBulkPreviewMutation() {
  const invalidate = useInvalidateBulkOperation();
  return useMutation({
    mutationFn: (input: CreateVulnerabilityAssessmentBulkPreviewInput) =>
      vulnerabilityTriageApi.createAssessmentBulkPreview(input),
    onSuccess: (result) => invalidate(result.operation.id),
  });
}

export function useCreateVulnerabilityAssessmentPropagationPreviewMutation() {
  const invalidate = useInvalidateBulkOperation();
  return useMutation({
    mutationFn: (input: CreateVulnerabilityAssessmentPropagationPreviewInput) =>
      vulnerabilityTriageApi.createAssessmentPropagationPreview(input),
    onSuccess: (result) => invalidate(result.operation.id),
  });
}

export function useExecuteVulnerabilityAssessmentBulkOperationMutation() {
  const invalidate = useInvalidateBulkOperation();
  return useMutation({
    mutationFn: ({
      operationId,
      input,
    }: {
      operationId: string;
      input: ExecuteVulnerabilityAssessmentBulkOperationInput;
    }) =>
      vulnerabilityTriageApi.executeAssessmentBulkOperation(operationId, input),
    onSuccess: (result) => invalidate(result.operation.id),
  });
}

export function useRetryVulnerabilityAssessmentBulkOperationMutation() {
  const invalidate = useInvalidateBulkOperation();
  return useMutation({
    mutationFn: ({
      operationId,
      input,
    }: {
      operationId: string;
      input: RetryVulnerabilityAssessmentBulkOperationInput;
    }) =>
      vulnerabilityTriageApi.retryAssessmentBulkOperation(operationId, input),
    onSuccess: (result) => invalidate(result.operation.id),
  });
}

export function useUndoVulnerabilityAssessmentBulkOperationMutation() {
  const invalidate = useInvalidateBulkOperation();
  return useMutation({
    mutationFn: ({
      operationId,
      input,
    }: {
      operationId: string;
      input: UndoVulnerabilityAssessmentBulkOperationInput;
    }) =>
      vulnerabilityTriageApi.undoAssessmentBulkOperation(operationId, input),
    onSuccess: (result) => invalidate(result.operation.id),
  });
}
