"use client";

import type {
  CancelReportingObligationInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingObligationInput,
  CreateReportingRehearsalInput,
  RecordReportingObligationStageSubmissionInput,
  AcquireReportingStageDraftLockInput,
  ApplyReportingFamilyTemplateInput,
  CreateReportingFamilyTemplateInput,
  CreateReportingStageDraftInput,
  SaveReportingStageDraftInput,
  SubmitReportingStageDraftInput,
  CreateReportingStageAcknowledgementInput,
  GenerateReportingObligationEvidencePackInput,
  GenerateReportingStageSubmissionPackageInput,
  ReauthenticateReportingStageFilingInput,
  RecordReportingStageExternalFilingFieldsInput,
  RecordReportingStageRehearsalFilingFields,
  ReplayReportingRehearsalInput,
  ReportingFamilyTemplateListQuery,
  ReportingObligationListQuery,
} from "@repo/contracts/reporting";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { reportingApi } from "./reporting.api";
import { reportingKeys } from "./reporting.keys";
import { ApiClientError } from "../../_lib/http/api-client";

export function useReportingObligationsQuery(
  query: Readonly<Partial<ReportingObligationListQuery>>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: reportingKeys.list(query),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => reportingApi.list(query, signal),
  });
}

export function useReportingDeadlineSummaryQuery(enabled: boolean) {
  return useQuery({
    queryKey: reportingKeys.deadlineSummary(),
    enabled,
    retry: false,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) => reportingApi.deadlineSummary(signal),
  });
}

export function useReportingObligationDetailQuery(
  obligationId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      obligationId === null
        ? reportingKeys.all
        : reportingKeys.detail(obligationId),
    enabled: enabled && obligationId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (obligationId === null)
        throw new Error("A reporting obligation identifier is required.");
      return reportingApi.detail(obligationId, signal);
    },
  });
}

export function useCreateReportingObligationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportingObligationInput) =>
      reportingApi.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: reportingKeys.all }),
  });
}

export function useCreateReportingRehearsalMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportingRehearsalInput) =>
      reportingApi.createRehearsal(input),
    onSuccess: () => client.invalidateQueries({ queryKey: reportingKeys.all }),
  });
}

export function useReplayReportingRehearsalMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      input: ReplayReportingRehearsalInput;
    }) => reportingApi.replayRehearsal(variables.obligationId, variables.input),
    onSuccess: () => client.invalidateQueries({ queryKey: reportingKeys.all }),
  });
}

export function useCorrectReportingAnchorMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      input: CorrectReportingObligationAnchorInput;
    }) => reportingApi.correctAnchor(variables.obligationId, variables.input),
    onSuccess: () => client.invalidateQueries({ queryKey: reportingKeys.all }),
  });
}

export function useRecordReportingSubmissionMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      input: RecordReportingObligationStageSubmissionInput;
    }) =>
      reportingApi.recordSubmission(variables.obligationId, variables.input),
    onSuccess: () => client.invalidateQueries({ queryKey: reportingKeys.all }),
  });
}

export function useCancelReportingObligationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      input: CancelReportingObligationInput;
    }) => reportingApi.cancel(variables.obligationId, variables.input),
    onSuccess: () => client.invalidateQueries({ queryKey: reportingKeys.all }),
  });
}

export function useReportingStageDraftQuery(
  obligationId: string | null,
  stageId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      obligationId !== null && stageId !== null
        ? reportingKeys.stageDraft(obligationId, stageId)
        : reportingKeys.all,
    enabled: enabled && obligationId !== null && stageId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (obligationId === null || stageId === null)
        throw new Error("A reporting stage is required.");
      return reportingApi
        .stageDraft(obligationId, stageId, signal)
        .catch((error) => {
          // The server deliberately returns 404 for a missing private draft. At
          // this UI boundary that is the normal empty state, not a recoverable
          // request failure; other 404s remain opaque and expose no tenant data.
          if (error instanceof ApiClientError && error.status === 404)
            return null;
          throw error;
        });
    },
  });
}

function invalidateStageDraft(
  client: ReturnType<typeof useQueryClient>,
  obligationId: string,
  stageId: string,
) {
  return client.invalidateQueries({
    queryKey: reportingKeys.stageDraft(obligationId, stageId),
  });
}

export function useCreateReportingStageDraftMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: CreateReportingStageDraftInput;
    }) =>
      reportingApi.createStageDraft(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidateStageDraft(client, variables.obligationId, variables.stageId),
  });
}
export function useAcquireReportingStageDraftLockMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: AcquireReportingStageDraftLockInput;
    }) =>
      reportingApi.acquireStageDraftLock(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidateStageDraft(client, variables.obligationId, variables.stageId),
  });
}
export function useSaveReportingStageDraftMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: SaveReportingStageDraftInput;
    }) =>
      reportingApi.saveStageDraft(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidateStageDraft(client, variables.obligationId, variables.stageId),
  });
}
export function useSubmitReportingStageDraftMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: SubmitReportingStageDraftInput;
    }) =>
      reportingApi.submitStageDraft(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) => {
      invalidateStageDraft(client, variables.obligationId, variables.stageId);
      client.invalidateQueries({ queryKey: reportingKeys.all });
    },
  });
}
export function useReauthenticateReportingStageApprovalMutation() {
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: import("@repo/contracts/reporting").ReauthenticateReportingStageApprovalInput;
    }) =>
      reportingApi.reauthenticateStageApproval(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
  });
}
export function useApproveReportingStageDraftMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: import("@repo/contracts/reporting").ApproveReportingStageDraftInput;
    }) =>
      reportingApi.approveStageDraft(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) => {
      invalidateStageDraft(client, variables.obligationId, variables.stageId);
      client.invalidateQueries({ queryKey: reportingKeys.all });
    },
  });
}
export function useGenerateReportingStageSubmissionPackageMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: GenerateReportingStageSubmissionPackageInput;
    }) =>
      reportingApi.generateStageSubmissionPackage(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) => {
      invalidateStageDraft(client, variables.obligationId, variables.stageId);
      client.invalidateQueries({ queryKey: reportingKeys.all });
    },
  });
}
export function useDownloadReportingStageSubmissionPackageMutation() {
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      packageId: string;
    }) =>
      reportingApi.stageSubmissionPackageDownload(
        variables.obligationId,
        variables.stageId,
        variables.packageId,
      ),
  });
}
export function useReauthenticateReportingStageFilingMutation() {
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: ReauthenticateReportingStageFilingInput;
    }) =>
      reportingApi.reauthenticateStageFiling(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
  });
}
export function useRecordReportingStageExternalFilingMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      fields: RecordReportingStageExternalFilingFieldsInput;
      receipt: File;
    }) =>
      reportingApi.recordStageExternalFiling(
        variables.obligationId,
        variables.stageId,
        variables.fields,
        variables.receipt,
      ),
    onSuccess: (_, variables) => {
      invalidateStageDraft(client, variables.obligationId, variables.stageId);
      client.invalidateQueries({ queryKey: reportingKeys.all });
      client.invalidateQueries({
        queryKey: reportingKeys.stageTimeline(
          variables.obligationId,
          variables.stageId,
        ),
      });
    },
  });
}

export function useRecordReportingStageRehearsalFilingMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      fields: RecordReportingStageRehearsalFilingFields;
      receipt: File;
    }) =>
      reportingApi.recordStageRehearsalFiling(
        variables.obligationId,
        variables.stageId,
        variables.fields,
        variables.receipt,
      ),
    onSuccess: (_, variables) => {
      invalidateStageDraft(client, variables.obligationId, variables.stageId);
      client.invalidateQueries({ queryKey: reportingKeys.all });
      client.invalidateQueries({
        queryKey: reportingKeys.stageTimeline(
          variables.obligationId,
          variables.stageId,
        ),
      });
    },
  });
}
export function useReportingStageEvidenceTimelineQuery(
  obligationId: string | null,
  stageId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      obligationId !== null && stageId !== null
        ? reportingKeys.stageTimeline(obligationId, stageId)
        : reportingKeys.all,
    enabled: enabled && obligationId !== null && stageId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (obligationId === null || stageId === null)
        throw new Error("A reporting stage is required.");
      return reportingApi.stageEvidenceTimeline(obligationId, stageId, signal);
    },
  });
}
export function useGenerateReportingEvidencePackMutation() {
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      input: GenerateReportingObligationEvidencePackInput;
    }) =>
      reportingApi.generateEvidencePack(
        variables.obligationId,
        variables.input,
      ),
  });
}
export function useDownloadReportingEvidencePackMutation() {
  return useMutation({
    mutationFn: (variables: { obligationId: string; evidencePackId: string }) =>
      reportingApi.evidencePackDownload(
        variables.obligationId,
        variables.evidencePackId,
      ),
  });
}
export function useCreateReportingStageAcknowledgementMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      submissionId: string;
      input: CreateReportingStageAcknowledgementInput;
    }) =>
      reportingApi.createStageAcknowledgement(
        variables.obligationId,
        variables.submissionId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      client.invalidateQueries({
        queryKey: reportingKeys.stageTimeline(
          variables.obligationId,
          variables.stageId,
        ),
      }),
  });
}
export function useReportingFamilyTemplatesQuery(
  obligationType: NonNullable<
    ReportingFamilyTemplateListQuery["obligationType"]
  >,
  stage: NonNullable<ReportingFamilyTemplateListQuery["stage"]>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: reportingKeys.templates(obligationType, stage),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      reportingApi.familyTemplates({ obligationType, stage }, signal),
  });
}
export function useApplyReportingFamilyTemplateMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      obligationId: string;
      stageId: string;
      input: ApplyReportingFamilyTemplateInput;
    }) =>
      reportingApi.applyFamilyTemplate(
        variables.obligationId,
        variables.stageId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidateStageDraft(client, variables.obligationId, variables.stageId),
  });
}
export function useCreateReportingFamilyTemplateMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportingFamilyTemplateInput) =>
      reportingApi.createFamilyTemplate(input),
    onSuccess: (_, variables) =>
      client.invalidateQueries({
        queryKey: reportingKeys.templates(
          variables.obligationType,
          variables.stage,
        ),
      }),
  });
}
