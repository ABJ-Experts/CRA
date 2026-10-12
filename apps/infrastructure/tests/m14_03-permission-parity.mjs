import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { defaultPermissionsFor, resolveEffectivePermissions } from "../../../packages/contracts/dist/permissions.js";
const scenarios = [
  ...["owner", "admin", "member", "viewer"].map((baseRole) => ({ baseRole })),
  { baseRole: "viewer", customRoles: [{ base_role: "owner", permissions: { can_export_evidence: true }, is_active: true, is_deleted: false }] },
  { baseRole: "viewer", customRoles: [{ base_role: "owner", permissions: {}, is_active: true, is_deleted: false }] },
  { baseRole: "viewer", customRoles: [{ permissions: { can_export_evidence: true }, is_active: false, is_deleted: false }] },
  { baseRole: "member", customRoles: [{ permissions: { can_export_suppliers: true }, is_active: true, is_deleted: false }], baseRoleOverrides: { can_view_suppliers: false, can_export_suppliers: false } },
];
const literal = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const checks = scenarios.map((scenario, index) => {
 const expected = resolveEffectivePermissions(scenario);
 const custom = scenario.customRoles?.[0];
 return `update public.organization_members set role='${scenario.baseRole}' where organization_id=v_org and user_id=v_actor;
 update public.custom_roles set permissions=${literal(custom?.permissions ?? {})},base_role='${custom?.base_role ?? "member"}',is_active=${custom?.is_active ?? false},is_deleted=${custom?.is_deleted ?? false} where id=v_role;
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_org,'${scenario.baseRole}',${literal(scenario.baseRoleOverrides ?? {})}) on conflict(organization_id,base_role) do update set permissions=excluded.permissions;
 for v_key,v_expected in select key,value from jsonb_each(${literal(expected)}) loop
  if public.m14_03_actor_can(v_org,v_actor,v_key) is distinct from (v_expected#>>'{}')::boolean then raise exception 'permission parity scenario ${index}: %',v_key; end if;
 end loop;`;
});
const sql = `begin;
set local statement_timeout='30s';
do $$ declare v_org uuid:=gen_random_uuid();v_role uuid:=gen_random_uuid();v_actor uuid;v_key text;v_expected jsonb;begin
 select user_id into strict v_actor from public.organization_members where role='owner' limit 1;
 insert into public.organizations(id,name,slug) values(v_org,'M14 permission rollback fixture','m14-perms-'||v_org);
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner');
 insert into public.custom_roles(id,organization_id,name,permissions) values(v_role,v_org,'M14 fixture','{}');
 insert into public.user_role_assignments(organization_id,user_id,role_id) values(v_org,v_actor,v_role);
 ${checks.join("\n")}
 if public.m14_03_actor_can(v_org,v_actor,'can_export_unknown') then raise exception 'unknown permission accepted';end if;
end $$;
rollback;`;
assert.equal(Object.keys(defaultPermissionsFor("owner")).length > 100, true);
const result = spawnSync("docker", ["exec", "-i", "supabase_db_cra", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
console.log(`M14 permission parity passed: ${scenarios.length} scenarios against all contract permission keys.`);
