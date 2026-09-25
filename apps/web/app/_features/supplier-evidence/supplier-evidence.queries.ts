"use client";

import type {
  CloseSupplierEvidenceRequestInput,
  CreateSupplierEvidenceRequestInput,
  IssueSupplierEvidenceRequestInput,
  PreviewSupplierEvidenceRequestInput,
  ReRequestSupplierEvidenceRequestInput,
  ReissueSupplierEvidenceRequestInput,
  RetrySupplierEvidenceReminderDeliveryInput,
  ReviewSupplierEvidenceSubmissionInput,
  SupplierEvidenceMetricsQuery,
  SupplierEvidenceOverdueListQuery,
  SupplierEvidenceReminderSettingsInput,
  SupplierEvidenceRequestListQuery,
  RevokeSupplierEvidenceRequestInput,
  StartSupplierDocumentExtractionInput,
  DecideSupplierDocumentFieldInput,
  CreateManualSupplierDocumentFieldInput,
} from "@repo/contracts/supplier-evidence";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { supplierEvidenceApi } from "./supplier-evidence.api";
import { supplierEvidenceKeys } from "./supplier-evidence.keys";

function useInvalidateRequests() {
  const client = useQueryClient();
  return (requestId?: string) => {
    void client.invalidateQueries({ queryKey: supplierEvidenceKeys.requests });
    if (requestId)
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.request(requestId),
      });
    if (requestId)
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.reviewRequest(requestId),
      });
  };
}

export function useSupplierEvidenceRequestsQuery(
  enabled: boolean,
  query: Partial<SupplierEvidenceRequestListQuery> = {},
) {
  return useQuery({
    queryKey: [...supplierEvidenceKeys.requests, query],
    enabled,
    retry: false,
    queryFn: ({ signal }) => supplierEvidenceApi.list(query, signal),
  });
}

export function useSupplierEvidenceEligibleSbomRequestsQuery(
  supplierId: string,
  productId: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: supplierEvidenceKeys.eligibleSbomRequests(supplierId, productId),
    enabled: enabled && supplierId !== "" && productId !== "",
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      supplierEvidenceApi.eligibleSbomRequests(
        {
          supplierId,
          productId,
          cursor: pageParam,
          limit: 100,
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useSupplierEvidenceRequestQuery(
  requestId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: requestId
      ? supplierEvidenceKeys.request(requestId)
      : supplierEvidenceKeys.requests,
    enabled: enabled && requestId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (!requestId)
        throw new Error("An evidence request identifier is required.");
      return supplierEvidenceApi.detail(requestId, signal);
    },
  });
}

/** Reviewer-only data remains separate from the ordinary request-detail cache. */
export function useSupplierEvidenceReviewRequestQuery(
  requestId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: requestId
      ? supplierEvidenceKeys.reviewRequest(requestId)
      : supplierEvidenceKeys.requests,
    enabled: enabled && requestId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (!requestId)
        throw new Error("An evidence request identifier is required.");
      return supplierEvidenceApi.reviewDetail(requestId, signal);
    },
  });
}

export function useCreateSupplierEvidenceRequestMutation() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: CreateSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.create(input),
    onSuccess: (response) => invalidate(response.request.id),
  });
}
export function usePreviewSupplierEvidenceRequestMutation() {
  return useMutation({
    mutationFn: (input: PreviewSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.preview(input),
  });
}
export function useIssueSupplierEvidenceRequestMutation(requestId: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: IssueSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.issue(requestId, input),
    onSuccess: () => invalidate(requestId),
  });
}
export function useReissueSupplierEvidenceRequestMutation(requestId: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: ReissueSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.reissue(requestId, input),
    onSuccess: () => invalidate(requestId),
  });
}
export function useRevokeSupplierEvidenceRequestMutation(requestId: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: RevokeSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.revoke(requestId, input),
    onSuccess: () => invalidate(requestId),
  });
}
export function useCloseSupplierEvidenceRequestMutation(requestId: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: CloseSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.close(requestId, input),
    onSuccess: () => invalidate(requestId),
  });
}

