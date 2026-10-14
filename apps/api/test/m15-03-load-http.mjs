// Actual Nest customer + mTLS operator reads. Original services and throttles untouched.
import assert from "node:assert/strict";
import { readFile, writeFile, open } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { performance as benchPerformance } from "node:perf_hooks";
import https from "node:https";
import { resolve } from "node:path";
import { customerSystemHealthResponseSchema } from "@repo/contracts/system/schemas";
const runtime = resolve(process.argv[2]);
assert.ok(
  runtime.endsWith("/2026-10-14-m15-03-scoped-operator-system-health/isolated"),
);
// All original and copied runners share one lease before any request or sign-in.
const lockPath = `${runtime}/controlled-measurement.lock`;
const lock = await open(lockPath, "wx");
await lock.writeFile(String(process.pid));
await lock.close();
const releaseLock = () => {
  try {
    if (readFileSync(lockPath, "utf8") === String(process.pid))
      unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
process.once("SIGINT", () => {
  releaseLock();
  process.exit(130);
});
process.once("SIGTERM", () => {
  releaseLock();
  process.exit(143);
});
process.once("exit", releaseLock);
const m = JSON.parse(
  await readFile(`${runtime}/fixture-manifest.private.json`, "utf8"),
);
assert.equal(m.apiOrigin, "http://127.0.0.1:3339");
const tls = {
  ca: await readFile(`${runtime}/tls/ca.crt`),
  cert: await readFile(`${runtime}/tls/client.crt`),
  key: await readFile(`${runtime}/tls/client.key`),
};
const agent = new https.Agent({ ...tls, keepAlive: true, maxSockets: 4 });
async function signIn(fixture) {
  const response = await fetch(`${m.apiOrigin}/api/v1/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: fixture.email,
      password: fixture.password,
      remember: true,
    }),
  });
  assert.equal(
    response.status,
    200,
    "Unchanged sign-in throttle must permit fixture",
  );
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
if (process.env.M15_03_SKIP_QUIET_WINDOW === "true") {
  console.log("Using caller-confirmed quiet throttle window");
} else {
  console.log(
    "Reserving one quiet 60-second throttle window before measurement",
  );
  await new Promise((resolve) => setTimeout(resolve, 60000));
}
const largeCookie = await signIn(m.large);
await new Promise((r) => setTimeout(r, 8000));
const smallCookie = await signIn(m.owner);
const routes = [
  "/api/v1/operator/instances?limit=100",
  `/api/v1/operator/instances/${m.instanceId}`,
  `/api/v1/operator/instances/${m.instanceId}/tenants?limit=100`,
  "/api/v1/operator/instance-metadata?limit=100",
];
let samples = Object.fromEntries(
  [...routes, "customer_large_health", "customer_small_health"].map((x) => [
    x,
    [],
  ]),
);
const resume = process.env.M15_03_RESUME_MEASURED_SAMPLES === "true";
if (resume)
  samples = JSON.parse(
    await readFile(`${runtime}/http-load-samples.partial.json`, "utf8"),
  );
let savedAttempts = null;
if (resume) {
  const saved = await readFile(
    `${runtime}/http-load-attempts.partial.json`,
    "utf8",
  ).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (saved) savedAttempts = JSON.parse(saved);
}
let offset = Object.values(samples)[0].length;
let attempts = Object.fromEntries(
  Object.keys(samples).map((key) => [
    key,
    Array.from({ length: offset }, () => ({
      status: 200,
      semanticValid: true,
    })),
  ]),
);
assert.ok(Object.values(samples).every((values) => values.length === offset));
let outcomes = {
  customer_large_health: Array.from({ length: offset }, () => ({
    availability: "ready",
    reasons: [],
  })),
  customer_small_health: Array.from({ length: offset }, () => ({
    availability: "ready",
    reasons: [],
  })),
};
if (resume) {
  const saved = await readFile(
    `${runtime}/http-load-outcomes.partial.json`,
    "utf8",
  ).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (saved) outcomes = JSON.parse(saved);
}
if (savedAttempts) {
  const validRounds = Array.from(
    { length: offset },
    (_, index) => index,
  ).filter((index) =>
    Object.keys(samples).every(
      (key) =>
        savedAttempts[key]?.[index]?.status === 200 &&
        savedAttempts[key]?.[index]?.semanticValid === true,
    ),
  );
  samples = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [
      key,
      validRounds.map((index) => values[index]),
    ]),
  );
  attempts = Object.fromEntries(
    Object.keys(samples).map((key) => [
      key,
      validRounds.map((index) => savedAttempts[key][index]),
    ]),
  );
  outcomes = {
    customer_large_health: validRounds.map(
      (index) => outcomes.customer_large_health[index],
    ),
    customer_small_health: validRounds.map(
      (index) => outcomes.customer_small_health[index],
    ),
  };
  offset = validRounds.length;
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    minMs: sorted[0],
    p50Ms: sorted[Math.ceil(values.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(values.length * 0.95) - 1],
    p99Ms: sorted[Math.ceil(values.length * 0.99) - 1],
    maxMs: sorted.at(-1),
    meanMs: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
function operator(route) {
  return new Promise((resolve) => {
    const start = benchPerformance.now();
    const req = https.get(
      `https://127.0.0.1:3446${route}`,
      { agent },
      (res) => {
        let data = [];
        res.on("data", (chunk) => {
          data = [...data, chunk];
        });
        res.on("end", () => {
          let semanticValid = false;
          try {
            const body = JSON.parse(Buffer.concat(data).toString());
            semanticValid =
              res.statusCode === 200
                ? !body.tenants || body.tenants.length === 100
                : res.statusCode === 503 &&
                  !Object.hasOwn(body, "instances") &&
                  !Object.hasOwn(body, "tenants") &&
                  JSON.stringify(body).includes(
                    "Operator registry unavailable",
                  );
          } catch {
            semanticValid = false;
          }
          resolve({
            ms: benchPerformance.now() - start,
            status: res.statusCode,
            semanticValid,
          });
        });
        res.on("error", () =>
          resolve({
            ms: benchPerformance.now() - start,
            status: 0,
            semanticValid: false,
          }),
        );
      },
    );
    req.on("error", () =>
      resolve({
        ms: benchPerformance.now() - start,
        status: 0,
        semanticValid: false,
      }),
    );
    req.setTimeout(5000, () => req.destroy(new Error("Timed out")));
  });
}
async function customer(cookie, large) {
  const start = benchPerformance.now();
  let status = 0;
  try {
    const response = await fetch(`${m.apiOrigin}/api/v1/system/health`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
    if (status !== 200)
      return {
        ms: benchPerformance.now() - start,
        status,
        availability: "http_error",
        reasons: [],
        semanticValid: false,
      };
    const body = customerSystemHealthResponseSchema.parse(
      await response.json(),
    );
    const queue = body.queues.find((q) => q.id === "exports");
    assert.equal(
      body.organizationId,
      large ? m.large.organizationId : m.owner.organizationId,
    );
    assert.ok(queue);
    if (queue.availability === "ready") {
      assert.equal(queue.pending, large ? 10000 : 0);
      if (large) assert.equal(queue.countRelation, "at_least");
    } else {
      assert.equal(queue.availability, "unavailable");
      for (const field of [
        "pending",
        "running",
        "retrying",
        "waitingForReview",
        "uncertainDelivery",
        "failedTerminal",
        "countRelation",
      ])
        assert.equal(queue[field], null);
      assert.ok(queue.reasons.length > 0);
    }
    return {
      ms: benchPerformance.now() - start,
      status,
      availability: queue.availability,
      reasons: queue.reasons,
      semanticValid: true,
    };
  } catch {
    return {
      ms: benchPerformance.now() - start,
      status,
      availability: "validation_or_transport_error",
      reasons: [],
      semanticValid: false,
    };
  }
}
const startedAt = new Date().toISOString();
for (let i = offset; i < 200; i++) {
  const roundStart = benchPerformance.now();
  const values = await Promise.all([
    ...routes.map(operator),
    customer(largeCookie, true),
    customer(smallCookie, false),
  ]);
  Object.keys(samples).forEach(
    (key, index) =>
      (samples = {
        ...samples,
        [key]: [...samples[key], values[index].ms],
      }),
  );
  attempts = Object.fromEntries(
    Object.keys(samples).map((key, index) => [
      key,
      [
        ...attempts[key],
        {
          status: values[index].status,
          semanticValid: values[index].semanticValid,
        },
      ],
    ]),
  );
  await writeFile(
    `${runtime}/http-load-attempts.partial.json`,
    JSON.stringify(attempts),
  );
  outcomes = {
    customer_large_health: [
      ...outcomes.customer_large_health,
      { availability: values[4].availability, reasons: values[4].reasons },
    ],
    customer_small_health: [
      ...outcomes.customer_small_health,
      { availability: values[5].availability, reasons: values[5].reasons },
    ],
  };
  await writeFile(
    `${runtime}/http-load-outcomes.partial.json`,
    JSON.stringify(outcomes),
  );
  await writeFile(
    `${runtime}/http-load-samples.partial.json`,
    JSON.stringify(samples),
  );
  if (i % 10 === 0) {
    await writeFile(
      `${runtime}/http-load-progress.json`,
      JSON.stringify({
        completedSamplesPerEndpoint: i + 1,
        startedAt,
        latestAt: new Date().toISOString(),
      }),
    );
    console.log(`${i + 1}/200 samples per actual API read`);
  }
  // 4 operator requests and 2 customer requests each round: <120/min and <60/min.
  // Measures exclude pacing time and include TLS, network, parsing and durable audit.
  const delay = Math.max(0, 2200 - (benchPerformance.now() - roundStart));
  if (delay) await new Promise((r) => setTimeout(r, delay));
}
const result = {
  transport: "actual customer Nest HTTP3339 and private mTLS Nest3446",
  fixtureRows: { registryTenants: 10000, sourceQueueRows: 100000 },
  concurrency: { operator: 4, customer: 2 },
  roundPacingMs: 2200,
  unchangedLimits: {
    operatorRequestsPerMinute: 120,
    customerRequestsPerMinute: 60,
  },
  warmupSamples: 0,
  measurementParts: {
    previousPersistedRounds: offset,
    additionalRounds: 200 - offset,
    splitRun: resume,
  },
  partialProbeAvailability: Object.fromEntries(
    Object.entries(outcomes).map(([key, values]) => [
      key,
      {
        ready: values.filter((v) => v.availability === "ready").length,
        unavailable: values.filter((v) => v.availability === "unavailable")
          .length,
        total: values.length,
        readyPercent:
          (100 * values.filter((v) => v.availability === "ready").length) /
          values.length,
      },
    ]),
  ),
  buildBaselineFile: "measurement-baseline.json",
  endpointAvailability: Object.fromEntries(
    Object.entries(attempts).map(([key, values]) => [
      key,
      {
        attempts: values.length,
        http200: values.filter((v) => v.status === 200).length,
        http503: values.filter((v) => v.status === 503).length,
        transportErrors: values.filter((v) => v.status === 0).length,
        semanticInvalid: values.filter((v) => !v.semanticValid).length,
        http200Percent:
          (100 * values.filter((v) => v.status === 200).length) / values.length,
      },
    ]),
  ),
  measuredSamplesPerRead: 200,
  startedAt,
  completedAt: new Date().toISOString(),
  records: Object.fromEntries(
    Object.entries(samples).map(([k, v]) => [k, summary(v)]),
  ),
};
await writeFile(
  `${runtime}/http-load-results.json`,
  JSON.stringify(result, null, 2),
);
await writeFile(`${runtime}/http-load-samples.json`, JSON.stringify(samples));
agent.destroy();
releaseLock();
console.log(JSON.stringify(result));
