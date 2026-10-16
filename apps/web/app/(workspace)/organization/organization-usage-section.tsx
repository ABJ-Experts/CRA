"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  LicenseUsageCounter,
  LicenseUsageOperationInput,
} from "@repo/contracts/licensing/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type { useLicensingQueries } from "../../_features/licensing/licensing.queries";
import { serializeUsageExport } from "../../_features/licensing/usage-export";
import { licenceReason } from "../../_features/licensing/licensing-status";
import { ApiClientError } from "../../_lib/http/api-client";

type Queries = ReturnType<typeof useLicensingQueries>;
type Operation = "export" | "reconcile";
const ROW_LABELS = {
  seats: "Active members and reserved invitations",
  products: "Nonarchived products",
  storage: "Customer storage bytes",
  protected_storage: "Protected storage",
};
const COMPONENT_LABELS = {
  activeMembers: "Active members",
  reservedInvitations: "Reserved invitations",
  products: "Nonarchived products",
  storageBytes: "Completed bytes",
  storageReservedBytes: "Reserved / uploading / uncertain bytes",
  protectedStorageBytes: "Protected bytes",
};
const STATES = {
  normal: "Within limit",
  near_limit: "Near limit",
  at_limit: "At limit",
  over_limit: "Over limit",
  unavailable: "Unavailable",
};
function date(value: string) {
  return new Date(value).toLocaleString();
}
function Quantity({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) return <>Unavailable</>;
  if (unit !== "bytes") return <>{value.toLocaleString()}</>;
  const exponent = Math.min(
    5,
    value > 0 ? Math.floor(Math.log(value) / Math.log(1024)) : 0,
  );
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB", "PiB"];
  return (
    <span
      aria-label={`${value.toLocaleString()} bytes`}
      title={`${value.toLocaleString()} bytes`}
    >
      {(value / 1024 ** exponent).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}{" "}
      {units[exponent]}
    </span>
  );
}
function Limit({ counter }: { counter: LicenseUsageCounter }) {
  if (counter.limit.kind === "finite")
    return <Quantity value={counter.limit.value} unit={counter.unit} />;
  return (
    <>
      {counter.limit.kind === "unlimited"
        ? "Unlimited"
        : counter.limit.kind === "exempt"
          ? "Exempt"
          : "Unverified limit"}
    </>
  );
}

export function OrganizationUsageSection({
  organizationId,
  queries,
}: {
  organizationId: string;
  queries: Queries;
}) {
  if (!queries.canView || queries.revoked)
    return (
      <div
        className={cn(
          "mt-6 border-t border-border pt-5 text-subhead-regular text-fg",
        )}
        role="alert"
      >
        You do not have permission to view usage.
      </div>
    );
  if (
    !queries.enabled ||
    (queries.usage.data && queries.usage.data.organizationId !== organizationId)
  )
    return (
      <p role="status" className={cn("mt-5 text-subhead-regular text-fg")}>
        Usage is unavailable for this organization.
      </p>
    );
  return (
    <UsageContent
      key={`${organizationId}:${queries.scope}`}
      organizationId={organizationId}
      queries={queries}
    />
  );
}

