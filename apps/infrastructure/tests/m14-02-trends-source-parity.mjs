// Separate from latency windows: exhaust only a bounded small product's
// contributing activity/coverage sources using one real authorized dataset pin.
import { readFileSync } from "node:fs";
import {
  assertBenchmarkDataset,
  beginSourceParity,
  acceptSourceParityPage,
} from "./m14-02-trends-benchmark-parity.mjs";

const origin = process.env.M14_TRENDS_HTTP_ORIGIN;
if (
  !origin ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
  process.env.M14_TRENDS_HTTP_DATABASE !== "cra_m14_benchmark"
)
  throw new Error("Source parity requires the owned local clone API");
const productId = process.env.M14_TRENDS_HTTP_PRODUCT_ID;
if (!productId) throw new Error("Source parity requires a small product scope");
const maxPages = Number(process.env.M14_TRENDS_SOURCE_PARITY_MAX_PAGES ?? 200);
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200)
  throw new Error("Source parity page bound must be 1..200");
const cookie = readFileSync(
  process.env.M14_TRENDS_HTTP_COOKIE_FILE,
  "utf8",
).trim();
if (!cookie || /[\r\n]/.test(cookie))
  throw new Error("Private cookie shape invalid");
const to =
  process.env.M14_TRENDS_HTTP_TO ?? new Date().toISOString().slice(0, 10);
const from =
  process.env.M14_TRENDS_HTTP_FROM ??
  new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
const filters = { from, to, timezone: "UTC", bucket: "day", productId };
async function read(endpoint, params) {
  const response = await fetch(
    `${origin}/api/v1/dashboard/trends${endpoint}?${params}`,
    {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (response.status !== 200)
    throw new Error(`Source parity HTTP ${response.status}`);
  return response.json();
}
const dataset = await read("", new URLSearchParams(filters));
assertBenchmarkDataset(dataset, filters, 0);
for (const metric of ["activity", "sbomCoverage"]) {
  let state = beginSourceParity(dataset, metric, maxPages);
  while (!state.complete) {
    // Include the first page and the transition between metrics in pacing.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const params = new URLSearchParams({
      datasetToken: dataset.datasetToken,
      metric,
      limit: "100",
    });
    if (state.nextCursor) params.set("cursor", state.nextCursor);
    state = acceptSourceParityPage(state, await read("/sources", params));
  }
  console.log(
    JSON.stringify({
      metric,
      expectedSources: state.expected,
      observedSources: state.count,
      carriedCoverageContexts: state.carriedCount,
      totalPagedItems: state.ids.size,
      pages: state.pages,
      complete: state.complete,
      duplicateEvents: false,
      scopeAndAvailableBucketParity: true,
      datasetRevisionParity: true,
      maxPages,
      sourcePageSize: 100,
      adapterDatabase: "cra_m14_benchmark",
      largeHistoryEnumerationPerformed: false,
    }),
  );
}
