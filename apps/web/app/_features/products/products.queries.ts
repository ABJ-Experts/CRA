"use client";

import type {
  AddReleaseMarketAvailabilityInput,
  ArchiveProductInput,
  ArchiveReleaseInput,
  CorrectPlacedOnMarketDateInput,
  CorrectReleaseMarketAvailabilityInput,
  CreateProductInput,
  CreateReleaseInput,
  MoveProductLegalEntityInput,
  ProductListQuery,
  ReleaseListQuery,
  RemoveReleaseMarketAvailabilityInput,
  TransitionReleaseLifecycleInput,
  UpdateProductInput,
  UpdateReleaseInput,
} from "@repo/contracts/products";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { productKeys } from "./products.keys";
import { productsApi } from "./products.api";

function listKey(query: Partial<ProductListQuery>): string {
  return JSON.stringify(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

export function useProductsQuery(
  query: Partial<ProductListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.list(listKey(query)),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => productsApi.list(query, signal),
  });
}

export function useProductQuery(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: productKeys.detail(productId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.get(productId, signal),
  });
}

export function useProductReleasesQuery(
  productId: string,
  query: {
    archived?: boolean;
    page?: number;
    pageSize?: number;
    lifecycle?: ReleaseListQuery["lifecycle"];
  },
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...productKeys.releases(productId), listKey(query)],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => productsApi.listReleases(productId, query, signal),
  });
}

export function useMemberStatesQuery(enabled: boolean) {
  return useQuery({
    queryKey: productKeys.memberStates,
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.listMemberStates(signal),
  });
}

export function useReleaseMarketAvailabilityQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.marketAvailability(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.getReleaseMarketAvailability(productId, releaseId, signal),
  });
}

export function useReleaseLifecycleTimelineQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.lifecycleTimeline(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.getReleaseLifecycleTimeline(productId, releaseId, signal),
  });
}

function useInvalidateProducts() {
  const client = useQueryClient();
  return async (productId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: productKeys.all }),
      ...(productId
        ? [
            client.invalidateQueries({
              queryKey: productKeys.detail(productId),
            }),
          ]
        : []),
    ]);
  };
}

export function useCreateProductMutation() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateProductInput) => productsApi.create(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProductMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: UpdateProductInput) =>
      productsApi.update(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useArchiveProductMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: ArchiveProductInput) =>
      productsApi.archive(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useMoveProductLegalEntityMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: MoveProductLegalEntityInput) =>
      productsApi.moveLegalEntity(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useCreateReleaseMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateReleaseInput) =>
      productsApi.createRelease(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useUpdateReleaseMutation(productId: string, releaseId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: UpdateReleaseInput) =>
      productsApi.updateRelease(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useArchiveReleaseMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: ArchiveReleaseInput) =>
      productsApi.archiveRelease(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useAddReleaseMarketAvailabilityMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: AddReleaseMarketAvailabilityInput) =>
      productsApi.addReleaseMarketAvailability(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useRemoveReleaseMarketAvailabilityMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      countryCode,
      input,
    }: Readonly<{
      countryCode: string;
      input: RemoveReleaseMarketAvailabilityInput;
    }>) =>
      productsApi.removeReleaseMarketAvailability(
        productId,
        releaseId,
        countryCode,
        input,
      ),
    onSuccess: () => invalidate(productId),
  });
}

export function useCorrectReleaseMarketAvailabilityMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CorrectReleaseMarketAvailabilityInput) =>
      productsApi.correctReleaseMarketAvailability(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useTransitionReleaseLifecycleMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: TransitionReleaseLifecycleInput) =>
      productsApi.transitionReleaseLifecycle(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useCorrectPlacedOnMarketDateMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CorrectPlacedOnMarketDateInput) =>
      productsApi.correctPlacedOnMarketDate(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}
