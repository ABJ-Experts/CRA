// Task-owned local load rows; no customer state or original database is copied.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
const runtime = resolve(process.argv[2]);
assert.ok(
  runtime.endsWith("/2026-10-14-m15-03-scoped-operator-system-health/isolated"),
);
const m = JSON.parse(
  await readFile(`${runtime}/fixture-manifest.private.json`, "utf8"),
);
const s = JSON.parse(
  await readFile(`${runtime}/stack-status.private.json`, "utf8"),
);
assert.equal(s.API_URL, "http://127.0.0.1:55321");
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
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
  );
const body = `begin;
insert into public.organization_export_jobs(organization_id,actor_user_id,request_digest,status,created_at,available_at)
select ${q(m.large.organizationId)},${q(m.large.userId)},encode(extensions.digest('m15-03-load-'||i,'sha256'),'hex'),case i%5 when 0 then 'queued' when 1 then 'running' when 2 then 'failed' when 3 then 'paused' else 'dead_letter' end,statement_timestamp()-interval '1 hour'+i*interval '1ms','infinity' from generate_series(1,100000)i;
insert into public.organization_export_jobs(organization_id,actor_user_id,request_digest,status,available_at)values(${q(m.restricted.organizationId)},${q(m.restricted.userId)},repeat('a',64),'queued','infinity');
insert into public.operator_registry_observations(instance_id,entity_kind,entity_id,label,revision,digest,status,source_observed_at,received_at,attempted_at,succeeded_at,entity_observed_at)
values(${q(m.instanceId)},'instance',${q(m.instanceId)},'Isolated load instance',1,repeat('d',64),'unknown',statement_timestamp(),statement_timestamp(),statement_timestamp(),statement_timestamp(),statement_timestamp());
insert into public.operator_registry_observations(instance_id,entity_kind,entity_id,label,revision,digest,status,source_observed_at,received_at,attempted_at,succeeded_at,licence_state,entity_observed_at)
select ${q(m.instanceId)},'tenant',('25555555-5555-4555-8555-'||lpad(i::text,12,'0'))::uuid,'Isolated tenant '||i,1,repeat('d',64),'unknown',statement_timestamp(),statement_timestamp(),statement_timestamp(),statement_timestamp(),'missing',statement_timestamp() from generate_series(1,10000)i;
analyze public.organization_export_jobs; analyze public.operator_registry_observations;commit;`;
await writeFile(`${runtime}/load-fixture.sql`, body);
sql(body);
const r = m.restricted,
  def = randomUUID(),
  run = randomUUID(),
  recipient = randomUUID();
const config = {
  title: "Retained revoked report",
  report: {
    kind: "list",
    source: "products.registry",
    format: "csv",
    context: {},
    filters: {},
  },
  schedule: { frequency: "daily", timezone: "UTC", localTime: "09:00" },
  dateWindow: { kind: "fixed" },
  recipientUserIds: [r.userId],
  emailEnabled: true,
};
sql(
  `begin;insert into public.report_definitions(id,organization_id,owner_user_id,config,config_digest,source_schema_digest,create_key)values(${q(def)},${q(r.organizationId)},${q(r.userId)},${q(JSON.stringify(config))}::jsonb,public.m14_04_digest(${q(JSON.stringify(config))}::jsonb),public.m14_04_digest(public.m14_03_source_policy('products.registry')),gen_random_uuid());insert into public.report_runs(id,organization_id,definition_id,definition_version,owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key)values(${q(run)},${q(r.organizationId)},${q(def)},1,${q(r.userId)},'preview',${q(JSON.stringify(config))}::jsonb,public.m14_04_digest(${q(JSON.stringify(config))}::jsonb),'m14_04_v1',public.m14_04_digest(public.m14_03_source_policy('products.registry')),statement_timestamp(),'preview:m15-03-isolated');insert into public.report_run_recipients(id,organization_id,run_id,user_id,email_state)values(${q(recipient)},${q(r.organizationId)},${q(run)},${q(r.userId)},'off');insert into public.notification_dispatches(organization_id,category,source_type,source_id,source_subtype,original_recipient_user_id,effective_recipient_user_id)values(${q(r.organizationId)},'scheduled_report','report_run_recipient',${q(recipient)},'ready',${q(r.userId)},${q(r.userId)});commit;`,
);
const tenantIds = sql(
  `select entity_id from public.operator_registry_observations where entity_kind='tenant' order by entity_id;`,
)
  .trim()
  .split("\n");
await writeFile(
  `${runtime}/registry-scope.json`,
  JSON.stringify({ instanceId: m.instanceId, tenantIds }, null, 2),
);
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "cra_operator_registry_reader", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
await writeFile(
  `${runtime}/reader-jwt.private`,
  `${unsigned}.${createHmac("sha256", s.JWT_SECRET).update(unsigned).digest("base64url")}`,
  { mode: 0o600 },
);
await writeFile(`${runtime}/anon-key.private`, s.ANON_KEY, { mode: 0o600 });
console.log(
  "Load fixture committed in isolated DB: 10,000 registry tenants and 100,000 source queue rows; restricted retained-source revocation fixtures added.",
);
