"use client";

import type {
  CancelReportingObligationInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
  AcquireReportingStageDraftLockInput,
  ApplyReportingFamilyTemplateInput,
  CreateReportingFamilyTemplateInput,
  CreateReportingStageDraftInput,
  SaveReportingStageDraftInput,
  SubmitReportingStageDraftInput,
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
      return reportingApi.stageDraft(obligationId, stageId, signal).catch((error) => {
        // The server deliberately returns 404 for a missing private draft. At
        // this UI boundary that is the normal empty state, not a recoverable
        // request failure; other 404s remain opaque and expose no tenant data.
        if (error instanceof ApiClientError && error.status === 404) return null;
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
