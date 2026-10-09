"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RevokeCiProviderReleaseBindingInput,
  UpsertCiProviderReleaseBindingInput,
} from "@repo/contracts/sboms";

import { useSession } from "../../_providers/session-provider";
import { ciBindingsApi } from "./ci-bindings.api";

function useKeys() {
  const { session } = useSession();
  const root = [
    "sboms",
    "organization",
    session?.organization?.id ?? "none",
    "ci-bindings",
  ] as const;
  return {
    root,
    runs: (bindingId: string) => [...root, bindingId, "runs"] as const,
  };
}

export function useCiBindingsQuery(enabled: boolean) {
  const keys = useKeys();
  return useQuery({
    queryKey: keys.root,
    enabled: enabled && keys.root[2] !== "none",
    retry: false,
    queryFn: ({ signal }) => ciBindingsApi.list(signal),
  });
}

export function useCiBindingRunsQuery(
  bindingId: string | null,
  enabled: boolean,
) {
  const keys = useKeys();
  return useQuery({
    queryKey: keys.runs(bindingId ?? "none"),
    enabled: enabled && keys.root[2] !== "none" && bindingId !== null,
    retry: false,
    queryFn: ({ signal }) => ciBindingsApi.listRuns(bindingId!, signal),
  });
}

export function useCreateCiBindingMutation() {
  const keys = useKeys();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertCiProviderReleaseBindingInput) =>
      ciBindingsApi.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.root }),
  });
}

export function useRevokeCiBindingMutation() {
  const keys = useKeys();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      bindingId,
      input,
    }: {
      bindingId: string;
      input: RevokeCiProviderReleaseBindingInput;
    }) => ciBindingsApi.revoke(bindingId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.root }),
  });
}
