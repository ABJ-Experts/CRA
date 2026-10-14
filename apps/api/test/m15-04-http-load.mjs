// Retained synthetic fixtures ONLY in the task-owned M15-04 isolated stack.
// Production throttles stay enabled. Credentials/cookies never enter reports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance as benchPerformance } from "node:perf_hooks";
import {
  diagnosticJobSchema,
  diagnosticListSchema,
} from "../../../packages/contracts/dist/support-diagnostics/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const mode = process.argv[2];
const runtime = resolve(
  process.argv[3] ?? resolve(root, ".superpowers/sdd/m15-04/isolated"),
);
const rounds = Number(process.argv[4] ?? 10);
assert.ok(["prepare", "measure"].includes(mode), "use prepare or measure");
assert.equal(runtime, resolve(root, ".superpowers/sdd/m15-04/isolated"));
assert.ok(
  [10, 20].includes(rounds),
  "only bounded 10 or 20 rounds are supported",
);
const statusPath = resolve(runtime, "stack-status.private.json");
const status = JSON.parse(await readFile(statusPath, "utf8"));
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:56321");
assert.equal(status.DB_CONTAINER ?? "cra_m15_04_db", "cra_m15_04_db");
const apiOrigin = "http://127.0.0.1:3335";
const db = "cra_m15_04_db";
const base = "/api/v1/system/diagnostics/bundles";
const manifestPath = resolve(runtime, "http-load-manifest.private.json");
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sleep = (milliseconds) =>
  new Promise((done) => setTimeout(done, milliseconds));
function sql(statement) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      db,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: statement,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}
async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
async function prepareTenant(name, rows) {
  const path = resolve(runtime, `http-load-${name}.private.json`);
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      resolve(root, "apps/web/e2e/m15-04-support-diagnostics-fixtures.ts"),
      path,
      statusPath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const fixture = JSON.parse(await readFile(path, "utf8"));
  assert.equal(fixture.stackOrigin, "http://127.0.0.1:56321");
  assert.equal(fixture.purpose, "m15-04-browser-verification");
  assert.match(fixture.organizationId, /^[a-f0-9-]{36}$/);
  const org = q(fixture.organizationId),
    actor = q(fixture.owner.userId);
  assert.equal(
    sql(
      `select count(*) from public.organizations o join public.organization_members m on m.organization_id=o.id join public.users u on u.id=m.user_id where o.id=${org}::uuid and o.slug like 'm15-04-browser-%' and m.user_id=${actor}::uuid and m.role='owner' and u.email=${q(fixture.owner.email)};`,
    ),
    "1",
  );
  const count = Number(
    sql(
      `select count(*) from public.support_diagnostic_jobs where organization_id=${org}::uuid;`,
    ),
  );
  assert.ok(
    count === 0 || count === rows,
    "existing fixture count must match the bounded intended workload",
  );
  if (count === 0)
    sql(`begin;
    set local statement_timeout='120s';
    insert into public.support_diagnostic_jobs(id,organization_id,creator_user_id,session_id,permission_version,idempotency_key,preview_digest,selection,selection_digest,consented_at,created_at,completed_at,expires_at,state,stage,version,attempts,progress,omissions,artifact,manifest,failure_code,cleanup_state)
    select job.id,${org}::uuid,${actor}::uuid,gen_random_uuid(),pv.version,gen_random_uuid(),repeat('a',64),
      jsonb_build_object('categories',jsonb_build_array('logs','configuration','metrics'),'from',public.m7_snapshot_timestamp_utc(statement_timestamp()-(n+24)*interval '1 hour'),'to',public.m7_snapshot_timestamp_utc(statement_timestamp()-n*interval '1 hour')),
      repeat('b',64),statement_timestamp()-n*interval '1 hour',statement_timestamp()-n*interval '1 hour',statement_timestamp()-n*interval '1 hour'+interval '45 seconds',
      case when n%5=1 then statement_timestamp()+interval '1 hour' else statement_timestamp()-interval '1 day' end,
      case n%5 when 0 then 'cancelled' when 1 then 'ready' when 2 then 'ready' when 3 then 'failed' else 'deleted' end,
      case when n%5=3 then 'collecting' when n%5=4 then 'cleanup' else 'ready' end,5,1,'{"completed":4,"total":4}',
      case when n%5=3 then '[{"category":"logs","code":"source_unavailable"}]'::jsonb else '[]'::jsonb end,
      case when n%5=3 then null else jsonb_build_object('sha256',repeat('c',64),'byteSize',1048576+n%500*1000,'fileName','support-diagnostics-'||job.id||'.zip') end,
      case when n%5=3 then null else jsonb_build_object('version','m15_04_v1','jobId',job.id,'generatedAt',public.m7_snapshot_timestamp_utc(statement_timestamp()-n*interval '1 hour'+interval '45 seconds'),'selection',jsonb_build_object('categories',jsonb_build_array('logs','configuration','metrics'),'from',public.m7_snapshot_timestamp_utc(statement_timestamp()-(n+24)*interval '1 hour'),'to',public.m7_snapshot_timestamp_utc(statement_timestamp()-n*interval '1 hour')),'entries',jsonb_build_array(jsonb_build_object('name','logs.json','sha256',repeat('d',64),'byteSize',1048576),jsonb_build_object('name','configuration.json','sha256',repeat('e',64),'byteSize',200),jsonb_build_object('name','metrics.json','sha256',repeat('f',64),'byteSize',1500),jsonb_build_object('name','omissions.json','sha256',repeat('0',64),'byteSize',2)),'omissions','[]'::jsonb) end,
      case when n%5=3 then 'source_unavailable' end,case when n%5=4 then 'deleted' else 'none' end
    from generate_series(1,${rows})n cross join lateral(select gen_random_uuid() as id where n>0)job join public.organization_permissions_version pv on pv.organization_id=${org}::uuid;
    commit;`);
  assert.equal(
    Number(
      sql(
        `select count(*) from public.support_diagnostic_jobs where organization_id=${org}::uuid and creator_user_id=${actor}::uuid and state not in('queued','running');`,
      ),
    ),
    rows,
  );
  const scope = JSON.parse(
    sql(
      `select jsonb_build_object('middleCursor',(select id from public.support_diagnostic_jobs where organization_id=${org}::uuid and creator_user_id=${actor}::uuid order by id offset ${Math.floor(rows / 2)} limit 1),'jobIds',(select jsonb_agg(id order by id) from(select id from public.support_diagnostic_jobs where organization_id=${org}::uuid and creator_user_id=${actor}::uuid order by id limit 100)j));`,
    ),
  );
  return {
    name,
    rows,
    fixturePath: path,
    organizationId: fixture.organizationId,
    ...scope,
  };
}

