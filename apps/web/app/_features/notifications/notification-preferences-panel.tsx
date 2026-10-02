"use client";

import type {
  NotificationMode,
  NotificationPreferences,
  NotificationSchedule,
} from "@repo/contracts/notifications";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
} from "./notifications.queries";

const modeOptions: readonly [NotificationMode, string][] = [
  ["immediate", "Immediate"],
  ["daily", "Daily digest"],
  ["weekly", "Weekly digest"],
  ["off", "Off"],
];

const weekdays = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have permission to manage notification preferences.";
    if (error.status === 409)
      return "Notification preferences changed elsewhere. Your draft is still here; refresh and retry.";
    if (error.kind === "network")
      return "You are offline. Your notification preference draft is still here.";
  }
  return "Notification preferences could not be saved. Review the values and retry.";
}

function scheduleDraft(
  preferences: NotificationPreferences,
): NotificationSchedule {
  return preferences.schedule;
}

function quietHoursText(schedule: NotificationSchedule): string {
  return schedule.quietHours
    ? `${schedule.quietHours.start}-${schedule.quietHours.end}`
    : "";
}

function parseQuietHoursText(
  value: string,
): NotificationSchedule["quietHours"] {
  const normalized = value.trim();
  if (!normalized) return null;

  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(normalized);
  if (!match) {
    throw new Error("Quiet hours must use HH:MM-HH:MM, or be left blank.");
  }
  const [, start, end] = match;
  if (!start || !end) {
    throw new Error("Quiet hours must use HH:MM-HH:MM, or be left blank.");
  }
  return { start, end };
}

export function NotificationPreferencesPanel() {
  const preferences = useNotificationPreferencesQuery();
  const update = useUpdateNotificationPreferencesMutation();
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [quietHoursDraft, setQuietHoursDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty && preferences.data?.preferences) {
      setDraft(preferences.data.preferences);
      setQuietHoursDraft(quietHoursText(preferences.data.preferences.schedule));
    }
  }, [dirty, preferences.data]);

  if (preferences.isLoading) {
    return (
      <p role="status" className="text-caption-1-regular text-fg-muted">
        Loading notification preferences…
      </p>
    );
  }

  if (preferences.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 text-danger"
      >
        <p className="text-caption-1-regular">
          {messageFor(preferences.error)}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void preferences.refetch()}
        >
          Retry notification preferences
        </Button>
      </div>
    );
  }

  if (!draft) {
    return (
      <p className="text-caption-1-regular text-fg-muted">
        Notification preferences are unavailable.
      </p>
    );
  }

  const setMode = (
    key: keyof NotificationPreferences["modes"],
    value: NotificationMode,
  ) => {
    setDirty(true);
    setMessage(null);
    setError(null);
    setDraft((current) =>
      current
        ? { ...current, modes: { ...current.modes, [key]: value } }
        : current,
    );
  };
  const setSchedule = (change: Partial<NotificationSchedule>) => {
    setDirty(true);
    setMessage(null);
    setError(null);
    setDraft((current) =>
      current
        ? { ...current, schedule: { ...scheduleDraft(current), ...change } }
        : current,
    );
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    setMessage(null);
    const current = draft;
    let parsedQuietHours: NotificationSchedule["quietHours"];
    try {
      parsedQuietHours = parseQuietHoursText(quietHoursDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messageFor(cause));
      return;
    }
    try {
      const result = await update.mutateAsync({
        expectedVersion: current.version,
        idempotencyKey: crypto.randomUUID(),
        modes: current.modes,
        schedule: { ...current.schedule, quietHours: parsedQuietHours },
      });
      setDraft(result.preferences);
      setQuietHoursDraft(quietHoursText(result.preferences.schedule));
      setDirty(false);
      setMessage("Notification preferences saved.");
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={save} noValidate>
      <div>
        <h2 className="text-subhead-semibold text-fg">
          Notification preferences
        </h2>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Optional categories can use immediate delivery, digest delivery, or be
          turned off. Critical regulatory alerts bypass these settings.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["finding_triage", "Finding triage"],
          ["evidence", "Evidence"],
          ["supplier_owner", "Supplier owner requests"],
        ].map(([key, label]) => (
          <label key={key} className="space-y-1 text-caption-1-regular text-fg">
            {label}
            <select
              className="h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              value={draft.modes[key as keyof NotificationPreferences["modes"]]}
              onChange={(event) =>
                setMode(
                  key as keyof NotificationPreferences["modes"],
                  event.target.value as NotificationMode,
                )
              }
              disabled={update.isPending}
            >
              {modeOptions.map(([value, optionLabel]) => (
                <option key={value} value={value}>
                  {optionLabel}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Digest timezone"
          value={draft.schedule.timezone}
          onChange={(event) => setSchedule({ timezone: event.target.value })}
          disabled={update.isPending}
        />
        <Input
          label="Digest time"
          type="time"
          value={draft.schedule.localTime}
          onChange={(event) => setSchedule({ localTime: event.target.value })}
          disabled={update.isPending}
        />
        <label className="space-y-1 text-caption-1-regular text-fg">
          Weekly digest day
          <select
            className="h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            value={draft.schedule.weekday}
            onChange={(event) =>
              setSchedule({ weekday: Number(event.target.value) })
            }
            disabled={update.isPending}
          >
            {weekdays.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Quiet hours"
          value={quietHoursDraft}
          onChange={(event) => {
            setDirty(true);
            setMessage(null);
            setError(null);
            setQuietHoursDraft(event.target.value);
          }}
          helperText="Use HH:MM-HH:MM, or leave blank."
          disabled={update.isPending}
        />
      </div>
      <p className="rounded-xl border border-warning bg-surface-subtle p-3 text-caption-1-regular text-fg">
        Critical regulatory alerts remain immediate and cannot be muted,
        digested, or suppressed by quiet hours.
      </p>
      {error ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          {message}
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          loading={update.isPending}
          disabled={!dirty || update.isPending}
        >
          Save notification preferences
        </Button>
      </div>
    </form>
  );
}
