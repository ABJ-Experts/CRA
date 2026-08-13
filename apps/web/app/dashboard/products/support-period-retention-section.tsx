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
      className="lg:col-span-2"
      aria-label={`Support and retention for ${release.label}`}
    >
      <h3 className="text-subhead-semibold text-fg">Support and retention</h3>
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
            <li key={period.id} className="rounded-lg border border-border p-3">
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
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
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
              <p className="mt-2 text-caption-1-regular text-fg-muted">
                Retention status: {releaseRetention?.status ?? "incomplete"}
                {releaseRetention?.retentionUntil
                  ? ` · retained until ${displayInstant(releaseRetention.retentionUntil)}`
                  : ""}
              </p>
              {releaseRetention?.placedOnMarketCandidate ? (
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Placed-on-market + 10 calendar years:{" "}
                  {displayInstant(releaseRetention.placedOnMarketCandidate)}
                </p>
              ) : null}
              {releaseRetention?.supportPeriodCandidate ? (
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Support-period end:{" "}
                  {displayInstant(releaseRetention.supportPeriodCandidate)}
                </p>
              ) : null}
              {releaseRetention?.winningRule ? (
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Controlling rule:{" "}
                  {releaseRetention.winningRule.replaceAll("_", " ")}
                </p>
              ) : null}
              {releaseRetention?.retentionProtectionUntil ? (
                <p className="mt-1 text-caption-1-regular text-fg-muted">
                  Deletion protection through:{" "}
                  {displayInstant(releaseRetention.retentionProtectionUntil)}
                </p>
              ) : null}
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
        </div>
        <div>
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
            <ul className="mt-2 space-y-1 text-caption-1-regular text-fg-muted">
              {releaseAlerts.map((alert) => (
                <li key={alert.id}>
                  {alert.thresholdDays} days before support end ·{" "}
                  {alert.deliveryState}
                  {alert.missed ? " · missed" : ""}
                  {` · due ${displayInstant(alert.dueAt)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {canEdit ? (
        <div className="mt-4 grid gap-4 rounded-xl border border-border p-4 lg:grid-cols-2">
          <form
            className="grid gap-3"
            noValidate
            onSubmit={previewSupportPeriod}
          >
            <Input
              label="Support starts"
              placeholder="2026-08-12T00:00:00.000Z"
              value={supportStartsAt}
              onChange={(event) => setSupportStartsAt(event.target.value)}
              required
            />
            <Input
              label="Support ends"
              placeholder="2029-08-12T00:00:00.000Z"
              value={supportEndsAt}
              onChange={(event) => setSupportEndsAt(event.target.value)}
              required
            />
            <Input
              label="Expected lifetime justification"
              value={expectedLifetimeJustification}
              onChange={(event) =>
                setExpectedLifetimeJustification(event.target.value)
              }
              required
            />
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
                loading={preview.isPending}
                loadingLabel="Previewing retention"
              >
                Preview retention
              </Button>
              <Button
                type="button"
                loading={create.isPending}
                loadingLabel="Recording support period"
                disabled={canSupersede}
                onClick={() => void recordSupportPeriod()}
              >
                Record support period
              </Button>
              {canSupersede ? (
                <>
                  <Input
                    label="Supersession reason"
                    value={supersessionReason}
                    onChange={(event) =>
                      setSupersessionReason(event.target.value)
                    }
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
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
          <form className="grid gap-3" noValidate onSubmit={saveAlertIntervals}>
            <Input
              label="Support alert intervals"
              value={alertIntervalsDays}
              onChange={(event) => setAlertIntervalsDays(event.target.value)}
              helperText="Use comma-separated day thresholds before support end."
              required
            />
            <Button
              type="submit"
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
