/** Task-source only: frozen audit + concurrent actual metadata RPCs cannot starve native worker control.
 * Creates/removes one synthetic job on the approved task instance, with no artifact. Existing records are preserved. */
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const container = process.env.M15_05_TEST_CONTAINER || "";
if (!/^cra_m15_05_[a-z0-9_]+$/.test(container))
  throw Error("task_source_required");
const root = path.resolve(__dirname, "../../..");
process.env.TS_NODE_PROJECT = path.join(root, "apps/api/tsconfig.json");
require(
  path.join(root, "apps/api/node_modules/ts-node/register/transpile-only"),
);
const { NativeBackupWorkerControlClient } = require(
  path.join(
    root,
    "apps/api/src/backups/infrastructure/native-backup-worker-control.client.ts",
  ),
);
const config = JSON.parse(
    fs.readFileSync(
      path.join(root, ".superpowers/sdd/m15-05/operator-server.private.json"),
    ),
  ),
  runtime = JSON.parse(
    fs.readFileSync(
      path.join(root, ".superpowers/sdd/m15-05/mounted-runtime.private.json"),
    ),
  );
const endpoint = new URL(config.databaseOrigin);
assert.ok(
  endpoint.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(endpoint.hostname) &&
    endpoint.port !== "54321",
  "dedicated_task_endpoint_required",
);
const reader = fs.readFileSync(config.readerJwtFile, "utf8").trim(),
  anon = fs.readFileSync(config.projectApiKeyFile, "utf8").trim();
const instance = config.instanceId,
  runId = crypto.randomUUID(),
  actor = crypto.randomUUID();
const sql = (q) =>
  cp.execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-XqAt",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
let owned = false;
(async () => {
  let fence;
  try {
    assert.equal(
      sql(
        "select count(*) from public.backup_runs where kind='capture' and state='running';",
      ).trim(),
      "0",
      "no_actual_capture_cut_allowed",
    );
    sql(
      `begin;insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,lease_owner,lease_expires_at) select '${runId}',instance_id,'capture','running','validating',configuration_revision,configuration,configuration_digest,gen_random_uuid(),repeat('a',64),'pool-fixture','pool_test',clock_timestamp()+interval '60 seconds' from public.backup_policies where instance_id='${instance}' and is_approved;commit;`,
    );
    owned = true;
    fence = cp.spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-XqAt",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const ready = new Promise((ok, no) => {
      let b = "";
      fence.stdout.on("data", (x) => {
        b += x;
        if (b.includes("FENCE_READY")) ok();
      });
      fence.on("error", no);
      fence.on("exit", (c) => {
        if (c) no(Error("fixture_fence_failed"));
      });
    });
    fence.stdin.end(
      "begin;lock table public.audit_logs in share mode;select 'FENCE_READY';select pg_sleep(2.5);rollback;\n",
    );
    await ready;
    const requests = Array.from({ length: 20 }, async () => {
      const at = performance.now();
      const r = await fetch(
        config.databaseOrigin + "/rest/v1/rpc/m15_03_operator_read",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anon,
            Authorization: "Bearer " + reader,
          },
          body: JSON.stringify({
            p_operator_id: actor,
            p_request_id: crypto.randomUUID(),
            p_instance_ids: [config.instanceId],
            p_tenant_ids: [],
            p_kind: "instances",
            p_instance_id: null,
            p_after_id: null,
            p_limit: 25,
          }),
          signal: AbortSignal.timeout(6000),
        },
      );
      const body = await r.json();
      return {
        status: r.status,
        code: body?.code ?? null,
        elapsedMs: performance.now() - at,
      };
    });
    await new Promise((r) => setTimeout(r, 100));
    const source = Object.values(runtime.sources).find(
      (s) => s.databaseContainer === container,
    );
    assert.ok(source, "source_binding_required");
    const control = new NativeBackupWorkerControlClient(instance, source);
    const start = performance.now();
    assert.equal(
      (await control.execute(instance, "pool-fixture", "policy/read"))
        .instanceId,
      instance,
    );
    const heartbeat = await control.execute(
      instance,
      "pool-fixture",
      "run/heartbeat",
      { runId, workerId: "pool_test", expectedVersion: 1, progress: 1 },
    );
    assert.equal(heartbeat.version, 2);
    const nativeElapsed = performance.now() - start;
    assert.ok(nativeElapsed < 1500, "native_control_must_remain_bounded");
    const outcomes = await Promise.all(requests);
    assert.ok(
      outcomes.every((r) => r.status >= 400 && r.code === "57014"),
      "metadata_must_fail_closed_during_fence",
    );
    assert.equal(
      sql(
        `select count(*) from public.audit_logs where actor_id='${actor}';`,
      ).trim(),
      "0",
    );
    const result = {
      fixtureOnly: true,
      existingSourceRowsChanged: 0,
      retainedFixtureRows: 0,
      concurrentMetadataReaders: 20,
      metadataTimeouts: outcomes.length,
      metadataMaxElapsedMs: Math.round(
        Math.max(...outcomes.map((r) => r.elapsedMs)),
      ),
      nativePolicyAndHeartbeatElapsedMs: Math.round(nativeElapsed),
      nativeHeartbeatVersion: heartbeat.version,
      metadataDisclosures: 0,
      protectedCaptureRecordsChanged: 0,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (fence)
      await new Promise((r) => {
        if (fence.exitCode !== null) return r();
        fence.once("exit", r);
      });
    if (owned)
      sql(
        `begin;delete from public.backup_runs where instance_id='${instance}' and id='${runId}';commit;`,
      );
  }
})().catch((e) => {
  console.error("pool_isolation_failed:" + String(e.message).split("\n")[0]);
  process.exitCode = 1;
});
