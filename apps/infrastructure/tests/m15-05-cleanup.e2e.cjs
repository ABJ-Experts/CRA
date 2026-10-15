/**
 * Real SQL/GPG cleanup policy test. Run from repository root:
 * CRA_BACKUP_SCHEMA_SOURCE_CONTAINER=cra_m15_05_source_db node apps/infrastructure/tests/m15-05-cleanup.e2e.cjs
 * The source is read only (schema/role names, never rows or passwords). Every write,
 * synthetic certificate, deletion and audit receipt belongs to a fresh network-none
 * PostgreSQL 17.6 container and private temporary repository. This is not a restore drill.
 */
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const root = path.resolve(__dirname, "../../..");
process.env.TS_NODE_PROJECT = path.join(root, "apps/api/tsconfig.json");
require(
  path.join(root, "apps/api/node_modules/ts-node/register/transpile-only"),
);
const { NativeBackupCleanupAdapter, createCleanupRepositoryFactory } = require(
  path.join(
    root,
    "apps/api/src/backups/infrastructure/cleanup/native-backup-cleanup.adapter.ts",
  ),
);
const { EncryptedBackupRepository, backupDigest } = require(
  path.join(
    root,
    "apps/api/src/backups/infrastructure/repository/encrypted-backup.repository.ts",
  ),
);
const { MountedBackupWorkerRequests } = require(
  path.join(
    root,
    "apps/api/src/backups/infrastructure/backup-worker-requests.ts",
  ),
);
const source =
  process.env.CRA_BACKUP_SCHEMA_SOURCE_CONTAINER || "supabase_db_cra";
if (!/^[A-Za-z0-9_.-]{1,128}$/.test(source))
  throw Error("invalid_schema_source");
const directory = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "cra-m15-05-cleanup-")),
);
const task = crypto.randomUUID();
const profile = {
  task,
  name: `cra-m15-05-cleanup-${task}`,
  image: "public.ecr.aws/supabase/postgres:17.6.1.156",
  instanceId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  repositoryGeneration: crypto.randomUUID(),
};
const results = [];
let created = false;
let fixture, runtime;
const run = (args, input) =>
  cp.execFileSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
