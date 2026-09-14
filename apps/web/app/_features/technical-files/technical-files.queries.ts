"use client";

import type {
  AddTechnicalFileSourceRequest,
  CreateTechnicalFileRequest,
  RemoveTechnicalFileSourceRequest,
  UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { technicalFilesApi } from "./technical-files.api";

const key = (productId: string) => ["technical-files", productId] as const;

export function useTechnicalFileQuery(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(productId),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) => technicalFilesApi.get(productId, signal),
  });
}

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
) {
  return queryClient.invalidateQueries({ queryKey: key(productId) });
}

export function useCreateTechnicalFileMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTechnicalFileRequest) =>
      technicalFilesApi.create(productId, input),
    onSuccess: () => invalidate(queryClient, productId),
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
    onSuccess: () => invalidate(queryClient, productId),
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
    onSuccess: () => invalidate(queryClient, productId),
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
    onSuccess: () => invalidate(queryClient, productId),
  });
}
