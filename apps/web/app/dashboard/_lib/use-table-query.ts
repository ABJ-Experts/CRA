"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SortingState } from "@repo/ui/data-table";
import { useCallback, useMemo, useState } from "react";
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

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface UseTableQueryOptions {
  /** Resource path, e.g. `/api/orders`. */
  endpoint: string;
  initialPageSize?: number;
  initialSorting?: SortingState;
  /** Force the endpoint to fail, for exercising the error path. */
  simulateError?: boolean;
}

export function useTableQuery<T>({
  endpoint,
  initialPageSize = 15,
  initialSorting = [],
  simulateError = false,
}: UseTableQueryOptions) {
  const ready = useMocksReady();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);
  const [sorting, setSortingRaw] = useState<SortingState>(initialSorting);
  const [search, setSearchRaw] = useState("");

  const sort = sorting[0];

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (sort) {
      p.set("sort", sort.id);
      p.set("order", sort.desc ? "desc" : "asc");
    }
    if (search) p.set("q", search);
    if (simulateError) p.set("fail", "1");
    return p;
  }, [page, pageSize, sort, search, simulateError]);

  const query = useQuery<Paged<T>>({
    queryKey: [endpoint, params.toString()],
    enabled: ready,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const res = await fetch(`${endpoint}?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      return (await res.json()) as Paged<T>;
    },
  });

  const setSorting = useCallback((updater: React.SetStateAction<SortingState>) => {
    setSortingRaw(updater);
    setPage(1);
  }, []);

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
