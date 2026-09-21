"use client";

import { Button } from "@repo/ui/button";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useEvidenceExpiryAlertIntervalsQuery,
  useUpdateEvidenceExpiryAlertIntervalsMutation,
} from "./evidence.queries";

function requestId(): string {
  return crypto.randomUUID();
}

function parseIntervals(value: string): number[] | null {
  const parts = value.split(",").map((part) => part.trim());
  if (
    parts.length < 1 ||
    parts.length > 12 ||
    parts.some((part) => !/^\d+$/.test(part))
  )
    return null;
  const days = parts.map(Number);
  return days.some((day) => day < 1 || day > 3650) ||
    new Set(days).size !== days.length
    ? null
    : days;
}

export function EvidenceExpiryAlertSettings({
  enabled,
}: Readonly<{ enabled: boolean }>) {
  const intervals = useEvidenceExpiryAlertIntervalsQuery(enabled);
  const update = useUpdateEvidenceExpiryAlertIntervalsMutation();
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty && intervals.data) {
      setDraft(intervals.data.expiryAlertIntervals.thresholdDays.join(", "));
    }
  }, [dirty, intervals.data]);

  if (intervals.isLoading) {
    return (
      <p role="status" className="text-caption-1-regular text-fg-muted">
        Loading expiry alert schedule…
      </p>
    );
  }
  if (intervals.isError) {
    return (
      <div className="grid gap-2">
        <p role="alert" className="text-caption-1-regular text-danger">
          Expiry alert settings could not be loaded.
        </p>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          onClick={() => void intervals.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }
  const configuration = intervals.data;
  if (!configuration) return null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const thresholdDays = parseIntervals(draft);
    if (!thresholdDays) {
      setMessage(
        "Use 1–12 unique whole-day thresholds between 1 and 3650, separated by commas.",
      );
      return;
    }
    const current = intervals.data;
    if (!current) {
      setMessage(
        "Expiry alert settings are no longer available. Reload and try again.",
      );
      return;
    }
    setMessage(null);
    try {
      await update.mutateAsync({
        thresholdDays,
        expectedVersion: current.expiryAlertIntervals.version,
        idempotencyKey: requestId(),
      });
      setDirty(false);
      setMessage(
        "Expiry alert schedule saved. Pending reminders were recalculated.",
      );
    } catch (error) {
      setMessage(
        error instanceof ApiClientError && error.status === 409
          ? "Expiry alert settings changed elsewhere. Your entered thresholds are still here; reload and retry."
          : "Expiry alert settings could not be saved. Your entered thresholds are still here; retry when the connection is restored.",
      );
    }
  }

  return (
    <form className="grid gap-3" noValidate onSubmit={save}>
      <div>
        <h3 className="text-h5 text-fg">Expiry alerts</h3>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Remind the active evidence owner before validity ends. Open-ended and
          missing validity receive no expiry alert.
        </p>
      </div>
      <label
        className="grid gap-1 text-caption-1-semibold text-fg"
        htmlFor="evidence-expiry-alert-intervals"
      >
        Days before expiry
        <input
          id="evidence-expiry-alert-intervals"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
          }}
          inputMode="numeric"
          aria-describedby="evidence-expiry-alert-intervals-help"
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </label>
      <p
        id="evidence-expiry-alert-intervals-help"
        className="text-caption-1-regular text-fg-muted"
      >
        Use comma-separated whole days, for example 30, 14, 7, 1.
      </p>
      {message ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          loading={update.isPending}
          loadingLabel="Saving expiry alert schedule"
        >
          Save expiry alerts
        </Button>
      </div>
    </form>
  );
}
