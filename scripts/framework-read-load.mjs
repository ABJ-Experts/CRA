// Bounded, read-only M10 probe against a local CRA API at its allowed request rate.
import {
  frameworkCatalogResponseSchema,
  frameworkTreeResponseSchema,
} from "../packages/contracts/dist/frameworks/index.js";

const origin = new URL(process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333");
if (!["localhost", "127.0.0.1"].includes(origin.hostname)) {
  throw new Error("The framework load probe is restricted to a local API");
}
if (!process.env.E2E_OWNER_EMAIL || !process.env.E2E_OWNER_PASSWORD) {
  throw new Error("Local owner credentials are required");
}
const bursts = Number(process.env.M10_LOAD_BURSTS ?? 12);
const burstSize = Number(process.env.M10_LOAD_BURST_SIZE ?? 8);
const intervalMs = Number(process.env.M10_LOAD_INTERVAL_MS ?? 10_000);
if (
  !Number.isInteger(bursts) ||
  bursts < 2 ||
  bursts > 24 ||
  !Number.isInteger(burstSize) ||
  burstSize < 2 ||
  burstSize > 16 ||
  !Number.isInteger(intervalMs) ||
  intervalMs < 5_000 ||
  burstSize * Math.ceil(60_000 / intervalMs) > 48
) {
  throw new Error(
    "Use 2–24 bursts, 2–16 requests per burst, and at most 48 requests/minute",
  );
}

const signIn = await fetch(new URL("/api/v1/auth/sign-in", origin), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.E2E_OWNER_EMAIL,
    password: process.env.E2E_OWNER_PASSWORD,
    remember: true,
  }),
  signal: AbortSignal.timeout(10_000),
});
if (!signIn.ok) throw new Error(`Owner sign-in returned ${signIn.status}`);
const cookie = signIn.headers
  .getSetCookie()
  .map((value) => value.split(";", 1)[0])
  .join("; ");
if (!cookie) throw new Error("Owner sign-in returned no session cookies");
const catalogResponse = await fetch(new URL("/api/v1/frameworks", origin), {
  headers: { cookie },
  signal: AbortSignal.timeout(10_000),
});
if (!catalogResponse.ok)
  throw new Error(`Framework catalog returned ${catalogResponse.status}`);
const catalog = frameworkCatalogResponseSchema.parse(
  await catalogResponse.json(),
);
const pack = catalog.packs.find((entry) => entry.packKey === "cra-annex-i");
const versionKey = pack?.versions[0]?.versionKey;
if (!versionKey) throw new Error("Reviewed CRA pack is unavailable");
const paths = [
  "/api/v1/frameworks",
  `/api/v1/frameworks/cra-annex-i/versions/${encodeURIComponent(versionKey)}/tree?limit=100`,
];
const results = [];
const started = performance.now();
async function request(index) {
  const kind = index % paths.length;
  const start = performance.now();
  try {
    const response = await fetch(new URL(paths[kind], origin), {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    const milliseconds = performance.now() - start;
    if (response.ok) {
      if (kind === 0) {
        const parsed = frameworkCatalogResponseSchema.parse(body);
        if (!parsed.packs.some((entry) => entry.packKey === "cra-annex-i")) {
          throw new Error("Catalog omitted the CRA pack");
        }
      } else {
        const parsed = frameworkTreeResponseSchema.parse(body);
        if (
          parsed.packKey !== "cra-annex-i" ||
          parsed.versionKey !== versionKey ||
          parsed.requirements.length !== 25
        ) {
          throw new Error("Tree omitted reviewed CRA requirements");
        }
      }
    }
    results.push({
      kind,
      status: response.status,
      milliseconds,
      valid: response.ok,
    });
  } catch (error) {
    results.push({
      kind,
      status: "invalid",
      milliseconds: performance.now() - start,
      valid: false,
    });
    process.stderr.write(`Framework read failed: ${error.message}\n`);
  }
}
for (let burst = 0; burst < bursts; burst += 1) {
  const remaining = started + burst * intervalMs - performance.now();
  if (remaining > 0)
    await new Promise((resolve) => setTimeout(resolve, remaining));
  await Promise.all(
    Array.from({ length: burstSize }, (_, offset) =>
      request(burst * burstSize + offset),
    ),
  );
}
const elapsedSeconds = (performance.now() - started) / 1000;
const percentile = (values, fraction) =>
  values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
for (const [kind, path] of paths.entries()) {
  const rows = results.filter((result) => result.kind === kind);
  const times = rows
    .filter((result) => result.valid)
    .map((result) => result.milliseconds)
    .sort((a, b) => a - b);
  const statusCounts = Object.fromEntries(
    [...new Set(rows.map((result) => result.status))].map((status) => [
      status,
      rows.filter((result) => result.status === status).length,
    ]),
  );
  const p95Ms = percentile(times, 0.95);
  const p99Ms = percentile(times, 0.99);
  const thresholdMet =
    rows.length === times.length && p95Ms < 400 && p99Ms < 1000;
  process.stdout.write(
    `${JSON.stringify({
      path,
      requests: rows.length,
      elapsedSeconds: elapsedSeconds.toFixed(1),
      requestsPerSecond: (rows.length / elapsedSeconds).toFixed(2),
      statusCounts,
      p50Ms: percentile(times, 0.5)?.toFixed(1),
      p95Ms: p95Ms?.toFixed(1),
      p99Ms: p99Ms?.toFixed(1),
      thresholdMet,
    })}\n`,
  );
  if (!thresholdMet) process.exitCode = 1;
}
