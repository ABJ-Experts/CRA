"use client";

import type { ReportAdministrationSummary } from "@repo/contracts/reports";
import { Button } from "@repo/ui/button";
import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../_lib/http/api-client";
import { reportsGateway, type ReportsGateway } from "./reports.api";

type Recipient = Readonly<{ id: string; displayName: string }>;

/** Administrators can stop a schedule without reading another owner's content. */
export function ReportsAdministration({
  gateway = reportsGateway,
  currentUserId,
  recipients,
}: {
  gateway?: ReportsGateway;
  currentUserId: string;
  recipients: readonly Recipient[];
}) {
  const [items, setItems] = useState<ReportAdministrationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void gateway
      .administration({}, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setItems(response.items);
          setCursor(response.nextCursor);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof ApiClientError && reason.status === 403
              ? "Administrator access changed. Refresh your session."
              : "Schedule administration is temporarily unavailable.",
          );
      });
    return () => controller.abort();
  }, [gateway]);

  async function pause(item: ReportAdministrationSummary) {
    setBusyId(item.id);
    setError(null);
    try {
      const signature = `${item.id}:${item.version}`;
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      const response = await gateway.administrationPause(item.id, {
        expectedVersion: item.version,
        idempotencyKey: attempt.current.key,
      });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? response.data : candidate,
        ),
      );
      attempt.current = null;
    } catch (reason) {
      setError(
        reason instanceof ApiClientError && reason.status === 409
          ? "This schedule changed. Refresh the list before pausing it."
          : "Could not pause this schedule. Refresh and try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function more() {
    if (!cursor) return;
    try {
      const response = await gateway.administration({ cursor });
      setItems((current) => [...current, ...response.items]);
      setCursor(response.nextCursor);
    } catch {
      setError("Could not load more schedules. Try again.");
    }
  }

  const otherSchedules = items.filter(
    (item) => item.ownerUserId !== currentUserId,
  );
  return (
    <section
      aria-labelledby="reports-administration"
      className="border-t border-border pt-6"
    >
      <h2 id="reports-administration" className="text-h4">
        Organization schedules
      </h2>
      <p className="mt-2 max-w-prose text-subhead-regular text-fg-muted">
        Administrators can pause another member&apos;s schedule. Report titles,
        filters, runs, and artifacts stay with their owner.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-subhead-regular text-danger">
          {error}
        </p>
      ) : null}
      {otherSchedules.length === 0 ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          No other member schedules to manage.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {otherSchedules.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p className="text-subhead-medium">
                  {recipients.find(
                    (recipient) => recipient.id === item.ownerUserId,
                  )?.displayName ?? "Organization member"}
                </p>
                <p className="text-caption-1-regular text-fg-muted">
                  Schedule {item.id.slice(0, 8)} · <span>{item.state}</span>
                </p>
              </div>
              {item.state === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === item.id}
                  aria-label={`Pause schedule ${item.id.slice(0, 8)}`}
                  onClick={() => void pause(item)}
                >
                  Pause schedule
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => void more()}
        >
          Load more organization schedules
        </Button>
      ) : null}
    </section>
  );
}
