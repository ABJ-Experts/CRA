import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { siemDestinationListSchema } from "@repo/contracts/audit/schemas";

// Owned CRA fixture API only. Tokens and response data never enter output.
async function benchmark(): Promise<void> {
  const origin = "http://127.0.0.1:3334";
  const response = await fetch(`${origin}/api/v1/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@cra.test",
      password: "Password123",
      remember: false,
    }),
  });
  if (response.status !== 200)
    throw new Error("Seeded owner authentication failed");
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value?.startsWith("cra_at="));
  if (!cookie) throw new Error("Access cookie unavailable");
  async function read() {
    const start = performance.now();
    const result = await fetch(
      `${origin}/api/v1/audit/siem/destinations?requestId=${randomUUID()}`,
      { headers: { cookie } },
    );
    if (result.status !== 200)
      throw new Error(`Read failed (${result.status})`);
    siemDestinationListSchema.parse(await result.json());
    return performance.now() - start;
  }
  for (let warmup = 0; warmup < 5; warmup++) await read();
  const samples: number[] = [];
  // Stay below the preserved 60/minute route limit; run separately from journeys.
  for (let batch = 0; batch < 60; batch++) {
    samples.push(
      ...(await Promise.all(Array.from({ length: 2 }, () => read()))),
    );
    await delay(2500);
  }
  samples.sort((a, b) => a - b);
  const percentile = (fraction: number): number => {
    const value = samples[Math.ceil(samples.length * fraction) - 1];
    if (value === undefined) throw new Error("Benchmark has no samples");
    return Number(value.toFixed(2));
  };
  const summary = {
    route: "/api/v1/audit/siem/destinations",
    samples: samples.length,
    concurrency: 2,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    scope:
      "seeded development tenant, fixture API with real authentication, durable receipts and database; not a production-size tenant",
  };
  console.log(JSON.stringify(summary));
  if (summary.p95Ms >= 400 || summary.p99Ms >= 1000) process.exitCode = 1;
}

void benchmark().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed");
  process.exitCode = 1;
});
