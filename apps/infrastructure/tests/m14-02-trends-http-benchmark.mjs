// Read-only authenticated HTTP timing. The caller must point the API's trends
// adapter at cra_m14_benchmark; never load synthetic rows into development.
// Cookie files are read privately and are never printed or written here.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  assertBenchmarkDataset,
  assertBenchmarkCsv,
} from "./m14-02-trends-benchmark-parity.mjs";
const origin = process.env.M14_TRENDS_HTTP_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error(
    "M14_TRENDS_HTTP_ORIGIN must name an owned local benchmark API",
  );
}
if (process.env.M14_TRENDS_HTTP_DATABASE !== "cra_m14_benchmark") {
  throw new Error(
    "Confirm isolated adapter with M14_TRENDS_HTTP_DATABASE=cra_m14_benchmark",
  );
}
const cookiePath = process.env.M14_TRENDS_HTTP_COOKIE_FILE;
if (!cookiePath) throw new Error("Provide a private owner-session cookie file");
const cookie = readFileSync(cookiePath, "utf8").trim();
if (!cookie || /[\r\n]/.test(cookie))
  throw new Error("Cookie file must contain one Cookie header value");
const secondCookiePath = process.env.M14_TRENDS_HTTP_SECOND_COOKIE_FILE;
const secondCookie = secondCookiePath
  ? readFileSync(secondCookiePath, "utf8").trim()
  : undefined;
if (secondCookie && /[\r\n]/.test(secondCookie))
  throw new Error("Secondary cookie file must contain one Cookie header value");
const samples = Number(process.env.M14_TRENDS_HTTP_SAMPLES ?? 200);
// Preserve the existing 60/minute read throttle, including optional overlapping
// second-tenant reads. Timing excludes this gap; no guard is bypassed.
const pace = Number(process.env.M14_TRENDS_HTTP_PACE_MS ?? 1300);
const minimumDurationCohorts = Number(
  process.env.M14_TRENDS_HTTP_MIN_DURATION_COHORTS ?? 0,
);
const minimumActivitySources = Number(
  process.env.M14_TRENDS_HTTP_MIN_ACTIVITY_SOURCES ?? 0,
);
if (
  !Number.isInteger(minimumActivitySources) ||
  minimumActivitySources < 0 ||
  minimumActivitySources > 100000000 ||
  !Number.isInteger(minimumDurationCohorts) ||
  minimumDurationCohorts < 0 ||
  minimumDurationCohorts > 100000 ||
  !Number.isInteger(samples) ||
  samples < 2 ||
  samples > 500 ||
  !Number.isFinite(pace) ||
  pace < 0 ||
  pace > 10000
) {
  throw new Error("Samples/pace exceed benchmark bounds");
}
const to =
  process.env.M14_TRENDS_HTTP_TO ?? new Date().toISOString().slice(0, 10);
const from =
  process.env.M14_TRENDS_HTTP_FROM ??
  new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
const filters = new URLSearchParams({
  from,
  to,
  timezone: "UTC",
  bucket: "day",
});
if (process.env.M14_TRENDS_HTTP_PRODUCT_ID)
  filters.set("productId", process.env.M14_TRENDS_HTTP_PRODUCT_ID);
const secondaryFilters = new URLSearchParams(filters);
secondaryFilters.delete("productId");
if (process.env.M14_TRENDS_HTTP_SECOND_PRODUCT_ID)
  secondaryFilters.set(
    "productId",
    process.env.M14_TRENDS_HTTP_SECOND_PRODUCT_ID,
  );
const auxiliarySamples = Number(
  process.env.M14_TRENDS_HTTP_AUXILIARY_SAMPLES ?? 0,
);
if (
  !Number.isInteger(auxiliarySamples) ||
  auxiliarySamples < 0 ||
  auxiliarySamples > samples
)
  throw new Error("Auxiliary samples must be 0..primary sample count");