const sql = (query) =>
  run(
    [
      "exec",
      "-i",
      profile.name,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "cra_cleanup_admin",
      "-h",
      "/tmp",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    query,
  ).trim();
const sourceSql = (query) =>
  run(
    [
      "exec",
      "-i",
      source,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    query,
  ).trim();
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const control = (action, input) =>
  JSON.parse(
    sql(
      `set role cra_backup_control;select public.m15_05_backup_control('${fixture.instanceId}','cleanup-fixture',${literal(action)},${literal(JSON.stringify(input))}::jsonb)::text;`,
    ),
  );
const review = (id) => {
  const result = control("cleanup/review", { runId: id });
  assert.equal(result.outcome, "ok");
  return result.result;
};
const check = (scenario, condition) => {
  assert.ok(condition, scenario);
  results.push({ scenario, status: "passed" });
};
async function provision() {
  run([
    "run",
    "--pull=never",
    "--detach",
    "--name",
    profile.name,
    "--label",
    `cra.m15.cleanup=${task}`,
    "--network",
    "none",
    "--user",
    "100:101",
    "--tmpfs",
    "/tmp:rw,nosuid,size=1073741824",
    "--entrypoint",
    "/bin/bash",
    profile.image,
    "-c",
    "initdb -D /tmp/cleanup-pgdata -U cra_cleanup_admin --auth-local=trust --auth-host=reject >/dev/null && exec postgres -D /tmp/cleanup-pgdata -c listen_addresses='' -c unix_socket_directories=/tmp,/var/run/postgresql -c shared_preload_libraries=pg_net -c shared_buffers=16MB",
  ]);
  created = true;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      sql("select 1;");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (attempt === 119) throw Error("fresh_target_unavailable");
    }
  }
  const roles = JSON.parse(
    sourceSql(
      "select json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'replication',rolreplication,'bypass',rolbypassrls)) from pg_roles where rolname !~ '^pg_';",
    ),
  );
  for (const role of roles)
    sql(
      `create role ${identifier(role.name)} ${role.super ? "SUPERUSER" : "NOSUPERUSER"} ${role.inherit ? "INHERIT" : "NOINHERIT"} ${role.createrole ? "CREATEROLE" : "NOCREATEROLE"} ${role.createdb ? "CREATEDB" : "NOCREATEDB"} NOLOGIN ${role.replication ? "REPLICATION" : "NOREPLICATION"} ${role.bypass ? "BYPASSRLS" : "NOBYPASSRLS"};`,
    );
  const memberships = JSON.parse(
    sourceSql(
      "select coalesce(json_agg(json_build_array(r.rolname,m.rolname)),'[]') from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname !~ '^pg_';",
    ),
  );
  for (const [role, member] of memberships)
    sql(`grant ${identifier(role)} to ${identifier(member)};`);
  const dump = cp.spawn(
    "docker",
    [
      "exec",
      source,
      "pg_dump",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "--schema-only",
      "--lock-wait-timeout=5s",
      "-Fc",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const restore = cp.spawn(
    "docker",
    [
      "exec",
      "-i",
      profile.name,
      "pg_restore",
      "-U",
      "cra_cleanup_admin",
      "-h",
      "/tmp",
      "-d",
      "postgres",
      "--clean",
      "--if-exists",
      "--exit-on-error",
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  dump.stdout.pipe(restore.stdin);
  dump.stderr.resume();
  restore.stderr.resume();
  await Promise.all(
    [dump, restore].map(
      (child) =>
        new Promise((resolve, reject) => {
          child.once("error", () => reject(Error("schema_tool_unavailable")));
          child.once("close", (code) =>
            code === 0 ? resolve() : reject(Error("schema_copy_failed")),
          );
        }),
    ),
  );
}
async function certificates() {
  const repository = path.join(directory, "repository");
  fs.mkdirSync(repository, { mode: 0o700 });
  const key = path.join(directory, "current.key");
  const oldKey = path.join(directory, "historical.key");
  for (const file of [key, oldKey])
    fs.writeFileSync(file, crypto.randomBytes(48).toString("base64url"), {
      mode: 0o600,
    });
  const gpg = cp.execFileSync("which", ["gpg"], { encoding: "utf8" }).trim();
  runtime = {
    sources: {
      source: {
        databaseContainer: profile.name,
        databaseName: "postgres",
        databaseUser: "cra_cleanup_admin",
      },
    },
    repositories: {
      repository: {
        path: repository,
        generation: profile.repositoryGeneration,
        residency: "local",
        offHost: true,
      },
    },
    keys: {
      cleanup_key: { path: key, keyId: "cleanup_key" },
      cleanup_old: { path: oldKey, keyId: "cleanup_old" },
    },
    staging: {},
    gpgBinary: gpg,
  };
  const configuration = {
    sourceAlias: "source",
    repositoryAlias: "repository",
    stagingAlias: "stage",
    keyAlias: "cleanup_key",
    targetProfile: "isolated",
    residency: "local",
    schedulingEnabled: false,
    checkpointIntervalMinutes: 30,
    baseIntervalHours: 24,
    verificationIntervalDays: 30,
    retentionDays: 30,
    pauseLimitSeconds: 120,
  };
  const keyFilesById = Object.fromEntries(
    Object.values(runtime.keys).map((k) => [k.keyId, k.path]),
  );
  const repo = new EncryptedBackupRepository({
    repository,
    keyFile: key,
    keyId: "cleanup_key",
    keyFilesById,
    gpgBinary: gpg,
    maximumPartBytes: 64 * 1024 * 1024,
  });
  const historical = new EncryptedBackupRepository({
    repository,
    keyFile: oldKey,
    keyId: "cleanup_old",
    keyFilesById,
    gpgBinary: gpg,
    maximumPartBytes: 64 * 1024 * 1024,
  });
  const captures = [];
  for (let index = 0; index < 3; index++) {
    const id = crypto.randomUUID();
    const part = await (index === 1 ? historical : repo).sealPart(
      id,
      "base",
      "base.tar",
      Readable.from([
        Buffer.from(
          `Synthetic cleanup-policy fixture ${index}; not a physical PostgreSQL backup`,
        ),
      ]),
      AbortSignal.timeout(30000),
    );
    const inventory = {
      catalog: { fixtureOnly: true },
      auditHeads: [],
      objects: [],
      externalKeyChecks: [],
    };
    const unsigned = {
      formatVersion: 1,
      instanceId: profile.instanceId,
      runId: id,
      baseRunId: id,
      repositoryGeneration: profile.repositoryGeneration,
      configurationRevision: 1,
      keyId: "cleanup_key",
      capturedAt: "1900-01-01T00:00:00.000Z",
      checkpoint: {
        systemIdentifier: "123456789",
        timeline: 1,
        lsn: "0/1000000",
        postgresVersion: "17.6",
        restorePoint: "cra_backup_" + id.replaceAll("-", ""),
      },
      parts: [part],
      inventoryDigest: backupDigest(inventory),
      auditHeadsDigest: backupDigest([]),
    };
    const certificate = {
      ...unsigned,
      certificateDigest: backupDigest(unsigned),
    };
    await repo.sealCertificate(
      certificate,
      inventory,
      AbortSignal.timeout(30000),
    );
    captures.push({
      id,
      verificationId: crypto.randomUUID(),
      certificate: new MountedBackupWorkerRequests(runtime).captured({
        certificate,
        bytes: part.bytes,
        objectCount: 0,
        durationMs: 1,
      }),
      nativeCertificate: certificate,
    });
  }
  fixture = {
    instanceId: profile.instanceId,
    organizationId: profile.organizationId,
    configuration,
    captures,
  };
  run(
    [
      "exec",
      "-i",
      profile.name,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "cra_cleanup_admin",
      "-h",
      "/tmp",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "fixture=" + JSON.stringify(fixture),
    ],
    fs.readFileSync(
      path.join(__dirname, "fixtures/m15-05-cleanup-fixture.sql"),
    ),
  );
}
async function claim(id) {
  const current = review(id);
  assert.equal(current.eligible, true, JSON.stringify(current.blockers));
  const key = crypto.randomUUID();
  assert.equal(
    control("cleanup/request", {
      runId: id,
      expectedVersion: current.version,
      idempotencyKey: key,
      reviewFingerprint: current.reviewFingerprint,
    }).outcome,
    "ok",
  );
  const claimed = control("cleanup/claim", { workerId: "cleanup_test" });
  assert.equal(claimed.outcome, "ok");
  return {
    instanceId: fixture.instanceId,
    runId: id,
    actor: "cleanup-fixture",
    workerId: "cleanup_test",
    expectedVersion: claimed.result.run.version,
    reviewFingerprint: current.reviewFingerprint,
    idempotencyKey: key,
    sourceAlias: "source",
    repositoryAlias: "repository",
  };
}
async function exercise() {
  const capture = fixture.captures[0];
  check(
    "retained_verification_blocks_capture",
    review(capture.id).blockers.includes("required_dependency"),
  );
  sql(
    `update public.retention_authority_states set available=false where organization_id='${fixture.organizationId}' and authority_kind='legal_hold'`,
  );
  check(
    "unknown_authority_blocks_cleanup",
    review(capture.verificationId).blockers.includes("authority_unknown"),
  );
  sql(
    `update public.retention_authority_states set available=true where organization_id='${fixture.organizationId}' and authority_kind='legal_hold'`,
  );
  const hold = crypto.randomUUID();
  sql(
    `insert into public.retention_authoritative_facts(organization_id,evidence_class,reason_kind,source_record_id,required_retention_days,protect_through,active) values('${fixture.organizationId}','m15_cleanup_fixture','legal_hold','${hold}',30,clock_timestamp()+interval '1 day',true)`,
  );
  check(
    "active_hold_blocks_cleanup",
    review(capture.verificationId).blockers.includes("legal_hold"),
  );
  sql(
    `update public.retention_authoritative_facts set active=false where organization_id='${fixture.organizationId}' and source_record_id='${hold}'`,
  );
  const adapter = new NativeBackupCleanupAdapter(runtime);
  const child = await adapter.cleanup(
    await claim(capture.verificationId),
    AbortSignal.timeout(40000),
  );
  check(
    "verification_cleanup_is_metadata_only",
    child.cleanup.state === "deleted" &&
      fs.existsSync(
        path.join(
          runtime.repositories.repository.path,
          "certificates",
          capture.id + ".json",
        ),
      ),
  );
  const request = await claim(capture.id);
  const preserve = fixture.captures[1].nativeCertificate.parts[0];
  const preservePath = path.join(
    runtime.repositories.repository.path,
    "parts",
    preserve.id + ".gpg",
  );
  const bytes = fs.readFileSync(preservePath);
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 1] ^= 1;
  fs.writeFileSync(preservePath, corrupt);
  await assert.rejects(
    adapter.cleanup(request, AbortSignal.timeout(40000)),
    /cleanup_failed/,
  );
  check(
    "corrupt_remaining_chain_blocks_deletion",
    fs.existsSync(
      path.join(
        runtime.repositories.repository.path,
        "certificates",
        capture.id + ".json",
      ),
    ),
  );
  fs.writeFileSync(preservePath, bytes);
  const historical = runtime.keys.cleanup_old.path;
  const historicalKey = fs.readFileSync(historical);
  fs.renameSync(historical, historical + ".held");
  await assert.rejects(
    adapter.cleanup(request, AbortSignal.timeout(40000)),
    /cleanup_failed/,
  );
  check(
    "missing_historical_key_blocks_deletion",
    fs.existsSync(
      path.join(
        runtime.repositories.repository.path,
        "certificates",
        capture.id + ".json",
      ),
    ),
  );
  fs.renameSync(historical + ".held", historical);
  fs.writeFileSync(historical, crypto.randomBytes(48).toString("base64url"));
  await assert.rejects(
    adapter.cleanup(request, AbortSignal.timeout(40000)),
    /cleanup_failed/,
  );
  check(
    "wrong_historical_key_blocks_deletion",
    fs.existsSync(
      path.join(
        runtime.repositories.repository.path,
        "certificates",
        capture.id + ".json",
      ),
    ),
  );
  fs.writeFileSync(historical, historicalKey);
  const factory = createCleanupRepositoryFactory(runtime);
  let raced = false;
  const guarded = new NativeBackupCleanupAdapter(runtime, async (alias) => {
    const repository = await factory(alias);
    return {
      recover: (...args) => repository.recover(...args),
      prepare: async (input, signal, authority) => {
        const prepared = await repository.prepare(input, signal, authority);
        try {
          sql(
            `begin;set local lock_timeout='150ms';select public.m15_01_lock('${fixture.organizationId}');insert into public.retention_authoritative_facts(organization_id,evidence_class,reason_kind,source_record_id,required_retention_days,protect_through,active) values('${fixture.organizationId}','m15_cleanup_fixture','legal_hold','${crypto.randomUUID()}',30,clock_timestamp()+interval '1 day',true);commit;`,
          );
          throw Error("hold_lock_not_held");
        } catch (error) {
          if (!String(error.stderr || "").includes("lock timeout")) throw error;
          raced = true;
        }
        return prepared;
      },
    };
  });
  const completed = await guarded.cleanup(request, AbortSignal.timeout(40000));
  check("concurrent_hold_writer_waits_for_cleanup_commit", raced);
  check(
    "audited_native_cleanup_deletes_only_reviewed_ciphertext",
    completed.cleanup.state === "deleted" &&
      !fs.existsSync(
        path.join(
          runtime.repositories.repository.path,
          "certificates",
          capture.id + ".json",
        ),
      ),
  );
  check(
    "two_remaining_independent_chains_preserved",
    fixture.captures
      .slice(1)
      .every(
        (c) =>
          fs.existsSync(
            path.join(
              runtime.repositories.repository.path,
              "certificates",
              c.id + ".json",
            ),
          ) &&
          c.nativeCertificate.parts.every((p) =>
            fs.existsSync(
              path.join(
                runtime.repositories.repository.path,
                "parts",
                p.id + ".gpg",
              ),
            ),
          ),
      ),
  );
  check(
    "last_two_verified_chains_cannot_be_cleaned",
    review(fixture.captures[1].id).blockers.includes("last_recoverable_chain"),
  );
  const audit = JSON.parse(
    sql(
      `select json_build_object('authorized',count(*)filter(where action='backup.cleanup_authorized'),'completed',count(*)filter(where action='backup.cleanup_completed'),'hashBound',bool_and(after_redacted->>'sha256'~'^[a-f0-9]{64}$'))::text from public.audit_logs where entity_id in ('${capture.id}','${capture.verificationId}') and action in ('backup.cleanup_authorized','backup.cleanup_completed')`,
    ),
  );
  check(
    "critical_cleanup_receipts_are_durable_and_hash_bound",
    audit.authorized === 2 && audit.completed === 2 && audit.hashBound === true,
  );
  return {
    fixtureOnly: true,
    physicalRecoveryClaim: false,
    postgresVersion: sql("show server_version"),
    sourceRowsCopied: 0,
    scenarios: results,
  };
}
(async () => {
  try {
    await provision();
    await certificates();
    console.log(JSON.stringify(await exercise(), null, 2));
  } finally {
    if (created) {
      const label = run([
        "inspect",
        "--format",
        '{{index .Config.Labels "cra.m15.cleanup"}}',
        profile.name,
      ]).trim();
      assert.equal(label, task, "owned_container_required");
      run(["rm", "--force", profile.name]);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(
    "backup_cleanup_test_failed:" +
      (typeof error.code === "string" ? error.code : "fixture_failed"),
  );
  process.exitCode = 1;
});
