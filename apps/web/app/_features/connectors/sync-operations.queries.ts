"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PreviewConnectorFieldMappingInput,
  SaveConnectorFieldMappingInput,
  SyncHistoryQuery,
  ReplaySyncRunPreviewInput,
  ReplaySyncRunInput,
} from "@repo/contracts/connectors/types";
import { connectorsApi } from "./connectors.api";
import { useConnectorKeys, useConnectorMutation } from "./connectors.queries";
export function useFieldMapSchemaQuery(id: string, enabled: boolean) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.detail(id), "field-mapping", "schema"],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.fieldMapSchema(id, signal),
  });
}
export function useFieldMapQuery(id: string, enabled: boolean) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.detail(id), "field-mapping"],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.fieldMap(id, signal),
  });
}
export function usePreviewFieldMapMutation(id: string) {
  return useConnectorMutation({
    mutationFn: (input: PreviewConnectorFieldMappingInput) =>
      connectorsApi.previewFieldMap(id, input),
  });
}
export function useSaveFieldMapMutation(id: string) {
  const keys = useConnectorKeys();
  const client = useQueryClient();
  return useConnectorMutation({
    mutationFn: (input: SaveConnectorFieldMappingInput) =>
      connectorsApi.saveFieldMap(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.detail(id) }),
  });
}
export function useSyncHistoryQuery(
  id: string,
  query: Partial<SyncHistoryQuery>,
  enabled: boolean,
) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.detail(id), "sync-history", JSON.stringify(query)],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.syncHistory(id, query, signal),
    refetchInterval: 5000,
  });
}
export function useSyncDetailQuery(
  id: string,
  run: string,
  query: Partial<SyncHistoryQuery>,
  enabled: boolean,
) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [...keys.detail(id), "sync-history", run, JSON.stringify(query)],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.syncDetail(id, run, query, signal),
    refetchInterval: 5000,
  });
}
export function useDeadLetterRecordsQuery(
  id: string,
  query: Partial<SyncHistoryQuery>,
  enabled: boolean,
) {
  const keys = useConnectorKeys();
  return useQuery({
    queryKey: [
      ...keys.detail(id),
      "dead-letter-records",
      JSON.stringify(query),
    ],
    enabled,
    retry: false,
    queryFn: ({ signal }) => connectorsApi.deadLetterRecords(id, query, signal),
    refetchInterval: 5000,
  });
}
export function usePreviewReplayMutation(id: string, run: string) {
  return useConnectorMutation({
    mutationFn: (input: ReplaySyncRunPreviewInput) =>
      connectorsApi.previewReplay(id, run, input),
  });
}
export function useReplayMutation(id: string, run: string) {
  const keys = useConnectorKeys();
  const client = useQueryClient();
  return useConnectorMutation({
    mutationFn: (input: ReplaySyncRunInput) =>
      connectorsApi.replay(id, run, input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.detail(id) }),
  });
}
