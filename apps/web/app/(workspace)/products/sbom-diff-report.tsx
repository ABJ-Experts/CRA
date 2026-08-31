"use client";

import {
  sbomComponentChangeKindSchema,
  sbomSourceDiffParamsSchema,
  type SbomComponentChangeKind,
  type SbomDiffComponentChange,
  type SbomDiffReport,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { SearchInput } from "@repo/ui/input";
import { Select, SelectItem } from "@repo/ui/select";
import { Tag, type TagProps } from "@repo/ui/tag";
import { ArrowLeftRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useRetrySbomDiffMutation,
  useSbomDiffComponentsQuery,
  useSbomDiffFindingsQuery,
  useSbomDiffReportQuery,
  useSbomSourceDiffQuery,
  useStartSbomDiffMutation,
} from "../../_features/sboms/sboms.queries";

const SEARCH_DEBOUNCE_MS = 250;

const changeLabels: Readonly<Record<SbomComponentChangeKind, string>> = {
  added: "Added",
  removed: "Removed",
  unchanged: "Unchanged",
  upgraded: "Upgraded",
  downgraded: "Downgraded",
  unresolved: "Unresolved",
};

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string | null): string {
  if (value === null) return "Not completed";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function diffErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to compare SBOM versions.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This SBOM comparison is unavailable.";
  }
  return "SBOM comparison data is temporarily unavailable. Try again.";
}

function reportTone(report: SbomDiffReport): TagProps["tone"] {
  if (report.state === "failed") return "red";
  return report.state === "completed" ? "green" : "blue";
}

function comparisonLabel(report: SbomDiffReport): string {
  if (report.comparisonStatus === "identical") return "Identical";
  if (report.comparisonStatus === "partial_integration_unavailable") {
    return "Partial integration";
  }
  return "Comparable";
}

function changeTone(change: SbomComponentChangeKind): TagProps["tone"] {
  if (change === "added" || change === "upgraded") return "green";
  if (change === "removed" || change === "downgraded") return "red";
  if (change === "unresolved") return "orange";
  return "blue";
}

function useDebouncedValue(value: string): string {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedValue(value),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [value]);
  return debouncedValue;
}

function Metric({
  label,
  value,
  description,
}: Readonly<{ label: string; value: string | number; description: string }>) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4">
      <p className="text-caption-1-semibold text-fg-muted">{label}</p>
      <p className="mt-2 text-title-2-semibold text-fg">{value}</p>
      <p className="mt-1 text-caption-2-regular text-fg-muted">{description}</p>
    </section>
  );
}

function ChangeTable({
  changes,
  pending,
  error,
  nextCursor,
  onNextPage,
}: Readonly<{
  changes: readonly SbomDiffComponentChange[];
  pending: boolean;
  error: unknown;
  nextCursor: string | null;
  onNextPage: (cursor: string) => void;
}>) {
  if (pending) {
    return (
      <p role="status" className="mt-4 text-caption-1-regular text-fg-muted">
        Loading component changes...
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="mt-4 text-caption-1-regular text-danger">
        {diffErrorMessage(error)}
      </p>
    );
  }
  if (changes.length === 0) {
    return (
      <p className="mt-4 text-caption-1-regular text-fg-muted">
        No component changes match these filters.
      </p>
    );
  }
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[58rem] border-collapse text-left">
          <caption className="sr-only">SBOM component changes</caption>
          <thead className="bg-surface">
            <tr>
              {["Change", "Identity", "Baseline", "Current", "Explanation"].map(
                (label) => (
                  <th
                    key={label}
                    scope="col"
                    className="px-3 py-2 text-caption-2-uppercase text-fg-muted"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.id} className="border-t border-border align-top">
                <td className="px-3 py-3">
                  <Tag variant="dot" size="sm" tone={changeTone(change.change)}>
                    {changeLabels[change.change]}
                  </Tag>
                </td>
                <td className="max-w-64 break-words px-3 py-3 font-mono text-caption-2-regular text-fg">
                  {change.identity ?? "Unresolved identity"}
                </td>
                <td className="max-w-56 break-words px-3 py-3 text-caption-2-regular text-fg-muted">
                  {change.baselinePurl ??
                    change.baselineVersion ??
                    "Not present"}
                </td>
                <td className="max-w-56 break-words px-3 py-3 text-caption-2-regular text-fg">
                  {change.currentPurl ?? change.currentVersion ?? "Not present"}
                </td>
                <td className="max-w-80 break-words px-3 py-3 text-caption-2-regular text-fg-muted">
                  {change.explanation}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => onNextPage(nextCursor)}
        >
          Load next changes
        </Button>
      ) : null}
    </>
  );
}

