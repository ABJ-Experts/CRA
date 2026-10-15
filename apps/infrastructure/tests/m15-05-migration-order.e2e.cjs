/** Ordered additive migration regression. No existing database writes.
 * Run from repository root: node apps/infrastructure/tests/m15-05-migration-order.e2e.cjs
 * Reads schema and nonsecret role definitions only, creates an exclusive PG17.6
 * network-none tmpfs target, applies the three M15-05 migrations in order and runs
 * rollback-only SQL suites. Removes only its labelled container and temp directory.
 */
const cp = require("node:child_process"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const dir = fs.mkdtempSync(
  path.join(require("node:os").tmpdir(), "cra-m15-05-ordered-"),
);
let created = false;
const previous = {
  instanceId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  repositoryGeneration: crypto.randomUUID(),
};
const task = crypto.randomUUID(),
  name = "cra-m15-05-ordered-" + task,
  image = "public.ecr.aws/supabase/postgres:17.6.1.156";
const run = (args, input) =>
  cp.execFileSync("docker", args, {
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
const sql = (container, query, user = "cra_cleanup_admin") =>
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      user,
      "-h",
      "/tmp",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    query,
  );
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../..");
async function exercise(profile, source) {
  const sql = (q) =>
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
      q,
    );
  sql("alter database postgres owner to postgres;");
  assert.equal(sql("select count(*) from public.organizations;").trim(), "0");
  sql(`do $outer$ declare d text;b text;f record;begin
select pg_get_functiondef(oid),prosrc into d,b from pg_proc where oid='public.m12_06_feed_rows(uuid,uuid)'::regprocedure;
execute replace(d,b,replace(b,E'\\n union all select * from public.m15_05_feed_rows(p_organization_id,p_actor_user_id)\\n',''));
for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'm15_05_%' loop execute format('drop function if exists %s cascade',f.sig);end loop;
end $outer$;
drop table if exists public.backup_runs cascade;drop table if exists public.backup_policies cascade;do $$begin if exists(select 1 from pg_roles where rolname='cra_backup_control') then drop owned by cra_backup_control;drop role cra_backup_control;end if;end $$;`);
  for (const file of [
    "20261014112426_m15_05_encrypted_backups.sql",
    "20261014171300_m15_05_backup_validation_contract.sql",
    "20261015052219_m15_05_capture_assurance_projection.sql",
  ])
    sql(
      "set role postgres;begin;\n" +
        fs.readFileSync(
          path.join(root, "apps/infrastructure/supabase/migrations", file),
          "utf8",
        ) +
        "\ncommit;",
    );
  const tests = fs
    .readdirSync("apps/infrastructure/tests")
    .filter((f) => /^m15-05-.*\.test\.sql$/.test(f));
  let assertions = 0;
  for (const file of tests) {
    const out = sql(
      fs.readFileSync(
        path.join(root, "apps/infrastructure/tests", file),
        "utf8",
      ),
    );
    if (/not ok|Looks like you failed|Looks like you planned/.test(out))
      throw Error("ordered_test_failed:" + file + "\n" + out);
    assertions += (out.match(/^ok \d+/gm) || []).length;
  }
  const local = cp
    .execFileSync(
      "docker",
      [
        "exec",
        source,
        "psql",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-At",
        "-c",
        "select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by proname)) from pg_proc where pronamespace='public'::regnamespace and proname like 'm15_05_%';",
      ],
      { encoding: "utf8" },
    )
    .trim();
  const target = sql(
    "select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by proname)) from pg_proc where pronamespace='public'::regnamespace and proname like 'm15_05_%';",
  ).trim();
  assert.equal(target, local);
  const result = {
    target: profile.name,
    network: "none",
    sourceRowsCopied: 0,
    migrationsAppliedInOrder: 3,
    sqlSuites: tests.length,
    assertions,
    canonicalFunctionDigest: target,
    canonicalParity: true,
    syntheticFixtureOnly: true,
  };
  fs.writeFileSync(
    path.join(dir, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
(async () => {
  run([
    "run",
    "--pull=never",
    "--detach",
    "--name",
    name,
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
    image,
    "-c",
    "initdb -D /tmp/cleanup-pgdata -U cra_cleanup_admin --auth-local=trust --auth-host=reject >/dev/null && exec postgres -D /tmp/cleanup-pgdata -c listen_addresses='' -c unix_socket_directories=/tmp -c shared_preload_libraries='pg_net' -c shared_buffers=16MB",
  ]);
  created = true;
  fs.writeFileSync(
    path.join(dir, "profile.private.json"),
    JSON.stringify(
      {
        task,
        name,
        image,
        instanceId: previous.instanceId,
        organizationId: previous.organizationId,
        repositoryGeneration: previous.repositoryGeneration,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  for (let n = 0; n < 120; n++) {
    try {
      sql(name, "select 1;");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
      if (n === 119) throw Error("fresh_target_unavailable");
    }
  }
  const source =
    process.env.CRA_BACKUP_SCHEMA_SOURCE_CONTAINER || "supabase_db_cra";
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(source)) throw Error("invalid_source");
  const sourceSql = (q) =>
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
      q,
    );
  const roles = JSON.parse(
    sourceSql(
      "select json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls)) from pg_roles where rolname !~ '^pg_';",
    ),
  );
  for (const r of roles) {
    const ident = '"' + r.name.replaceAll('"', '""') + '"';
    sql(
      name,
      `create role ${ident} ${r.super ? "SUPERUSER" : "NOSUPERUSER"} ${r.inherit ? "INHERIT" : "NOINHERIT"} ${r.createrole ? "CREATEROLE" : "NOCREATEROLE"} ${r.createdb ? "CREATEDB" : "NOCREATEDB"} NOLOGIN ${r.replication ? "REPLICATION" : "NOREPLICATION"} ${r.bypass ? "BYPASSRLS" : "NOBYPASSRLS"};`,
    );
  }
  const memberships = JSON.parse(
    sourceSql(
      "select coalesce(json_agg(json_build_array(r.rolname,m.rolname,a.admin_option,a.inherit_option,a.set_option)),'[]') from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname !~ '^pg_';",
    ),
  );
  for (const [role, member, admin, inherit, set] of memberships)
    sql(
      name,
      `grant "${role.replaceAll('"', '""')}" to "${member.replaceAll('"', '""')}" with admin ${admin};grant "${role.replaceAll('"', '""')}" to "${member.replaceAll('"', '""')}" with inherit ${inherit};grant "${role.replaceAll('"', '""')}" to "${member.replaceAll('"', '""')}" with set ${set};`,
    );
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
      "-Fc",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const restore = cp.spawn(
    "docker",
    [
      "exec",
      "-i",
      name,
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
  let error = "";
  dump.stderr.on("data", (b) => {
    error += b;
  });
  restore.stderr.on("data", (b) => {
    error += b;
  });
  await Promise.all([
    new Promise((ok, no) =>
      dump.on("exit", (c) =>
        c === 0 ? ok() : no(Error("schema_read_failed")),
      ),
    ),
    new Promise((ok, no) =>
      restore.on("exit", (c) =>
        c === 0 ? ok() : no(Error("schema_import_failed")),
      ),
    ),
  ]);
  await exercise({ task, name }, source);
})()
  .catch((e) => {
    console.error(
      "ordered_migration_test_failed:" + String(e.message).split("\n")[0],
    );
    process.exitCode = 1;
  })
  .finally(() => {
    if (created) {
      const label = run([
        "inspect",
        "--format",
        '{{index .Config.Labels "cra.m15.cleanup"}}',
        name,
      ]).trim();
      if (label !== task) throw Error("owned_target_required");
      run(["rm", "--force", name]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
