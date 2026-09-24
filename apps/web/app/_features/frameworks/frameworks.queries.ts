"use client";

import {
  frameworkCatalogResponseSchema,
  type SelectFrameworkInput,
} from "@repo/contracts/frameworks";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";

import { frameworksApi } from "./frameworks.api";

const catalogKey = (organizationId: string) =>
  ["frameworks", organizationId, "catalog"] as const;
const treeKey = (organizationId: string, packKey: string, versionKey: string) =>
  ["frameworks", organizationId, "tree", packKey, versionKey] as const;

export function useFrameworkCatalog(
  organizationId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: catalogKey(organizationId ?? "none"),
    enabled: enabled && organizationId !== null,
    retry: false,
    queryFn: ({ signal }) => frameworksApi.catalog(signal),
  });
}

export function useFrameworkTree(
  organizationId: string | null,
  packKey: string | null,
  versionKey: string | null,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: treeKey(
      organizationId ?? "none",
      packKey ?? "none",
      versionKey ?? "none",
    ),
    enabled:
      enabled &&
      organizationId !== null &&
      packKey !== null &&
      versionKey !== null,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (packKey === null || versionKey === null)
        throw new Error("Framework version required.");
      return frameworksApi.tree(packKey, versionKey, pageParam, signal);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useSelectFramework(organizationId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      packKey,
      input,
    }: {
      packKey: string;
      input: SelectFrameworkInput;
    }) => frameworksApi.select(packKey, input),
    onSuccess: (selection) => {
      if (organizationId !== null) {
        client.setQueryData<z.output<typeof frameworkCatalogResponseSchema>>(
          catalogKey(organizationId),
          (current) =>
            current && {
              ...current,
              packs: current.packs.map((pack) =>
                pack.packKey === selection.packKey
                  ? {
                      ...pack,
                      selection: {
                        versionKey: selection.versionKey,
                        enabled: selection.enabled,
                        revision: selection.revision,
                      },
                    }
                  : pack,
              ),
            },
        );
        void client.invalidateQueries({ queryKey: catalogKey(organizationId) });
      }
    },
  });
}
