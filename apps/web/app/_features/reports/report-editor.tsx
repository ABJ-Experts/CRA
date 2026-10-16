"use client";

import type {
  ReportConfiguration,
  ReportDefinition,
  ReportRun,
  ReportRunDetailResponse,
} from "@repo/contracts/reports";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";

const fieldClass =
  "min-h-10 rounded-md border border-border bg-canvas px-3 py-2 text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
function dateLabel(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not scheduled";
}
type Recipient = Readonly<{ id: string; displayName: string }>;
type ReportEditorProps = Readonly<{
  config: ReportConfiguration;
  selected: ReportDefinition | null;
  preview: ReportRun | null;
  previewEligibility: ReportRunDetailResponse["recipientEligibility"];
  recipients: readonly Recipient[];
  recipientNextCursor: string | null;
  loadingRecipients: boolean;
  busy: boolean;
  dirty: boolean;
  previewReady: boolean;
  onChange: (next: ReportConfiguration) => void;
  onSave: () => void | Promise<void>;
  onPreview: () => void | Promise<void>;
  onRefreshVersion: () => void | Promise<void>;
  onRefreshPreview: () => void | Promise<void>;
  onMutate: (
    operation: "activate" | "pause" | "resume" | "archive",
  ) => void | Promise<void>;
  onLoadMoreRecipients: () => void | Promise<void>;
}>;