function UsageContent({
  organizationId,
  queries,
}: {
  organizationId: string;
  queries: Queries;
}) {
  const { usage, usageExport, reconciliation, canManage } = queries;
  const data = usage.data;
  const titleId = useId();
  const feedback = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const attempts = useRef<
    Partial<Record<Operation, LicenseUsageOperationInput>>
  >({});
  const [conflicts, setConflicts] = useState<
    Partial<Record<Operation, string>>
  >({});
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState<Partial<Record<Operation, boolean>>>({});
  const [running, setRunning] = useState<Operation | null>(null);
  const version = data ? `${data.license.version}:${data.meterVersion}` : "";
  const busy = !!running || usageExport.isPending || reconciliation.isPending;
  const unavailable = !data || !!usage.error || usage.isFetching;
  const blocked = (operation: Operation) =>
    unavailable || busy || conflicts[operation] === version;
  function report(text: string, error: boolean) {
    if (!mounted.current) return;
    setMessage({ text, error });
    requestAnimationFrame(() => feedback.current?.focus());
  }
  async function operate(
    operation: Operation,
    format: "json" | "csv" = "json",
  ) {
    if (
      !data ||
      blocked(operation) ||
      (operation === "reconcile" && !canManage)
    )
      return;
    const input = attempts.current[operation] ?? {
      expectedLicenseVersion: data.license.version,
      expectedMeterVersion: data.meterVersion,
      idempotencyKey: crypto.randomUUID(),
    };
    attempts.current = { ...attempts.current, [operation]: input };
    setRunning(operation);
    try {
      if (operation === "export") {
        const receipt = await usageExport.mutateAsync(input);
        if (!mounted.current) return;
        if (receipt.snapshot.organizationId !== organizationId)
          throw new Error(
            "Usage export organization mismatch. Refresh usage and retry.",
          );
        const file = serializeUsageExport(receipt, format);
        const url = URL.createObjectURL(
          new Blob([file.content], { type: file.mediaType }),
        );
        const link = document.createElement("a");
        try {
          link.href = url;
          link.download = file.filename;
          document.body.append(link);
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        report(
          `${format.toUpperCase()} usage snapshot downloaded${receipt.replayed ? " from the original audited receipt" : ""}.`,
          false,
        );
      } else {
        const receipt = await reconciliation.mutateAsync(input);
        report(
          `Reconciliation ${receipt.replayed ? "replayed" : "completed"}: ${receipt.checked.toLocaleString()} checked, ${receipt.repaired.toLocaleString()} repaired, ${receipt.released.toLocaleString()} released, ${receipt.unresolved.toLocaleString()} unresolved. Current usage is being refreshed.`,
          false,
        );
      }
      attempts.current = { ...attempts.current, [operation]: undefined };
      setRetry((previous) => ({ ...previous, [operation]: false }));
    } catch (error) {
      if (!mounted.current) return;
      const apiError = error instanceof ApiClientError ? error : null;
      const isBusy =
        apiError?.code === "license_usage_busy" ||
        apiError?.status === 423 ||
        (apiError?.status === 503 &&
          apiError.code !== "license_usage_unavailable");
      const conflict = apiError?.status === 409 && !isBusy;
      if (conflict) {
        attempts.current = { ...attempts.current, [operation]: undefined };
        setConflicts((previous) => ({ ...previous, [operation]: version }));
      }
      setRetry((previous) => ({ ...previous, [operation]: !conflict }));
      report(
        conflict
          ? "Licence or usage changed. Refresh usage, review the new readings, and start a new attempt."
          : isBusy
            ? "Usage operation is busy. Refresh usage and retry the same attempt."
            : apiError?.code === "license_usage_unavailable"
              ? "Usage is temporarily unavailable. Refresh usage and retry the same attempt."
              : error instanceof Error
                ? error.message
                : "Usage operation failed. Refresh usage and retry the same attempt.",
        true,
      );
    } finally {
      if (mounted.current) setRunning(null);
    }
  }
  async function refreshUsage() {
    const result = await usage.refetch();
    if (mounted.current && !result.isError) setConflicts({});
  }
  return (
    <section
      aria-labelledby={titleId}
      className={cn("mt-6 min-w-0 border-t border-border pt-5")}
    >
      <h3 id={titleId} className={cn("text-subhead-semibold text-fg")}>
        Current usage
      </h3>
      <p className={cn("mt-2 max-w-prose text-subhead-regular text-fg")}>
        Organization gauges show current use and reservations. No calendar
        reset: readings change with source records. Licence capacity never
        replaces permissions or regulatory approvals.
      </p>
      {usage.isPending ? (
        <p role="status" className={cn("mt-4 text-subhead-regular text-fg")}>
          Loading usage…
        </p>
      ) : null}
      {usage.error ? (
        <p
          role="alert"
          className={cn("mt-4 text-subhead-regular text-danger-fg")}
        >
          Usage is unavailable
          {data ? "; previously loaded readings may be stale" : ""}. Refresh
          usage to retry.
        </p>
      ) : null}
      {data ? (
        <>
          <dl
            className={cn(
              "mt-4 flex flex-wrap gap-x-6 gap-y-2 text-caption-1-regular text-fg",
            )}
          >
            <div>
              <dt className={cn("font-semibold")}>Observed</dt>
              <dd>
                <time dateTime={data.observedAt}>{date(data.observedAt)}</time>
              </dd>
            </div>
            <div>
              <dt className={cn("font-semibold")}>Reconciled</dt>
              <dd>
                {data.reconciledAt ? (
                  <time dateTime={data.reconciledAt}>
                    {date(data.reconciledAt)}
                  </time>
                ) : (
                  "Never reconciled"
                )}
              </dd>
            </div>
            <div>
              <dt className={cn("font-semibold")}>Versions</dt>
              <dd>
                Licence {data.license.version.toLocaleString()} · Meter{" "}
                {data.meterVersion.toLocaleString()} · Definitions{" "}
                {data.definitionVersion}
              </dd>
            </div>
          </dl>
          <p className={cn("mt-3 text-caption-1-regular text-fg")}>
            {data.license.verified
              ? "Limits come from the locally verified licence."
              : "Licence limits are unverified; known usage does not grant capacity."}{" "}
            {data.license.reasons.map(licenceReason).join(". ")}
          </p>
          <div
            role="region"
            aria-label="Usage readings, scroll horizontally if needed"
            tabIndex={0}
            className={cn(
              "mt-4 overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500",
            )}
          >
            <table
              aria-label="Licence capacity"
              className={cn(
                "w-full min-w-[640px] text-left text-caption-1-regular text-fg tabular-nums",
              )}
            >
              <thead>
                <tr>
                  {[
                    "Resource and definition",
                    "Used / reserved",
                    "Limit",
                    "Status",
                  ].map((label) => (
                    <th key={label} scope="col" className={cn("p-3 align-top")}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.counters.map((counter) => (
                  <tr key={counter.id} className={cn("border-t border-border")}>
                    <th
                      scope="row"
                      className={cn("max-w-xs p-3 align-top font-normal")}
                    >
                      <span className={cn("font-semibold")}>
                        {ROW_LABELS[counter.id]}
                      </span>
                      <p className={cn("mt-1")}>{counter.definition}</p>
                    </th>
                    <td className={cn("p-3 align-top")}>
                      <Quantity value={counter.value} unit={counter.unit} />
                      <dl className={cn("mt-2 space-y-1")}>
                        {counter.components.map((component) => (
                          <div key={component.key}>
                            <dt>{COMPONENT_LABELS[component.key]}</dt>
                            <dd>
                              <Quantity
                                value={component.value}
                                unit={counter.unit}
                              />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                    <td className={cn("p-3 align-top")}>
                      <Limit counter={counter} />
                    </td>
                    <td className={cn("p-3 align-top")}>
                      <span
                        className={cn(
                          "font-semibold",
                          counter.state === "over_limit" && "text-danger-fg",
                        )}
                      >
                        {counter.limit.kind === "exempt" &&
                        counter.state === "normal"
                          ? "Informational"
                          : STATES[counter.state]}
                      </span>
                      {counter.reasons.map((reason) => (
                        <p key={reason} className={cn("mt-1")}>
                          {licenceReason(reason)}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn("mt-3 text-caption-1-regular text-fg")}>
            Generated protective evidence and exports are exempt from the
            customer storage limit. Uncertain uploads remain reserved until
            source proof permits release.
          </p>
        </>
      ) : null}
      <div className={cn("mt-4 flex flex-wrap gap-3")}>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          disabled={busy || usage.isFetching}
          onClick={() => void refreshUsage()}
        >
          Refresh usage
        </Button>
        {(["json", "csv"] as const).map((format) => (
          <Button
            key={format}
            type="button"
            variant="outline"
            tone="grey"
            disabled={blocked("export")}
            onClick={() => void operate("export", format)}
          >
            {running === "export"
              ? "Exporting…"
              : `${retry.export ? "Retry export" : "Export"} ${format.toUpperCase()}`}
          </Button>
        ))}
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={blocked("reconcile")}
            onClick={() => void operate("reconcile")}
          >
            {running === "reconcile" || reconciliation.isPending
              ? "Reconciling…"
              : retry.reconcile
                ? "Retry reconciliation"
                : "Reconcile usage"}
          </Button>
        ) : null}
      </div>
      <p className={cn("mt-2 text-caption-1-regular text-fg")}>
        Exports contain aggregate readings and version provenance.
        Reconciliation checks at most 100 reservations per attempt and preserves
        unresolved charges.
      </p>
      <p
        ref={feedback}
        tabIndex={-1}
        role={message?.error ? "alert" : "status"}
        aria-live="polite"
        className={cn(
          "mt-3 text-subhead-regular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          message?.error ? "text-danger-fg" : "text-fg",
        )}
      >
        {message?.text ?? (busy ? "Usage operation in progress…" : "")}
      </p>
    </section>
  );
}
