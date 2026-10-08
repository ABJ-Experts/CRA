"use client";

import type {
  DashboardOverviewResponse,
  DashboardProductPostureResponse,
} from "@repo/contracts/dashboard/types";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { useMocksReady } from "../../_providers/providers";
import { sessionKeys } from "../session/session.keys";
import { DashboardGateway } from "./dashboard-gateway";
import {
  isDashboardAuthorizationFailure,
  revokeDashboardScope,
} from "./dashboard-access";
import { retainsDashboardEvidence } from "./dashboard-clock";

export const DASHBOARD_REFRESH_MS = 30_000;
export type DashboardProjection =
  DashboardOverviewResponse | DashboardProductPostureResponse;
const gateway = new DashboardGateway();

export function useDashboardQuery(productId?: string) {
  const client = useQueryClient();
  const { session, permissions, isLoading, isError } = useSession();
  const ready = useMocksReady();
  const live = process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const organizationId = session?.organization?.id;
  const sessionRevision =
    client.getQueryState(sessionKeys.identity)?.dataUpdatedAt ?? 0;
  const scope = JSON.stringify([
    organizationId,
    session?.user.id,
    sessionRevision,
    Object.entries(permissions).sort(),
  ]);
  const access = useQuery<boolean>({
    queryKey: ["dashboard-access", scope],
    queryFn: skipToken,
    enabled: false,
    initialData: false,
    gcTime: 0,
  });
  const enabled =
    !access.data &&
    live &&
    ready &&
    !isLoading &&
    !isError &&
    !!organizationId &&
    permissions.can_view_dashboards === true &&
    (!productId || permissions.can_view_products === true);
  const query = useQuery({
    queryKey: ["dashboard", scope, productId ?? "overview"],
    enabled,
    retry: false,
    staleTime: DASHBOARD_REFRESH_MS,
    gcTime: 0,
    refetchInterval: DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) => {
      const projection = await (
        productId
          ? gateway.posture(productId, signal)
          : gateway.overview(signal)
      ).catch((error: unknown) => {
        if (isDashboardAuthorizationFailure(error))
          revokeDashboardScope(client, scope);
        throw error;
      });
      if (projection.organizationId !== organizationId)
        throw new ApiClientError(
          "invalid_response",
          "The dashboard scope changed. Refresh to continue.",
        );
      return { projection, receivedAt: performance.now() };
    },
  });
  useEffect(
    () => () => {
      const queryKey = ["dashboard", scope, productId ?? "overview"];
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
      client.removeQueries({
        queryKey: ["dashboard-access", scope],
        exact: true,
      });
    },
    [client, scope, productId],
  );
  const mayRetain = !query.isError || retainsDashboardEvidence(query.error);
  return {
    ...query,
    data: enabled && mayRetain ? query.data : undefined,
    live,
    enabled,
    sessionLoading: isLoading,
    scope,
    stale: query.isError && mayRetain,
  };
}
