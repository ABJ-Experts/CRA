// SQL transport benchmark. This reports PostgREST RPC latency, not Nest/mTLS latency.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance as benchPerformance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const runtime = resolve(process.argv[2]);
assert.ok(
  runtime.endsWith("/2026-10-14-m15-03-scoped-operator-system-health/isolated"),
);
const m = JSON.parse(
    await readFile(`${runtime}/fixture-manifest.private.json`, "utf8"),
  ),
  status = JSON.parse(
    await readFile(`${runtime}/stack-status.private.json`, "utf8"),
  ),
  scope = JSON.parse(await readFile(`${runtime}/registry-scope.json`, "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:55321");
const reader = (await readFile(`${runtime}/reader-jwt.private`, "utf8")).trim();
async function rpc(name, input, credential) {
  const start = benchPerformance.now();
  const response = await fetch(`${status.API_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${name} HTTP ${response.status}`);
  return { body, ms: benchPerformance.now() - start };
}
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    minMs: sorted[0],
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
    maxMs: sorted.at(-1),
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}
let records = {},
  principal = randomUUID();
for (const kind of ["instances", "detail", "tenants", "instance_metadata"]) {
  let measured = [],
    small = [];
  for (let i = 0; i < 200; i++) {
    const [main, neighbor] = await Promise.all([
      rpc(
        "m15_03_operator_read",
        {
          p_operator_id: principal,
          p_request_id: randomUUID(),
          p_instance_ids: [scope.instanceId],
          p_tenant_ids: scope.tenantIds,
          p_kind: kind,
          p_instance_id: kind === "instances" ? null : scope.instanceId,
          p_after_id: null,
          p_limit: 100,
        },
        reader,
      ),
      rpc(
        "m15_03_read_health_source",
        {
          p_organization_id: m.owner.organizationId,
          p_actor_user_id: m.owner.userId,
          p_source: "exports",
          p_product_id: null,
        },
        status.SERVICE_ROLE_KEY,
      ),
    ]);
    measured = [...measured, main.ms];
    small = [...small, neighbor.ms];
    assert.equal(neighbor.body.outcome, "ready");
    assert.equal(neighbor.body.data.queue.pending, 0);
    if (kind === "tenants" || kind === "instance_metadata")
      assert.equal(main.body.tenants.length, 100);
  }
  records = {
    ...records,
    [`operator_${kind}`]: {
      main: summary(measured),
      concurrentSmallTenant: summary(small),
    },
  };
  console.log(`${kind}: 200 measured reads completed`);
}
let large = [],
  small = [];
for (let i = 0; i < 200; i++) {
  const [main, neighbor] = await Promise.all([
    rpc(
      "m15_03_read_health_source",
      {
        p_organization_id: m.large.organizationId,
        p_actor_user_id: m.large.userId,
        p_source: "exports",
        p_product_id: null,
      },
      status.SERVICE_ROLE_KEY,
    ),
    rpc(
      "m15_03_read_health_source",
      {
        p_organization_id: m.owner.organizationId,
        p_actor_user_id: m.owner.userId,
        p_source: "exports",
        p_product_id: null,
      },
      status.SERVICE_ROLE_KEY,
    ),
  ]);
  assert.equal(main.body.outcome, "ready");
  assert.equal(main.body.data.queue.pending, 10000);
  assert.equal(main.body.data.queue.countRelation, "at_least");
  assert.equal(neighbor.body.data.queue.pending, 0);
  large = [...large, main.ms];
  small = [...small, neighbor.ms];
}
records = {
  ...records,
  customer_export_source: {
    main: summary(large),
    concurrentSmallTenant: summary(small),
  },
};
const result = {
  transport:
    "actual local PostgREST HTTP RPC; excludes Nest/mTLS listener overhead and throttles",
  fixtureRows: { registryTenants: 10000, sourceQueueRows: 100000 },
  concurrency: 2,
  warmupSamples: 0,
  measuredSamplesPerRead: 200,
  records,
  completedAt: new Date().toISOString(),
};
await writeFile(
  `${runtime}/postgrest-load-results.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
