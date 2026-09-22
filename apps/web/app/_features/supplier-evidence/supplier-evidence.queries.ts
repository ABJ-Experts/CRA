"use client";

import type {
  CloseSupplierEvidenceRequestInput,
  CreateSupplierEvidenceRequestInput,
  IssueSupplierEvidenceRequestInput,
  PreviewSupplierEvidenceRequestInput,
  ReissueSupplierEvidenceRequestInput,
  RevokeSupplierEvidenceRequestInput,
} from "@repo/contracts/supplier-evidence";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  };
}

export function useSupplierEvidenceRequestsQuery(enabled: boolean) {
  return useQuery({
    queryKey: supplierEvidenceKeys.requests,
    enabled,
    retry: false,
    queryFn: ({ signal }) => supplierEvidenceApi.list(signal),
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
