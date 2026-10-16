// Genuine PostgREST audit fault in a disposable task database only.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const runtime = resolve(process.argv[2]);
assert.ok(
  runtime.endsWith("/2026-10-14-m15-03-scoped-operator-system-health/isolated"),
);
const m = JSON.parse(
  await readFile(`${runtime}/fixture-manifest.private.json`, "utf8"),
);
const status = JSON.parse(
  await readFile(`${runtime}/stack-status.private.json`, "utf8"),
);
assert.equal(status.API_URL, "http://127.0.0.1:55321");
const reader = (await readFile(`${runtime}/reader-jwt.private`, "utf8")).trim();
const principal = randomUUID(),
  requestId = randomUUID();
const sql = (query) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cra_m15_03_isolated_20261014",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
async function rpc(body, credential = reader) {
  const response = await fetch(
    `${status.API_URL}/rest/v1/rpc/m15_03_operator_read`,
    {
      method: "POST",
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    },
  );
  return { status: response.status, body: await response.json() };
}
const input = {
  p_operator_id: principal,
  p_request_id: requestId,
  p_instance_ids: [m.instanceId],
  p_tenant_ids: [],
  p_kind: "instances",
  p_instance_id: null,
  p_after_id: null,
  p_limit: 50,
};
const success = await rpc({ ...input, p_request_id: randomUUID() });
assert.equal(success.status, 200);
assert.equal(success.body.instances.length, 1);
const receiptsBefore = Number(
  sql(
    `select count(*) from public.audit_logs where actor_type='operator' and actor_id='${principal}';`,
  ),
);
assert.equal(receiptsBefore, 1);
const digestBefore = sql(
  `select md5(string_agg(id::text||coalesce(content_hash,''),',' order by id)) from public.audit_logs;`,
);
let failure;
try {
  sql(
    `create function public.m15_03_isolated_fail_audit() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin if new.actor_type='operator' and new.actor_id='${principal}' then raise exception 'isolated audit append unavailable' using errcode='42501';end if;return new;end$$;create trigger m15_03_isolated_audit_failure before insert on public.audit_logs for each row execute function public.m15_03_isolated_fail_audit();`,
  );
  failure = await rpc(input);
  assert.equal(failure.status, 403);
  assert.equal(failure.body.code, "42501");
  assert.ok(!Object.hasOwn(failure.body, "instances"));
  assert.equal(
    Number(
      sql(
        `select count(*) from public.audit_logs where actor_type='operator' and actor_id='${principal}';`,
      ),
    ),
    receiptsBefore,
  );
  assert.equal(
    sql(
      `select md5(string_agg(id::text||coalesce(content_hash,''),',' order by id)) from public.audit_logs;`,
    ),
    digestBefore,
  );
} finally {
  sql(
    "drop trigger if exists m15_03_isolated_audit_failure on public.audit_logs;drop function if exists public.m15_03_isolated_fail_audit();",
  );
}
const resumed = await rpc({ ...input, p_request_id: randomUUID() });
assert.equal(resumed.status, 200);
for (const table of [
  "products",
  "users",
  "organization_license_states",
  "operator_registry_observations",
]) {
  const response = await fetch(
    `${status.API_URL}/rest/v1/${table}?select=*&limit=1`,
    { headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${reader}` } },
  );
  assert.ok(
    [401, 403].includes(response.status),
    `${table} must deny narrowreader`,
  );
}
const report = {
  scope: "isolated PostgREST HTTP audited RPC",
  schemaSnapshot: "current original public DDL only; no tenant contents copied",
  successfulReadStatus: success.status,
  injectedAppendFailureStatus: failure.status,
  noDisclosureOnFailure: true,
  receiptsRolledBack: true,
  existingAuditDigestUnchanged: true,
  normalReadRestoredStatus: resumed.status,
  readerContentTablesDenied: true,
  resourceOrigin: status.API_URL,
  completedAt: new Date().toISOString(),
};
await writeFile(
  `${runtime}/audit-atomicity-results.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
