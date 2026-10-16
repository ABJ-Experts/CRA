"use client";

import type {
  PortfolioProductsQuery,
  PortfolioConcentrationQuery,
  PortfolioDetailQuery,
} from "@repo/contracts/dashboard/types";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { useMocksReady } from "../../_providers/providers";
import { sessionKeys } from "../session/session.keys";
import {
  isDashboardAuthorizationFailure,
  revokeDashboardScope,
} from "./dashboard-access";
import { PortfolioGateway } from "./portfolio-gateway";
import { portfolioEvidence, portfolioScope } from "./portfolio-policy";

const gateway = new PortfolioGateway();
const REFRESH_MS = 30_000;

function usePortfolioQuery<T extends { organizationId: string }>(
  kind: string,
  filters: object,
  readProjection: (signal: AbortSignal) => Promise<T>,
) {
  const client = useQueryClient();
  const { session, permissions, isLoading, isError } = useSession();
  const ready = useMocksReady();
  const live = process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const organizationId = session?.organization?.id;
  const revision =
    client.getQueryState(sessionKeys.identity)?.dataUpdatedAt ?? 0;
  const scope = portfolioScope(
    organizationId,
    session?.user.id,
    revision,
    permissions,
  );
  // Identity fetch timestamps isolate evidence, but do not change the user's
  // interaction scope. Public session identity exposes no session identifier;
  // retained references are still revalidated by the server on each read.
  const identityScope = portfolioScope(
    organizationId,
    session?.user.id,
    0,
    permissions,
  );
  const access = useQuery({
    queryKey: ["dashboard-access", scope],
    queryFn: skipToken,
    initialData: false,
    enabled: false,
    gcTime: 0,
  });
  const enabled =
    live &&
    ready &&
    !isLoading &&
    !isError &&
    !!organizationId &&
    !access.data &&
    permissions.can_view_dashboards === true &&
    permissions.can_view_products === true;
  const key = ["dashboard", scope, "portfolio", kind, filters] as const;
  const query = useQuery({
    queryKey: key,
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) => {
      try {
        const data = await readProjection(signal);
        if (data.organizationId !== organizationId)
          throw new ApiClientError(
            "invalid_response",
            "Portfolio scope changed.",
          );
        return data;
      } catch (error) {
        if (isDashboardAuthorizationFailure(error))
          revokeDashboardScope(client, scope);
        throw error;
      }
    },
  });
  // Keys include parsed filters; leaving a page or scope aborts its transport and removes evidence.
  const serializedFilters = JSON.stringify(filters);
  useEffect(
    () => () => {
      const queryKey = [
        "dashboard",
        scope,
        "portfolio",
        kind,
        JSON.parse(serializedFilters),
      ];
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
    [client, scope, kind, serializedFilters],
  );
  return {
    ...query,
    data: portfolioEvidence(query.data, organizationId, enabled, query.error),
    enabled,
    live,
    scope,
    identityScope,
    sessionLoading: isLoading,
    stale:
      query.isError &&
      !!portfolioEvidence(query.data, organizationId, enabled, query.error),
  };
}

export function usePortfolioProducts(filters: Partial<PortfolioProductsQuery>) {
  return usePortfolioQuery("products", filters, (signal) =>
    gateway.products(filters, signal),
  );
}
export function usePortfolioConcentration(
  filters: Partial<PortfolioConcentrationQuery>,
) {
  return usePortfolioQuery("concentration", filters, (signal) =>
    gateway.concentration(filters, signal),
  );
}
export function usePortfolioDetail(filters: Partial<PortfolioDetailQuery>) {
  return usePortfolioQuery("detail", filters, (signal) =>
    gateway.detail(filters, signal),
  );
}
