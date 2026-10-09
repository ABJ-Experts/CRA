"use client";

import { supplierEvidenceReminderSettingsInputSchema } from "@repo/contracts/supplier-evidence";
import { Button } from "@repo/ui/button";
import { Tag, type TagProps } from "@repo/ui/tag";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useRetrySupplierEvidenceReminderMutation,
  useSupplierEvidenceMetricsQuery,
  useSupplierEvidenceOverdueQuery,
  useSupplierEvidenceReminderSettingsQuery,
  useUpdateSupplierEvidenceReminderSettingsMutation,
} from "./supplier-evidence.queries";

const OFFSET_MINIMUM = -720;
const OFFSET_MAXIMUM = 720;

function defaultWindow(): Readonly<{ from: string; to: string }> {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

function parseOffsets(value: string): number[] | null {
  const parts = value.split(",").map((part) => part.trim());
  if (
    parts.length < 1 ||
    parts.length > 3 ||
    parts.some((part) => !/^-?\d+$/.test(part))
  )
    return null;
  const offsets = parts.map(Number);
  return offsets.some(
    (offset) =>
      offset === 0 || offset < OFFSET_MINIMUM || offset > OFFSET_MAXIMUM,
  ) ||
    !offsets.includes(24) ||
    new Set(offsets).size !== offsets.length
    ? null
    : offsets;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRate(value: number | null): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value);
}

function deliveryTone(state: string): TagProps["tone"] {
  if (state === "delivered") return "green";
  if (state === "failed" || state === "cancelled") return "red";
  if (state === "processing" || state === "pending") return "orange";
  return "blue";
}

function retryMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to retry this reminder.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This reminder changed elsewhere. Reload the overdue list before retrying.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. This reminder was not retried.";
  return "The reminder could not be retried. Review its current delivery status and try again.";
}

function conflict(error: unknown): boolean {
  return (
    (error instanceof ApiClientError && error.status === 409) ||
    (typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 409)
  );
}

