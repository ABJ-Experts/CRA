"use client";

import {
  frameworkCatalogResponseSchema,
  type SelectFrameworkInput,
} from "@repo/contracts/frameworks";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useMemo } from "react";
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
  const query = useInfiniteQuery({
    queryKey: catalogKey(organizationId ?? "none"),
    enabled: enabled && organizationId !== null,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      frameworksApi.catalog(signal, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const data = useMemo(() => {
    if (!query.data) return undefined;
    type Pack = z.output<
      typeof frameworkCatalogResponseSchema
    >["packs"][number];
    const packs = new Map<string, Pack>();
    for (const page of query.data.pages) {
      for (const pack of page.packs) {
        const previous = packs.get(pack.packKey);
        packs.set(
          pack.packKey,
          previous
            ? {
                ...previous,
                versions: [
                  ...previous.versions,
                  ...pack.versions.filter(
                    (version) =>
                      !previous.versions.some(
                        (item) => item.versionKey === version.versionKey,
                      ),
                  ),
                ],
                selection: pack.selection ?? previous.selection,
              }
            : pack,
        );
      }
    }
    return { packs: [...packs.values()] };
  }, [query.data]);
  return { ...query, data };
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
        client.setQueryData<
          InfiniteData<
            z.output<typeof frameworkCatalogResponseSchema>,
            string | undefined
          >
        >(
          catalogKey(organizationId),
          (current) =>
            current && {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                packs: page.packs.map((pack) =>
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
              })),
            },
        );
        void client.invalidateQueries({ queryKey: catalogKey(organizationId) });
      }
    },
  });
}
