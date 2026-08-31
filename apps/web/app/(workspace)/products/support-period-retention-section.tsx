"use client";

import {
  createSupportPeriodRequestSchema,
  previewSupportPeriodChangeRequestSchema,
  supersedeSupportPeriodRequestSchema,
  updateSupportAlertIntervalsRequestSchema,
  type Release,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { useEffect, useMemo, useState } from "react";

import {
  useCreateSupportPeriodMutation,
  usePreviewSupportPeriodMutation,
  useSupportAlertIntervalsQuery,
  useSupportAlertsQuery,
  useSupportPeriodHistoryQuery,
  useSupportPeriodRetentionQuery,
  useSupersedeSupportPeriodMutation,
  useUpdateSupportAlertIntervalsMutation,
} from "../../_features/products/products.queries";
import { useOrganizationSettingsQuery } from "../../_features/organizations/organizations.queries";
import { ApiClientError } from "../../_lib/http/api-client";

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to perform that action.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This support period resource is unavailable.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "This record changed in another session. Refresh it before trying again.";
  }
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  return fallback;
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "conflict";
}

export function parseSupportAlertIntervalsDraft(
  value: string,
): number[] | null {
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => !/^\d+$/.test(entry))) {
    return null;
  }
  return entries.map(Number);
}

function formatComplianceInstant(
  instant: string,
  organizationTimezone: string | null,
): string {
  const timeZone = organizationTimezone ?? "UTC";
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(instant));
    return `${formatted} (${timeZone})`;
  } catch {
    return instant;
  }
}

