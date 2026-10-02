"use client";

import type { CustomFrameworkCommandInput } from "@repo/contracts/frameworks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { customFrameworksApi } from "./custom-frameworks.api";

const customListKey = (organizationId: string) =>
  ["frameworks", organizationId, "custom"] as const;
const catalogKey = (organizationId: string) =>
  ["frameworks", organizationId, "catalog"] as const;
const customDetailKey = (organizationId: string, draftId: string) =>
  ["frameworks", organizationId, "custom", draftId] as const;

export function useCustomFrameworks(
  organizationId: string | null,
  enabled: boolean,
  offset = 0,
) {
  return useQuery({
    queryKey: [...customListKey(organizationId ?? "none"), "page", offset],
    enabled: enabled && organizationId !== null,
    retry: false,
    queryFn: ({ signal }) => customFrameworksApi.list(20, offset, signal),
  });
}

export function useCustomFrameworkDetail(
  organizationId: string | null,
  draftId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: customDetailKey(organizationId ?? "none", draftId ?? "none"),
    enabled: enabled && organizationId !== null && draftId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (draftId === null) throw new Error("Custom framework required.");
      return customFrameworksApi.detail(draftId, signal);
    },
  });
}

export function useCustomFrameworkCommand(organizationId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      draftId,
      input,
    }: {
      draftId: string | null;
      input: CustomFrameworkCommandInput;
    }) => customFrameworksApi.command(draftId, input),
    onSuccess: (result) => {
      if (organizationId !== null) {
        void client.invalidateQueries({
          queryKey: customListKey(organizationId),
        });
        void client.invalidateQueries({ queryKey: catalogKey(organizationId) });
        void client.invalidateQueries({
          queryKey: customDetailKey(organizationId, result.draftId),
        });
      }
    },
  });
}
