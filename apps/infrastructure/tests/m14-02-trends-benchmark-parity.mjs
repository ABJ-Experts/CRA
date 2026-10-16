import { createHash } from "node:crypto";
const columns = [
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
export function beginSourceParity(dataset, metric, maxPages) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200)
    throw new Error("Source parity page bound must be 1..200");
  if (!dataset.filters.productId)
    throw new Error("Source parity requires a small product scope");
  if (
    !["activity", "sbomCoverage"].includes(metric) ||
    dataset.series[metric].state !== "available"
  )
    throw new Error("Source parity requires an available supported series");
  const expected = dataset.series[metric].buckets.reduce(
    (total, b) => total + b.sourceCount,
    0,
  );
  if (expected > maxPages * 100)
    throw new Error("Chart exceeds bounded source bound");
  return {
    dataset,
    metric,
    maxPages,
    expected,
    count: 0,
    carriedCount: 0,
    carriedReleases: new Set(),
    pages: 0,
    ids: new Set(),
    cursors: new Set(),
    nextCursor: null,
    complete: false,
  };
}

export function acceptSourceParityPage(state, page) {
  if (state.complete) throw new Error("Source parity is already complete");
  if (page.datasetRevision !== state.dataset.datasetRevision)
    throw new Error("Source revision parity failed");
  if (
    !Array.isArray(page.items) ||
    page.items.length > 100 ||
    page.continuationUnavailable
  )
    throw new Error("Source page shape or continuation unavailable");
  const ids = new Set(state.ids);
  const carriedReleases = new Set(state.carriedReleases);
  const series = state.dataset.series[state.metric];
  let observations = 0,
    carried = 0;
  for (const item of page.items) {
    if (typeof item.id !== "string" || !item.id || item.id.length > 256)
      throw new Error("Source identity memory bound exceeded");
    if (item.productId !== state.dataset.filters.productId)
      throw new Error("Source product scope mismatch");
    const at = Date.parse(item.effectiveAt);
    if (item.factKind === "carried_coverage_context") {
      if (
        state.metric !== "sbomCoverage" ||
        item.sourceType !== "release" ||
        typeof item.sourceId !== "string" ||
        !item.sourceId ||
        item.sourceId.length > 256 ||
        typeof item.provenance !== "string" ||
        !item.provenance.trim() ||
        !Number.isFinite(Date.parse(item.recordedAt)) ||
        !Number.isFinite(at) ||
        !series.buckets.length ||
        at >= Date.parse(series.buckets[0].start) ||
        carriedReleases.has(item.sourceId)
      )
        throw new Error("Invalid carried coverage context");
      carriedReleases.add(item.sourceId);
      carried += 1;
    } else {
      if (
        !series.buckets.some((b) => {
          const known =
            state.metric === "activity"
              ? [b.opened, b.closed, b.reopened].every(
                  (value) => value !== null,
                )
              : b.numerator !== null && b.denominator !== null;
          return (
            known &&
            (!series.baselineAt ||
              Date.parse(b.end) > Date.parse(series.baselineAt)) &&
            Date.parse(b.start) <= at &&
            at < Date.parse(b.end)
          );
        })
      )
        throw new Error("Source event is outside an available bucket");
      if (
        state.metric === "sbomCoverage" &&
        item.factKind !== "coverage_observation"
      )
        throw new Error("Invalid coverage observation kind");
      observations += 1;
    }
    if (ids.has(item.id)) throw new Error("Source duplicate event identity");
    ids.add(item.id);
  }
  const count = state.count + observations,
    carriedCount = state.carriedCount + carried,
    pages = state.pages + 1;
  if (count > state.expected || (!page.nextCursor && count !== state.expected))
    throw new Error("Chart/source count parity failed");
  if (pages > state.maxPages || (page.nextCursor && pages === state.maxPages))
    throw new Error("Source parity page bound exceeded");
  const cursors = new Set(state.cursors);
  if (page.nextCursor) {
    if (
      typeof page.nextCursor !== "string" ||
      page.nextCursor.length > 16384 ||
      !page.items.length
    )
      throw new Error("Source cursor shape or empty continuation");
    const digest = createHash("sha256").update(page.nextCursor).digest("hex");
    if (cursors.has(digest)) throw new Error("Source cursor repeated");
    cursors.add(digest);
  }
  return {
    ...state,
    count,
    carriedCount,
    carriedReleases,
    pages,
    ids,
    cursors,
    nextCursor: page.nextCursor,
    complete: !page.nextCursor,
  };
}

export function assertBenchmarkDataset(
  data,
  requested,
  minimumDurationCohorts,
  minimumActivitySources = 0,
) {
  if (
    !data.datasetRevision ||
    !data.datasetToken ||
    data.policyVersion !== "m14-02-v1"
  )
    throw new Error("Malformed benchmark policy or dataset pin");
  for (const key of ["from", "to", "timezone", "bucket", "productId"])
    if (data.filters?.[key] !== requested[key])
      throw new Error("Mismatched benchmark filter");
  if (!requested.productId) {
    for (const metric of ["triage", "remediation", "readiness"]) {
      const series = data.series?.[metric];
      if (
        series?.state !== "unavailable" ||
        series.reason !== "select_product" ||
        series.buckets.length
      )
        throw new Error(
          `Organization benchmark must withhold ${metric} product cohorts`,
        );
    }
  }
  for (const metric of ["triage", "remediation"]) {
    const resolved = data.series[metric].buckets.reduce(
      (total, b) => total + b.sampleCount,
      0,
    );
    if (resolved < minimumDurationCohorts)
      throw new Error(`Incomplete ${metric} benchmark cohort: ${resolved}`);
  }
  const activitySources = data.series.activity.buckets.reduce(
    (total, b) => total + b.sourceCount,
    0,
  );
  if (activitySources < minimumActivitySources)
    throw new Error(
      `Incomplete activity benchmark source cohort: ${activitySources}`,
    );
}

function parseCsv(text) {
  if (text.length > 5_000_000)
    throw new Error("CSV exceeds benchmark memory bound");
  let rows = [],
    row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row = [...row, field];
      field = "";
    } else if (!quoted && (c === "\r" || c === "\n")) {
      rows = [...rows, [...row, field]];
      row = [];
      field = "";
      if (c === "\r" && text[i + 1] === "\n") i += 1;
    } else field += c;
  }
  if (quoted) throw new Error("CSV has incomplete quoted field");
  if (row.length || field) rows = [...rows, [...row, field]];
  return rows;
}

function expectedRecords(data) {
  return [
    columns,
    ...Object.entries(data.series).flatMap(([metric, series]) =>
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
    ),
  ];
}

export function assertBenchmarkCsv(text, data) {
  const actual = parseCsv(text),
    expected = expectedRecords(data);
  if (actual.length !== expected.length)
    throw new Error("Chart/CSV rows differ");
  expected.forEach((row, i) => {
    if (actual[i].length !== row.length)
      throw new Error("Chart/CSV column parity failed");
    row.forEach((value, j) => {
      const raw = value == null ? "" : String(value);
      const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
      if (actual[i][j] !== safe)
        throw new Error("Chart/CSV value parity failed");
    });
  });
}
