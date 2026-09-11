"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type {
  ArchiveConnectorInput,
  CancelSyncRunInput,
  ConnectorListQuery,
  CreateConnectorInput,
  IdentitiesQuery,
  LinkExternalIdentityInput,
  MergeExternalIdentityInput,
  PlanItemsQuery,
  PreviewFieldAuthorityPolicyInput,
  RequestSyncRunCommitInput,
  ResolveSyncConflictInput,
  SetConnectorSecretInput,
  StartSyncRunInput,
  SyncRunResponse,
  SyncRunsQuery,
  UnlinkExternalIdentityInput,
  UpdateConnectorInput,
  UpsertFieldAuthorityPolicyInput,
} from "./connectors.schemas";
import { connectorKeys } from "./connectors.keys";
import { connectorsApi } from "./connectors.api";

function listKey(query: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

function shouldPollSyncRun(status: string | undefined): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "retrying" ||
    status === "waiting_for_review"
  );
}

export function useConnectorsQuery(
  query: Partial<ConnectorListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.list(listKey(query)),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => connectorsApi.list(query, signal),
  });
}

export function useConnectorQuery(connectorId: string, enabled: boolean) {
  return useQuery({
    queryKey: connectorKeys.detail(connectorId),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) => connectorsApi.get(connectorId, signal),
  });
}

export function useConnectorMappingQuery(
  connectorId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.mapping(connectorId),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) => connectorsApi.getMapping(connectorId, signal),
  });
}

export function useConnectorIdentitiesQuery(
  connectorId: string,
  query: Partial<IdentitiesQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.identities(connectorId, listKey(query)),
    enabled: enabled && connectorId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      connectorsApi.listIdentities(connectorId, query, signal),
  });
}

export function useConnectorSyncRunsQuery(
  connectorId: string,
  query: Partial<SyncRunsQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.syncRuns(connectorId, listKey(query)),
    enabled: enabled && connectorId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      connectorsApi.listSyncRuns(connectorId, query, signal),
  });
}

export function useSyncRunQuery(
  connectorId: string,
  runId: string,
  enabled: boolean,
) {
  return useQuery<SyncRunResponse>({
    queryKey: connectorKeys.syncRun(connectorId, runId),
    enabled: enabled && connectorId !== "" && runId !== "",
    retry: false,
    refetchInterval: (query) =>
      shouldPollSyncRun(query.state.data?.run.status) ? 2_000 : false,
    queryFn: ({ signal }) =>
      connectorsApi.getSyncRun(connectorId, runId, signal),
  });
}

export function usePlanItemsQuery(
  connectorId: string,
  runId: string,
  query: Partial<PlanItemsQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.planItems(connectorId, runId, listKey(query)),
    enabled: enabled && connectorId !== "" && runId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      connectorsApi.listPlanItems(connectorId, runId, query, signal),
  });
}

export function useRunConflictsQuery(
  connectorId: string,
  runId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.runConflicts(connectorId, runId),
    enabled: enabled && connectorId !== "" && runId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.listRunConflicts(connectorId, runId, signal),
  });
}

export function useConnectorDeadLettersQuery(
  connectorId: string,
  query: Partial<SyncRunsQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.deadLetters(connectorId, listKey(query)),
    enabled: enabled && connectorId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      connectorsApi.listDeadLetters(connectorId, query, signal),
  });
}

export function useConnectorMetricsSnapshotQuery(
  connectorId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectorKeys.metricsSnapshot(connectorId),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.getMetricsSnapshot(connectorId, signal),
  });
}

function useInvalidateConnectors() {
  const client = useQueryClient();
  return async (connectorId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: connectorKeys.all }),
      ...(connectorId
        ? [
            client.invalidateQueries({
              queryKey: connectorKeys.detail(connectorId),
            }),
          ]
        : []),
    ]);
  };
}

