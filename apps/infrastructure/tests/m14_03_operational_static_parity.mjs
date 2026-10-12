import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";

// Type-only source imports disappear. Evaluate these pure, source-owned catalogues
// through the installed compiler, so the parity gate also works on Node 20.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(resolve(root, "apps/api/package.json"));
const ts = require("typescript");
function sourceExports(path) {
  const source = readFileSync(resolve(root, path), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const result = {};
  runInNewContext(
    code,
    { exports: result, Object, Set, Map },
    { timeout: 1_000 },
  );
  return result;
}
const { CONNECTOR_CATALOGUE } = sourceExports(
  "apps/api/src/connectors/application/connector-catalogue.ts",
);
const { PERMISSION_KEYS, DEFAULT_PERMISSIONS_BY_ROLE } = sourceExports(
  "packages/contracts/src/permissions.ts",
);
const permissionRows = PERMISSION_KEYS.map((permissionKey) => ({
  permissionKey,
  ...Object.fromEntries(
    ["owner", "admin", "member", "viewer"].map((role) => [
      role,
      DEFAULT_PERMISSIONS_BY_ROLE[role][permissionKey] === true,
    ]),
  ),
}));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const digest = (rows) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(rows)))
    .digest("hex");
const catalogHash = digest(CONNECTOR_CATALOGUE);
const permissionHash = digest(permissionRows);
const literal = (rows) =>
  "'" + JSON.stringify(rows).replaceAll("'", "''") + "'::jsonb";
const sql = `-- Generated from the source-owned connector catalogue and permission defaults.
-- Regenerate with tests/m14_03_operational_static_parity.mjs --write <new CLI migration>.
-- This does not create a table, duplicate credentials, or accept browser-supplied rows.
create or replace function public.m14_03_static_catalog_version() returns text language sql immutable
set search_path=public,pg_temp as $$ select '${catalogHash}'::text $$;
create or replace function public.m14_03_static_permissions_version() returns text language sql immutable
set search_path=public,pg_temp as $$ select '${permissionHash}'::text $$;
create or replace function public.m14_03_static_catalog_rows() returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language sql immutable set search_path=public,pg_temp as $$
 select item->>'id',public.m14_03_static_catalog_version(),null::uuid,item
 from jsonb_array_elements(${literal(CONNECTOR_CATALOGUE)}) with ordinality items(item,ordinal)
 order by ordinal
$$;
create or replace function public.m14_03_static_permission_rows(p_org uuid) returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.item->>'permissionKey',public.m14_03_static_permissions_version(),null::uuid,
 jsonb_build_object('permissionKey',r.item->>'permissionKey',
  'owner',coalesce((o.permissions->> (r.item->>'permissionKey'))::boolean,(r.item->>'owner')::boolean),
  'admin',coalesce((a.permissions->> (r.item->>'permissionKey'))::boolean,(r.item->>'admin')::boolean),
  'member',coalesce((m.permissions->> (r.item->>'permissionKey'))::boolean,(r.item->>'member')::boolean),
  'viewer',coalesce((v.permissions->> (r.item->>'permissionKey'))::boolean,(r.item->>'viewer')::boolean))
 from jsonb_array_elements(${literal(permissionRows)}) with ordinality r(item,ordinal)
 left join public.base_role_permission_overrides o on o.organization_id=p_org and o.base_role='owner'
 left join public.base_role_permission_overrides a on a.organization_id=p_org and a.base_role='admin'
 left join public.base_role_permission_overrides m on m.organization_id=p_org and m.base_role='member'
 left join public.base_role_permission_overrides v on v.organization_id=p_org and v.base_role='viewer'
 order by r.ordinal
$$;
do $grants$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in ('m14_03_static_catalog_version','m14_03_static_permissions_version','m14_03_static_catalog_rows','m14_03_static_permission_rows') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $grants$;
`;
if (process.argv[2] === "--write") {
  if (!process.argv[3])
    throw new Error("Pass the new CLI-created migration path.");
  writeFileSync(resolve(root, process.argv[3]), sql);
  console.log("Generated canonical static export projections.");
} else if (process.argv[2] === "--check") {
  const path =
    process.argv[3] ??
    "apps/infrastructure/supabase/migrations/20261009113438_m14_03_operational_static_sources.sql";
  if (readFileSync(resolve(root, path), "utf8") !== sql)
    throw new Error(
      "M14-03 generated static migration differs from source-owned catalogues.",
    );
  console.log("M14-03 static migration matches source-owned catalogues.");
} else {
  // Only metadata hashes leave PostgreSQL. No tenant rows, overrides or user data.
  const result = spawnSync(
    "docker",
    [
      "exec",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "select jsonb_build_object('catalogVersion',public.m14_03_static_catalog_version(),'permissionVersion',public.m14_03_static_permissions_version(),'catalog',(select jsonb_agg(row_values) from public.m14_03_static_catalog_rows()),'permissions',(select jsonb_agg(row_values) from public.m14_03_static_permission_rows(null)))",
    ],
    { encoding: "utf8" },
  );
  const live = result.status === 0 ? JSON.parse(result.stdout.trim()) : null;
  if (
    !live ||
    live.catalogVersion !== catalogHash ||
    live.permissionVersion !== permissionHash ||
    digest(live.catalog) !== catalogHash ||
    digest(live.permissions) !== permissionHash
  ) {
    throw new Error(
      "M14-03 static projection drift: apply the generated source migration before enabling exports.",
    );
  }
  console.log(
    "M14-03 catalogue and permission projections match canonical sources.",
  );
}
