"use client";

import type {
  ConfirmVulnerabilityOfflineBundleInput,
  ReplayVulnerabilitySyncInput,
  TriggerVulnerabilitySyncInput,
  VulnerabilityFeedKey,
  VulnerabilityCsafReconciliationDetailResponse,
  VulnerabilityOfflineBundleImportStatusResponse,
  VulnerabilityOfflineBundlePreflightFieldsInput,
  VulnerabilitySyncRunListQuery,
} from "@repo/contracts/vulnerabilities";
import { vulnerabilitySyncRunListQuerySchema } from "@repo/contracts/vulnerabilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type OfflineBundleUploadFiles,
  vulnerabilityFeedsApi,
} from "./vulnerabilities.api";
import { vulnerabilityFeedKeys } from "./vulnerabilities.keys";

function listKey(query: VulnerabilitySyncRunListQuery): string {
  return JSON.stringify(query);
}

export function useVulnerabilityFeedHealthQuery(enabled: boolean) {
  return useQuery({
    queryKey: vulnerabilityFeedKeys.health,
    enabled,
    retry: false,
    queryFn: ({ signal }) => vulnerabilityFeedsApi.health(signal),
  });
}

export function useVulnerabilitySyncRunsQuery(
  input: Partial<VulnerabilitySyncRunListQuery>,
  enabled: boolean,
) {
  const query = vulnerabilitySyncRunListQuerySchema.parse(input);

  return useQuery({
    queryKey: vulnerabilityFeedKeys.syncRuns(listKey(query)),
    enabled,
    retry: false,
    queryFn: ({ signal }) => vulnerabilityFeedsApi.listRuns(query, signal),
  });
}

export function useOfflineBundleImportQuery(
  importId: string | null,
  enabled: boolean,
) {
  return useQuery<VulnerabilityOfflineBundleImportStatusResponse>({
    queryKey:
      importId === null
        ? vulnerabilityFeedKeys.offlineBundles
        : vulnerabilityFeedKeys.offlineBundle(importId),
    enabled: enabled && importId !== null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.import.status === "preflight" ||
      query.state.data?.import.status === "promoting"
        ? 2_000
        : false,
    queryFn: ({ signal }) => {
      if (importId === null) {
        throw new Error("An offline bundle import identifier is required.");
      }
      return vulnerabilityFeedsApi.offlineBundleImport(importId, signal);
    },
  });
}

export function useCsafReconciliationQuery(
  canonicalId: string | null,
  enabled: boolean,
) {
  return useQuery<VulnerabilityCsafReconciliationDetailResponse>({
    queryKey:
      canonicalId === null
        ? vulnerabilityFeedKeys.csafReconciliations
        : vulnerabilityFeedKeys.csafReconciliation(canonicalId),
    enabled: enabled && canonicalId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (canonicalId === null) {
        throw new Error("A canonical advisory identifier is required.");
      }
      return vulnerabilityFeedsApi.csafReconciliation(canonicalId, signal);
    },
  });
}

function useInvalidateVulnerabilityFeeds() {
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({ queryKey: vulnerabilityFeedKeys.all });
}

export function useTriggerVulnerabilitySyncMutation(
  feedKey: VulnerabilityFeedKey,
) {
  const invalidate = useInvalidateVulnerabilityFeeds();
  return useMutation({
    mutationFn: (input: TriggerVulnerabilitySyncInput = {}) =>
      vulnerabilityFeedsApi.sync(feedKey, input),
    onSuccess: invalidate,
  });
}

export function useReplayVulnerabilitySyncMutation(
  feedKey: VulnerabilityFeedKey,
  runId: string,
) {
  const invalidate = useInvalidateVulnerabilityFeeds();
  return useMutation({
    mutationFn: (input: ReplayVulnerabilitySyncInput) =>
      vulnerabilityFeedsApi.replay(feedKey, runId, input),
    onSuccess: invalidate,
  });
}

export function usePreflightOfflineBundleMutation() {
  const invalidate = useInvalidateVulnerabilityFeeds();
  return useMutation({
    mutationFn: (
      input: Readonly<{
        files: OfflineBundleUploadFiles;
        fields: VulnerabilityOfflineBundlePreflightFieldsInput;
      }>,
    ) =>
      vulnerabilityFeedsApi.preflightOfflineBundle(input.files, input.fields),
    onSuccess: invalidate,
  });
}

export function useConfirmOfflineBundleMutation(importId: string | null) {
  const client = useQueryClient();
  const invalidate = useInvalidateVulnerabilityFeeds();
  return useMutation({
    mutationFn: (input: ConfirmVulnerabilityOfflineBundleInput) => {
      if (importId === null) {
        throw new Error("An offline bundle import identifier is required.");
      }
      return vulnerabilityFeedsApi.confirmOfflineBundle(importId, input);
    },
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        importId === null
          ? Promise.resolve()
          : client.invalidateQueries({
              queryKey: vulnerabilityFeedKeys.offlineBundle(importId),
            }),
      ]);
    },
  });
}
