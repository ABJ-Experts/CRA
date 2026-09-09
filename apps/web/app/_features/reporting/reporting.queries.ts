"use client";

import type {
  CancelReportingObligationInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
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
