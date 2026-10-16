// Real local PostgREST ACL proof. Credentials stay in memory and are never logged.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";

const origin = "http://127.0.0.1:54321";
const environment = (container) =>
  Object.fromEntries(
    JSON.parse(
      execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
    )[0].Config.Env.map((value) => {
      const index = value.indexOf("=");
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  );
const gateway = environment("supabase_kong_cra");
const auth = environment("supabase_auth_cra");
const localStatus = JSON.parse(
  execFileSync(
    "pnpm",
    [
      "--filter",
      "infrastructure",
      "exec",
      "supabase",
      "status",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const anonKey = localStatus.ANON_KEY;
assert.ok(anonKey, "local gateway publishable credential required");
const owner = JSON.parse(
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      "select json_build_object('id',u.id,'org',m.organization_id) from public.users u join public.organization_members m on m.user_id=u.id and m.role='owner' where u.email='owner@cra.test' limit 1",
    ],
    { encoding: "utf8" },
  ).trim(),
);
const token = (role) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, sub: owner.id, session_id: randomUUID(), iss: "supabase", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 120 })}`;
  return `${data}.${createHmac("sha256", auth.GOTRUE_JWT_SECRET).update(data).digest("base64url")}`;
};
const reader = token("cra_operator_registry_reader");
const service = token("service_role");
const request = async (path, credential, body) => {
  const response = await fetch(`${origin}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  return { status: response.status, body: await response.json() };
};
for (const table of [
  "products",
  "users",
  "organization_members",
  "organization_license_states",
  "operator_registry_observations",
]) {
  const response = await request(`${table}?select=*&limit=1`, reader);
  assert.ok(
    [401, 403].includes(response.status),
    `reader must not read ${table}: ${response.status}`,
  );
}
for (const [name, body] of [
  [
    "m15_03_read_health_source",
    {
      p_organization_id: owner.org,
      p_actor_user_id: owner.id,
      p_source: "deadline_monitor",
      p_product_id: null,
    },
  ],
  [
    "get_dashboard_projection",
    {
      p_organization_id: owner.org,
      p_actor_user_id: owner.id,
      p_tab: "overview",
      p_filters: {},
    },
  ],
  [
    "m15_03_publish_observation",
    { p_expected_instance_id: randomUUID(), p_observation: {} },
  ],
  [
    "m15_03_record_poll_outcome",
    {
      p_instance_id: randomUUID(),
      p_attempted_at: new Date().toISOString(),
      p_reason: "collection_unreachable",
    },
  ],
]) {
  const response = await request(`rpc/${name}`, reader, body);
  assert.ok(
    [401, 403, 404].includes(response.status),
    `reader must not execute ${name}: ${response.status}`,
  );
}
const requestId = randomUUID();
const principalId = randomUUID();
const read = await request("rpc/m15_03_operator_read", reader, {
  p_operator_id: principalId,
  p_request_id: requestId,
  p_instance_ids: [],
  p_tenant_ids: [],
  p_kind: "instances",
  p_instance_id: null,
  p_after_id: null,
  p_limit: 50,
});
assert.equal(
  read.status,
  200,
  "narrow metadata RPC available through actual PostgREST",
);
assert.deepEqual(read.body.instances, []);
const receipt = JSON.parse(
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      `select json_build_object('scope',event_scope,'actor',actor_id,'organizationId',organization_id) from public.audit_logs where correlation_id='${requestId}'`,
    ],
    { encoding: "utf8" },
  ).trim(),
);
assert.deepEqual(receipt, {
  scope: "security",
  actor: principalId,
  organizationId: null,
});
const failedRequestId = randomUUID();
const failureName = `m15_03_test_audit_failure_${randomUUID().replaceAll("-", "")}`;
const sql = (statement) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
sql(
  `create function public.${failureName}() returns trigger language plpgsql set search_path=pg_catalog as $$ begin if new.actor_id='${principalId}' then raise exception 'task-owned audit failure' using errcode='XX000'; end if; return new; end $$; create trigger ${failureName} before insert on public.audit_logs for each row execute function public.${failureName}();`,
);
try {
  const failedRead = await request("rpc/m15_03_operator_read", reader, {
    p_operator_id: principalId,
    p_request_id: failedRequestId,
    p_instance_ids: [],
    p_tenant_ids: [],
    p_kind: "instances",
    p_instance_id: null,
    p_after_id: null,
    p_limit: 50,
  });
  assert.equal(
    failedRead.status,
    500,
    "audit storage failure denies actual HTTP disclosure",
  );
  assert.equal(Object.hasOwn(failedRead.body, "instances"), false);
  assert.equal(
    sql(
      `select exists(select 1 from public.audit_logs where correlation_id='${failedRequestId}');`,
    ).trim(),
    "f",
    "failed HTTP transaction did not retain a partial receipt",
  );
} finally {
  sql(
    `drop trigger ${failureName} on public.audit_logs; drop function public.${failureName}();`,
  );
}
const health = await request("rpc/m15_03_read_health_source", service, {
  p_organization_id: owner.org,
  p_actor_user_id: owner.id,
  p_source: "deadline_monitor",
  p_product_id: null,
});
assert.equal(health.status, 200);
assert.equal(health.body.outcome, "ready");
const foreign = await request("rpc/m15_03_read_health_source", service, {
  p_organization_id: randomUUID(),
  p_actor_user_id: owner.id,
  p_source: "deadline_monitor",
  p_product_id: null,
});
assert.equal(foreign.body.outcome, "forbidden");
assert.equal(
  Object.hasOwn(foreign.body, "sourceAt"),
  true,
  "all source outcomes include the required nullable provenance field",
);
assert.equal(
  foreign.body.sourceAt,
  null,
  "forbidden source data has no fabricated timestamp",
);
const withheld = await request("rpc/m15_03_read_health_source", service, {
  p_organization_id: owner.org,
  p_actor_user_id: owner.id,
  p_source: "connectors",
  p_product_id: randomUUID(),
});
assert.equal(withheld.body.outcome, "withheld");
assert.equal(withheld.body.sourceAt, null);
assert.equal(withheld.body.data, null);
for (const projection of [health.body, foreign.body, withheld.body]) {
  assert.deepEqual(
    Object.keys(projection).sort(),
    ["data", "observedAt", "outcome", "reasons", "source", "sourceAt"],
    "actual PostgREST responses share the strict internal projection shape",
  );
}
const signIn = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "owner@cra.test", password: "Password123" }),
  signal: AbortSignal.timeout(2000),
});
assert.equal(signIn.status, 200);
const customer = (await signIn.json()).access_token;
const customerRead = await request("rpc/m15_03_operator_read", customer, {
  p_operator_id: principalId,
  p_request_id: randomUUID(),
  p_instance_ids: [],
  p_tenant_ids: [],
  p_kind: "instances",
  p_limit: 50,
});
assert.ok(
  [401, 403].includes(customerRead.status),
  "actual customer token cannot enter operator realm",
);
// Hold only the source table read lock briefly, with no source-row mutation.
const blocker = spawn(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_cra",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const ready = new Promise((resolve, reject) => {
  let output = "";
  blocker.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("M15_03_LOCK_READY")) resolve();
  });
  blocker.on("error", reject);
  blocker.on("exit", (code) => {
    if (code !== 0) reject(new Error("source lock fixture failed"));
  });
});
blocker.stdin.end(
  "begin; lock table public.reporting_deadline_monitor_health in access exclusive mode;\n\\echo M15_03_LOCK_READY\nselect pg_sleep(0.8); rollback;\n",
);
await ready;
const started = performance.now();
const bounded = await request("rpc/m15_03_read_health_source", service, {
  p_organization_id: owner.org,
  p_actor_user_id: owner.id,
  p_source: "deadline_monitor",
  p_product_id: null,
});
assert.equal(
  bounded.body.code,
  "57014",
  "actual PostgREST hoists the RPC statement_timeout",
);
assert.ok(
  performance.now() - started < 650,
  "database source timeout remains below the lock fixture duration",
);
await new Promise((resolve) => blocker.on("close", resolve));
console.log(
  "M15-03 real PostgREST reader table/RPC denial, customer denial, source tenant denial and committed security receipt PASS",
);
