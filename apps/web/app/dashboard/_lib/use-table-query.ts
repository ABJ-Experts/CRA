"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { pagedSchema, type Paged } from "@repo/contracts/pagination";
import { pageParamsSchema } from "@repo/contracts/pagination/schemas";
import type { SortingState } from "@repo/ui/data-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { useMocksReady } from "../../_providers/providers";

/**
 * One hook behind all four Tables screens.
 *
 * Owns the server-driven table state (page, size, sort, search) and derives
 * the query from it, so the request and what the table displays can never
 * disagree. Two behaviours here are the difference between a demo and
 * something usable:
 *
 *  - Changing sort or search RESETS to page one. Without it, filtering while
 *    on page 6 asks for a page the filtered set no longer has and lands on an
 *    empty table that looks broken.
 *  - `keepPreviousData` holds the previous page on screen while the next one
 *    loads, so paging does not collapse the table to skeletons and shift the
 *    whole page height on every click.
 */

export interface UseTableQueryOptions<T> {
  /** Resource path, e.g. `/api/orders`. */
  endpoint: `/${string}`;
  rowSchema: z.ZodType<T>;
  initialPageSize?: number;
  initialSorting?: SortingState;
  /** Force the endpoint to fail, for exercising the error path. */
  simulateError?: boolean;
}

export function useTableQuery<T>({
  endpoint,
  rowSchema,
  initialPageSize = 15,
  initialSorting = [],
  simulateError = false,
}: UseTableQueryOptions<T>) {
  const ready = useMocksReady();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);
  const [sorting, setSortingRaw] = useState<SortingState>(initialSorting);
  const [search, setSearchRaw] = useState("");

  const sort = sorting[0];

  const params = useMemo(() => {
    const parsed = pageParamsSchema.parse({
      page,
      pageSize,
      sort: sort?.id,
      order: sort?.desc ? "desc" : "asc",
      q: search,
    });
    const p = new URLSearchParams({
      page: String(parsed.page),
      pageSize: String(parsed.pageSize),
    });
    if (parsed.sort) {
      p.set("sort", parsed.sort);
      p.set("order", parsed.order);
    }
    if (parsed.q) p.set("q", parsed.q);
    if (simulateError) p.set("fail", "1");
    return p;
  }, [page, pageSize, sort, search, simulateError]);
  const queryString = params.toString();
  const responseSchema = useMemo(() => pagedSchema(rowSchema), [rowSchema]);

  const query = useQuery<Paged<T>>({
    queryKey: [endpoint, queryString],
    enabled: ready,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      authenticatedRequestJson({
        path: `${endpoint}?${queryString}`,
        schema: responseSchema,
        signal,
      }),
  });

  useEffect(() => {
    const serverPage = query.data?.page;
    if (
      serverPage !== undefined &&
      !query.isPlaceholderData &&
      serverPage !== page
    ) {
      setPage(serverPage);
    }
  }, [page, query.data?.page, query.isPlaceholderData]);

  const setSorting = useCallback(
    (updater: React.SetStateAction<SortingState>) => {
      setSortingRaw(updater);
      setPage(1);
    },
    [],
  );

  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    setPage(1);
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size);
    setPage(1);
  }, []);

  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    pageCount: query.data?.pageCount ?? 1,
    page,
    pageSize,
    sorting,
    search,
    setPage,
    setPageSize,
    setSorting,
    setSearch,
    /* `isLoading` is only the very first load. A refetch keeps the old rows
     * (see `keepPreviousData`), so it must not swap them for skeletons. */
    isLoading: !ready || (query.isLoading && !query.data),
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error instanceof Error ? query.error.message : undefined,
    refetch: query.refetch,
  };
}