function dateTimeInputValue(instant: string): string {
  if (!instant) return "";
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function utcInstantFromDateTimeInput(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function SupportPeriodRetentionSection({
  productId,
  release,
  canEdit,
  enabled,
  onReload,
}: {
  productId: string;
  release: Release;
  canEdit: boolean;
  enabled: boolean;
  onReload: () => void;
}) {
  const history = useSupportPeriodHistoryQuery(productId, release.id, enabled);
  const retention = useSupportPeriodRetentionQuery(
    productId,
    release.id,
    enabled,
  );
  const alerts = useSupportAlertsQuery(productId, release.id, enabled);
  const intervals = useSupportAlertIntervalsQuery(enabled);
  const organizationSettings = useOrganizationSettingsQuery(enabled);
  const preview = usePreviewSupportPeriodMutation(productId);
  const create = useCreateSupportPeriodMutation(productId);
  const supersede = useSupersedeSupportPeriodMutation(productId);
  const updateIntervals = useUpdateSupportAlertIntervalsMutation();
  const supportPeriods = history.data?.supportPeriods ?? [];
  const activeSupportPeriod =
    supportPeriods.find(
      (period) =>
        period.releaseId === release.id && period.supersededAt === null,
    ) ??
    supportPeriods.find(
      (period) => period.releaseId === null && period.supersededAt === null,
    ) ??
    null;
  const releaseRetention = retention.data?.retention.releaseCalculations.find(
    (calculation) => calculation.releaseId === release.id,
  );
  const releaseAlerts =
    activeSupportPeriod === null
      ? []
      : (alerts.data?.alerts.filter(
          (alert) => alert.supportPeriodId === activeSupportPeriod.id,
        ) ?? []);
  const [supportStartsAt, setSupportStartsAt] = useState("");
  const [supportEndsAt, setSupportEndsAt] = useState("");
  const [expectedLifetimeJustification, setExpectedLifetimeJustification] =
    useState("");
  const [supersessionReason, setSupersessionReason] = useState("");
  const [alertIntervalsDays, setAlertIntervalsDays] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);
  const updateSupportStartsAt = (event: {
    currentTarget: HTMLInputElement;
  }) => {
    setSupportStartsAt(utcInstantFromDateTimeInput(event.currentTarget.value));
  };
  const updateSupportEndsAt = (event: { currentTarget: HTMLInputElement }) => {
    setSupportEndsAt(utcInstantFromDateTimeInput(event.currentTarget.value));
  };
  const previewResult = preview.data?.preview ?? null;
  const organizationTimezone =
    organizationSettings.data?.settings.values?.timezone ?? null;
  const displayInstant = (instant: string) =>
    formatComplianceInstant(instant, organizationTimezone);

  useEffect(() => {
    if (!activeSupportPeriod) return;
    setSupportStartsAt(activeSupportPeriod.supportStartsAt);
    setSupportEndsAt(activeSupportPeriod.supportEndsAt);
    setExpectedLifetimeJustification(
      activeSupportPeriod.expectedLifetimeJustification,
    );
  }, [activeSupportPeriod]);

  useEffect(() => {
    if (!intervals.data) return;
    setAlertIntervalsDays(intervals.data.alertIntervalsDays.join(", "));
  }, [intervals.data]);

  const canSupersede = useMemo(
    () => canEdit && activeSupportPeriod !== null,
    [activeSupportPeriod, canEdit],
  );

  async function previewSupportPeriod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const parsed = previewSupportPeriodChangeRequestSchema.safeParse({
      releaseId: release.id,
      expectedVersion: activeSupportPeriod?.version ?? 0,
      current: activeSupportPeriod
        ? {
            supportStartsAt: activeSupportPeriod.supportStartsAt,
            supportEndsAt: activeSupportPeriod.supportEndsAt,
            expectedLifetimeJustification:
              activeSupportPeriod.expectedLifetimeJustification,
          }
        : null,
      proposed: {
        supportStartsAt,
        supportEndsAt,
        expectedLifetimeJustification,
      },
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the support period dates.",
      );
      return;
    }
    try {
      await preview.mutateAsync(parsed.data);
      setMessage("Support retention preview updated.");
    } catch (error) {
      setMessage(messageFor(error, "Support retention preview failed."));
    }
  }

  async function recordSupportPeriod() {
    setMessage(null);
    setStaleUpdate(false);
    const parsed = createSupportPeriodRequestSchema.safeParse({
      releaseId: release.id,
      supportStartsAt,
      supportEndsAt,
      expectedLifetimeJustification,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the support period details.",
      );
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setMessage("Support period recorded.");
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(messageFor(error, "Support period could not be recorded."));
    }
  }

  async function supersedeSupportPeriod() {
    if (!activeSupportPeriod) return;
    setMessage(null);
    setStaleUpdate(false);
    const parsed = supersedeSupportPeriodRequestSchema.safeParse({
      supportStartsAt,
      supportEndsAt,
      expectedLifetimeJustification,
      expectedVersion: activeSupportPeriod.version,
      reason: supersessionReason,
      previewDigest: previewResult?.previewDigest,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the supersession details.",
      );
      return;
    }
    try {
      await supersede.mutateAsync({
        supportPeriodId: activeSupportPeriod.id,
        input: parsed.data,
      });
      setSupersessionReason("");
      setMessage("Support period superseded.");
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(messageFor(error, "Support period could not be superseded."));
    }
  }

  async function saveAlertIntervals(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsedIntervals = parseSupportAlertIntervalsDraft(alertIntervalsDays);
    if (!parsedIntervals) {
      setMessage(
        "Enter comma-separated whole-number day thresholds without blank or invalid values.",
      );
      return;
    }
    const parsed = updateSupportAlertIntervalsRequestSchema.safeParse({
      alertIntervalsDays: parsedIntervals,
      expectedVersion: intervals.data?.version ?? 0,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the support alert intervals.",
      );
      return;
    }
    try {
      await updateIntervals.mutateAsync(parsed.data);
      setMessage("Support alert intervals saved.");
    } catch (error) {
      setMessage(
        messageFor(error, "Support alert intervals could not be saved."),
      );
    }
  }

  return (
    <section
      className="mt-2 border-t border-border pt-6"
      aria-label={`Support and retention for ${release.label}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-title-3-semibold text-fg">
            Support and retention
          </h3>
          <p className="mt-1 max-w-2xl text-caption-1-regular text-fg-muted">
            Record the support commitment, then review the legal retention date
            and scheduled expiry reminders.
          </p>
        </div>
        <span className="rounded-full bg-surface-raised px-3 py-1 text-caption-1-semibold text-fg-muted">
          {activeSupportPeriod
            ? "Support period active"
            : "Support period needed"}
        </span>
      </div>
      {history.isPending ? (
        <p role="status" className="mt-2 text-caption-1-regular text-fg-muted">
          Loading support periods...
        </p>
      ) : history.isError ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-caption-1-regular text-danger">
            {messageFor(history.error, "Support periods could not be loaded.")}
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void history.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : supportPeriods.length === 0 ? (
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          No support periods have been recorded.
        </p>
      ) : (
        <ul
          className="mt-2 grid gap-2 text-caption-1-regular text-fg-muted md:grid-cols-2"
          aria-label="Support period history"
        >
          {supportPeriods.map((period) => (
            <li key={period.id} className="rounded-xl bg-surface-subtle p-3">
              <span className="block text-fg">
                {displayInstant(period.supportStartsAt)} to{" "}
                {displayInstant(period.supportEndsAt)}
              </span>
              <span>
                Scope revision {period.scopeRevision} ·{" "}
                {period.releaseId === null
                  ? "Product default"
                  : "Release override"}{" "}
                · {period.supersededAt === null ? "Active" : "Superseded"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="rounded-xl bg-surface-subtle p-4">
          <h4 className="text-caption-1-semibold text-fg">Retention</h4>
          {retention.isPending ? (
            <p
              role="status"
              className="mt-2 text-caption-1-regular text-fg-muted"
            >
              Loading retention report...
            </p>
          ) : retention.isError ? (
            <div
              role="alert"
              className="mt-2 flex flex-wrap items-center gap-2"
            >
              <p className="text-caption-1-regular text-danger">
                {messageFor(
                  retention.error,
                  "Retention report could not be loaded.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                onClick={() => void retention.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-caption-1-regular text-fg-muted">
                    Legal retention outcome
                  </dt>
                  <dd className="mt-1 text-subhead-semibold text-fg">
                    {releaseRetention?.retentionUntil
                      ? `Retained until ${displayInstant(releaseRetention.retentionUntil)}`
                      : `Calculation ${releaseRetention?.status ?? "incomplete"}`}
                  </dd>
                </div>
                {releaseRetention?.placedOnMarketCandidate ? (
                  <div className="min-w-0">
                    <dt className="text-caption-1-regular text-fg-muted">
                      Market-date floor
                    </dt>
                    <dd className="mt-1 break-words text-caption-1-regular text-fg">
                      {displayInstant(releaseRetention.placedOnMarketCandidate)}
                    </dd>
                  </div>
                ) : null}
                {releaseRetention?.supportPeriodCandidate ? (
                  <div className="min-w-0">
                    <dt className="text-caption-1-regular text-fg-muted">
                      Support-period end
                    </dt>
                    <dd className="mt-1 break-words text-caption-1-regular text-fg">
                      {displayInstant(releaseRetention.supportPeriodCandidate)}
                    </dd>
                  </div>
                ) : null}
                {releaseRetention?.winningRule ? (
                  <div className="min-w-0">
                    <dt className="text-caption-1-regular text-fg-muted">
                      Controlling rule
                    </dt>
                    <dd className="mt-1 break-words text-caption-1-regular text-fg">
                      {releaseRetention.winningRule.replaceAll("_", " ")}
                    </dd>
                  </div>
                ) : null}
                {releaseRetention?.retentionProtectionUntil ? (
                  <div className="min-w-0">
                    <dt className="text-caption-1-regular text-fg-muted">
                      Deletion protection
                    </dt>
                    <dd className="mt-1 break-words text-caption-1-regular text-fg">
                      {displayInstant(
                        releaseRetention.retentionProtectionUntil,
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {releaseRetention?.legalHoldActive ? (
                <p
                  role="alert"
                  className="mt-1 text-caption-1-regular text-danger"
                >
                  An active legal hold prevents deletion.
                </p>
              ) : null}
              {releaseRetention?.incompleteReasons.length ? (
                <ul className="mt-1 list-disc pl-5 text-caption-1-regular text-fg-muted">
                  {releaseRetention.incompleteReasons.map((reason) => (
                    <li key={reason}>{reason.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </section>
        <section className="rounded-xl bg-surface-subtle p-4">
          <h4 className="text-caption-1-semibold text-fg">Support alerts</h4>
          {alerts.isPending ? (
            <p
              role="status"
              className="mt-2 text-caption-1-regular text-fg-muted"
            >
              Loading support alerts...
            </p>
          ) : alerts.isError ? (
            <div
              role="alert"
              className="mt-2 flex flex-wrap items-center gap-2"
            >
              <p className="text-caption-1-regular text-danger">
                {messageFor(
                  alerts.error,
                  "Support alerts could not be loaded.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                onClick={() => void alerts.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : releaseAlerts.length === 0 ? (
            <p className="mt-2 text-caption-1-regular text-fg-muted">
              No support alerts are open.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 text-caption-1-regular text-fg-muted">
              {releaseAlerts.map((alert) => (
                <li key={alert.id} className="rounded-lg bg-canvas px-3 py-2">
                  {alert.thresholdDays} days before support end ·{" "}
                  {alert.deliveryState}
                  {alert.missed ? " · missed" : ""}
                  {` · due ${displayInstant(alert.dueAt)}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {canEdit ? (
        <div className="mt-4 grid gap-4 rounded-xl bg-surface-subtle p-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <form
            className="grid gap-3"
            noValidate
            onSubmit={previewSupportPeriod}
          >
            <div>
              <h4 className="text-subhead-semibold text-fg">
                {activeSupportPeriod
                  ? "Revise support period"
                  : "Record support period"}
              </h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Dates are entered and stored as UTC instants.
              </p>
            </div>
            <Input
              label="Support starts (UTC)"
              type="datetime-local"
              value={dateTimeInputValue(supportStartsAt)}
              onChange={updateSupportStartsAt}
              onInput={updateSupportStartsAt}
              required
            />
            <Input
              label="Support ends (UTC)"
              type="datetime-local"
              value={dateTimeInputValue(supportEndsAt)}
              onChange={updateSupportEndsAt}
              onInput={updateSupportEndsAt}
              required
            />
            <label className="grid gap-2 text-caption-1-regular text-fg">
              Expected lifetime justification
              <textarea
                required
                value={expectedLifetimeJustification}
                onChange={(event) =>
                  setExpectedLifetimeJustification(event.target.value)
                }
                className="min-h-28 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
              />
            </label>
            {previewResult ? (
              <p className="text-caption-1-regular text-fg-muted">
                Preview retention{" "}
                {previewResult.proposedRetentionUntil
                  ? `until ${displayInstant(previewResult.proposedRetentionUntil)}`
                  : "is incomplete"}
                {previewResult.retentionProtectionWouldReduce === true
                  ? " · protection would reduce"
                  : ""}
                {(previewResult.blockedReasons ?? []).length
                  ? ` · blocked by ${(previewResult.blockedReasons ?? []).join(", ")}`
                  : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="outline"
                tone="grey"
                className="w-full sm:w-auto"
                loading={preview.isPending}
                loadingLabel="Previewing retention"
              >
                Preview retention
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                loading={create.isPending}
                loadingLabel="Recording support period"
                disabled={canSupersede}
                onClick={() => void recordSupportPeriod()}
              >
                Record support period
              </Button>
              {canSupersede ? (
                <>
                  <div className="basis-full">
                    <Input
                      label="Supersession reason"
                      value={supersessionReason}
                      onChange={(event) =>
                        setSupersessionReason(event.target.value)
                      }
                      required
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    className="w-full sm:w-auto"
                    loading={supersede.isPending}
                    loadingLabel="Superseding support period"
                    onClick={() => void supersedeSupportPeriod()}
                  >
                    Supersede active period
                  </Button>
                </>
              ) : null}
            </div>
          </form>
          <form
            className="grid content-start gap-3"
            noValidate
            onSubmit={saveAlertIntervals}
          >
            <div>
              <h4 className="text-subhead-semibold text-fg">Alert schedule</h4>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                Choose when responsible users are reminded before support ends.
              </p>
            </div>
            <Input
              label="Support alert intervals"
              value={alertIntervalsDays}
              onChange={(event) => setAlertIntervalsDays(event.target.value)}
              helperText="Use comma-separated day thresholds before support end."
              required
            />
            <Button
              type="submit"
              className="w-full sm:w-auto"
              loading={updateIntervals.isPending}
              loadingLabel="Saving support alert intervals"
            >
              Save alert intervals
            </Button>
          </form>
        </div>
      ) : null}
      {message ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            {message}
          </p>
          {staleUpdate ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={onReload}
            >
              Reload current data
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