export function useReviewSupplierEvidenceSubmissionMutation(requestId: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: ({
      submissionId,
      input,
    }: Readonly<{
      submissionId: string;
      input: ReviewSupplierEvidenceSubmissionInput;
    }>) => supplierEvidenceApi.reviewSubmission(requestId, submissionId, input),
    onSuccess: () => invalidate(requestId),
  });
}

export function useSupplierDocumentExtractionQuery(
  requestId: string,
  submissionId: string,
  productId: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: supplierEvidenceKeys.extraction(
      requestId,
      submissionId,
      productId,
    ),
    enabled,
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      supplierEvidenceApi.extraction(
        requestId,
        submissionId,
        productId,
        signal,
        pageParam ?? undefined,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.run?.status === "pending" ||
      query.state.data?.pages[0]?.run?.status === "processing"
        ? 2_000
        : false,
  });
}

export function useStartSupplierDocumentExtractionMutation(
  requestId: string,
  submissionId: string,
  productId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StartSupplierDocumentExtractionInput) =>
      supplierEvidenceApi.startExtraction(requestId, submissionId, input),
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.extraction(
          requestId,
          submissionId,
          productId,
        ),
      }),
  });
}

export function useDecideSupplierDocumentFieldMutation(
  requestId: string,
  submissionId: string,
  productId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      fieldId,
      input,
    }: Readonly<{
      fieldId: string;
      input: DecideSupplierDocumentFieldInput;
    }>) =>
      supplierEvidenceApi.decideField(requestId, submissionId, fieldId, input),
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.extraction(
          requestId,
          submissionId,
          productId,
        ),
      }),
  });
}

export function useCreateManualSupplierDocumentFieldMutation(
  requestId: string,
  submissionId: string,
  productId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateManualSupplierDocumentFieldInput) =>
      supplierEvidenceApi.createManualField(requestId, submissionId, input),
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.extraction(
          requestId,
          submissionId,
          productId,
        ),
      }),
  });
}

export function useReRequestSupplierEvidenceRequestMutation(requestId: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: ReRequestSupplierEvidenceRequestInput) =>
      supplierEvidenceApi.reRequest(requestId, input),
    onSuccess: () => invalidate(requestId),
  });
}

export function useSupplierEvidenceReminderSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: supplierEvidenceKeys.reminderSettings,
    enabled,
    retry: false,
    queryFn: ({ signal }) => supplierEvidenceApi.reminderSettings(signal),
  });
}

export function useUpdateSupplierEvidenceReminderSettingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierEvidenceReminderSettingsInput) =>
      supplierEvidenceApi.updateReminderSettings(input),
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.reminderSettings,
      }),
  });
}

export function useSupplierEvidenceMetricsQuery(
  query: SupplierEvidenceMetricsQuery,
  enabled: boolean,
) {
  return useQuery({
    queryKey: supplierEvidenceKeys.metrics(query),
    enabled,
    retry: false,
    queryFn: ({ signal }) => supplierEvidenceApi.metrics(query, signal),
  });
}

export function useSupplierEvidenceOverdueQuery(
  query: Partial<SupplierEvidenceOverdueListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: supplierEvidenceKeys.overdue(query),
    enabled,
    retry: false,
    queryFn: ({ signal }) => supplierEvidenceApi.overdue(query, signal),
  });
}

export function useRetrySupplierEvidenceReminderMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      deliveryId,
      input,
    }: Readonly<{
      requestId: string;
      deliveryId: string;
      input: RetrySupplierEvidenceReminderDeliveryInput;
    }>) => supplierEvidenceApi.retryReminder(requestId, deliveryId, input),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.overdueRoot,
      });
      void client.invalidateQueries({
        queryKey: supplierEvidenceKeys.metricsRoot,
      });
    },
  });
}