/** Internal-only operational view; supplier data remains server-scoped. */
export function SupplierEvidenceRemindersPanel({
  supplierId,
  readEnabled,
  canManage,
}: Readonly<{
  supplierId: string;
  readEnabled: boolean;
  canManage: boolean;
}>) {
  const window = useMemo(defaultWindow, []);
  const settings = useSupplierEvidenceReminderSettingsQuery(canManage);
  const updateSettings = useUpdateSupplierEvidenceReminderSettingsMutation();
  const metrics = useSupplierEvidenceMetricsQuery(
    { ...window, supplierId },
    readEnabled,
  );
  const overdue = useSupplierEvidenceOverdueQuery(
    { supplierId, limit: 25 },
    readEnabled,
  );
  const retry = useRetrySupplierEvidenceReminderMutation();
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<Readonly<{
    deliveryId: string;
    message: string;
  }> | null>(null);

  useEffect(() => {
    if (!dirty && settings.data)
      setDraft(settings.data.settings.offsetsHours.join(", "));
  }, [dirty, settings.data]);

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const offsetsHours = parseOffsets(draft);
    const current = settings.data?.settings;
    if (!offsetsHours) {
      setScheduleMessage(
        "Use 1–3 unique whole-hour offsets between -720 and 720, including 24; zero is not allowed.",
      );
      return;
    }
    if (!current) {
      setScheduleMessage(
        "Reminder settings are unavailable. Reload and try again.",
      );
      return;
    }
    const input = supplierEvidenceReminderSettingsInputSchema.safeParse({
      expectedVersion: current.version,
      offsetsHours,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!input.success) {
      setScheduleMessage(
        input.error.issues[0]?.message ?? "Check the reminder offsets.",
      );
      return;
    }
    setScheduleMessage(null);
    try {
      await updateSettings.mutateAsync(input.data);
      setDirty(false);
      setScheduleMessage(
        "Reminder schedule saved. Future deliveries were recalculated.",
      );
    } catch (error) {
      setScheduleMessage(
        conflict(error)
          ? "Reminder settings changed elsewhere. Your entered offsets are still here; reload and retry."
          : "Reminder settings could not be saved. Your entered offsets are still here; retry when the connection is restored.",
      );
    }
  }

  async function retryDelivery(
    requestId: string,
    deliveryId: string,
    version: number,
  ) {
    setRetryState(null);
    try {
      await retry.mutateAsync({
        requestId,
        deliveryId,
        input: {
          expectedVersion: version,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setRetryState({
        deliveryId,
        message: "Reminder queued for another delivery attempt.",
      });
    } catch (error) {
      setRetryState({ deliveryId, message: retryMessage(error) });
    }
  }

  const summary = metrics.data?.summary;
  return (
    <section
      aria-labelledby="supplier-evidence-reminders-heading"
      className="mt-6 border-t border-border pt-6"
    >
      <div>
        <h3
          id="supplier-evidence-reminders-heading"
          className="text-h5 text-fg"
        >
          Supplier follow-up
        </h3>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Response metrics use delivered invitations and verified evidence only.
          Dates display in your locale.
        </p>
      </div>

      {summary ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-caption-1-regular text-fg-muted">
              Outstanding
            </dt>
            <dd className="mt-1 text-h5 text-fg">{summary.outstandingCount}</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-caption-1-regular text-fg-muted">
              First submission response
            </dt>
            <dd className="mt-1 text-h5 text-fg">
              {formatRate(summary.firstSubmissionResponseRate.value)}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-caption-1-regular text-fg-muted">
              Accepted completion
            </dt>
            <dd className="mt-1 text-h5 text-fg">
              {formatRate(summary.acceptedCompletionRate.value)}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-caption-1-regular text-fg-muted">
              Average first submission
            </dt>
            <dd className="mt-1 text-h5 text-fg">
              {summary.averageFirstSubmissionTurnaroundHours === null
                ? "Unavailable"
                : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(summary.averageFirstSubmissionTurnaroundHours)} hours`}
            </dd>
          </div>
        </dl>
      ) : metrics.isLoading ? (
        <p role="status" className="mt-4 text-caption-1-regular text-fg-muted">
          Loading response metrics…
        </p>
      ) : metrics.isError ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            Response metrics could not be loaded.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            tone="grey"
            onClick={() => void metrics.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {canManage ? (
        settings.isLoading ? (
          <p
            role="status"
            className="mt-5 text-caption-1-regular text-fg-muted"
          >
            Loading reminder schedule…
          </p>
        ) : settings.isError ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-caption-1-regular text-danger">
              Reminder settings could not be loaded.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              tone="grey"
              onClick={() => void settings.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <form
            className="mt-5 grid gap-2"
            noValidate
            onSubmit={(event) => void saveSchedule(event)}
          >
            <label
              htmlFor="supplier-evidence-reminder-offsets"
              className="grid gap-1 text-caption-1-semibold text-fg"
            >
              Reminder offsets in hours
              <input
                id="supplier-evidence-reminder-offsets"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDirty(true);
                }}
                inputMode="text"
                aria-describedby="supplier-evidence-reminder-offsets-help"
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <p
              id="supplier-evidence-reminder-offsets-help"
              className="text-caption-1-regular text-fg-muted"
            >
              Comma-separated hours from the due date: negative before, positive
              after. Include 24 for the overdue escalation; the default is -168,
              -24, 24.
            </p>
            {scheduleMessage ? (
              <p role="alert" className="text-caption-1-regular text-danger">
                {scheduleMessage}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                loading={updateSettings.isPending}
                loadingLabel="Saving reminder schedule"
              >
                Save reminder schedule
              </Button>
            </div>
          </form>
        )
      ) : null}

      <div className="mt-6">
        <h4 className="text-subhead-semibold text-fg">Overdue requests</h4>
        {overdue.isLoading ? (
          <p
            role="status"
            className="mt-2 text-caption-1-regular text-fg-muted"
          >
            Loading overdue requests…
          </p>
        ) : null}
        {overdue.isError ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-caption-1-regular text-danger">
              Overdue requests could not be loaded.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              tone="grey"
              onClick={() => void overdue.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {overdue.data?.overdue.length === 0 ? (
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            No overdue supplier evidence requests for this supplier.
          </p>
        ) : null}
        {overdue.data?.overdue.length ? (
          <ul
            className="mt-2 grid gap-2"
            aria-label="Overdue supplier evidence requests"
          >
            {overdue.data.overdue.map((row) => {
              const delivery = row.latestDelivery;
              const retryable = canManage && delivery?.state === "failed";
              return (
                <li
                  key={row.revisionId}
                  className="rounded-xl border border-border bg-canvas p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-subhead-semibold text-fg">
                        {row.requestTitle}
                      </p>
                      <p className="mt-1 text-caption-1-regular text-fg-muted">
                        Due {formatDate(row.dueAt)} · {row.daysOverdue} day
                        {row.daysOverdue === 1 ? "" : "s"} overdue
                      </p>
                    </div>
                    <Tag
                      variant="dot"
                      size="sm"
                      tone={deliveryTone(delivery?.state ?? "pending")}
                    >
                      {delivery
                        ? delivery.state.replaceAll("_", " ")
                        : "No reminder delivery"}
                    </Tag>
                  </div>
                  {delivery?.failureMessage ? (
                    <p className="mt-2 text-caption-1-regular text-danger">
                      Delivery issue: {delivery.failureMessage}
                    </p>
                  ) : null}
                  {retryable && delivery ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={retry.isPending}
                        onClick={() =>
                          void retryDelivery(
                            row.requestId,
                            delivery.id,
                            delivery.version,
                          )
                        }
                      >
                        Retry reminder
                      </Button>
                      {retryState?.deliveryId === delivery.id ? (
                        <p
                          role="status"
                          className="text-caption-1-regular text-fg-muted"
                        >
                          {retryState.message}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
