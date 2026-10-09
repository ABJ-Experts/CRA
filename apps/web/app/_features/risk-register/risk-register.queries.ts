"use client";

import type {
  AcceptResidualRiskRequest,
  ArchiveRiskRegisterRiskRequest,
  CreateRiskRegisterRiskRequest,
  UpdateRiskRegisterRiskRequest,
} from "@repo/contracts/risk-registers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { riskRegisterApi } from "./risk-register.api";

const key = (productId: string) => ["risk-register", productId] as const;

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: string,
) {
  return queryClient.invalidateQueries({ queryKey: key(productId) });
}

export function useRiskRegisterQuery(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(productId),
    enabled: enabled && productId !== "",
    retry: false,
    queryFn: ({ signal }) => riskRegisterApi.get(productId, signal),
  });
}

export function useCreateRiskMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRiskRegisterRiskRequest) =>
      riskRegisterApi.createRisk(productId, input),
    onSuccess: () => invalidate(queryClient, productId),
  });
}

export function useUpdateRiskMutation(productId: string, riskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRiskRegisterRiskRequest) =>
      riskRegisterApi.updateRisk(productId, riskId, input),
    onSuccess: () => invalidate(queryClient, productId),
  });
}

export function useAcceptResidualRiskMutation(
  productId: string,
  riskId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptResidualRiskRequest) =>
      riskRegisterApi.acceptResidualRisk(productId, riskId, input),
    onSuccess: () => invalidate(queryClient, productId),
  });
}

export function useArchiveRiskMutation(productId: string, riskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveRiskRegisterRiskRequest) =>
      riskRegisterApi.archiveRisk(productId, riskId, input),
    onSuccess: () => invalidate(queryClient, productId),
  });
}
