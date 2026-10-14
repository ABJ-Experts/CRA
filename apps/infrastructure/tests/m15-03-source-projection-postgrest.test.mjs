// Read-only proof against an existing task-owned health-only actor. Credentials
// are loaded in memory from a private local stack status file and never logged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { systemHealthReasonSchema } from "../../../packages/contracts/dist/system/schemas/index.js";

const require = createRequire(
  new URL("../../../packages/contracts/package.json", import.meta.url),
);
const { z } = require("zod");
const sources = [
  "deadline_monitor",
  "vulnerability_feeds",
  "usage_metering",
  "licensing",
  "evidence_processing",
  "connectors",
  "sboms",
  "exports",
  "reports",
  "notifications",
];
const projectionSchema = z.strictObject({
  outcome: z.enum(["ready", "withheld", "forbidden"]),
  source: z.enum(sources),
  sourceAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime().nullable(),
  data: z.unknown(),
  reasons: z.array(systemHealthReasonSchema).max(30),
});
const [statusPath, organizationId, actorId] = process.argv.slice(2);
assert.ok(
  statusPath && organizationId && actorId,
  "supply private local stack status, organization UUID and health-only actor UUID",
);
assert.ok(
  z.uuid().safeParse(organizationId).success &&
    z.uuid().safeParse(actorId).success,
);
const status = JSON.parse(readFileSync(statusPath, "utf8"));
const origin = new URL(status.API_URL);
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");
assert.ok(
  ["54321", "55321"].includes(origin.port),
  "only the existing approved local stacks are supported",
);
assert.ok(
  status.ANON_KEY && status.SERVICE_ROLE_KEY,
  "private local stack keys are required",
);
for (const source of sources) {
  const response = await fetch(
    new URL("/rest/v1/rpc/m15_03_read_health_source", origin),
    {
      method: "POST",
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_source: source,
        p_product_id: null,
      }),
      signal: AbortSignal.timeout(2000),
    },
  );
  assert.equal(response.status, 200, `${source} RPC status`);
  const raw = await response.json();
  assert.deepEqual(
    Object.keys(raw).sort(),
    ["data", "observedAt", "outcome", "reasons", "source", "sourceAt"],
    `${source} final wrapper exact keyset`,
  );
  const projection = projectionSchema.parse(raw);
  assert.equal(projection.source, source);
  assert.equal(
    projection.outcome,
    "withheld",
    `${source} must retain permission withholding`,
  );
  assert.equal(projection.sourceAt, null);
  assert.equal(projection.data, null);
  assert.deepEqual(projection.reasons, ["source_permission_withheld"]);
}
console.log(
  "M15-03 actual PostgREST final wrapper: all 10 health-only source denials parse strictly as withheld with null provenance/data PASS",
);
