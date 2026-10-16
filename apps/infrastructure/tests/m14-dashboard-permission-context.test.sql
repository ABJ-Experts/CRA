-- Read-only dashboard permission snapshot: all synthetic setup rolls back.
begin;
create extension if not exists pgtap;
select plan(7);
do $$begin if to_regprocedure('public.get_dashboard_permission_context(uuid,uuid,text)') is null then raise exception 'M14 permission context RPC absent';end if;end$$;
select ok(not has_function_privilege('anon','public.get_dashboard_permission_context(uuid,uuid,text)','execute'),'anonymous execution denied');
select ok(not has_function_privilege('authenticated','public.get_dashboard_permission_context(uuid,uuid,text)','execute'),'browser execution denied');
select ok(has_function_privilege('service_role','public.get_dashboard_permission_context(uuid,uuid,text)','execute'),'service role execution granted');
select ok((select provolatile='s' from pg_proc where oid='public.get_dashboard_permission_context(uuid,uuid,text)'::regprocedure),'context uses one stable read snapshot');
select ok((select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_dashboard_permission_context(uuid,uuid,text)'::regprocedure),'context pins search path');
select is(public.get_dashboard_permission_context(gen_random_uuid(),gen_random_uuid(),'owner')->>'outcome','not_found','unknown scope is concealed');
select is(public.get_dashboard_permission_context(null,null,null)->>'outcome','not_found','null identity fails closed');
create or replace function pg_temp.context_check(label text,valid boolean)returns void language plpgsql as $$begin if not coalesce(valid,false)then raise exception 'M14 context check failed: %',label;end if;raise notice 'M14 context verified: %',label;end$$;
do $$declare o uuid:=gen_random_uuid();other uuid:=gen_random_uuid();u uuid:=gen_random_uuid();r uuid:=gen_random_uuid();inactive uuid:=gen_random_uuid();deleted uuid:=gen_random_uuid();foreign_role uuid:=gen_random_uuid();j jsonb;prior_version bigint;current_version bigint;before_audit bigint;begin
insert into public.users(id,email)values(u,'m14-context-'||u||'@example.invalid');
insert into public.organizations(id,name,slug)values(o,'M14 rollback context','m14-context-'||o),(other,'M14 rollback foreign context','m14-context-'||other);
insert into public.organization_members(organization_id,user_id,role)values(o,u,'viewer');
insert into public.custom_roles(id,organization_id,name,base_role,permissions,is_active,is_deleted,deleted_at)values
(r,o,'M14 additive','owner','{"can_view_findings":true,"can_export_audit":false}',true,false,null),
(inactive,o,'M14 inactive','member','{"can_edit_products":true}',false,false,null),
(deleted,o,'M14 deleted','member','{"can_delete_products":true}',true,true,statement_timestamp()),
(foreign_role,other,'M14 foreign','owner','{"can_edit_connectors":true}',true,false,null);
insert into public.user_role_assignments(organization_id,user_id,role_id)values(o,u,r),(o,u,inactive),(o,u,deleted);
insert into public.base_role_permission_overrides(organization_id,base_role,permissions)values(o,'viewer','{"can_view_findings":false,"can_view_dashboards":true}');
select version into prior_version from public.organization_permissions_version where organization_id=o;
j:=public.get_dashboard_permission_context(o,u,'viewer');
perform pg_temp.context_check('current verified scope available',j->>'outcome'='available'and j#>>'{context,organizationId}'=o::text and j#>>'{context,userId}'=u::text and j#>>'{context,role}'='viewer');
perform pg_temp.context_check('version is authoritative',(j#>>'{context,permissionVersion}')::bigint=prior_version);
perform pg_temp.context_check('all assigned flags retained for unchanged resolver',jsonb_array_length(j#>'{context,customRoles}')=3 and exists(select 1 from jsonb_array_elements(j#>'{context,customRoles}')x where x->>'id'=inactive::text and x->>'is_active'='false')and exists(select 1 from jsonb_array_elements(j#>'{context,customRoles}')x where x->>'id'=deleted::text and x->>'is_deleted'='true'));
perform pg_temp.context_check('custom base-role remains label',exists(select 1 from jsonb_array_elements(j#>'{context,customRoles}')x where x->>'id'=r::text and x->>'base_role'='owner'and x->'permissions'='{"can_view_findings":true,"can_export_audit":false}'::jsonb));
perform pg_temp.context_check('hard override retained exactly',j#>'{context,baseRoleOverrides}'='{"can_view_findings":false,"can_view_dashboards":true}'::jsonb);
perform pg_temp.context_check('foreign role not leaked',not exists(select 1 from jsonb_array_elements(j#>'{context,customRoles}')x where x->>'id'=foreign_role::text));
perform pg_temp.context_check('verified role mismatch conceals all fields',public.get_dashboard_permission_context(o,u,'owner')='{"outcome":"not_found"}'::jsonb);
update public.organization_members set role='admin'where organization_id=o and user_id=u;
perform pg_temp.context_check('current role change rejects old verified role',public.get_dashboard_permission_context(o,u,'viewer')='{"outcome":"not_found"}'::jsonb and public.get_dashboard_permission_context(o,u,'admin')->>'outcome'='available');
update public.organization_members set role='viewer'where organization_id=o and user_id=u;
select version into prior_version from public.organization_permissions_version where organization_id=o;
perform pg_temp.context_check('invalid expected role denied',public.get_dashboard_permission_context(o,u,'root')='{"outcome":"not_found"}'::jsonb);
perform pg_temp.context_check('foreign membership denied',public.get_dashboard_permission_context(other,u,'viewer')='{"outcome":"not_found"}'::jsonb);
select count(*)into before_audit from public.audit_logs;
perform public.get_dashboard_permission_context(o,u,'viewer');perform public.get_dashboard_permission_context(o,u,'viewer');
perform pg_temp.context_check('context read creates no audit/source effects',(select count(*)from public.audit_logs)=before_audit and(select version from public.organization_permissions_version where organization_id=o)=prior_version);
update public.base_role_permission_overrides set permissions='{"can_view_findings":true}'where organization_id=o and base_role='viewer';
select version into current_version from public.organization_permissions_version where organization_id=o;j:=public.get_dashboard_permission_context(o,u,'viewer');
perform pg_temp.context_check('committed-context invalidation version and inputs agree',current_version>prior_version and(j#>>'{context,permissionVersion}')::bigint=current_version and j#>'{context,baseRoleOverrides}'='{"can_view_findings":true}'::jsonb);
delete from public.user_role_assignments where organization_id=o and user_id=u;delete from public.base_role_permission_overrides where organization_id=o;
j:=public.get_dashboard_permission_context(o,u,'viewer');perform pg_temp.context_check('unassigned and missing overrides stay empty',j#>'{context,customRoles}'='[]'::jsonb and j#>'{context,baseRoleOverrides}'='{}'::jsonb);
update public.users set is_active=false where id=u;perform pg_temp.context_check('revoked identity denied',public.get_dashboard_permission_context(o,u,'viewer')='{"outcome":"not_found"}'::jsonb);update public.users set is_active=true where id=u;
update public.organizations set is_active=false where id=o;perform pg_temp.context_check('inactive organization denied',public.get_dashboard_permission_context(o,u,'viewer')='{"outcome":"not_found"}'::jsonb);update public.organizations set is_active=true where id=o;
update public.organization_permissions_version set version=0 where organization_id=o;perform pg_temp.context_check('nonpositive version fails closed',public.get_dashboard_permission_context(o,u,'viewer')='{"outcome":"unavailable"}'::jsonb);
update public.organization_permissions_version set version=9007199254740992 where organization_id=o;perform pg_temp.context_check('unsafe integer version fails closed',public.get_dashboard_permission_context(o,u,'viewer')='{"outcome":"unavailable"}'::jsonb);
delete from public.organization_permissions_version where organization_id=o;perform pg_temp.context_check('missing version unavailable without inputs',public.get_dashboard_permission_context(o,u,'viewer')='{"outcome":"unavailable"}'::jsonb);
end$$;
select *from finish();rollback;
