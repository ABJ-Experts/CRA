"use client";

import type {
  CreateEvidenceReplacementInput,
  CreateEvidenceDeletionIntentInput,
  EvidenceDocumentListQuery,
  EvidenceDocumentListResponse,
  EvidenceDocumentVersionsResponse,
  EvidenceLegalHoldListResponse,
  EvidenceRetentionReviewResponse,
  EvidenceExpiryAlertIntervalsResponse,
  EvidenceExtractedTextResponse,
  EvidenceSearchQuery,
  EvidenceSearchResponse,
  EvidenceVersionReuseResponse,
  InitializeEvidenceUploadInput,
  PlaceEvidenceLegalHoldInput,
  ReleaseEvidenceLegalHoldInput,
  UpdateEvidenceExpiryAlertIntervalsInput,
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
    query.validity ?? null,
    query.cursor ?? null,
    query.limit ?? 50,
  ] as const;

export function useEvidenceDocumentsQuery(
  productId: string,
  enabled: boolean,
  query: Partial<EvidenceDocumentListQuery> = {},
) {
  return useQuery<EvidenceDocumentListResponse>({
    queryKey: evidenceKey(productId, query),
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
    queryFn: ({ signal }) => evidenceApi.list(productId, query, signal),
  });
}

export const evidenceVersionReuseKey = (
  productId: string,
  documentId: string,
  versionId: string,
) => ["evidence", productId, "reuse", documentId, versionId] as const;

export function useEvidenceVersionReuseQuery(
  productId: string,
  documentId: string | null,
  versionId: string | null,
  enabled: boolean,
) {
  return useQuery<EvidenceVersionReuseResponse>({
    queryKey: evidenceVersionReuseKey(
      productId,
      documentId ?? "",
      versionId ?? "",
    ),
    enabled: enabled && documentId !== null && versionId !== null,
    retry: false,
    queryFn: ({ signal }) =>
      evidenceApi.reuse(productId, documentId ?? "", versionId ?? "", signal),
  });
}

export const evidenceExpiryAlertIntervalsKey = [
  "evidence",
  "expiry-alert-intervals",
] as const;

export function useEvidenceExpiryAlertIntervalsQuery(enabled: boolean) {
  return useQuery<EvidenceExpiryAlertIntervalsResponse>({
    queryKey: evidenceExpiryAlertIntervalsKey,
    enabled,
    retry: false,
    queryFn: ({ signal }) => evidenceApi.expiryAlertIntervals(signal),
  });
}

export function useUpdateEvidenceExpiryAlertIntervalsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEvidenceExpiryAlertIntervalsInput) =>
      evidenceApi.updateExpiryAlertIntervals(input),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: evidenceExpiryAlertIntervalsKey }),
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

export const evidenceSearchKey = (
  productId: string,
  query: EvidenceSearchQuery,
) =>
  [
    "evidence",
    productId,
    "search",
    query.q,
    query.documentClass ?? null,
    query.includeHistorical,
    query.limit,
    query.cursor ?? null,
  ] as const;

export function useEvidenceSearchQuery(
  productId: string,
  query: EvidenceSearchQuery,
  enabled: boolean,
) {
  return useQuery<EvidenceSearchResponse>({
    queryKey: evidenceSearchKey(productId, query),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) => evidenceApi.search(productId, query, signal),
  });
}

export const evidenceExtractedTextKey = (
  productId: string,
  documentId: string,
  versionId: string,
) => ["evidence", productId, "extracted-text", documentId, versionId] as const;

export function useEvidenceExtractedTextQuery(
  productId: string,
  documentId: string | null,
  versionId: string | null,
  enabled: boolean,
) {
  return useQuery<EvidenceExtractedTextResponse>({
    queryKey: evidenceExtractedTextKey(
      productId,
      documentId ?? "",
      versionId ?? "",
    ),
    enabled: enabled && documentId !== null && versionId !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.extractedText.extraction.status;
      return status === "queued" || status === "running" ? 5_000 : false;
    },
    queryFn: ({ signal }) =>
      evidenceApi.extractedText(
        productId,
        documentId ?? "",
        versionId ?? "",
        signal,
      ),
  });
}

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

