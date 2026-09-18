"use client";

import type {
  CreateEvidenceReplacementInput,
  EvidenceDocumentListQuery,
  EvidenceDocumentListResponse,
  EvidenceDocumentVersionsResponse,
  InitializeEvidenceUploadInput,
} from "@repo/contracts/evidence";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { evidenceApi } from "./evidence.api";

export const evidenceKey = (
  productId: string,
  query: Partial<EvidenceDocumentListQuery> = {},
) =>
  [
    "evidence",
    productId,
    query.status ?? null,
    query.documentClass ?? null,
    query.cursor ?? null,
    query.limit ?? 50,
  ] as const;

export function useEvidenceDocumentsQuery(productId: string, enabled: boolean) {
  return useQuery<EvidenceDocumentListResponse>({
    queryKey: evidenceKey(productId),
    enabled: enabled && productId !== "",
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.items.some(
        ({ document }) =>
          document.currentVersion.status === "uploading" ||
          document.currentVersion.status === "scan_pending",
      )
        ? 5_000
        : false,
    queryFn: ({ signal }) => evidenceApi.list(productId, {}, signal),
  });
}

export function useInitializeEvidenceUploadMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: InitializeEvidenceUploadInput) =>
      evidenceApi.initialize(input),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: evidenceKey(productId) }),
  });
}

export function useCompleteEvidenceUploadMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      idempotencyKey,
    }: Readonly<{ versionId: string; idempotencyKey: string }>) =>
      evidenceApi.complete(versionId, { idempotencyKey }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: evidenceKey(productId) }),
  });
}

export const evidenceVersionsKey = (productId: string, documentId: string) =>
  ["evidence", productId, "versions", documentId] as const;

export function useEvidenceVersionsQuery(
  productId: string,
  documentId: string | null,
  enabled: boolean,
) {
  return useQuery<EvidenceDocumentVersionsResponse>({
    queryKey: evidenceVersionsKey(productId, documentId ?? ""),
    enabled: enabled && documentId !== null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.versions.some(
        ({ status }) => status === "uploading" || status === "scan_pending",
      )
        ? 5_000
        : false,
    queryFn: ({ signal }) =>
      evidenceApi.versions(productId, documentId ?? "", signal),
  });
}

export function useReplaceEvidenceMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEvidenceReplacementInput) =>
      evidenceApi.replace(input),
    onSuccess: (response) => {
      void client.invalidateQueries({ queryKey: evidenceKey(productId) });
      void client.invalidateQueries({
        queryKey: evidenceVersionsKey(productId, response.document.id),
      });
    },
  });
}
