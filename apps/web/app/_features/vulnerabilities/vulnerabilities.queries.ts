"use client";

import type {
  ReplayVulnerabilitySyncInput,
  TriggerVulnerabilitySyncInput,
  VulnerabilityFeedKey,
  VulnerabilitySyncRunListQuery,
} from "@repo/contracts/vulnerabilities";
import { vulnerabilitySyncRunListQuerySchema } from "@repo/contracts/vulnerabilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { vulnerabilityFeedsApi } from "./vulnerabilities.api";
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
