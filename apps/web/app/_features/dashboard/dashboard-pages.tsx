"use client";

import type {
  DashboardObligationsResponse,
  DashboardReadinessResponse,
  DashboardIngestionResponse,
} from "@repo/contracts/dashboard/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import type { DashboardProjection } from "./dashboard.queries";
import { DashboardGateway } from "./dashboard-gateway";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  isDashboardAuthorizationFailure,
  revokeDashboardScope,
} from "./dashboard-access";
import { retainsDashboardEvidence } from "./dashboard-clock";
import {
  DashboardIngestion,
  DashboardObligations,
  DashboardReadiness,
} from "./dashboard-sections";

type ListKind = "obligations" | "readiness" | "ingestion";
const gateway = new DashboardGateway();
export function DashboardPagedList({
  kind,
  initial,
  scope,
  productId,
  now,
}: {
  kind: ListKind;
  initial: DashboardProjection;
  scope: string;
  productId?: string;
  now: number;
}) {
  const client = useQueryClient();
  useEffect(
    () => () => {
      const queryKey = ["dashboard", scope, kind, productId];
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    },
    [client, scope, kind, productId],
  );
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([]);
  const initialHistory = kind === "obligations" && productId !== undefined;
  const [history, setHistory] = useState(initialHistory);
  const cursor = cursors.at(-1);
  const query = useQuery<
    | DashboardObligationsResponse
    | DashboardReadinessResponse
    | DashboardIngestionResponse
  >({
    queryKey: ["dashboard", scope, kind, productId, cursor, history],
    enabled: cursors.length > 0 || history !== initialHistory,
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) => {
      const filter = { productId, cursor };
      const response = await (
        kind === "obligations"
          ? gateway.obligations(
              { ...filter, state: history ? "history" : "active" },
              signal,
            )
          : kind === "readiness"
            ? gateway.readiness(filter, signal)
            : gateway.ingestion(filter, signal)
      ).catch((error: unknown) => {
        if (isDashboardAuthorizationFailure(error))
          revokeDashboardScope(client, scope);
        throw error;
      });
      if (response.organizationId !== initial.organizationId)
        throw new ApiClientError(
          "invalid_response",
          "The dashboard scope changed. Refresh to continue.",
        );
      return response;
    },
  });
  const data =
    query.data?.organizationId === initial.organizationId
      ? query.data
      : undefined;
  const safe = !query.isError || retainsDashboardEvidence(query.error);
  const paging = cursors.length > 0 || history !== initialHistory;
  const section =
    safe && !paging
      ? initial[kind]
      : safe && data
        ? "obligations" in data
          ? data.obligations
          : "readiness" in data
            ? data.readiness
            : data.ingestion
        : undefined;
  const next =
    section &&
    typeof section === "object" &&
    "data" in section &&
    section.data &&
    "nextCursor" in section.data
      ? section.data.nextCursor
      : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!paging ? (
        kind === "obligations" ? (
          <DashboardObligations section={initial.obligations} now={now} />
        ) : kind === "readiness" ? (
          <DashboardReadiness section={initial.readiness} />
        ) : (
          <DashboardIngestion section={initial.ingestion} />
        )
      ) : safe && data ? (
        <>
          {"obligations" in data ? (
            <DashboardObligations section={data.obligations} now={now} />
          ) : "readiness" in data ? (
            <DashboardReadiness section={data.readiness} />
          ) : (
            <DashboardIngestion section={data.ingestion} />
          )}
        </>
      ) : null}
      {query.isLoading && paging ? (
        <p role="status" className="text-subhead-regular text-fg">
          Loading more {kind}…
        </p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-subhead-regular text-fg">
          {safe && data
            ? "These records are stale after a failed refresh."
            : "These records are unavailable."}{" "}
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            onClick={() => void query.refetch()}
          >
            Retry list
          </Button>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {kind === "obligations" ? (
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            onClick={() => {
              setCursors([]);
              setHistory((current) => !current);
            }}
          >
            {history ? "Show active stages" : "Show stage history"}
          </Button>
        ) : null}
        {cursors.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            disabled={query.isFetching}
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            Previous {kind}
          </Button>
        ) : null}
        {next ? (
          <Button
            size="sm"
            variant="outline"
            tone="grey"
            disabled={query.isFetching}
            onClick={() => setCursors((current) => [...current, next])}
          >
            Next {kind}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
