"use client";

import type {
  AddTechnicalFileSourceRequest,
  CreateTechnicalFileRequest,
  RemoveTechnicalFileSourceRequest,
  RecalculateTechnicalFileReadinessRequest,
  ReviewTechnicalFileSourceRequest,
  SignalTechnicalFileSourceMaterialChangeRequest,
  UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { technicalFilesApi } from "./technical-files.api";

const key = (productId: string) => ["technical-files", productId] as const;
const readinessKey = (productId: string) =>
  ["technical-file-readiness", productId] as const;

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

function invalidateReadiness(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: key(productId) }),
    queryClient.invalidateQueries({ queryKey: readinessKey(productId) }),
  ]);
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