const rows = { primary: [], secondary: [], sources: [], export: [] };
const datasets = {};
async function sample(scope, header) {
  const started = performance.now();
  const query = scope === "primary" ? filters : secondaryFilters;
  const response = await fetch(`${origin}/api/v1/dashboard/trends?${query}`, {
    headers: { Cookie: header },
    signal: AbortSignal.timeout(30000),
  });
  const bytes = await response.arrayBuffer();
  const elapsedMs = performance.now() - started;
  rows[scope].push({
    elapsedMs,
    bytes: bytes.byteLength,
    status: response.status,
  });
  if (response.status !== 200)
    throw new Error(`HTTP benchmark failed with status ${response.status}`);
  const body = JSON.parse(new TextDecoder().decode(bytes));
  assertBenchmarkDataset(
    body,
    Object.fromEntries(query),
    scope === "primary" ? minimumDurationCohorts : 0,
    scope === "primary" ? minimumActivitySources : 0,
  );
  if (!datasets[scope]) {
    datasets[scope] = {
      baselineAt: body.baselineAt,
      filters: body.filters,
      cohortsAndEvents: Object.fromEntries(
        Object.entries(body.series).map(([metric, series]) => [
          metric,
          {
            state: series.state,
            sampleCount: series.buckets.reduce(
              (total, b) => total + b.sampleCount,
              0,
            ),
            sourceCount: series.buckets.reduce(
              (total, b) => total + b.sourceCount,
              0,
            ),
            opened: series.buckets.reduce(
              (total, b) => total + (b.opened ?? 0),
              0,
            ),
            closed: series.buckets.reduce(
              (total, b) => total + (b.closed ?? 0),
              0,
            ),
            reopened: series.buckets.reduce(
              (total, b) => total + (b.reopened ?? 0),
              0,
            ),
          },
        ]),
      ),
    };
  }
  return body;
}
async function samplePinned(endpoint, body) {
  const params = new URLSearchParams({ datasetToken: body.datasetToken });
  if (endpoint === "sources") {
    params.set("metric", "activity");
    params.set("limit", "20");
  }
  const started = performance.now();
  const response = await fetch(
    `${origin}/api/v1/dashboard/trends/${endpoint}?${params}`,
    { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) },
  );
  const content = await response.text();
  rows[endpoint].push({
    elapsedMs: performance.now() - started,
    bytes: Buffer.byteLength(content),
    status: response.status,
  });
  if (response.status !== 200)
    throw new Error(`Pinned ${endpoint} failed with status ${response.status}`);
  if (endpoint === "sources") {
    const source = JSON.parse(content);
    if (
      source.datasetRevision !== body.datasetRevision ||
      !Array.isArray(source.items) ||
      source.items.length > 20
    )
      throw new Error("Pinned source dataset mismatch");
  } else if (
    !response.headers.get("content-type")?.startsWith("text/csv") ||
    !content.includes(`"${body.datasetRevision}"`)
  )
    throw new Error("Pinned CSV dataset mismatch");
  else assertBenchmarkCsv(content, body);
  datasets[endpoint] ??= {
    pinnedRevisionParity: true,
    metric: endpoint === "sources" ? "activity" : "all",
  };
}
let failure;
try {
  for (let index = 0; index < samples; index += 1) {
    // Independent authenticated identities overlap their reads when supplied.
    const [primaryBody] = await Promise.all([
      sample("primary", cookie),
      ...(secondCookie && index % 4 === 0
        ? [sample("secondary", secondCookie)]
        : []),
    ]);
    if (
      auxiliarySamples > 0 &&
      Math.floor(((index + 1) * auxiliarySamples) / samples) >
        Math.floor((index * auxiliarySamples) / samples)
    ) {
      for (const endpoint of ["sources", "export"]) {
        if (pace > 0) await new Promise((resolve) => setTimeout(resolve, pace));
        await samplePinned(endpoint, primaryBody);
      }
    }
    if ((index + 1) % 25 === 0) {
      console.log(
        JSON.stringify({
          progress: true,
          completedPrimarySamples: rows.primary.length,
          completedSecondarySamples: rows.secondary.length,
          requestedPrimarySamples: samples,
        }),
      );
    }
    if (pace > 0 && index + 1 < samples)
      await new Promise((resolve) => setTimeout(resolve, pace));
  }
} catch (error) {
  failure = error;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lo = Math.floor(position),
    hi = Math.ceil(position);
  return Number(
    (sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo)).toFixed(2),
  );
}
for (const [scope, timings] of Object.entries(rows)) {
  if (!timings.length) continue;
  const p95 = percentile(
    timings.map((row) => row.elapsedMs),
    0.95,
  );
  const p99 = percentile(
    timings.map((row) => row.elapsedMs),
    0.99,
  );
  console.log(
    JSON.stringify({
      scope,
      dataset: datasets[scope],
      samples: timings.length,
      requestedSamples:
        scope === "primary"
          ? samples
          : scope === "secondary"
            ? Math.ceil(samples / 4)
            : auxiliarySamples,
      successfulResponses: timings.filter((row) => row.status === 200).length,
      failedResponses: timings.filter((row) => row.status !== 200).length,
      completed: !failure,
      p50Ms: percentile(
        timings.map((row) => row.elapsedMs),
        0.5,
      ),
      p95Ms: p95,
      rawElapsedMs: timings.map((row) => Number(row.elapsedMs.toFixed(2))),
      p99Ms: p99,
      maxResponseBytes: Math.max(...timings.map((row) => row.bytes)),
      meetsReadTarget: !failure && p95 < 400 && p99 < 1000,
      quantileEvidence:
        timings.length >= 200
          ? "200-sample-main-read-gate"
          : "limited-diagnostic-tail-confidence",
      adapterDatabase: "cra_m14_benchmark",
      minimumDurationCohorts,
      minimumActivitySources,
      requestedScope: filters.has("productId") ? "product" : "organization",
      concurrentSecondTenant: Boolean(secondCookie),
      sourceWrites: "external-harness-only",
    }),
  );
}

if (failure) throw failure;
