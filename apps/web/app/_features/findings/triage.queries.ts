"use client";

import type {
  ApproveVulnerabilityFindingAssessmentInput,
  CreateVulnerabilitySavedViewInput,
  DeleteVulnerabilitySavedViewInput,
  RejectVulnerabilityFindingAssessmentInput,
  SetDefaultVulnerabilitySavedViewInput,
  SubmitVulnerabilityFindingAssessmentInput,
  UpdateVulnerabilitySavedViewInput,
  UpdateVulnerabilityAssessmentApprovalPolicyInput,
  VulnerabilityTriageQueueQuery,
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
