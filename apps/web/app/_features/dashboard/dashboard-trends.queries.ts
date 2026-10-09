"use client";
import type {
  DashboardTrendsQuery,
  DashboardTrendMetric,
} from "@repo/contracts/dashboard/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../../_lib/http/api-client";
import { useEffect, useRef } from "react";
import { productsApi } from "../products/products.api";
import { DashboardGateway } from "./dashboard-gateway";
import {
  isDashboardAuthorizationFailure,
  revokeDashboardScope,
} from "./dashboard-access";
const gateway = new DashboardGateway();

export function useDashboardTrends(
  filters: DashboardTrendsQuery,
  scope: string,
  enabled: boolean,
  pollingPaused = false,
) {
  const client = useQueryClient();
  const exportController = useRef<AbortController | null>(null);
  const key = ["dashboard", scope, "trends", filters] as const;
  const query = useQuery({
    queryKey: key,
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 30_000,
    refetchInterval: pollingPaused ? false : 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    queryFn: ({ signal }) =>
      gateway
        .trends(filters, signal)
        .then((data) => {
          if (data.organizationId !== JSON.parse(scope)[0])
            throw new ApiClientError(
              "invalid_response",
              "The trend organization changed. Refresh to continue.",
            );
          return data;
        })
        .catch((error: unknown) => {
          if (isDashboardAuthorizationFailure(error))
            revokeDashboardScope(client, scope);
          throw error;
        }),
  });
  useEffect(() => {
    const controller = new AbortController();
    exportController.current = controller;
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey: ["dashboard", scope, "trends"] });
      client.removeQueries({ queryKey: ["dashboard", scope, "trends"] });
    };
  }, [client, scope]);
  return {
    ...query,
    data: enabled && !query.isError ? query.data : undefined,
    exportDataset: (token: string) =>
      downloadDashboardTrends(token, exportController.current?.signal).catch(
        (error: unknown) => {
          if (isDashboardAuthorizationFailure(error))
            revokeDashboardScope(client, scope);
          throw error;
        },
      ),
  };
}
export function useDashboardTrendSources(
  token: string | undefined,
  metric: DashboardTrendMetric | null,
  cursor: string | undefined,
  scope: string,
  enabled: boolean,
) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["dashboard", scope, "trends", "sources", token, metric, cursor],
    enabled: enabled && !!token && !!metric,
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    queryFn: ({ signal }) =>
      gateway
        .trendSources({ datasetToken: token!, metric: metric!, cursor }, signal)
        .catch((error: unknown) => {
          if (isDashboardAuthorizationFailure(error))
            revokeDashboardScope(client, scope);
          throw error;
        }),
  });
  return { ...query, data: enabled && !query.isError ? query.data : undefined };
}
export async function downloadDashboardTrends(
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const csv = await gateway.trendExport(token, signal);
  if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "cra-trends.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useDashboardTrendProducts(
  scope: string,
  enabled: boolean,
  search: string,
) {
  return useQuery({
    queryKey: ["dashboard", scope, "trends", "products", search],
    enabled,
    retry: false,
    gcTime: 0,
    queryFn: ({ signal }) =>
      productsApi.list(
        {
          page: 1,
          pageSize: 100,
          ...(search.trim() ? { q: search.trim() } : {}),
        },
        signal,
      ),
  });
}
