const bucket = {
  start: "2026-10-09T00:00:00.000Z",
  end: "2026-10-10T00:00:00.000Z",
  partial: true,
  opened: 2,
  closed: 1,
  reopened: 0,
  value: null,
  sampleCount: 0,
  excludedCount: 1,
  numerator: null,
  denominator: null,
  sourceCount: 3,
};
const filters = {
  from: "2026-10-09",
  to: "2026-10-09",
  timezone: "UTC",
  bucket: "day",
};
const withheld = (unit) => ({
  state: "unavailable",
  reason: "select_product",
  unit,
  baselineAt: null,
  buckets: [],
});

const source = (id, overrides = {}) => ({
  id,
  productId: "synthetic-product",
  sourceId: `source-${id}`,
  sourceType: "finding",
  factKind: "opening",
  provenance: "synthetic_benchmark",
  recordedAt: "2026-10-09T01:00:00.000Z",
  href: null,
  effectiveAt: "2026-10-09T01:00:00.000Z",
  ...overrides,
});
const sourcePage = (items, overrides = {}) => ({
  datasetRevision: dataset.datasetRevision,
  items,
  nextCursor: null,
  ...overrides,
});

const dataset = {
  datasetToken: "synthetic-test-pin",
  datasetRevision: "synthetic-test-revision",
  policyVersion: "m14-02-v1",
  generatedAt: "2026-10-09T12:00:00.000Z",
  filters,
  series: {
    activity: {
      state: "available",
      reason: null,
      unit: "count",
      baselineAt: "2026-10-09T00:00:00.000Z",
      buckets: [bucket],
    },
    triage: withheld("hours"),
    remediation: withheld("days"),
    sbomCoverage: withheld("percent"),
    readiness: withheld("percent"),
  },
};
const sourceDataset = {
  ...dataset,
  filters: { ...filters, productId: "synthetic-product" },
};
const header = [
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
];
function csvFor(data) {
  const records = Object.entries(data.series).flatMap(([metric, series]) =>
    (series.buckets.length ? series.buckets : [null]).map((b) => [
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
      ...(b
        ? [
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
          ]
        : Array.from({ length: 12 }, () => null)),
      series.baselineAt,
      series.reason,
    ]),
  );
  return (
    [header, ...records]
      .map((r) =>
        r
          .map((c) => {
            const raw = c == null ? "" : String(c);
            const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
            return `"${safe.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

export { dataset, sourceDataset, bucket, filters, source, sourcePage, csvFor };
