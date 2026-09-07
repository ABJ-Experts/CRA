"use client";

import type {
  CreateVulnerabilitySavedViewInput,
  DeleteVulnerabilitySavedViewInput,
  SetDefaultVulnerabilitySavedViewInput,
  UpdateVulnerabilitySavedViewInput,
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
