// Read-only timings. The API must use the isolated benchmark database; cookie
// files contain a private Cookie header and are never logged.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";

const origin = process.env.M14_PORTFOLIO_HTTP_ORIGIN;
if (!origin || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
  throw new Error("Provide an owned local benchmark API origin");
if (
  !/^(cra_m14_benchmark|cra_m14_05_benchmark)$/.test(
    process.env.M14_PORTFOLIO_HTTP_DATABASE ?? "",
  )
)
  throw new Error(
    "Confirm the API adapter uses the isolated benchmark database",
  );
function privateCookie(path) {
  if (!path) throw new Error("Provide a private cookie header file");
  const value = readFileSync(path, "utf8").trim();
  if (!value || /[\r\n]/.test(value))
    throw new Error("Cookie must be one header value");
  return value;
}
const cookie = privateCookie(process.env.M14_PORTFOLIO_HTTP_COOKIE_FILE);
const secondCookie = process.env.M14_PORTFOLIO_HTTP_SECOND_COOKIE_FILE
  ? privateCookie(process.env.M14_PORTFOLIO_HTTP_SECOND_COOKIE_FILE)
  : null;
const expectedOrg = process.env.M14_PORTFOLIO_HTTP_ORGANIZATION_ID;
const expectedSmallOrg = process.env.M14_PORTFOLIO_HTTP_SECOND_ORGANIZATION_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (
  !uuid.test(expectedOrg ?? "") ||
  (secondCookie &&
    (!uuid.test(expectedSmallOrg ?? "") || expectedOrg === expectedSmallOrg))
)
  throw new Error(
    "Identify the isolated primary and distinct secondary organizations",
  );
const samples = Number(process.env.M14_PORTFOLIO_HTTP_SAMPLES ?? 200);
const pace = Number(process.env.M14_PORTFOLIO_HTTP_PACE_MS ?? 1300);
const minimumComponents = Number(
  process.env.M14_PORTFOLIO_HTTP_MIN_COMPONENTS ?? 10000,
);
if (
  !Number.isInteger(samples) ||
  samples < 2 ||
  samples > 500 ||
  !Number.isFinite(pace) ||
  pace < 0 ||
  pace > 10000 ||
  ![10000, 100000, 1000000].includes(minimumComponents)
)
  throw new Error("Samples, pace or component scale outside benchmark bounds");
const primaryFilters = new URLSearchParams({ limit: "20" });
if (process.env.M14_PORTFOLIO_HTTP_ENTITY_ID)
  primaryFilters.set("legalEntityId", process.env.M14_PORTFOLIO_HTTP_ENTITY_ID);
const secondaryFilters = new URLSearchParams({ limit: "20" });
if (process.env.M14_PORTFOLIO_HTTP_SECOND_ENTITY_ID)
  secondaryFilters.set(
    "legalEntityId",
    process.env.M14_PORTFOLIO_HTTP_SECOND_ENTITY_ID,
  );
const timings = new Map();
const apiPid = process.env.M14_PORTFOLIO_HTTP_API_PID;
if (
  !/^[1-9][0-9]{0,8}$/.test(apiPid ?? "") ||
  !execFileSync("ps", ["-o", "command=", "-p", apiPid], {
    encoding: "utf8",
  }).includes("m14-05-benchmark-api.cjs")
)
  throw new Error(
    "Identify the owned benchmark API PID for server memory evidence",
  );
let apiPeakRssBytes = 0;
function measureApiMemory() {
  const rss = Number(
    execFileSync("ps", ["-o", "rss=", "-p", apiPid], {
      encoding: "utf8",
    }).trim(),
  );
  if (!Number.isFinite(rss) || rss <= 0)
    throw new Error("Benchmark API RSS unavailable");
  apiPeakRssBytes = Math.max(apiPeakRssBytes, rss * 1024);
}
measureApiMemory();
const memoryTimer = setInterval(measureApiMemory, 1000);
let componentRef;
async function sample(endpoint, header, scope = "primary") {
  const filters = new URLSearchParams(
    scope === "primary" ? primaryFilters : secondaryFilters,
  );
  if (endpoint === "concentration/detail")
    filters.set("componentRef", componentRef);
  const started = performance.now();
  const response = await fetch(
    `${origin}/api/v1/dashboard/portfolio/${endpoint}?${filters}`,
    {
      headers: { Cookie: header },
      signal: AbortSignal.timeout(60000),
    },
  );
  const bytes = await response.arrayBuffer();
  const key = `${scope}/${endpoint}`;
  const rows = timings.get(key) ?? [];
  rows.push({
    ms: performance.now() - started,
    bytes: bytes.byteLength,
    status: response.status,
  });
  timings.set(key, rows);
  if (response.status !== 200)
    throw new Error(`${key} returned ${response.status}`);
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (
    body.organizationId !==
    (scope === "primary" ? expectedOrg : expectedSmallOrg)
  )
    throw new Error(
      "API response organization does not match the isolated fixture",
    );
  const section =
    body[
      endpoint === "products"
        ? "products"
        : endpoint === "concentration"
          ? "concentration"
          : "affectedReleases"
    ];
  if (
    !section?.data ||
    !Array.isArray(section.data.rows) ||
    section.data.rows.length > 20
  )
    throw new Error(`${key} does not satisfy the bounded page contract`);
  if (
    scope === "primary" &&
    (!Number.isInteger(body.coverage?.data?.totalComponents) ||
      body.coverage.data.totalComponents < minimumComponents)
  )
    throw new Error(
      "API did not expose the requested synthetic component scale",
    );
  if (scope === "primary" && endpoint === "concentration") {
    const row = section.data.rows[0];
    if (!row || row.productCount < 2 || !row.componentRef)
      throw new Error("Synthetic shared-component ranking is absent");
    componentRef = row.componentRef;
  }
}
function quantile(rows, q) {
  const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
  return Number(sorted[Math.ceil(q * sorted.length) - 1].toFixed(2));
}
let failure;
try {
  for (const endpoint of [
    "products",
    "concentration",
    "concentration/detail",
  ]) {
    for (let n = 0; n < samples; n += 1) {
      await Promise.all([
        sample(endpoint, cookie),
        ...(secondCookie && n % 4 === 0
          ? [sample("products", secondCookie, "secondary")]
          : []),
      ]);
      if ((n + 1) % 25 === 0)
        console.log(
          JSON.stringify({ progress: true, endpoint, samples: n + 1 }),
        );
      if (pace) await new Promise((resolve) => setTimeout(resolve, pace));
    }
  }
} catch (error) {
  failure = error;
} finally {
  clearInterval(memoryTimer);
  measureApiMemory();
}
for (const [endpoint, rows] of timings) {
  const p95Ms = quantile(rows, 0.95),
    p99Ms = quantile(rows, 0.99);
  console.log(
    JSON.stringify({
      endpoint,
      samples: rows.length,
      p50Ms: quantile(rows, 0.5),
      p95Ms,
      p99Ms,
      maxResponseBytes: Math.max(...rows.map((r) => r.bytes)),
      successfulResponses: rows.filter((r) => r.status === 200).length,
      rawElapsedMs: rows.map((r) => Number(r.ms.toFixed(2))),
      completed: !failure,
      meetsReadTarget: !failure && p95Ms < 400 && p99Ms < 1000,
      minimumComponents,
      concurrentSmallTenant: Boolean(secondCookie),
      database: process.env.M14_PORTFOLIO_HTTP_DATABASE,
      harnessMemoryBytes: process.memoryUsage(),
      apiPeakRssBytes,
      apiMemory:
        "OS RSS sampled every second; harness memory reported separately",
      quantileEvidence:
        rows.length >= 200
          ? "200-sample-read-gate"
          : "limited-diagnostic-tail-confidence",
    }),
  );
}
if (failure) throw failure;