export const evidenceRetentionReviewKey = (documentId: string) =>
  ["evidence", "retention-review", documentId] as const;

export function useEvidenceRetentionReviewQuery(
  documentId: string | null,
  enabled: boolean,
) {
  return useQuery<EvidenceRetentionReviewResponse>({
    queryKey: evidenceRetentionReviewKey(documentId ?? ""),
    enabled: enabled && documentId !== null,
    retry: false,
    queryFn: ({ signal }) =>
      evidenceApi.retentionReview(documentId ?? "", signal),
  });
}

export const evidenceLegalHoldsKey = (documentId: string) =>
  ["evidence", "legal-holds", documentId] as const;

export function useEvidenceLegalHoldsQuery(
  documentId: string | null,
  enabled: boolean,
) {
  return useQuery<EvidenceLegalHoldListResponse>({
    queryKey: evidenceLegalHoldsKey(documentId ?? ""),
    enabled: enabled && documentId !== null,
    retry: false,
    queryFn: ({ signal }) => evidenceApi.legalHolds(documentId ?? "", signal),
  });
}

function invalidateEvidenceRetention(
  client: ReturnType<typeof useQueryClient>,
  documentId: string,
  productId: string,
) {
  void client.invalidateQueries({
    queryKey: evidenceRetentionReviewKey(documentId),
  });
  void client.invalidateQueries({ queryKey: evidenceLegalHoldsKey(documentId) });
  void client.invalidateQueries({ queryKey: evidenceKey(productId) });
  void client.invalidateQueries({
    queryKey: evidenceVersionsKey(productId, documentId),
  });
}

export function useCreateEvidenceDeletionIntentMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      variables: Readonly<{
        documentId: string;
        input: CreateEvidenceDeletionIntentInput;
      }>,
    ) => evidenceApi.createDeletionIntent(variables.documentId, variables.input),
    onSuccess: (_, variables) =>
      invalidateEvidenceRetention(client, variables.documentId, productId),
  });
}

export function usePlaceEvidenceLegalHoldMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      variables: Readonly<{
        documentId: string;
        input: PlaceEvidenceLegalHoldInput;
      }>,
    ) => evidenceApi.placeLegalHold(variables.documentId, variables.input),
    onSuccess: (_, variables) =>
      invalidateEvidenceRetention(client, variables.documentId, productId),
  });
}

export function useReleaseEvidenceLegalHoldMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      variables: Readonly<{
        documentId: string;
        holdId: string;
        input: ReleaseEvidenceLegalHoldInput;
      }>,
    ) =>
      evidenceApi.releaseLegalHold(
        variables.documentId,
        variables.holdId,
        variables.input,
      ),
    onSuccess: (_, variables) =>
      invalidateEvidenceRetention(client, variables.documentId, productId),
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

export function useRetryEvidenceExtractionMutation(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      versionId,
      idempotencyKey,
    }: Readonly<{
      documentId: string;
      versionId: string;
      idempotencyKey: string;
    }>) =>
      evidenceApi.retryExtraction(productId, documentId, versionId, {
        idempotencyKey,
      }),
    onSuccess: (_, variables) => {
      void client.invalidateQueries({ queryKey: evidenceKey(productId) });
      void client.invalidateQueries({
        queryKey: evidenceVersionsKey(productId, variables.documentId),
      });
      void client.invalidateQueries({
        queryKey: evidenceExtractedTextKey(
          productId,
          variables.documentId,
          variables.versionId,
        ),
      });
      void client.invalidateQueries({
        queryKey: ["evidence", productId, "search"],
      });
    },
  });
}
