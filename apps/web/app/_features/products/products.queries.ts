"use client";

import type {
  AddReleaseMarketAvailabilityInput,
  ArchiveProductInput,
  ArchiveReleaseInput,
  CorrectPlacedOnMarketDateInput,
  CorrectReleaseMarketAvailabilityInput,
  CreateProductInput,
  CreateReleaseInput,
  CreateSupportPeriodRequest,
  MoveProductLegalEntityInput,
  ProductListQuery,
  ReleaseListQuery,
  RemoveReleaseMarketAvailabilityInput,
  SupersedeSupportPeriodRequest,
  PreviewSupportPeriodChangeRequest,
  TransitionReleaseLifecycleInput,
  UpdateSupportAlertIntervalsRequest,
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

export function useSupportPeriodHistoryQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.supportPeriods(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listSupportPeriods(productId, releaseId, signal),
  });
}

export function useSupportPeriodRetentionQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.supportRetention(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.getSupportRetention(productId, signal),
  });
}

export function useSupportAlertsQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.supportAlerts(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.getSupportAlerts(productId, signal),
  });
}

export function useSupportAlertIntervalsQuery(enabled: boolean) {
  return useQuery({
    queryKey: productKeys.supportAlertIntervals,
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.getSupportAlertIntervals(signal),
  });
}

function useInvalidateProducts() {
  const client = useQueryClient();
  return async (
    productId?: string,
    releaseId?: string,
    options: Readonly<{ support?: boolean }> = {},
  ) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: productKeys.all }),
      ...(productId
        ? [
            client.invalidateQueries({
              queryKey: productKeys.detail(productId),
            }),
            client.invalidateQueries({
              queryKey: productKeys.releases(productId),
            }),
            ...(options.support
              ? [
                  client.invalidateQueries({
                    queryKey: productKeys.supportPeriods(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.supportRetention(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.supportAlerts(productId),
                  }),
                ]
              : []),
          ]
        : []),
      ...(productId && releaseId
        ? [
            client.invalidateQueries({
              queryKey: productKeys.marketAvailability(productId, releaseId),
            }),
            client.invalidateQueries({
              queryKey: productKeys.lifecycleTimeline(productId, releaseId),
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
    onSuccess: () => invalidate(productId, releaseId),
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
    onSuccess: () => invalidate(productId, releaseId),
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
    onSuccess: () => invalidate(productId, releaseId),
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
    onSuccess: () => invalidate(productId, releaseId),
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
    onSuccess: () => invalidate(productId, releaseId),
  });
}

export function usePreviewSupportPeriodMutation(productId: string) {
  return useMutation({
    mutationFn: (input: PreviewSupportPeriodChangeRequest) =>
      productsApi.previewSupportPeriod(productId, input),
  });
}

export function useCreateSupportPeriodMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateSupportPeriodRequest) =>
      productsApi.createSupportPeriod(productId, input),
    onSuccess: () => invalidate(productId, undefined, { support: true }),
  });
}

export function useSupersedeSupportPeriodMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      supportPeriodId,
      input,
    }: Readonly<{
      supportPeriodId: string;
      input: SupersedeSupportPeriodRequest;
    }>) =>
      productsApi.supersedeSupportPeriod(productId, supportPeriodId, input),
    onSuccess: () => invalidate(productId, undefined, { support: true }),
  });
}

export function useUpdateSupportAlertIntervalsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSupportAlertIntervalsRequest) =>
      productsApi.updateSupportAlertIntervals(input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: productKeys.supportAlertIntervals,
        }),
        client.invalidateQueries({ queryKey: productKeys.all }),
      ]);
    },
  });
}
