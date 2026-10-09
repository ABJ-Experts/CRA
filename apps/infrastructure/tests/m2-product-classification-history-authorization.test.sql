-- Read authorization is rechecked inside the database, including service-role callers.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.check(label text, passed boolean) returns void language plpgsql as $$
begin if passed is not true then raise exception 'FAIL %',label; end if; raise notice 'ok %',label; end $$;
select pg_temp.check('scoped history RPC exists',to_regprocedure('public.get_product_classification_history(uuid,uuid,uuid,integer,integer)') is not null);
select pg_temp.check('history RPC only executable by service role',has_function_privilege('service_role','public.get_product_classification_history(uuid,uuid,uuid,integer,integer)','execute')
  and not has_function_privilege('authenticated','public.get_product_classification_history(uuid,uuid,uuid,integer,integer)','execute')
  and not has_function_privilege('anon','public.get_product_classification_history(uuid,uuid,uuid,integer,integer)','execute'));
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_viewer uuid;
  v_entity uuid;
  v_product uuid:=gen_random_uuid();
  v_policy jsonb:=public.m2_classification_policy();
  v_saved record;
  v_read record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_viewer from public.users where email='viewer@cra.test';
  select id into v_entity from public.organization_legal_entities where organization_id=v_org and is_default;
  insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
  values(v_product,v_org,v_entity,0,'{}','Classification history authorization','HISTORY-'||v_product,'standalone_software',v_actor,v_actor,v_actor);
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,15);
  perform pg_temp.check('empty history has bounded valid page',v_read.outcome='found' and v_read.history->'latest'='null'::jsonb
    and v_read.history->>'productVersion'='0' and v_read.history->'runs'='{"rows":[],"page":1,"pageSize":15,"total":0,"pageCount":1}'::jsonb);
  select * into v_saved from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',
    '{"scope":"undetermined","criticalCoreFunction":null,"classIICoreFunction":null,"classICoreFunction":null}','Read authorization fixture',gen_random_uuid());
  execute 'set local role service_role';
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,1);
  execute 'reset role';
  perform pg_temp.check('history returns exact full immutable run',v_read.outcome='found' and v_read.history->'latest'=v_saved.run
    and v_read.history->'runs'->'rows'->0=v_saved.run and v_read.history->'runs'->>'total'='1');
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,2,1);
  perform pg_temp.check('out of range page empty but latest retained',v_read.outcome='found' and v_read.history->'latest'=v_saved.run
    and v_read.history->'runs'->'rows'='[]'::jsonb and v_read.history->'runs'->>'pageCount'='1');
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,gen_random_uuid(),1,15);
  perform pg_temp.check('foreign or missing product denied',v_read.outcome='not_found' and v_read.history is null);
  select * into v_read from public.get_product_classification_history(gen_random_uuid(),v_viewer,v_product,1,15);
  perform pg_temp.check('tenant substitution denied',v_read.outcome in ('not_found','forbidden') and v_read.history is null);
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,0,15);
  perform pg_temp.check('invalid page denied',v_read.outcome='invalid_request');
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,101);
  perform pg_temp.check('oversized page denied',v_read.outcome='invalid_request');
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,100001,15);
  perform pg_temp.check('oversized page number denied',v_read.outcome='invalid_request');
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,null,15);
  perform pg_temp.check('null pagination denied',v_read.outcome='invalid_request');
  insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_org,'viewer','{"can_view_products":false}')
    on conflict(organization_id,base_role) do update set permissions=excluded.permissions;
  execute 'set local role service_role';
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,15);
  execute 'reset role';
  perform pg_temp.check('revoked read permission denied in database',v_read.outcome='forbidden' and v_read.history is null);
  delete from public.base_role_permission_overrides where organization_id=v_org and base_role='viewer';
  update public.users set is_active=false where id=v_viewer;
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,15);
  perform pg_temp.check('inactive actor denied in database',v_read.outcome='forbidden' and v_read.history is null);
  update public.users set is_active=true where id=v_viewer;
  update public.products set archived_at=clock_timestamp() where id=v_product;
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,15);
  perform pg_temp.check('archived retained history readable',v_read.outcome='found' and v_read.history->'latest'=v_saved.run);
  update public.organization_lifecycles set status='deactivated' where organization_id=v_org;
  select * into v_read from public.get_product_classification_history(v_org,v_viewer,v_product,1,15);
  perform pg_temp.check('inactive tenant lifecycle denied',v_read.outcome='not_found' and v_read.history is null);
end $$;
rollback;
