"use client";
import { useState, useEffect, useRef } from "react";
import { Button } from "@repo/ui/button";
import { Chart } from "@repo/ui/chart";
import { cn } from "@repo/ui/cn";
import type {
  DashboardTrendsQuery,
  DashboardTrendMetric,
  DashboardTrendSeries,
} from "@repo/contracts/dashboard/types";
import { dashboardTrendsQuerySchema } from "@repo/contracts/dashboard/schemas";
import {
  defaultTrendFilters,
  trendValue,
  trendDate,
  trendReason,
} from "./dashboard-trends-policy";
import {
  useDashboardTrends,
  useDashboardTrendSources,
  useDashboardTrendProducts,
} from "./dashboard-trends.queries";

const titles: Record<DashboardTrendMetric, string> = {
  activity: "Findings opened and closed",
  triage: "Mean time to first triage",
  remediation: "Mean time to remediate",
  sbomCoverage: "SBOM release coverage",
  readiness: "Readiness at snapshot creation",
};
const metrics = Object.keys(titles) as DashboardTrendMetric[];
const control = cn(
  "min-w-0 max-w-full rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular focus-visible:outline-2 focus-visible:outline-active-500",
);

function TrendSeries({
  metric,
  series,
  timezone,
  onSources,
  disabled,
}: {
  metric: DashboardTrendMetric;
  series: DashboardTrendSeries;
  timezone: string;
  onSources: () => void;
  disabled: boolean;
}) {
  const activity = metric === "activity";
  const coverage = metric === "sbomCoverage" || metric === "readiness";
  const bucketLabel = (start: string, partial: boolean) =>
    `${trendDate(start, timezone)}${partial ? " (partial)" : ""}`;
  const categories = series.buckets.map((b) => bucketLabel(b.start, b.partial));
  return (
    <section
      aria-label={titles[metric]}
      className="min-w-0 border-t border-border pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-h5">
          {titles[metric]}{" "}
          <span className="text-subhead-regular">({series.unit})</span>
        </h3>
        <Button
          variant="outline"
          tone="grey"
          className={cn("h-auto min-h-10 max-w-full whitespace-normal py-2")}
          disabled={disabled || series.state !== "available"}
          onClick={onSources}
        >
          View {titles[metric].toLowerCase()} sources
        </Button>
      </div>
      <p className="mt-2 text-subhead-regular">
        {trendReason(series.reason) ??
          (coverage
            ? "Observed numerator / eligible denominator; gaps are unavailable history."
            : activity
              ? "First openings and effective closures; reopenings are separate. Suppression does not close a finding."
              : "Terminal-event cohorts; unresolved and negative durations are excluded.")}
      </p>
      {metric === "sbomCoverage" ? (
        <p className="mt-2 text-caption-1-regular">
          Coverage carries forward only from recorded history. Observations
          count historical facts in each bucket; sources also include earlier
          coverage context at its original date.
        </p>
      ) : null}
      {series.baselineAt ? (
        <p className="mt-2 text-caption-1-regular">
          Baseline:{" "}
          <time dateTime={series.baselineAt}>
            {trendDate(series.baselineAt, timezone)}
          </time>
        </p>
      ) : null}
      {series.state === "available" && series.buckets.length ? (
        <Chart
          ariaLabel={`${titles[metric]} chart. Exact values in the table below.`}
          height={240}
          deps={[series, timezone]}
          notMerge
          build={(p) => ({
            animation: false,
            grid: {
              top: 45,
              right: 20,
              bottom: 35,
              left: 55,
              containLabel: true,
            },
            legend: { top: 0, textStyle: { color: p.fg } },
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "category",
              data: categories,
              axisLabel: { color: p.fgMuted },
            },
            yAxis: {
              type: "value",
              name: series.unit,
              min: 0,
              ...(coverage ? { max: 100 } : {}),
              splitLine: { lineStyle: { color: p.border } },
            },
            series: activity
              ? [
                  {
                    name: "Opened",
                    type: "bar",
                    data: series.buckets.map((b) => b.opened),
                    itemStyle: { color: p.active },
                  },
                  {
                    name: "Closed",
                    type: "bar",
                    data: series.buckets.map((b) => b.closed),
                    itemStyle: { color: p.success },
                  },
                  {
                    name: "Reopened",
                    type: "line",
                    symbol: "diamond",
                    lineStyle: { type: "dashed" },
                    data: series.buckets.map((b) => b.reopened),
                    itemStyle: { color: p.fg },
                  },
                ]
              : [
                  {
                    name: titles[metric],
                    type: "line",
                    connectNulls: false,
                    smooth: false,
                    showSymbol: true,
                    symbol: "circle",
                    data: series.buckets.map((b) => b.value),
                    itemStyle: { color: p.active },
                  },
                ],
          })}
        />
      ) : (
        <p role="status" className="py-6 text-subhead-regular">
          {series.state === "restricted"
            ? "Source access restricted."
            : "Historical observations unavailable for this selection."}
        </p>
      )}
      <div
        role="region"
        aria-label={`${titles[metric]} table scroll area`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !["ArrowLeft", "ArrowRight"].includes(event.key) ||
            event.currentTarget.scrollWidth <= event.currentTarget.clientWidth
          )
            return;
          event.preventDefault();
          event.currentTarget.scrollBy({
            left: event.key === "ArrowRight" ? 96 : -96,
            behavior: "auto",
          });
        }}
        className={cn(
          "mt-4 min-w-0 overflow-x-auto focus-visible:outline-2 focus-visible:outline-active-500",
        )}
      >
        <table className="w-full text-left text-subhead-regular tabular-nums">
          <caption className="sr-only">{titles[metric]} values</caption>
          <thead>
            <tr>
              {[
                "Bucket",
                ...(activity
                  ? ["Opened", "Closed", "Reopened"]
                  : [`Value (${series.unit})`]),
                ...(coverage
                  ? ["Numerator", "Denominator"]
                  : ["Samples", "Excluded"]),
                metric === "sbomCoverage" ? "Observations" : "Sources",
              ].map((label) => (
                <th
                  scope="col"
                  key={label}
                  className="whitespace-nowrap border-b border-border p-3"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.buckets.map((b) => (
              <tr key={b.start}>
                <th
                  scope="row"
                  className="whitespace-nowrap border-b border-border p-3 font-normal"
                >
                  {bucketLabel(b.start, b.partial)}
                </th>
                {(activity ? [b.opened, b.closed, b.reopened] : [b.value]).map(
                  (value, i) => (
                    <td key={i} className="border-b border-border p-3">
                      {trendValue(value)}
                    </td>
                  ),
                )}
                {(coverage
                  ? [b.numerator, b.denominator]
                  : [b.sampleCount, b.excludedCount]
                ).map((value, i) => (
                  <td key={i} className="border-b border-border p-3">
                    {trendValue(value)}
                  </td>
                ))}
                <td className="border-b border-border p-3">{b.sourceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DashboardTrendsPanel({
  productId,
  scope,
  enabled,
  canSelectProduct = false,
}: {
  productId?: string;
  scope: string;
  enabled: boolean;
  canSelectProduct?: boolean;
}) {
  const [draft, setDraft] = useState<DashboardTrendsQuery>(() => ({
    ...defaultTrendFilters(),
    ...(productId ? { productId } : {}),
  }));
  const [filters, setFilters] = useState(draft);
  const [message, setMessage] = useState<string | null>(null);
  const [sourcePin, setSourcePin] = useState<{
    token: string;
    scope: string;
    expiresAt: number;
  }>();
  const [selectedMetric, setMetric] = useState<DashboardTrendMetric | null>(
    null,
  );
  const [cursor, setCursor] = useState<string>();
  const [search, setSearch] = useState("");
  const products = useDashboardTrendProducts(
    scope,
    enabled && canSelectProduct && !productId,
    search,
  );
  const [exporting, setExporting] = useState(false);
  const sourceViewOpen =
    enabled &&
    selectedMetric !== null &&
    sourcePin?.scope === scope &&
    Date.now() < sourcePin.expiresAt;
  const query = useDashboardTrends(filters, scope, enabled, sourceViewOpen);
  const data = enabled ? query.data : undefined;
  const expired =
    !!data && Date.now() - Date.parse(data.generatedAt) >= 15 * 60 * 1000;
  const metric =
    !expired && sourceViewOpen && sourcePin?.token === data?.datasetToken
      ? selectedMetric
      : null;
  useEffect(() => {
    if (
      selectedMetric &&
      (!enabled ||
        sourcePin?.scope !== scope ||
        expired ||
        query.isError ||
        (data && sourcePin?.token !== data.datasetToken))
    ) {
      setMetric(null);
      setSourcePin(undefined);
      setCursor(undefined);
    }
  }, [data, enabled, expired, query.isError, scope, selectedMetric, sourcePin]);
  const sourceRef = useRef<HTMLElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (metric) {
      sourceRef.current?.scrollIntoView?.({ block: "start" });
      sourceRef.current?.focus({ preventScroll: true });
    }
  }, [metric]);
  const sources = useDashboardTrendSources(
    data?.datasetToken,
    metric,
    cursor,
    scope,
    enabled && !expired,
  );
  if (!enabled) return null;
  const apply = () => {
    const parsed = dashboardTrendsQuerySchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(
        "Choose valid dates, an IANA timezone and a range of at most 366 days.",
      );
      return;
    }
    setMessage(null);
    setMetric(null);
    setCursor(undefined);
    if (JSON.stringify(filters) === JSON.stringify(parsed.data))
      void query.refetch();
    else setFilters(parsed.data);
  };
  return (
    <section
      data-testid="dashboard-trends"
      className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-surface p-6"
    >
      <div>
        <h2 className="text-h4">Finding and coverage trends</h2>
        <p className="mt-2 max-w-prose text-subhead-regular">
          Historical facts with explicit cohorts and source evidence. Missing
          history is unavailable, not zero.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
        className="flex flex-wrap items-end gap-4"
      >
        {(["from", "to"] as const).map((key) => (
          <label
            key={key}
            className="flex min-w-0 max-w-full flex-col gap-2 text-subhead-medium"
          >
            {key === "from" ? "From date" : "To date"}
            <input
              type="date"
              className={control}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="flex min-w-0 max-w-full flex-col gap-2 text-subhead-medium">
          Timezone
          <input
            className={control}
            list="trend-timezones"
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          />
          <datalist id="trend-timezones">
            {[
              "UTC",
              Intl.DateTimeFormat().resolvedOptions().timeZone,
              "America/New_York",
              "Europe/London",
              "Asia/Kolkata",
            ]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((v) => (
                <option key={v} value={v} />
              ))}
          </datalist>
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-2 text-subhead-medium">
          Time bucket
          <select
            className={control}
            aria-label="Time bucket"
            value={draft.bucket}
            onChange={(e) =>
              setDraft({
                ...draft,
                bucket: e.target.value as DashboardTrendsQuery["bucket"],
              })
            }
          >
            <option value="day">Daily</option>
            <option value="week">Weekly (Monday)</option>
            <option value="month">Monthly</option>
          </select>
        </label>
        {!productId && canSelectProduct ? (
          <>
            <label className="flex min-w-0 max-w-full flex-col gap-2 text-subhead-medium">
              Find product
              <input
                className={control}
                value={search}
                maxLength={200}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 max-w-full flex-col gap-2 text-subhead-medium">
              Product cohort
              <select
                className={control}
                aria-label="Product cohort"
                value={draft.productId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, productId: e.target.value || undefined })
                }
              >
                <option value="">Organization activity / coverage</option>
                {draft.productId &&
                !products.data?.products.rows.some(
                  (product) => product.id === draft.productId,
                ) ? (
                  <option value={draft.productId}>Selected product</option>
                ) : null}
                {products.data?.products.rows.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            {products.isError ? (
              <p role="status">
                Product choices unavailable. Refresh or open the product
                registry.
              </p>
            ) : null}
          </>
        ) : null}
        <Button
          type="submit"
          disabled={query.isFetching}
          loading={query.isFetching}
        >
          Apply trend filters
        </Button>
      </form>
      {!filters.productId ? (
        <p className="text-subhead-regular">
          Organization activity and SBOM coverage. Open a product’s posture
          dashboard for product-specific duration and readiness cohorts.
        </p>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
      {query.isLoading ? <p role="status">Loading historical facts…</p> : null}
      {query.isError ? (
        <div role="alert" className="text-subhead-regular">
          Trend evidence is unavailable or the dataset access changed. Your
          filters are preserved.{" "}
          <Button
            variant="outline"
            tone="grey"
            onClick={() => {
              setMetric(null);
              setCursor(undefined);
              void query.refetch();
            }}
          >
            Refresh trends
          </Button>
        </div>
      ) : null}
      {data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 break-words text-caption-1-regular">
              Policy {data.policyVersion} · Revision {data.datasetRevision} ·{" "}
              {data.filters.timezone} ·{" "}
              <time dateTime={data.generatedAt}>
                {new Date(data.generatedAt).toLocaleString()}
              </time>
            </p>
            <Button
              variant="outline"
              tone="grey"
              className={cn(
                "h-auto min-h-10 max-w-full whitespace-normal py-2",
              )}
              disabled={expired || query.isFetching || exporting}
              loading={exporting}
              onClick={() => {
                setExporting(true);
                setMessage(null);
                void query
                  .exportDataset(data.datasetToken)
                  .catch(() =>
                    setMessage(
                      "Export unavailable or access changed. Refresh trends before retrying.",
                    ),
                  )
                  .finally(() => setExporting(false));
              }}
            >
              Export displayed dataset (CSV)
            </Button>
          </div>
          {expired ? (
            <p role="status">
              Dataset expired. Apply filters again to refresh before exporting
              or opening sources.
            </p>
          ) : null}
          {metrics.map((key) => (
            <TrendSeries
              key={key}
              metric={key}
              series={data.series[key]}
              timezone={data.filters.timezone}
              disabled={expired || query.isFetching}
              onSources={() => {
                sourceTrigger.current =
                  document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
                setSourcePin({
                  token: data.datasetToken,
                  scope,
                  expiresAt: Date.parse(data.generatedAt) + 15 * 60 * 1000,
                });
                setMetric(key);
                setCursor(undefined);
              }}
            />
          ))}
        </>
      ) : null}
      {metric && data ? (
        <section
          ref={sourceRef}
          tabIndex={-1}
          aria-label={`${titles[metric]} source records`}
          className="border-t border-border pt-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-h5">{titles[metric]} source records</h3>
            <Button
              variant="outline"
              tone="grey"
              onClick={() => {
                setMetric(null);
                setCursor(undefined);
                sourceTrigger.current?.focus();
              }}
            >
              Close source records
            </Button>
          </div>
          {sources.isLoading ? (
            <p role="status">Loading contributing facts…</p>
          ) : null}
          {sources.isError ? (
            <p role="alert">
              Source records unavailable. Refresh the dataset to continue.
            </p>
          ) : null}
          {sources.data ? (
            <>
              <ul className="divide-y divide-border">
                {sources.data.items.map((item) => (
                  <li key={item.id} className="py-3 text-subhead-regular">
                    <p>
                      {item.factKind.replaceAll("_", " ")} ·{" "}
                      {trendDate(item.effectiveAt, data.filters.timezone)}
                    </p>
                    <p className="mt-1 break-words text-caption-1-regular">
                      {item.provenance} · Recorded{" "}
                      {new Date(item.recordedAt).toLocaleString()}
                    </p>
                    {item.href ? (
                      <a
                        className="mt-2 inline-block text-active-500 underline underline-offset-4 focus-visible:outline-2"
                        href={item.href}
                      >
                        Open source record
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              {!sources.data.items.length ? (
                <p>
                  No contributing records for this metric in the selected range.
                </p>
              ) : null}
              {sources.data.continuationUnavailable === "source_page_limit" ? (
                <p role="status" className="mt-3 text-subhead-regular">
                  More source records exist. Narrow the date range to continue.
                </p>
              ) : null}
              {sources.data.nextCursor ? (
                <Button
                  variant="outline"
                  tone="grey"
                  onClick={() => setCursor(sources.data!.nextCursor!)}
                >
                  Next source page
                </Button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
