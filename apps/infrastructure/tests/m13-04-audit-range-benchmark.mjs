/** Disposable-database benchmark. Never accepts the retained CRA database. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const options = new Map(
  process.argv.slice(2).map((entry) => entry.split("=", 2)),
);
const database = options.get("--database");
if (database !== "m13_test_04_range_v2")
  throw new Error(
    "--database=m13_test_04_range_v2 is required; retained CRA is never benchmarked.",
  );
const container = options.get("--container") ?? "supabase_db_cra";
if (!/^[a-zA-Z0-9_-]+$/.test(container))
  throw new Error("Invalid container name.");
const budgetSeconds = Number(options.get("--seconds") ?? "300");
if (
  !Number.isInteger(budgetSeconds) ||
  budgetSeconds < 10 ||
  budgetSeconds > 3600
)
  throw new Error("Benchmark budget must be 10–3600 seconds per range.");
const organizationId = options.get("--organization");
const actorId = options.get("--actor");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuid.test(organizationId ?? "") || !uuid.test(actorId ?? ""))
  throw new Error(
    "An authorized disposable fixture organization and actor are required.",
  );
const sizes = (options.get("--sizes") ?? "10000,100000,1000000")
  .split(",")
  .map(Number);
if (
  !sizes.every(
    (size) => Number.isInteger(size) && size > 0 && size <= 1_000_000,
  )
)
  throw new Error("Invalid range sizes.");
function literal(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nonfinite SQL input");
    return String(value);
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return `'${serialized.replaceAll("'", "''")}'${typeof value === "string" ? "" : "::jsonb"}`;
}
class Psql {
  queue = [];
  buffer = "";
  errors = "";
  closedError = null;
  constructor() {
    this.process = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-X",
        "-qAt",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.process.stdin.on("error", (error) => this.rejectAll(error));
    this.process.stdout.on("data", (data) => {
      this.buffer += data.toString();
      while (this.buffer.includes("\n")) {
        const end = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        const waiter = this.queue.shift();
        if (!waiter) continue;
        try {
          waiter.resolve(JSON.parse(line));
        } catch {
          waiter.reject(new Error("Invalid benchmark provider response"));
        }
      }
    });
    this.process.stderr.on("data", (data) => {
      this.errors = (this.errors + data.toString()).slice(-4096);
    });
    this.process.on("error", (error) => this.rejectAll(error));
    this.process.on("exit", (code) =>
      this.rejectAll(
        new Error(`Disposable SQL process stopped (${code}): ${this.errors}`),
      ),
    );
  }
  rejectAll(error) {
    this.closedError = error;
    for (const waiter of this.queue.splice(0)) waiter.reject(error);
  }
  query(sql) {
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolveQuery, reject) => {
      this.queue.push({ resolve: resolveQuery, reject });
      this.process.stdin.write(`${sql}\n`);
    });
  }
  close() {
    this.process.stdin.end();
  }
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? Math.round(
        sorted[
          Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
        ] * 100,
      ) / 100
    : null;
}
const timings = new Map();
const sql = new Psql();
const require = createRequire(resolve("apps/api/package.json"));
const { AuditRangeWorker } = require(
  resolve("apps/api/dist/audit/range/audit-range-worker.js"),
);
const { SupabaseAuditRangeRepository } = require(
  resolve(
    "apps/api/dist/audit/range/infrastructure/supabase-audit-range.repository.js",
  ),
);
const reports = [];
const claims = [];
let fairness = null;
try {
  const identity = await sql.query(
    "set statement_timeout='55s'; set lock_timeout='5s'; select jsonb_build_object('database',current_database(),'version',current_setting('server_version'),'head',(select max(last_sequence)::text from public.audit_chain_heads))::text;",
  );
  if (identity.database !== database)
    throw new Error("Disposable database identity mismatch.");
  if (options.has("--seed")) {
    const existing = await sql.query(
      `select jsonb_build_object('rows',(select count(*) from public.audit_logs where organization_id=${literal(organizationId)}))::text;`,
    );
    if (Number(existing.rows) !== 0)
      throw new Error(
        "Seed requires a fresh synthetic organization with no existing audit rows.",
      );
    await sql.query(
      `begin; insert into public.users(id,email) values(${literal(actorId)},'benchmark-${actorId}@cra.test') on conflict(id) do nothing; insert into public.organizations(id,name,slug) values(${literal(organizationId)},'Disposable range benchmark','range-benchmark-${organizationId}') on conflict(id) do nothing; insert into public.organization_members(organization_id,user_id,role) values(${literal(organizationId)},${literal(actorId)},'owner') on conflict do nothing; commit; select jsonb_build_object('seedFixture',true)::text;`,
    );
    let previousHash = "0".repeat(64);
    let lastId = null;
    const total = Math.max(...sizes);
    const seedBegan = performance.now();
    for (let first = 1; first <= total; first += 1000) {
      const rows = [];
      for (
        let sequence = first;
        sequence <= Math.min(first + 999, total);
        sequence++
      ) {
        const payload = {
          id: randomUUID(),
          organization_id: organizationId,
          user_id: actorId,
          actor_email: null,
          action: "organization.range_fixture",
          entity_type: "organization",
          entity_id: organizationId,
          changes: null,
          ip_address: null,
          user_agent: null,
          schema_version: 1,
          event_scope: null,
          event_key: null,
          actor_type: null,
          actor_id: null,
          outcome: null,
          correlation_id: null,
          before_redacted: null,
          after_redacted: null,
          reason: null,
          redaction_version: null,
          chain_version: 1,
          chain_sequence: String(sequence),
          created_at: "2026-10-07T00:00:00.000000Z",
        };
        const canonical = JSON.stringify(
          Object.fromEntries(
            Object.entries(payload).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          ),
        );
        const hash = createHash("sha256")
          .update(Buffer.from(previousHash, "hex"))
          .update(canonical)
          .digest("hex");
        rows.push({
          ...payload,
          previous_hash: previousHash,
          content_hash: hash,
          canonical_content: canonical,
        });
        previousHash = hash;
        lastId = payload.id;
      }
      // Synthetic seeding bypasses insert triggers only in this transaction. It is not writer-throughput evidence.
      await sql.query(
        `begin; set local session_replication_role=replica; insert into public.audit_logs select * from jsonb_populate_recordset(null::public.audit_logs,${literal(rows)}); commit; select jsonb_build_object('seeded',${rows.length})::text;`,
      );
    }
    await sql.query(
      `insert into public.audit_chain_heads(organization_id,legacy_count,last_sequence,last_event_id,last_hash) values(${literal(organizationId)},0,${total},${literal(lastId)},${literal(previousHash)}) on conflict(organization_id) do update set last_sequence=excluded.last_sequence,last_event_id=excluded.last_event_id,last_hash=excluded.last_hash; analyze public.audit_logs; select jsonb_build_object('seedSeconds',${(performance.now() - seedBegan) / 1000})::text;`,
    );
    const canonicalCheck = await sql.query(
      `select jsonb_build_object('mismatches',count(*))::text from public.audit_logs a where organization_id=${literal(organizationId)} and chain_sequence in (1,${total}) and canonical_content<>public.m13_02_canonical_content(a,chain_sequence);`,
    );
    if (Number(canonicalCheck.mismatches) !== 0)
      throw new Error("Synthetic canonical bytes do not match database rules.");
  }
  const available = await sql.query(
    `select jsonb_build_object('count',(select count(*) from public.audit_logs where organization_id=${literal(organizationId)} and chain_sequence is not null),'head',(select last_sequence::text from public.audit_chain_heads where organization_id=${literal(organizationId)}))::text;`,
  );
  const client = {
    admin: () => ({
      rpc: async (name, args) => {
        if (
          !/^m13_04_[a-z_]+$/.test(name) ||
          !Object.keys(args).every((key) => /^p_[a-z_]+$/.test(key))
        )
          throw new Error("Unexpected benchmark RPC");
        const began = performance.now();
        const value = await sql.query(
          `select jsonb_build_object('value',public.${name}(${Object.entries(
            args,
          )
            .map(([key, value]) => `${key}=>${literal(value)}`)
            .join(",")}))::text;`,
        );
        timings.set(name, [
          ...(timings.get(name) ?? []),
          performance.now() - began,
        ]);
        if (name === "m13_04_claim_verification" && value.value)
          claims.push(value.value.organization_id);
        return { data: value.value, error: null };
      },
    }),
  };
  const repository = new SupabaseAuditRangeRepository(client);
  const worker = new AuditRangeWorker({
    repository,
    workerId: `benchmark-${randomUUID()}`,
  });
  for (const size of sizes) {
    if (BigInt(available.head ?? "0") < BigInt(size)) {
      reports.push({
        requestedEvents: size,
        achieved: false,
        reason: "disposable_fixture_too_small",
        availableEvents: available.count,
      });
      continue;
    }
    const requestId = randomUUID();
    const began = performance.now();
    const job = await repository.create(organizationId, actorId, {
      requestId,
      fromSequence: "1",
      toSequence: String(size),
    });
    let current = job;
    let batches = 0;
    let peakRssBytes = process.memoryUsage().rss;
    const oldTransaction = new Psql();
    await oldTransaction.query(
      "begin; select jsonb_build_object('snapshot',pg_current_snapshot()::text)::text;",
    );
    const polling = [];
    try {
      while (
        ["queued", "processing"].includes(current.status) &&
        performance.now() - began < budgetSeconds * 1000
      ) {
        await worker.runOnce();
        batches += 1;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        if (batches % 10 === 0) {
          const readBegan = performance.now();
          current = await repository.status(
            organizationId,
            actorId,
            job.id,
            randomUUID(),
          );
          polling.push(performance.now() - readBegan);
        }
      }
      current = await repository.status(
        organizationId,
        actorId,
        job.id,
        randomUUID(),
      );
      const elapsedMs = performance.now() - began;
      const checked = Number(current.result?.checkedCount ?? "0");
      if (["queued", "processing"].includes(current.status))
        await repository.cancel(organizationId, actorId, job.id, {
          requestId: randomUUID(),
          expectedVersion: current.version,
        });
      reports.push({
        requestedEvents: size,
        achieved:
          current.status === "completed" &&
          current.result?.outcome === "consistent",
        status: current.status,
        outcome: current.result?.outcome ?? null,
        checkedEvents: checked,
        batches,
        elapsedMs: Math.round(elapsedMs),
        eventsPerSecond: Math.round(checked / (elapsedMs / 1000)),
        peakRssBytes,
        pollingP95Ms: percentile(polling, 0.95),
        pollingP99Ms: percentile(polling, 0.99),
        oldTransactionHeld: true,
        budgetReached: elapsedMs >= budgetSeconds * 1000,
      });
    } finally {
      await oldTransaction.query(
        "rollback; select jsonb_build_object('rolledBack',true)::text;",
      );
      oldTransaction.close();
    }
  }
  const fairnessOrganization = options.get("--fairness-organization");
  const fairnessActor = options.get("--fairness-actor");
  if (fairnessOrganization || fairnessActor) {
    if (
      !uuid.test(fairnessOrganization ?? "") ||
      !uuid.test(fairnessActor ?? "") ||
      fairnessOrganization === organizationId
    )
      throw new Error(
        "Fairness requires a second authorized synthetic tenant.",
      );
    const main = await repository.create(organizationId, actorId, {
      requestId: randomUUID(),
      fromSequence: "1",
      toSequence: "500",
    });
    const other = await repository.create(fairnessOrganization, fairnessActor, {
      requestId: randomUUID(),
      fromSequence: "1",
      toSequence: "500",
    });
    const before = claims.length;
    for (let iteration = 0; iteration < 8; iteration++) await worker.runOnce();
    const selected = claims.slice(before);
    const states = await Promise.all([
      repository.status(organizationId, actorId, main.id, randomUUID()),
      repository.status(
        fairnessOrganization,
        fairnessActor,
        other.id,
        randomUUID(),
      ),
    ]);
    const heldJob = await repository.create(organizationId, actorId, {
      requestId: randomUUID(),
      fromSequence: "1",
      toSequence: "500",
    });
    const activeLease = await repository.claim(
      `benchmark-cancel-${randomUUID()}`,
    );
    if (!activeLease || activeLease.id !== heldJob.id)
      throw new Error("Cancellation fixture was not claimed as expected.");
    const cancelBegan = performance.now();
    const cancelled = await repository.cancel(
      organizationId,
      actorId,
      heldJob.id,
      { requestId: randomUUID(), expectedVersion: activeLease.version },
    );
    const cancellationMs =
      Math.round((performance.now() - cancelBegan) * 100) / 100;
    const fencedConnection = new Psql();
    let staleWorkerFenced = false;
    try {
      await fencedConnection.query(
        `select jsonb_build_object('value',public.m13_04_page_verification(p_organization_id=>${literal(organizationId)},p_job_id=>${literal(heldJob.id)},p_worker_id=>${literal(activeLease.workerId)},p_lease_token=>${literal(activeLease.leaseToken)},p_expected_version=>${activeLease.version},p_after_sequence=>'0',p_upper_sequence=>'500',p_limit=>250,p_maximum_bytes=>16777216))::text;`,
      );
    } catch (error) {
      staleWorkerFenced =
        error instanceof Error &&
        error.message.includes("verification_lease_conflict");
    } finally {
      fencedConnection.close();
    }
    fairness = {
      tenantClaims: selected.map((org) =>
        org === organizationId
          ? "first"
          : org === fairnessOrganization
            ? "second"
            : "other",
      ),
      bothCompleted: states.every(
        (state) =>
          state.status === "completed" &&
          state.result?.outcome === "consistent",
      ),
      cancellationMs,
      staleWorkerFenced,
      cancelledState: cancelled.status,
      tenantCount: 2,
      limitation:
        "Sequential batch scheduler exercise; not sustained concurrent tenant load",
    };
  }
  console.log(
    JSON.stringify(
      {
        database,
        fixtureDigest: createHash("sha256")
          .update(`${organizationId}:${actorId}`)
          .digest("hex"),
        measuredPath:
          "persistent docker psql -> actual M13-04 RPCs -> real Node worker/kernel; excludes PostgREST/HTTP",
        reports,
        fairness,
        rpcTimings: Object.fromEntries(
          [...timings].map(([name, values]) => [
            name,
            {
              calls: values.length,
              p95Ms: percentile(values, 0.95),
              p99Ms: percentile(values, 0.99),
            },
          ]),
        ),
        limitations: [
          "Fixtures must be synthetic and pre-generated in the named disposable database",
          "Actual DB authorization and Node hashing included; network delivery excluded",
          "One-tenant run does not establish mixed-tenant fairness",
          "Peak RSS is the Node driver/worker process, not PostgreSQL/container memory",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  sql.close();
}