function FindingDelta({
  diffId,
  enabled,
}: Readonly<{ diffId: string; enabled: boolean }>) {
  const findings = useSbomDiffFindingsQuery(diffId, { limit: 50 }, enabled);
  if (findings.isPending) {
    return (
      <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
        Loading finding delta...
      </p>
    );
  }
  if (findings.isError || !findings.data) {
    return (
      <p role="alert" className="mt-3 text-caption-1-regular text-danger">
        {diffErrorMessage(findings.error)}
      </p>
    );
  }
  if (findings.data.status === "partial_integration_unavailable") {
    return (
      <p className="mt-3 text-caption-1-regular text-fg-muted">
        {findings.data.reason ?? "Finding delta integration is unavailable."}
      </p>
    );
  }
  if (findings.data.findings.length === 0) {
    return (
      <p className="mt-3 text-caption-1-regular text-fg-muted">
        No finding changes were recorded.
      </p>
    );
  }
  return (
    <ul aria-label="Finding delta" className="mt-3 grid gap-2">
      {findings.data.findings.map((finding) => (
        <li
          key={`${finding.findingId}-${finding.change}`}
          className="rounded-lg border border-border bg-canvas p-3"
        >
          <p className="text-caption-1-semibold text-fg">
            {titleCase(finding.change)} finding
          </p>
          <p className="mt-1 text-caption-2-regular text-fg-muted">
            {finding.explanation} Origin: {titleCase(finding.origin)}.
          </p>
        </li>
      ))}
    </ul>
  );
}

