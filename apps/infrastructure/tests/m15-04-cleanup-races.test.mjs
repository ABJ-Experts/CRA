// Two real local PostgreSQL connections. Every source/fixture write rolls back.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const command = [
  "exec",
  "-i",
  "supabase_db_cra",
  "psql",
  "-XqAt",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
const query = (sql) =>
  execFileSync("docker", [...command, "-c", sql], { encoding: "utf8" }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function connection() {
  const child = spawn("docker", command, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  let pending;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (pending && output.includes(pending.marker)) {
      const item = pending;
      pending = undefined;
      const before = output.slice(0, output.indexOf(item.marker));
      output = output
        .slice(output.indexOf(item.marker) + item.marker.length)
        .trimStart();
      item.resolve(before.trim());
    }
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  child.on("exit", (code) => {
    if (pending)
      pending.reject(
        new Error(`PostgreSQL test connection exited ${code}: ${errors}`),
      );
  });
  return {
    async send(sql) {
      assert.equal(pending, undefined, "one command at a time per connection");
      const marker = `m15_done_${randomUUID().replaceAll("-", "")}`;
      const result = new Promise((resolve, reject) => {
        pending = { marker, resolve, reject };
      });
      child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      return result;
    },
    async close() {
      child.stdin.end("ROLLBACK;\n\\q\n");
    },
  };
}
const selected =
  query(`select o.id::text||'|'||m.user_id::text from public.organizations o
 join public.organization_members m on m.organization_id=o.id and m.role='owner'
 join public.organization_retention_policies p on p.organization_id=o.id and p.evidence_class='export_artifact' and p.effective_retention_days=0
 where o.is_active and not exists(select 1 from public.retention_authoritative_facts f where f.organization_id=o.id and f.active and (f.reason_kind='legal_hold' or (f.evidence_class='export_artifact' and f.protect_through>clock_timestamp())))
 and not exists(select 1 from public.evidence_document_legal_holds h where h.organization_id=o.id and h.released_at is null)
 and not exists(select 1 from public.product_lifecycle_dependency_facts f where f.organization_id=o.id and f.active and f.authority_kind='legal_hold')
 and not exists(select 1 from public.organization_export_jobs e where e.organization_id=o.id and e.status in ('queued','running'))
 order by o.id,m.user_id limit 1;`);
const [org, actor] = selected.split("|");
assert.match(org ?? "", /^[a-f0-9-]{36}$/);
assert.match(actor ?? "", /^[a-f0-9-]{36}$/);
const writer = connection();
const deleter = connection();
const setup = async () => {
  const job = randomUUID();
  const object = randomUUID();
  const path = `${org}/${job}/attempt-1/bundle.zip`;
  // Only fixture setup bypasses triggers, preventing setup from acquiring the
  // common advisory lock before the race starts. Actual DELETE/writer commands
  // run all production triggers. No fixture or modified authority commits.
  await deleter.send(`BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL storage.allow_delete_query='true'; SET LOCAL session_replication_role=replica;
 UPDATE public.retention_authority_states SET available=true,last_reconciled_at=clock_timestamp() WHERE organization_id='${org}';
 INSERT INTO public.support_diagnostic_jobs(id,organization_id,creator_user_id,session_id,permission_version,idempotency_key,preview_digest,selection,selection_digest,state,stage,completed_at,expires_at,object_path,object_paths,cleanup_state,cleanup_worker_id,cleanup_lease_expires_at)
 SELECT '${job}','${org}','${actor}','${randomUUID()}',version,'${randomUUID()}',repeat('a',64),'{"categories":["logs"],"from":"2026-10-01T00:00:00Z","to":"2026-10-02T00:00:00Z"}',repeat('b',64),'failed','cleanup',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day','${path}',ARRAY['${path}'],'deleting','race_worker',clock_timestamp()+interval '60 seconds' FROM public.organization_permissions_version WHERE organization_id='${org}';
 INSERT INTO storage.objects(id,bucket_id,name,metadata) VALUES('${object}','support-diagnostics','${path}','{"size":73,"mimetype":"application/zip"}');
 UPDATE public.support_diagnostic_jobs j SET cleanup_review_fingerprint=public.m15_04_cleanup_policy(j)->>'reviewFingerprint' WHERE id='${job}';
 DO $$BEGIN IF NOT (SELECT (public.m15_04_cleanup_policy(j)->>'eligible')::boolean FROM public.support_diagnostic_jobs j WHERE id='${job}') THEN RAISE EXCEPTION 'race fixture must be eligible'; END IF;END$$;
 SET LOCAL session_replication_role=origin;`);
  return { job, object, path };
};
const waitForLock = async (pid) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const wait = query(
      `select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'') from pg_stat_activity where pid=${Number(pid)};`,
    );
    if (wait === "Lock:advisory") return;
    await delay(25);
  }
  assert.fail("operation must block on the shared tenant advisory lock");
};
try {
  const deleterPid = Number(await deleter.send("select pg_backend_pid();"));
  const writerPid = Number(await writer.send("select pg_backend_pid();"));
  let fixture = await setup();
  await writer.send(
    `BEGIN; SET LOCAL statement_timeout='15s'; UPDATE public.organization_retention_policies SET requested_retention_days=36500,effective_retention_days=36500 WHERE organization_id='${org}' AND evidence_class='export_artifact';`,
  );
  const pendingDelete = deleter.send(
    `DELETE FROM storage.objects WHERE id='${fixture.object}';`,
  );
  await waitForLock(deleterPid);
  await writer.send("ROLLBACK;");
  await pendingDelete;
  assert.equal(
    await deleter.send(
      `select count(*) from public.audit_logs where organization_id='${org}' and event_key='support.diagnostic.cleanup_object_deleted:${fixture.object}';`,
    ),
    "1",
    "metadata deletion carries an authoritative receipt",
  );
  await deleter.send("ROLLBACK;");

  fixture = await setup();
  await deleter.send(
    `DELETE FROM storage.objects WHERE id='${fixture.object}';`,
  );
  const pendingWriter = writer.send(
    `BEGIN; SET LOCAL statement_timeout='15s'; UPDATE public.organization_retention_policies SET requested_retention_days=36500,effective_retention_days=36500 WHERE organization_id='${org}' AND evidence_class='export_artifact';`,
  );
  await waitForLock(writerPid);
  // This open transaction models Storage's backend-delete callback: source
  // protections remain serialized until transaction completion, including any
  // backend failure. ROLLBACK preserves every original row and fixture.
  await deleter.send("ROLLBACK;");
  await pendingWriter;
  await writer.send("ROLLBACK;");
  assert.equal(
    query(
      `select count(*) from public.support_diagnostic_jobs where id in ('${fixture.job}');`,
    ),
    "0",
  );
  process.stdout.write(
    "M15-04 cleanup writer-first and delete-first transaction races passed; all fixtures rolled back.\n",
  );
} finally {
  await writer.close();
  await deleter.close();
}