export function useCreateConnectorMutation() {
  const invalidate = useInvalidateConnectors();
  return useMutation({
    mutationFn: (input: CreateConnectorInput) => connectorsApi.create(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      connectorsApi.update(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

export function useSetConnectorSecretMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useMutation({
    mutationFn: (input: SetConnectorSecretInput) =>
      connectorsApi.setSecret(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

export function useTestConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useMutation({
    mutationFn: () => connectorsApi.test(connectorId),
    onSuccess: () => invalidate(connectorId),
  });
}

export function useArchiveConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useMutation({
    mutationFn: (input: ArchiveConnectorInput) =>
      connectorsApi.archive(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

export function usePreviewMappingMutation(connectorId: string) {
  return useMutation({
    mutationFn: (input: PreviewFieldAuthorityPolicyInput) =>
      connectorsApi.previewMapping(connectorId, input),
  });
}

export function useSaveMappingMutation(connectorId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertFieldAuthorityPolicyInput) =>
      connectorsApi.saveMapping(connectorId, input),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: connectorKeys.mapping(connectorId),
      }),
  });
}

function useInvalidateIdentities(connectorId: string) {
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({
      queryKey: ["connectors", connectorId, "identities"],
    });
}

export function useLinkIdentityMutation(connectorId: string) {
  const invalidate = useInvalidateIdentities(connectorId);
  return useMutation({
    mutationFn: (input: LinkExternalIdentityInput) =>
      connectorsApi.linkIdentity(connectorId, input),
    onSuccess: () => invalidate(),
  });
}

export function useUnlinkIdentityMutation(connectorId: string) {
  const invalidate = useInvalidateIdentities(connectorId);
  return useMutation({
    mutationFn: ({
      mappingId,
      input,
    }: Readonly<{ mappingId: string; input: UnlinkExternalIdentityInput }>) =>
      connectorsApi.unlinkIdentity(connectorId, mappingId, input),
    onSuccess: () => invalidate(),
  });
}

export function useMergeIdentitiesMutation(connectorId: string) {
  const invalidate = useInvalidateIdentities(connectorId);
  return useMutation({
    mutationFn: (input: MergeExternalIdentityInput) =>
      connectorsApi.mergeIdentities(connectorId, input),
    onSuccess: () => invalidate(),
  });
}

function useInvalidateSyncRuns(connectorId: string) {
  const client = useQueryClient();
  return async (runId?: string) => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: ["connectors", connectorId, "sync-runs"],
      }),
      client.invalidateQueries({
        queryKey: ["connectors", connectorId, "dead-letters"],
      }),
      client.invalidateQueries({
        queryKey: connectorKeys.metricsSnapshot(connectorId),
      }),
      ...(runId
        ? [
            client.invalidateQueries({
              queryKey: connectorKeys.syncRun(connectorId, runId),
            }),
          ]
        : []),
    ]);
  };
}

export function useStartSyncRunMutation(connectorId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useMutation({
    mutationFn: (input: StartSyncRunInput) =>
      connectorsApi.startSyncRun(connectorId, input),
    onSuccess: (response) => invalidate(response.run.id),
  });
}

export function useRequestCommitMutation(connectorId: string, runId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useMutation({
    mutationFn: (input: RequestSyncRunCommitInput) =>
      connectorsApi.requestCommit(connectorId, runId, input),
    onSuccess: () => invalidate(runId),
  });
}

export function useCancelSyncRunMutation(connectorId: string, runId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useMutation({
    mutationFn: (input: CancelSyncRunInput) =>
      connectorsApi.cancelSyncRun(connectorId, runId, input),
    onSuccess: () => invalidate(runId),
  });
}

export function useRetrySyncRunMutation(connectorId: string, runId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useMutation({
    mutationFn: () => connectorsApi.retrySyncRun(connectorId, runId),
    onSuccess: () => invalidate(runId),
  });
}

export function useResolveConflictMutation(connectorId: string, runId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      conflictId,
      input,
    }: Readonly<{ conflictId: string; input: ResolveSyncConflictInput }>) =>
      connectorsApi.resolveConflict(conflictId, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: connectorKeys.runConflicts(connectorId, runId),
        }),
        client.invalidateQueries({
          queryKey: connectorKeys.syncRun(connectorId, runId),
        }),
        client.invalidateQueries({
          queryKey: connectorKeys.metricsSnapshot(connectorId),
        }),
      ]);
    },
  });
}

export function useExportDiagnosticsMutation(connectorId: string) {
  return useMutation({
    mutationFn: () => connectorsApi.exportDiagnostics(connectorId),
  });
}
