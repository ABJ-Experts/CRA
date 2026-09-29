"use client";

import {
  type UseMutationOptions,
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
import { connectorKeys as baseConnectorKeys } from "./connectors.keys";
import { connectorsApi } from "./connectors.api";
import { useRef, useState } from "react";
import { useSession } from "../../_providers/session-provider";
import type {
  TestConnectorInput,
  RevokeConnectorSecretInput,
  DisconnectConnectorInput,
  ReconnectConnectorInput,
} from "@repo/contracts/connectors/types";

/** Reject stale tenant callbacks before dispatch and before mutation success is published. */
function useConnectorMutation<Data, Variables = void>(
  options: UseMutationOptions<Data, Error, Variables>,
) {
  const { session } = useSession();
  const orgId = session?.organization?.id;
  const currentOrg = useRef(orgId);
  currentOrg.current = orgId;
  return useMutation({
    ...options,
    mutationFn: async (variables, context) => {
      if (!orgId || currentOrg.current !== orgId)
        throw new Error(
          "Organization changed. Reopen the connector in the selected organization.",
        );
      const result = await options.mutationFn!(variables, context);
      if (currentOrg.current !== orgId)
        throw new Error(
          "Organization changed during the action. Reload current data.",
        );
      return result;
    },
  });
}

function useConnectorKeys() {
  const { session } = useSession();
  const orgId = session?.organization?.id ?? "no-organization";
  const scoped = (key: readonly unknown[]) =>
    baseConnectorKeys.scoped(orgId, key);
  return {
    all: baseConnectorKeys.organization(orgId),
    list: (query: string) => scoped(baseConnectorKeys.list(query)),
    detail: (id: string) => scoped(baseConnectorKeys.detail(id)),
    mapping: (id: string) => scoped(baseConnectorKeys.mapping(id)),
    identities: (id: string, query: string) =>
      scoped(baseConnectorKeys.identities(id, query)),
    syncRuns: (id: string, query: string) =>
      scoped(baseConnectorKeys.syncRuns(id, query)),
    syncRun: (id: string, run: string) =>
      scoped(baseConnectorKeys.syncRun(id, run)),
    planItems: (id: string, run: string, query: string) =>
      scoped(baseConnectorKeys.planItems(id, run, query)),
    runConflicts: (id: string, run: string) =>
      scoped(baseConnectorKeys.runConflicts(id, run)),
    conflict: (id: string) => scoped(baseConnectorKeys.conflict(id)),
    deadLetters: (id: string, query: string) =>
      scoped(baseConnectorKeys.deadLetters(id, query)),
    metricsSnapshot: (id: string) =>
      scoped(baseConnectorKeys.metricsSnapshot(id)),
  };
}

export function useConnectorCatalogueQuery(enabled: boolean) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.all, "catalogue"],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.catalogue(signal),
  });
}
export function useConnectorOverviewsQuery(
  query: Partial<ConnectorListQuery>,
  enabled: boolean,
) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.all, "overviews", listKey(query)],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.overviews(query, signal),
  });
}
export function useConnectorOverviewQuery(
  connectorId: string,
  enabled: boolean,
) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.detail(connectorId), "overview"],
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) => connectorsApi.overview(connectorId, signal),
  });
}

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
  const connectorKeys = useConnectorKeys();
  return useQuery({
    queryKey: connectorKeys.list(listKey(query)),
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.list(query, signal),
  });
}

export function useConnectorQuery(connectorId: string, enabled: boolean) {
  const connectorKeys = useConnectorKeys();
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
  const connectorKeys = useConnectorKeys();
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
  const connectorKeys = useConnectorKeys();
  return useQuery({
    queryKey: connectorKeys.identities(connectorId, listKey(query)),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.listIdentities(connectorId, query, signal),
  });
}

export function useConnectorSyncRunsQuery(
  connectorId: string,
  query: Partial<SyncRunsQuery>,
  enabled: boolean,
) {
  const connectorKeys = useConnectorKeys();
  return useQuery({
    queryKey: connectorKeys.syncRuns(connectorId, listKey(query)),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.listSyncRuns(connectorId, query, signal),
  });
}

export function useSyncRunQuery(
  connectorId: string,
  runId: string,
  enabled: boolean,
) {
  const connectorKeys = useConnectorKeys();
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
  const connectorKeys = useConnectorKeys();
  return useQuery({
    queryKey: connectorKeys.planItems(connectorId, runId, listKey(query)),
    enabled: enabled && connectorId !== "" && runId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.listPlanItems(connectorId, runId, query, signal),
  });
}

export function useRunConflictsQuery(
  connectorId: string,
  runId: string,
  enabled: boolean,
) {
  const connectorKeys = useConnectorKeys();
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
  const connectorKeys = useConnectorKeys();
  return useQuery({
    queryKey: connectorKeys.deadLetters(connectorId, listKey(query)),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.listDeadLetters(connectorId, query, signal),
  });
}

export function useConnectorMetricsSnapshotQuery(
  connectorId: string,
  enabled: boolean,
) {
  const connectorKeys = useConnectorKeys();
  return useQuery({
    queryKey: connectorKeys.metricsSnapshot(connectorId),
    enabled: enabled && connectorId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      connectorsApi.getMetricsSnapshot(connectorId, signal),
  });
}

