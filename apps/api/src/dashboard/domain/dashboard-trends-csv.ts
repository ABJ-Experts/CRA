import type { DashboardTrendsData } from "@repo/contracts/dashboard/types";
/** Export the validated chart dataset rather than independently querying facts. */
export function dashboardTrendsCsv(data: DashboardTrendsData): string {
  const rows: (string | number | boolean | null)[][] = [
    [
      "policy",
      "revision",
      "timezone",
      "range_from",
      "range_to",
      "bucket",
      "as_of",
      "product",
      "metric",
      "state",
      "unit",
      "start",
      "end",
      "partial",
      "opened",
      "closed",
      "reopened",
      "value",
      "sample_count",
      "excluded_count",
      "numerator",
      "denominator",
      "source_count",
      "baseline",
      "reason",
    ],
  ];
  for (const [metric, series] of Object.entries(data.series)) {
    const meta = [
      data.policyVersion,
      data.datasetRevision,
      data.filters.timezone,
      data.filters.from,
      data.filters.to,
      data.filters.bucket,
      data.generatedAt,
      data.filters.productId ?? "organization",
      metric,
      series.state,
      series.unit,
    ];
    if (!series.buckets.length)
      rows.push([
        ...meta,
        ...Array.from({ length: 12 }, () => null),
        series.baselineAt,
        series.reason,
      ]);
    for (const b of series.buckets)
      rows.push([
        ...meta,
        b.start,
        b.end,
        b.partial,
        b.opened,
        b.closed,
        b.reopened,
        b.value,
        b.sampleCount,
        b.excludedCount,
        b.numerator,
        b.denominator,
        b.sourceCount,
        series.baselineAt,
        series.reason,
      ]);
  }
  return (
    rows
      .map((row) =>
        row
          .map((cell) => {
            const text = cell == null ? "" : String(cell);
            const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
            return `"${safe.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