await mkdir(runtime, { recursive: true });
if (mode === "prepare") {
  const large = await prepareTenant("large", 10_000);
  const small = await prepareTenant("small", 100);
  assert.notEqual(large.organizationId, small.organizationId);
  await privateJson(manifestPath, {
    purpose: "m15-04-isolated-http-metadata-load",
    apiOrigin,
    db,
    stackOrigin: new URL(status.API_URL).origin,
    createdAt: new Date().toISOString(),
    tenants: [large, small],
  });
  console.log(
    "Prepared and retained 10,000 large-tenant and 100 small-tenant terminal metadata rows in the isolated M15-04 stack; credentials remain private.",
  );
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.purpose, "m15-04-isolated-http-metadata-load");
assert.equal(manifest.apiOrigin, apiOrigin);
assert.equal(manifest.db, db);
assert.equal(manifest.stackOrigin, "http://127.0.0.1:56321");
const lockPath = resolve(runtime, "http-load-measurement.lock");
const lock = await open(lockPath, "wx", 0o600);
await lock.writeFile(String(process.pid));
await lock.close();
let report;
try {
  // The parent/UI worker must finish browser verification before this command.
  // Two new credentials are used, with the existing sign-in limit untouched.
  const tenants = [];
  for (const tenant of manifest.tenants) {
    const fixture = JSON.parse(await readFile(tenant.fixturePath, "utf8"));
    assert.equal(fixture.organizationId, tenant.organizationId);
    const response = await fetch(`${apiOrigin}/api/v1/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: fixture.owner.email,
        password: fixture.owner.password,
        remember: true,
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    assert.equal(
      response.status,
      200,
      "fixture sign-in failed; body is deliberately not logged",
    );
    const body = await response.json();
    assert.equal(body.next, "dashboard");
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";", 1)[0])
      .join("; ");
    assert.ok(cookie.includes("cra_at="));
    tenants.push({ ...tenant, cookie });
    await sleep(8_000);
  }
  const samples = [],
    attempts = [];
  let inFlight = 0,
    peakInFlight = 0;
  async function request(tenant, kind, worker, round, warmup = false) {
    const cursor = round % 2 ? `&cursor=${tenant.middleCursor}` : "";
    const jobId =
      tenant.jobIds[(round * 7 + worker * 11) % tenant.jobIds.length];
    const path =
      kind === "list" ? `${base}?limit=25${cursor}` : `${base}/${jobId}`;
    const started = benchPerformance.now();
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    let response;
    let recorded = false;
    try {
      response = await fetch(new URL(path, apiOrigin), {
        headers: { Cookie: tenant.cookie },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      const text = await response.text();
      const elapsedMs = benchPerformance.now() - started;
      const attempt = {
        tenant: tenant.name,
        kind,
        round,
        status: response.status,
        elapsedMs,
        responseBytes: Buffer.byteLength(text),
        warmup,
      };
      attempts.push(attempt);
      recorded = true;
      if (response.status !== 200)
        throw new Error(
          `metadata_${tenant.name}_${kind}_http_${response.status}`,
        );
      const data =
        kind === "list"
          ? diagnosticListSchema.parse(JSON.parse(text))
          : diagnosticJobSchema.parse(JSON.parse(text));
      assert.equal(data.organizationId, tenant.organizationId);
      if (kind === "list") {
        assert.equal(data.items.length, 25);
        assert.ok(
          data.items.every(
            (item) => item.organizationId === tenant.organizationId,
          ),
        );
      } else assert.equal(data.id, jobId);
      assert.ok(
        !/("objectPath"|"sessionId"|"creatorUserId"|"grantDigest"|"previewToken")/.test(
          text,
        ),
      );
      attempt.semanticValid = true;
      if (!warmup) samples.push(attempt);
    } catch (error) {
      if (!recorded)
        attempts.push({
          tenant: tenant.name,
          kind,
          round,
          status: response?.status ?? 0,
          elapsedMs: benchPerformance.now() - started,
          responseBytes: 0,
          warmup,
          semanticValid: false,
          errorCode: "transport_failure",
        });
      throw error;
    } finally {
      inFlight--;
    }
  }
  async function phase(workers, kind, round) {
    const outcomes = await Promise.allSettled(
      workers.map(({ worker, tenant }) => request(tenant, kind, worker, round)),
    );
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure) throw failure.reason;
  }
  for (const tenant of tenants) {
    await request(tenant, "list", 0, 0, true);
    await request(tenant, "get", 0, 0, true);
  }
  console.log(
    "Warmup passed. Reserving 61 seconds for unchanged per-route/IP throttle windows.",
  );
  await sleep(30_000);
  await sleep(30_000);
  await sleep(1_000);
  const measurementStart = benchPerformance.now();
  try {
    for (let round = 0; round < rounds; round++) {
      const roundStart = benchPerformance.now();
      // Ten concurrent clients: five from each tenant. The list phase and get
      // phase each launch ten requests, so peak request concurrency is ten.
      const workers = Array.from({ length: 10 }, (_, worker) => ({
        worker,
        tenant: tenants[worker % 2],
      }));
      await phase(workers, "list", round);
      await phase(workers, "get", round);
      if ((round + 1) % 2 === 0)
        console.log(
          `Completed ${round + 1}/${rounds} concurrent rounds; no throttle/configuration changes.`,
        );
      // Ten requests per route every eleven seconds remain within 60/min.
      if (round + 1 < rounds)
        await sleep(
          Math.max(0, 11_000 - (benchPerformance.now() - roundStart)),
        );
    }
  } finally {
    const quantile = (values, percentile) =>
      [...values].sort((a, b) => a - b)[
        Math.ceil(percentile * values.length) - 1
      ];
    const results = tenants.flatMap((tenant) =>
      ["list", "get"].map((kind) => {
        const entries = samples.filter(
          (sample) => sample.tenant === tenant.name && sample.kind === kind,
        );
        const values = entries.map((entry) => entry.elapsedMs);
        return {
          tenant: tenant.name,
          operation: kind,
          samples: values.length,
          p50Ms: quantile(values, 0.5),
          p95Ms: quantile(values, 0.95),
          p99Ms: quantile(values, 0.99),
          maxMs: values.length ? Math.max(...values) : null,
          responseBytes: entries.length
            ? {
                min: Math.min(...entries.map((entry) => entry.responseBytes)),
                max: Math.max(...entries.map((entry) => entry.responseBytes)),
              }
            : null,
        };
      }),
    );
    report = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      apiOrigin,
      database: db,
      fixtureRows: { large: 10_000, small: 100 },
      workers: 10,
      rounds,
      peakInFlight,
      measuredDurationMs: benchPerformance.now() - measurementStart,
      throttle: {
        untouched: true,
        limitPerRoutePerIpPerMinute: 60,
        roundIntervalMs: 11_000,
        warmupQuietMs: 61_000,
      },
      attempts: attempts.filter((attempt) => !attempt.warmup).length,
      statusCounts: attempts
        .filter((attempt) => !attempt.warmup)
        .reduce(
          (counts, attempt) => ({
            ...counts,
            [attempt.status]: (counts[attempt.status] ?? 0) + 1,
          }),
          {},
        ),
      results,
      samples,
      limitations: [
        "Metadata list/get only; synthetic historical receipts have no stored objects",
        "Paced throughput preserves production throttles; peak concurrency10 is separate from sustained request rate",
        "Two cookie sessions on one localhost source IP; response body/schema and tenant scope checked",
        "No source/archive/download/worker load is measured",
      ],
    };
    await writeFile(
      resolve(runtime, "http-load-results.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  assert.equal(report.attempts, rounds * 20);
  assert.equal(report.peakInFlight, 10);
  assert.ok(
    report.results.every(
      (result) =>
        result.samples === rounds * 5 &&
        result.p95Ms < 400 &&
        result.p99Ms < 1000,
    ),
    "metadata HTTP latency target failed; inspect retained report",
  );
  console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));
} finally {
  await unlink(lockPath);
}
