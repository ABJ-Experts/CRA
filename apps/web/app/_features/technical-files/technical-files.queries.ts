"use client";

import type {
  AddTechnicalFileSourceRequest,
  CancelTechnicalFileSnapshotExportRequest,
  CreateTechnicalFileSnapshotExportRequest,
  CreateTechnicalFileSnapshotRequest,
  CreateTechnicalFileRequest,
  CreateTechnicalFileDeclarationDraftRequest,
  IssueTechnicalFileDeclarationRequest,
  RemoveTechnicalFileSourceRequest,
  RecalculateTechnicalFileReadinessRequest,
  ReissueTechnicalFileDeclarationRequest,
  ReviewTechnicalFileSourceRequest,
  SignalTechnicalFileSourceMaterialChangeRequest,
  TechnicalFileSnapshotExportResponse,
  TechnicalFileDeclarationPreviewResponse,
  CreateTechnicalFileAuditorGrantRequest,
  RevokeTechnicalFileAuditorGrantRequest,
  RedeemTechnicalFileAuditorGrantRequest,
  TechnicalFileAuditorGrantPreviewResponse,
  TechnicalFileAuditorManifestResponse,
  TechnicalFileAuditorSnapshotViewResponse,
  UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { technicalFilesApi } from "./technical-files.api";

const key = (productId: string) => ["technical-files", productId] as const;
const readinessKey = (productId: string) =>
  ["technical-file-readiness", productId] as const;
const snapshotsKey = (productId: string) =>
  ["technical-file-snapshots", productId] as const;
const declarationsKey = (productId: string) =>
  ["technical-file-declarations", productId] as const;
const declarationPreviewKey = (productId: string, snapshotId: string) =>
  ["technical-file-declaration-preview", productId, snapshotId] as const;
const snapshotExportKey = (
  productId: string,
  snapshotId: string,
  exportId: string,
) =>
  ["technical-file-snapshot-export", productId, snapshotId, exportId] as const;
const auditorGrantsKey = (productId: string, snapshotId: string) =>
  ["technical-file-auditor-grants", productId, snapshotId] as const;
const auditorGrantPreviewKey = (productId: string, snapshotId: string, exportId: string) =>
  ["technical-file-auditor-grant-preview", productId, snapshotId, exportId] as const;
const auditorSnapshotKey = ["technical-file-auditor-snapshot"] as const;
const auditorManifestKey = ["technical-file-auditor-manifest"] as const;

export function useTechnicalFileQuery(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(productId),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.get(productId, signal),
  });
}

export function useTechnicalFileReadinessQuery(
  productId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: readinessKey(productId),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.getReadiness(productId, signal),
  });
}

export function useTechnicalFileSnapshotsQuery(
  productId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: snapshotsKey(productId),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.listSnapshots(productId, signal),
  });
}

export function useTechnicalFileSnapshotExportQuery(
  productId: string,
  snapshotId: string | null,
  exportId: string | null,
  enabled: boolean,
) {
  return useQuery<TechnicalFileSnapshotExportResponse>({
    queryKey: snapshotExportKey(productId, snapshotId ?? "", exportId ?? ""),
    enabled:
      enabled && productId !== "" && snapshotId !== null && exportId !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.export.status;
      return status === "queued" || status === "generating" ? 2_000 : false;
    },
    queryFn: ({ signal }) =>
      technicalFilesApi.getSnapshotExport(
        productId,
        snapshotId ?? "",
        exportId ?? "",
        signal,
      ),
  });
}

export function useTechnicalFileDeclarationsQuery(
  productId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: declarationsKey(productId),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      technicalFilesApi.listDeclarations(productId, signal),
  });
}

export function useTechnicalFileDeclarationPreviewQuery(
  productId: string,
  snapshotId: string | null,
  enabled: boolean,
) {
  return useQuery<TechnicalFileDeclarationPreviewResponse>({
    queryKey: declarationPreviewKey(productId, snapshotId ?? ""),
    enabled: enabled && productId !== "" && snapshotId !== null,
    retry: false,
    queryFn: ({ signal }) =>
      technicalFilesApi.previewDeclaration(productId, snapshotId ?? "", signal),
  });
}

function invalidateReadiness(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: key(productId) }),
    queryClient.invalidateQueries({ queryKey: readinessKey(productId) }),
  ]);
}

function invalidateSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
) {
  return queryClient.invalidateQueries({ queryKey: snapshotsKey(productId) });
}

function invalidateDeclarations(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: declarationsKey(productId),
  });
}

export function useCreateTechnicalFileMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTechnicalFileRequest) =>
      technicalFilesApi.create(productId, input),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useUpdateTechnicalFileSectionMutation(
  productId: string,
  sectionKey: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTechnicalFileSectionRequest) =>
      technicalFilesApi.updateSection(productId, sectionKey, input),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useAddTechnicalFileSourceMutation(
  productId: string,
  sectionKey: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddTechnicalFileSourceRequest) =>
      technicalFilesApi.addSource(productId, sectionKey, input),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useRemoveTechnicalFileSourceMutation(
  productId: string,
  sectionKey: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceId,
      ...input
    }: RemoveTechnicalFileSourceRequest & { sourceId: string }) =>
      technicalFilesApi.removeSource(productId, sectionKey, sourceId, input),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useRecalculateTechnicalFileReadinessMutation(
  productId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecalculateTechnicalFileReadinessRequest) =>
      technicalFilesApi.recalculateReadiness(productId, input),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useReviewTechnicalFileSourceMutation(
  productId: string,
  sectionKey: string,
  sourceId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewTechnicalFileSourceRequest) =>
      technicalFilesApi.reviewSource(productId, sectionKey, sourceId, input),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useSignalTechnicalFileSourceMaterialChangeMutation(
  productId: string,
  sectionKey: string,
  sourceId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignalTechnicalFileSourceMaterialChangeRequest) =>
      technicalFilesApi.signalSourceMaterialChange(
        productId,
        sectionKey,
        sourceId,
        input,
      ),
    onSuccess: () => invalidateReadiness(queryClient, productId),
  });
}

export function useCreateTechnicalFileSnapshotMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTechnicalFileSnapshotRequest) =>
      technicalFilesApi.createSnapshot(productId, input),
    onSuccess: () => invalidateSnapshots(queryClient, productId),
  });
}

export function useCreateTechnicalFileSnapshotExportMutation(
  productId: string,
  snapshotId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTechnicalFileSnapshotExportRequest) =>
      technicalFilesApi.createSnapshotExport(productId, snapshotId, input),
    onSuccess: () => invalidateSnapshots(queryClient, productId),
  });
}

export function useCancelTechnicalFileSnapshotExportMutation(
  productId: string,
  snapshotId: string,
  exportId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CancelTechnicalFileSnapshotExportRequest) =>
      technicalFilesApi.cancelSnapshotExport(
        productId,
        snapshotId,
        exportId,
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: snapshotExportKey(productId, snapshotId, exportId),
      });
      return invalidateSnapshots(queryClient, productId);
    },
  });
}

export function useTechnicalFileSnapshotDownloadMutation() {
  return useMutation({
    mutationFn: ({
      productId,
      snapshotId,
      exportId,
      artifact,
    }: {
      productId: string;
      snapshotId: string;
      exportId: string;
      artifact: "pdf" | "archive";
    }) =>
      technicalFilesApi.downloadSnapshotExport(
        productId,
        snapshotId,
        exportId,
        artifact,
      ),
  });
}

export function useSaveTechnicalFileDeclarationDraftMutation(
  productId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ declarationId, ...input }: CreateTechnicalFileDeclarationDraftRequest & { declarationId?: string }) =>
      declarationId
        ? technicalFilesApi.updateDeclarationDraft(productId, declarationId, input)
        : technicalFilesApi.saveDeclarationDraft(productId, input),
    onSuccess: () => invalidateDeclarations(queryClient, productId),
  });
}

export function useIssueTechnicalFileDeclarationMutation(
  productId: string,
  declarationId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueTechnicalFileDeclarationRequest) =>
      technicalFilesApi.issueDeclaration(productId, declarationId, input),
    onSuccess: () => invalidateDeclarations(queryClient, productId),
  });
}

export function useReissueTechnicalFileDeclarationMutation(
  productId: string,
  declarationId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReissueTechnicalFileDeclarationRequest) =>
      technicalFilesApi.reissueDeclaration(productId, declarationId, input),
    onSuccess: () => invalidateDeclarations(queryClient, productId),
  });
}

export function useTechnicalFileDeclarationDownloadMutation() {
  return useMutation({
    mutationFn: ({
      productId,
      declarationId,
    }: {
      productId: string;
      declarationId: string;
    }) => technicalFilesApi.downloadDeclaration(productId, declarationId),
  });
}

export function useTechnicalFileAuditorGrantsQuery(
  productId: string,
  snapshotId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: auditorGrantsKey(productId, snapshotId ?? ""),
    enabled: enabled && productId !== "" && snapshotId !== null,
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.listAuditorGrants(productId, snapshotId ?? "", signal),
  });
}

export function useTechnicalFileAuditorGrantPreviewQuery(
  productId: string,
  snapshotId: string | null,
  exportId: string | null,
  enabled: boolean,
) {
  return useQuery<TechnicalFileAuditorGrantPreviewResponse>({
    queryKey: auditorGrantPreviewKey(productId, snapshotId ?? "", exportId ?? ""),
    enabled: enabled && productId !== "" && snapshotId !== null && exportId !== null,
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.previewAuditorGrant(productId, snapshotId ?? "", exportId ?? "", signal),
  });
}

export function useCreateTechnicalFileAuditorGrantMutation(productId: string, snapshotId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTechnicalFileAuditorGrantRequest) => technicalFilesApi.createAuditorGrant(productId, snapshotId ?? "", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: auditorGrantsKey(productId, snapshotId ?? "") }),
  });
}

export function useRevokeTechnicalFileAuditorGrantMutation(productId: string, snapshotId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ grantId, ...input }: RevokeTechnicalFileAuditorGrantRequest & { grantId: string }) =>
      technicalFilesApi.revokeAuditorGrant(productId, snapshotId ?? "", grantId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: auditorGrantsKey(productId, snapshotId ?? "") }),
  });
}

export function useRedeemTechnicalFileAuditorGrantMutation() {
  return useMutation({ mutationFn: (input: RedeemTechnicalFileAuditorGrantRequest) => technicalFilesApi.redeemAuditorGrant(input) });
}

export function useTechnicalFileAuditorSnapshotQuery(enabled: boolean) {
  return useQuery<TechnicalFileAuditorSnapshotViewResponse>({
    queryKey: auditorSnapshotKey,
    enabled,
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.getAuditorSnapshot(signal),
  });
}

export function useTechnicalFileAuditorManifestQuery(enabled: boolean) {
  return useQuery<TechnicalFileAuditorManifestResponse>({
    queryKey: auditorManifestKey,
    enabled,
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.getAuditorManifest(signal),
  });
}
