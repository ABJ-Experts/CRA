"use client";
import { useEffect, useState } from "react";
import type { CustomerSystemHealthResponse } from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  systemHealthGateway,
  type SystemHealthGateway,
} from "./system-health.gateway";
import { SystemHealthTables } from "./system-health-tables";

export interface HealthScope {
  readonly userId: string;
  readonly organizationId: string;
  readonly permissionRevision: string;
}
type Snapshot = Readonly<{
  key: string;
  data?: CustomerSystemHealthResponse;
  error?: unknown;
}>;
function failure(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to view system health.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The organization or observation changed. Reload system health.";
  return "System health is unavailable. Your existing workflows remain available. Try again.";
}
export function SystemHealthContent({
  scope,
  canView,
  gateway = systemHealthGateway,
}: {
  scope: HealthScope | null;
  canView: boolean;
  gateway?: Pick<SystemHealthGateway, "read">;
}) {
  const key = JSON.stringify([
    scope?.userId,
    scope?.organizationId,
    scope?.permissionRevision,
    canView,
  ]);
  const organizationId = scope?.organizationId;
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!organizationId || !canView) return;
    const controller = new AbortController();
    setSnapshot(null);
    void gateway
      .read(organizationId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot({ key, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSnapshot({ key, error });
      });
    return () => controller.abort();
  }, [organizationId, canView, key, attempt, gateway]);
  const current = snapshot?.key === key ? snapshot : null;
  return (
    <section
      aria-label="System health"
      className={cn("flex min-w-0 flex-col gap-5")}
    >
      <div className={cn("flex flex-wrap items-start justify-between gap-3")}>
        <div>
          <h1 className={cn("text-h3 text-fg")}>System health</h1>
          <p className={cn("mt-1 text-subhead-regular text-fg-muted")}>
            Local components, background work and source observations.
          </p>
        </div>
        {canView && organizationId && current?.data ? (
          <Button
            variant="outline"
            tone="grey"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Refresh health
          </Button>
        ) : null}
      </div>
      {!canView ? (
        <p role="alert" className={cn("text-subhead-regular text-danger")}>
          {failure(new ApiClientError("api", "", 403))}
        </p>
      ) : !organizationId ? (
        <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
          Select a current organization to view system health.
        </p>
      ) : current?.error ? (
        <div
          role="alert"
          className={cn("rounded-lg border border-border bg-surface p-5")}
        >
          <p className={cn("mb-3 text-subhead-regular")}>
            {failure(current.error)}
          </p>
          <Button
            variant="outline"
            tone="grey"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      ) : current?.data ? (
        <SystemHealthTables data={current.data} />
      ) : (
        <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
          Loading system health…
        </p>
      )}
    </section>
  );
}