function useInvalidateConnectors() {
  const connectorKeys = useConnectorKeys();
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
  return useConnectorMutation({
    mutationFn: (input: CreateConnectorInput) => connectorsApi.create(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useConnectorMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      connectorsApi.update(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

/** Secrets bypass MutationCache entirely: no plaintext variables or completed mutation objects. */
export function useSetConnectorSecretMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  const { session } = useSession();
  const orgId = session?.organization?.id;
  const activeOrg = useRef(orgId);
  activeOrg.current = orgId;
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    async mutateAsync(input: SetConnectorSecretInput) {
      if (!orgId || activeOrg.current !== orgId)
        throw new Error(
          "Organization changed. Reopen the connector before submitting credentials.",
        );
      setPending(true);
      try {
        const result = await connectorsApi.setSecret(connectorId, input);
        await invalidate(connectorId);
        if (activeOrg.current !== orgId)
          throw new Error("Organization changed during credential submission.");
        return result;
      } finally {
        setPending(false);
      }
    },
  };
}

export function useRevokeConnectorSecretMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useConnectorMutation({
    mutationFn: (input: RevokeConnectorSecretInput) =>
      connectorsApi.revokeSecret(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}
export function useDisconnectConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useConnectorMutation({
    mutationFn: (input: DisconnectConnectorInput) =>
      connectorsApi.disconnect(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}
export function useReconnectConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useConnectorMutation({
    mutationFn: (input: ReconnectConnectorInput) =>
      connectorsApi.reconnect(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

export function useTestConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useConnectorMutation({
    mutationFn: (input: TestConnectorInput) =>
      connectorsApi.test(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

export function useArchiveConnectorMutation(connectorId: string) {
  const invalidate = useInvalidateConnectors();
  return useConnectorMutation({
    mutationFn: (input: ArchiveConnectorInput) =>
      connectorsApi.archive(connectorId, input),
    onSuccess: () => invalidate(connectorId),
  });
}

export function usePreviewMappingMutation(connectorId: string) {
  return useConnectorMutation({
    mutationFn: (input: PreviewFieldAuthorityPolicyInput) =>
      connectorsApi.previewMapping(connectorId, input),
  });
}

export function useSaveMappingMutation(connectorId: string) {
  const connectorKeys = useConnectorKeys();
  const client = useQueryClient();
  return useConnectorMutation({
    mutationFn: (input: UpsertFieldAuthorityPolicyInput) =>
      connectorsApi.saveMapping(connectorId, input),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: connectorKeys.mapping(connectorId),
      }),
  });
}

function useInvalidateIdentities(connectorId: string) {
  const connectorKeys = useConnectorKeys();
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({
      queryKey: connectorKeys.identities(connectorId, "").slice(0, -1),
    });
}

export function useLinkIdentityMutation(connectorId: string) {
  const invalidate = useInvalidateIdentities(connectorId);
  return useConnectorMutation({
    mutationFn: (input: LinkExternalIdentityInput) =>
      connectorsApi.linkIdentity(connectorId, input),
    onSuccess: () => invalidate(),
  });
}

export function useUnlinkIdentityMutation(connectorId: string) {
  const invalidate = useInvalidateIdentities(connectorId);
  return useConnectorMutation({
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
  return useConnectorMutation({
    mutationFn: (input: MergeExternalIdentityInput) =>
      connectorsApi.mergeIdentities(connectorId, input),
    onSuccess: () => invalidate(),
  });
}

function useInvalidateSyncRuns(connectorId: string) {
  const connectorKeys = useConnectorKeys();
  const client = useQueryClient();
  return async (runId?: string) => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: connectorKeys.syncRuns(connectorId, "").slice(0, -1),
      }),
      client.invalidateQueries({
        queryKey: connectorKeys.deadLetters(connectorId, "").slice(0, -1),
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
  return useConnectorMutation({
    mutationFn: (input: StartSyncRunInput) =>
      connectorsApi.startSyncRun(connectorId, input),
    onSuccess: (response) => invalidate(response.run.id),
  });
}

export function useRequestCommitMutation(connectorId: string, runId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useConnectorMutation({
    mutationFn: (input: RequestSyncRunCommitInput) =>
      connectorsApi.requestCommit(connectorId, runId, input),
    onSuccess: () => invalidate(runId),
  });
}

export function useCancelSyncRunMutation(connectorId: string, runId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useConnectorMutation({
    mutationFn: (input: CancelSyncRunInput) =>
      connectorsApi.cancelSyncRun(connectorId, runId, input),
    onSuccess: () => invalidate(runId),
  });
}

export function useRetrySyncRunMutation(connectorId: string, runId: string) {
  const invalidate = useInvalidateSyncRuns(connectorId);
  return useConnectorMutation({
    mutationFn: () => connectorsApi.retrySyncRun(connectorId, runId),
    onSuccess: () => invalidate(runId),
  });
}

export function useResolveConflictMutation(connectorId: string, runId: string) {
  const connectorKeys = useConnectorKeys();
  const client = useQueryClient();
  return useConnectorMutation({
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
  return useConnectorMutation({
    mutationFn: () => connectorsApi.exportDiagnostics(connectorId),
  });
}
