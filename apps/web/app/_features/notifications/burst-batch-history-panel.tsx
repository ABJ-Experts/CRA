"use client";

import type {
  NotificationBurstBatch,
  NotificationDeliveryCursor,
} from "@repo/contracts/notifications";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { useNotificationBurstBatchesQuery } from "./notifications.queries";

function date(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not scheduled";
}

function outcome(batch: NotificationBurstBatch): string {
  if (batch.status === "provider_accepted")
    return "Provider accepted; final delivery unconfirmed";
  if (
    batch.status === "exhausted" &&
    batch.safeErrorCode === "lease_expired_ambiguous"
  )
    return "Outcome uncertain; manual review needed";
  if (batch.status === "queued") return "Queued";
  if (batch.status === "attempted") return "Attempted; outcome pending";
  if (batch.status === "delivered") return "Delivered";
  if (batch.status === "failed") return "Failed";
  if (batch.status === "exhausted") return "Exhausted";
  return "Cancelled";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have permission to view burst history.";
    if (error.kind === "network")
      return "Burst history is offline. Retry when connected.";
  }
  return "Burst history is temporarily unavailable. Retry to see current outcomes.";
}

export function BurstBatchHistoryPanel({
  canViewAudit,
}: Readonly<{ canViewAudit: boolean }>) {
  const { session } = useSession();
  const organizationId = session?.organization?.id ?? null;
  const lastOrganization = useRef(organizationId);
  const [cursors, setCursors] = useState<
    readonly (NotificationDeliveryCursor | undefined)[]
  >([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const scopeChanged = lastOrganization.current !== organizationId;
  useEffect(() => {
    if (lastOrganization.current === organizationId) return;
    lastOrganization.current = organizationId;
    setCursors([undefined]);
    setPageIndex(0);
  }, [organizationId]);
  const query = useMemo(
    () => ({
      cursor: scopeChanged ? undefined : cursors[pageIndex],
      limit: 25,
    }),
    [cursors, pageIndex, scopeChanged],
  );
  const history = useNotificationBurstBatchesQuery(query, canViewAudit);
  const rows =
    canViewAudit && !scopeChanged && !history.isLoading && !history.isError
      ? (history.data?.rows ?? [])
      : [];
  const nextCursor = history.data?.nextCursor;

  return (
    <section
      aria-labelledby="burst-history-title"
      className="space-y-3 rounded-xl border border-border bg-canvas p-4"
    >
      <div className="space-y-1">
        <h3 id="burst-history-title" className="text-subhead-semibold text-fg">
          Burst delivery history
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          Email batch windows and provider outcomes. Source events remain
          available in the notification inbox.
        </p>
      </div>
      {!canViewAudit ? (
        <p className="text-caption-1-regular text-fg-muted">
          You do not have permission to view burst history.
        </p>
      ) : null}
      {canViewAudit && (history.isLoading || scopeChanged) ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading burst history…
        </p>
      ) : null}
      {canViewAudit && history.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-caption-1-regular text-danger"
        >
          <span>{errorMessage(history.error)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void history.refetch()}
          >
            Retry burst history
          </Button>
        </div>
      ) : null}
      {canViewAudit &&
      !history.isLoading &&
      !history.isError &&
      !scopeChanged &&
      rows.length === 0 ? (
        <p className="text-caption-1-regular text-fg-muted">
          No notification burst deliveries yet.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table
            aria-label="Notification burst deliveries"
            className="w-full min-w-[720px] border-collapse text-left text-caption-1-regular text-fg"
          >
            <thead>
              <tr className="border-b border-border text-caption-2-semibold text-fg">
                <th className="p-2" scope="col">
                  Event and window
                </th>
                <th className="p-2" scope="col">
                  Members
                </th>
                <th className="p-2" scope="col">
                  Delivery outcome
                </th>
                <th className="p-2" scope="col">
                  Next step
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((batch) => (
                <tr
                  key={batch.batchId}
                  className="border-b border-border align-top last:border-0"
                >
                  <td className="p-2">
                    <span className="block text-caption-1-semibold text-fg">
                      {batch.eventClass.replaceAll("_", " ")}
                    </span>
                    <span className="block text-caption-2-regular text-fg-muted">
                      {date(batch.windowStartsAt)} to {date(batch.windowEndsAt)}
                    </span>
                  </td>
                  <td className="p-2">
                    {batch.preparedCount} of {batch.memberCount} prepared
                  </td>
                  <td className="p-2">
                    <span className="block text-caption-1-semibold text-fg">
                      {outcome(batch)}
                    </span>
                    <span className="block text-caption-2-regular text-fg-muted">
                      {batch.attemptCount} attempt
                      {batch.attemptCount === 1 ? "" : "s"}; last{" "}
                      {date(batch.lastAttemptAt)}
                    </span>
                    {batch.safeErrorCode &&
                    batch.safeErrorCode !== "lease_expired_ambiguous" ? (
                      <span className="block text-caption-2-regular text-fg-muted">
                        Reason: {batch.safeErrorCode.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2">
                    {batch.preparedCount > 0 ? (
                      <Link
                        className="text-caption-1-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        href={`/notifications?batchId=${batch.batchId}`}
                      >
                        View prepared events
                      </Link>
                    ) : (
                      <span className="text-caption-2-regular text-fg-muted">
                        No prepared events
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <nav
          aria-label="Burst history pages"
          className="flex items-center justify-between gap-3 text-caption-1-regular text-fg-muted"
        >
          <span>Page {pageIndex + 1}</span>
          <div className="flex gap-2">
            {pageIndex > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPageIndex((index) => index - 1)}
              >
                Previous burst page
              </Button>
            ) : null}
            {nextCursor ? (
              <Button
                size="sm"
                variant="outline"
                disabled={history.isFetching}
                onClick={() => {
                  setCursors((current) => [
                    ...current.slice(0, pageIndex + 1),
                    nextCursor,
                  ]);
                  setPageIndex((index) => index + 1);
                }}
              >
                Next burst page
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