export function ReportEditor({
  config,
  selected,
  preview,
  previewEligibility,
  recipients,
  recipientNextCursor,
  loadingRecipients,
  busy,
  dirty,
  previewReady,
  onChange,
  onSave,
  onPreview,
  onRefreshVersion,
  onRefreshPreview,
  onMutate,
  onLoadMoreRecipients,
}: ReportEditorProps) {
  const displayedRecipients = [
    ...recipients,
    ...config.recipientUserIds
      .filter((id) => !recipients.some((recipient) => recipient.id === id))
      .map((id) => ({ id, displayName: `Selected member ${id.slice(0, 8)}…` })),
  ];
  const shownEligibility = previewEligibility.filter((result) =>
    config.recipientUserIds.includes(result.userId),
  );
  const previewHasIneligible = shownEligibility.some(
    (result) => result.state === "ineligible",
  );
  const previewAllIneligible =
    shownEligibility.length === config.recipientUserIds.length &&
    !shownEligibility.some((result) => result.state === "eligible");
  return (
    <section aria-labelledby="report-editor" className="max-w-4xl">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="report-editor" className="text-h4">
          {selected ? "Edit schedule" : "New schedule"}
        </h2>
        {selected ? (
          <span className="text-caption-1-regular text-fg-muted">
            {selected.state} · version {selected.version}
          </span>
        ) : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2 text-subhead-regular">
          Report title
          <input
            className={cn(fieldClass)}
            value={config.title}
            maxLength={120}
            onChange={(event) =>
              onChange({ ...config, title: event.target.value })
            }
          />
        </label>
        <p className="sm:col-span-2 text-caption-1-regular text-fg-muted">
          Source:{" "}
          {config.report.kind === "readiness"
            ? "Product readiness"
            : config.report.source}{" "}
          ·{" "}
          {config.report.kind === "readiness"
            ? "PDF and JSON"
            : config.report.format.toUpperCase()}
          . Selection and filters came from the source view.
        </p>
        <label className="flex flex-col gap-1 text-subhead-regular">
          Frequency
          <select
            className={cn(fieldClass)}
            value={config.schedule.frequency}
            onChange={(event) => {
              const frequency = event.target.value as
                "daily" | "weekly" | "monthly";
              onChange({
                ...config,
                schedule: {
                  frequency,
                  timezone: config.schedule.timezone,
                  localTime: config.schedule.localTime,
                  ...(frequency === "weekly" ? { weekday: 1 } : {}),
                  ...(frequency === "monthly" ? { monthDay: 1 } : {}),
                },
              });
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-subhead-regular">
          Local time
          <input
            className={cn(fieldClass)}
            type="time"
            value={config.schedule.localTime}
            onChange={(event) =>
              onChange({
                ...config,
                schedule: {
                  ...config.schedule,
                  localTime: event.target.value,
                },
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-subhead-regular">
          Time zone
          <input
            className={cn(fieldClass)}
            value={config.schedule.timezone}
            onChange={(event) =>
              onChange({
                ...config,
                schedule: {
                  ...config.schedule,
                  timezone: event.target.value,
                },
              })
            }
          />
          <span className="text-caption-1-regular text-fg-muted">
            IANA name, for example Asia/Kolkata. Skipped clock times do not run
            twice.
          </span>
        </label>
        {config.schedule.frequency === "weekly" ? (
          <label className="flex flex-col gap-1 text-subhead-regular">
            Day of week
            <select
              className={cn(fieldClass)}
              value={config.schedule.weekday ?? 1}
              onChange={(event) =>
                onChange({
                  ...config,
                  schedule: {
                    ...config.schedule,
                    weekday: Number(event.target.value),
                  },
                })
              }
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {config.schedule.frequency === "monthly" ? (
          <label className="flex flex-col gap-1 text-subhead-regular">
            Day of month
            <input
              className={cn(fieldClass)}
              type="number"
              min={1}
              max={31}
              value={config.schedule.monthDay ?? 1}
              onChange={(event) =>
                onChange({
                  ...config,
                  schedule: {
                    ...config.schedule,
                    monthDay: Number(event.target.value),
                  },
                })
              }
            />
            <span className="text-caption-1-regular text-fg-muted">
              Shorter months use their final day.
            </span>
          </label>
        ) : null}
        {config.report.kind === "list" &&
        ["audit.events", "dashboard.trends"].includes(config.report.source) ? (
          <label className="flex flex-col gap-1 text-subhead-regular">
            Date window
            <select
              className={cn(fieldClass)}
              value={
                config.dateWindow.kind === "fixed"
                  ? "fixed"
                  : String(config.dateWindow.days)
              }
              onChange={(event) =>
                onChange({
                  ...config,
                  dateWindow:
                    event.target.value === "fixed"
                      ? { kind: "fixed" }
                      : {
                          kind: "rolling",
                          days: Number(event.target.value) as 7 | 30 | 90,
                        },
                })
              }
            >
              <option value="fixed">Saved source dates</option>
              <option value="7">Previous 7 complete local days</option>
              <option value="30">Previous 30 complete local days</option>
              <option value="90">Previous 90 complete local days</option>
            </select>
          </label>
        ) : null}
      </div>
      <fieldset className="mt-6">
        <legend className="text-subhead-medium">Recipients</legend>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Only active verified members with current source access receive their
          own artifact. Select up to 20.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {displayedRecipients.map((recipient) => (
            <label
              key={recipient.id}
              className="flex items-center gap-2 text-subhead-regular"
            >
              <input
                type="checkbox"
                checked={config.recipientUserIds.includes(recipient.id)}
                disabled={
                  !config.recipientUserIds.includes(recipient.id) &&
                  config.recipientUserIds.length >= 20
                }
                onChange={(event) =>
                  onChange({
                    ...config,
                    recipientUserIds: event.target.checked
                      ? [...config.recipientUserIds, recipient.id]
                      : config.recipientUserIds.filter(
                          (id) => id !== recipient.id,
                        ),
                  })
                }
              />
              {recipient.displayName}
            </label>
          ))}
        </div>
        {recipientNextCursor ? (
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            disabled={loadingRecipients}
            onClick={() => void onLoadMoreRecipients()}
          >
            {loadingRecipients ? "Loading members…" : "Load more members"}
          </Button>
        ) : null}
      </fieldset>
      <label className="mt-5 flex items-center gap-2 text-subhead-regular">
        <input
          type="checkbox"
          checked={config.emailEnabled}
          onChange={(event) =>
            onChange({ ...config, emailEnabled: event.target.checked })
          }
        />
        Request email links for eligible recipients
      </label>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        Each member controls report email separately. Inbox links remain
        available when email is off.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void onSave()}>
          {selected ? "Save changes" : "Save draft"}
        </Button>
        {selected ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || dirty}
            onClick={() => void onPreview()}
          >
            Preview report
          </Button>
        ) : null}
        {selected ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void onRefreshVersion()}
          >
            Refresh server version
          </Button>
        ) : null}
      </div>
      {selected ? (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-h5">Activation</h3>
          <p className="mt-2 max-w-prose text-subhead-regular text-fg-muted">
            A successful owner preview from this saved version is required
            within 24 hours. Activation checks access again.
          </p>
          {preview ? (
            <p role="status" className="mt-3 text-subhead-regular">
              Preview {preview.state} ·{" "}
              {dateLabel(preview.finishedAt ?? preview.createdAt)}
              {preview.safeErrorCode
                ? ` · ${preview.safeErrorCode.replaceAll("_", " ")}`
                : ""}
            </p>
          ) : null}
          {preview && shownEligibility.length > 0 ? (
            <section
              aria-labelledby="preview-recipient-eligibility"
              className="mt-5"
            >
              <h4
                id="preview-recipient-eligibility"
                className="text-subhead-medium"
              >
                Preview recipient eligibility
              </h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Source access was checked for this preview. It is checked again
                for each scheduled run.
              </p>
              <ul className="mt-3 divide-y divide-border border-y border-border text-subhead-regular">
                {shownEligibility.map((result) => {
                  const name =
                    displayedRecipients.find(
                      (recipient) => recipient.id === result.userId,
                    )?.displayName ??
                    `Selected member ${result.userId.slice(0, 8)}…`;
                  return (
                    <li key={result.userId} className="py-2">
                      {name} ·{" "}
                      {result.state === "eligible" ? "Eligible" : "Ineligible"}
                      {result.safeErrorCode
                        ? ` · ${result.safeErrorCode.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase())}`
                        : ""}
                    </li>
                  );
                })}
              </ul>
              {previewHasIneligible ? (
                <p className="mt-2 text-subhead-regular text-danger">
                  {previewAllIneligible
                    ? "No selected recipient is eligible in this preview. Resolve access or change recipients, then save and preview again."
                    : "Ineligible members will be skipped at each scheduled occurrence unless their access changes. Access is checked again at run time."}
                </p>
              ) : null}
            </section>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={
                busy ||
                !previewReady ||
                previewAllIneligible ||
                selected.state === "active" ||
                selected.state === "archived"
              }
              onClick={() =>
                void onMutate(
                  selected.state === "paused" ? "resume" : "activate",
                )
              }
            >
              {selected.state === "paused"
                ? "Resume schedule"
                : "Activate schedule"}
            </Button>
            {preview && preview.state !== "succeeded" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onRefreshPreview()}
              >
                Refresh preview
              </Button>
            ) : null}
            {selected.state === "active" ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onMutate("pause")}
              >
                Pause schedule
              </Button>
            ) : null}
            {selected.state !== "archived" ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onMutate("archive")}
              >
                Archive schedule
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