function CompletedDiff({
  report,
  enabled,
}: Readonly<{ report: SbomDiffReport; enabled: boolean }>) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const rawChange = params.get("change");
  const selectedChange =
    sbomComponentChangeKindSchema.safeParse(rawChange).data;
  const ecosystem = params.get("ecosystem") ?? "";
  const rawQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(rawQuery);
  const debouncedQuery = useDebouncedValue(query);
  const cursor = params.get("cursor") ?? undefined;
  const changes = useSbomDiffComponentsQuery(
    report.id,
    {
      limit: 50,
      cursor,
      ...(selectedChange ? { change: selectedChange } : {}),
      ...(ecosystem ? { ecosystem } : {}),
      ...(debouncedQuery ? { q: debouncedQuery } : {}),
    },
    enabled,
  );

  useEffect(() => setQuery(rawQuery), [rawQuery]);

  function replaceQuery(values: Readonly<Record<string, string | undefined>>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, {
      scroll: false,
    });
  }

  useEffect(() => {
    if (debouncedQuery === rawQuery) return;
    replaceQuery({ q: debouncedQuery, cursor: undefined });
    // The URL params are intentionally the source of truth; changing them retriggers this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const summary = report.counts;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Compared versions"
          value={comparisonLabel(report)}
          description={`Source ${report.baselineSourceId} → ${report.sourceId}.`}
        />
        <Metric
          label="Component delta"
          value={
            report.comparisonStatus === "identical"
              ? 0
              : (summary?.componentChanges ?? "—")
          }
          description={
            report.comparisonStatus === "identical"
              ? "No component changes were detected."
              : "Added, removed, version, and unresolved changes."
          }
        />
        <Metric
          label="Finding delta"
          value={
            report.findingDelta.status === "available"
              ? "Available"
              : "Partial integration"
          }
          description={
            report.findingDelta.reason ??
            "Finding changes remain separate from component evidence."
          }
        />
        <Metric
          label="Completed"
          value={formatInstant(report.completedAt)}
          description={`Comparator: ${report.comparatorVersion}.`}
        />
      </div>
      {summary ? (
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-diff-components-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="sbom-diff-components-heading"
                className="text-title-3-semibold text-fg"
              >
                Component changes
              </h2>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                {report.comparisonStatus === "identical"
                  ? "The compared normalized graphs have no component delta."
                  : "Current source evidence is compared with its immutable release predecessor."}
              </p>
            </div>
            <Tag variant="cool" size="sm">
              {summary.componentChanges}
            </Tag>
          </div>
          {report.comparisonStatus === "identical" ? (
            <p role="status" className="mt-4 text-caption-1-regular text-fg-muted">
              The compared normalized graphs are identical.
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SearchInput
                  aria-label="Search component changes"
                  value={query}
                  onValueChange={setQuery}
                  clearable
                  placeholder="Package URL, version, or explanation"
                />
                <Select
                  label="Change"
                  value={selectedChange ?? "all"}
                  onValueChange={(value) =>
                    replaceQuery({
                      change: value === "all" ? undefined : value,
                      cursor: undefined,
                    })
                  }
                >
                  <SelectItem value="all">All changes</SelectItem>
                  {Object.entries(changeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </Select>
                <label className="flex flex-col gap-2 text-caption-1-semibold text-fg-muted">
                  Ecosystem
                  <input
                    aria-label="Filter by ecosystem"
                    value={ecosystem}
                    onChange={(event) =>
                      replaceQuery({
                        ecosystem: event.target.value,
                        cursor: undefined,
                      })
                    }
                    className="h-10 rounded-xl border border-border bg-canvas px-3 text-caption-1-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-active-500"
                    placeholder="npm, maven, python"
                  />
                </label>
              </div>
              <ChangeTable
                changes={changes.data?.changes ?? []}
                pending={changes.isPending}
                error={changes.isError ? changes.error : null}
                nextCursor={changes.data?.nextCursor ?? null}
                onNextPage={(nextCursor) => replaceQuery({ cursor: nextCursor })}
              />
            </>
          )}
        </section>
      ) : null}
      <section
        className="rounded-xl border border-border bg-surface-subtle p-4"
        aria-labelledby="sbom-diff-findings-heading"
      >
        <h2
          id="sbom-diff-findings-heading"
          className="text-title-3-semibold text-fg"
        >
          Finding delta
        </h2>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Finding changes are displayed separately so human assessments are
          never overwritten by a component comparison.
        </p>
        <FindingDelta diffId={report.id} enabled={enabled} />
      </section>
    </>
  );
}

export function SbomDiffReport({
  productId,
  documentId,
  sourceId,
  canView,
  canStart,
  enabled,
}: Readonly<{
  productId: string;
  documentId: string;
  sourceId?: string;
  canView: boolean;
  canStart: boolean;
  enabled: boolean;
}>) {
  const params = useSearchParams();
  const sourceCandidate = sbomSourceDiffParamsSchema.safeParse({ sourceId });
  const sourceIdValue = sourceCandidate.success
    ? sourceCandidate.data.sourceId
    : null;
  const rawBaseSourceId = params.get("baseSourceId");
  const baselineCandidate =
    rawBaseSourceId === null
      ? undefined
      : sbomSourceDiffParamsSchema.safeParse({ sourceId: rawBaseSourceId });
  const baseSourceId =
    baselineCandidate && baselineCandidate.success
      ? baselineCandidate.data.sourceId
      : undefined;
  const hasInvalidBaseline =
    baselineCandidate !== undefined && !baselineCandidate.success;
  const startedFor = useRef<string | null>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const start = useStartSbomDiffMutation();
  const sourceDiff = useSbomSourceDiffQuery(
    sourceIdValue,
    baseSourceId ? { baseSourceId } : {},
    enabled && canView && !hasInvalidBaseline,
  );
  const sourceReport =
    sourceDiff.data?.status === "found" ? sourceDiff.data.report : undefined;
  const reportId = sourceReport?.id ?? diffId;
  const detail = useSbomDiffReportQuery(reportId, enabled && canView);
  const retry = useRetrySbomDiffMutation();
  const startKey = `${sourceIdValue ?? ""}:${baseSourceId ?? ""}`;

  useEffect(() => {
    if (
      !enabled ||
      !canView ||
      !canStart ||
      !sourceIdValue ||
      hasInvalidBaseline ||
      sourceDiff.isPending ||
      sourceDiff.isError ||
      sourceDiff.data?.status !== "not_started" ||
      startedFor.current === startKey
    )
      return;
    startedFor.current = startKey;
    setDiffId(null);
    start.mutate({
      sourceId: sourceIdValue,
      input: {
        baseSourceId: sourceDiff.data.baselineSourceId,
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }, [
    baseSourceId,
    canView,
    canStart,
    enabled,
    hasInvalidBaseline,
    sourceIdValue,
    sourceDiff.data,
    sourceDiff.isError,
    sourceDiff.isPending,
    start,
    startKey,
  ]);

  useEffect(() => {
    if (start.data?.status === "queued") setDiffId(start.data.report.id);
  }, [start.data]);

  if (!canView)
    return (
      <p role="alert" className="text-subhead-regular text-danger">
        You do not have permission to compare SBOM versions.
      </p>
    );
  if (sourceId === undefined || sourceIdValue === null)
    return (
      <p role="alert" className="text-subhead-regular text-danger">
        A valid source provenance identifier is required to compare release
        lineage.
      </p>
    );
  if (hasInvalidBaseline)
    return (
      <p role="alert" className="text-subhead-regular text-danger">
        The requested baseline source identifier is invalid.
      </p>
    );
  if (sourceDiff.isPending || start.isPending || (reportId !== null && detail.isPending))
    return (
      <p role="status" className="text-subhead-regular text-fg-muted">
        Preparing SBOM comparison...
      </p>
    );
  if (sourceDiff.isError || start.isError || detail.isError)
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-surface-subtle p-4"
      >
        <p className="text-caption-1-regular text-danger">
          {diffErrorMessage(sourceDiff.error ?? start.error ?? detail.error)}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => {
            startedFor.current = null;
            start.reset();
          }}
        >
          Try again
        </Button>
      </div>
    );

  const noComparable =
    sourceDiff.data?.status === "no_comparable_version"
      ? sourceDiff.data
      : start.data?.status === "no_comparable_version"
        ? start.data
        : undefined;
  if (noComparable) {
    return (
      <section aria-label="SBOM lineage comparison" className="grid gap-4">
        <header className="rounded-xl border border-border bg-surface-subtle p-4">
          <Link
            href={`/products/${productId}/sboms/${documentId}?sourceId=${encodeURIComponent(sourceId)}`}
            className="text-caption-1-semibold text-active-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500"
          >
            Back to normalized graph
          </Link>
          <h1 className="mt-3 text-title-2-semibold text-fg">
            SBOM comparison
          </h1>
        </header>
        <div
          role="status"
          className="rounded-xl border border-border bg-surface-subtle p-4"
        >
          <p className="text-subhead-semibold text-fg">
            No comparable version.
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            {noComparable.reason}
          </p>
        </div>
      </section>
    );
  }
  if (sourceDiff.data?.status === "not_started" && !canStart) {
    return (
      <section aria-label="SBOM lineage comparison" className="grid gap-4">
        <header className="rounded-xl border border-border bg-surface-subtle p-4">
          <Link
            href={`/products/${productId}/sboms/${documentId}?sourceId=${encodeURIComponent(sourceId)}`}
            className="text-caption-1-semibold text-active-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500"
          >
            Back to normalized graph
          </Link>
          <h1 className="mt-3 text-title-2-semibold text-fg">
            SBOM comparison
          </h1>
        </header>
        <div
          role="status"
          className="rounded-xl border border-border bg-surface-subtle p-4"
        >
          <p className="text-subhead-semibold text-fg">
            A comparison has not been generated.
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            An authorized SBOM uploader can start the comparison for this
            release lineage.
          </p>
        </div>
      </section>
    );
  }
  const report =
    detail.data?.report ??
    sourceReport ??
    (start.data?.status === "queued" ? start.data.report : undefined);
  if (!report)
    return (
      <p role="status" className="text-subhead-regular text-fg-muted">
        Preparing SBOM comparison...
      </p>
    );
  const retryable =
    report.state === "failed" && report.error?.retryable === true;
  const readyForRows = report.state === "completed";

  return (
    <section aria-label="SBOM lineage comparison" className="grid gap-4">
      <header className="rounded-xl border border-border bg-surface-subtle p-4">
        <Link
          href={`/products/${productId}/sboms/${documentId}?sourceId=${encodeURIComponent(sourceId)}`}
          className="text-caption-1-semibold text-active-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500"
        >
          Back to normalized graph
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-caption-1-semibold text-fg-muted">
              Immutable release lineage
            </p>
            <h1 className="mt-1 text-title-2-semibold text-fg">
              SBOM comparison
            </h1>
            <p className="mt-1 max-w-3xl text-caption-1-regular text-fg-muted">
              Compare the selected source with its direct immutable predecessor.
              Component and finding changes remain separately explainable.
            </p>
          </div>
          <Tag variant="dot" size="sm" tone={reportTone(report)}>
            {titleCase(report.state)}
          </Tag>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-caption-2-regular text-fg-muted">
          <ArrowLeftRight aria-hidden="true" className="size-4" />
          <span>
            Baseline source {report.baselineSourceId} → source {report.sourceId}
          </span>
        </div>
      </header>
      {report.state === "failed" ? (
        <div
          role="alert"
          className="rounded-xl border border-border bg-surface-subtle p-4"
        >
          <p className="text-subhead-semibold text-fg">Comparison failed.</p>
          <p className="mt-1 text-caption-1-regular text-danger">
            {report.error?.message ?? "The comparison could not finish."}
          </p>
          {retryable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              tone="grey"
              className="mt-3"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate({
                  diffId: report.id,
                  input: { idempotencyKey: crypto.randomUUID() },
                })
              }
            >
              <RefreshCw
                aria-hidden="true"
                className={cn(
                  "mr-2 size-4",
                  retry.isPending && "animate-spin motion-reduce:animate-none",
                )}
              />
              Retry comparison
            </Button>
          ) : null}
        </div>
      ) : report.state !== "completed" ? (
        <div
          role="status"
          className="rounded-xl border border-border bg-surface-subtle p-4"
        >
          <p className="text-subhead-semibold text-fg">
            Comparison is {report.state}.
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            {report.progress.message}
          </p>
        </div>
      ) : readyForRows ? (
        <CompletedDiff report={report} enabled={enabled} />
      ) : null}
    </section>
  );
}
