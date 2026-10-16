-- M11-01 review hardening: replay the original successful safe wire projection,
-- never a newer configuration. Pre-cutover commands without a projection retain
-- the old current-row fallback; newly completed commands always record one.
do $$
declare v_definition text; v_oid regprocedure; v_anchor text;
begin
 foreach v_oid in array array[
  'public.m11_execute_connector_command_atomic(uuid,uuid,uuid,text,integer,uuid,text,text,bigint,jsonb)'::regprocedure,
  'public.m11_begin_connector_test_atomic(uuid,uuid,uuid,integer,uuid,text,text,bigint)'::regprocedure,
  'public.m11_finalize_connector_test_atomic(uuid,uuid,uuid,bigint,integer,integer,jsonb)'::regprocedure
 ] loop
  select pg_get_functiondef(v_oid) into v_definition;
  v_anchor:='public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command)';
  if position(v_anchor in v_definition)=0 then raise exception 'M11 recorded replay projection anchor missing %',v_oid; end if;
  v_definition:=replace(v_definition,v_anchor,
   'coalesce(v_command.result->''connector'',public.m2_v2_connector_json(v_connector)),public.m11_connector_command_json(v_command)');
  if v_oid::text like '%m11_execute_connector_command_atomic%' then
   v_anchor:='jsonb_build_object(''version'',v_connector.version)';
   if position(v_anchor in v_definition)=0 then raise exception 'M11 command result anchor missing'; end if;
   v_definition:=replace(v_definition,v_anchor,
    'jsonb_build_object(''version'',v_connector.version,''connector'',public.m2_v2_connector_json(v_connector))');
  elsif v_oid::text like '%m11_finalize_connector_test_atomic%' then
   v_anchor:='state=''completed'',completed_at=now(),result=p_result';
   if position(v_anchor in v_definition)=0 then raise exception 'M11 test result anchor missing'; end if;
   v_definition:=replace(v_definition,v_anchor,
    'state=''completed'',completed_at=now(),result=p_result||jsonb_build_object(''connector'',public.m2_v2_connector_json(v_connector))');
  end if;
  execute v_definition;
 end loop;
end $$;

-- Aggregating the fixed action enum in SQL avoids silently dropping actions
-- from large plans while keeping the worker's response bounded by enum size.
create function public.m11_sync_run_required_product_actions(p_organization_id uuid,p_sync_run_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(action order by action),'[]'::jsonb) from (
  select distinct proposed_action as action from public.sync_run_plan_items
  where organization_id=p_organization_id and sync_run_id=p_sync_run_id
 ) actions
$$;
create index connector_commands_digest_key_idx on public.connector_commands(organization_id,request_digest_key_id);
create index connector_secrets_key_identity_idx on public.connector_secrets(organization_id,key_id) where revoked_at is null;

-- Retirement readiness covers encryption references AND retained HMAC digest
-- references. If more than 100 key identities exist, callers must fail closed
-- rather than treating this bounded response as a complete retirement proof.
create function public.m11_connector_key_references(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with configured as (
  select s.key_id,count(*) as reference_count from public.connector_secrets s
  join public.connectors c on c.organization_id=s.organization_id and c.id=s.connector_id and c.secret_ref=s.id
  where s.organization_id=p_organization_id and s.revoked_at is null group by s.key_id
 ), commands as (
  select request_digest_key_id as key_id,count(*) as reference_count from public.connector_commands
  where organization_id=p_organization_id group by request_digest_key_id
 ), identities as (
  select key_id from configured where key_id is not null union select key_id from commands
 ), bounded as (select key_id from identities order by key_id limit 100)
 select jsonb_build_object(
  'envelopeKeyReferences',coalesce((select jsonb_object_agg(c.key_id,c.reference_count) from configured c join bounded b on b.key_id=c.key_id),'{}'::jsonb),
  'commandKeyReferences',coalesce((select jsonb_object_agg(c.key_id,c.reference_count) from commands c join bounded b on b.key_id=c.key_id),'{}'::jsonb),
  'legacyEnvelopeCount',coalesce((select reference_count from configured where key_id is null),0),
  'hasMoreKeys',(select count(*)>100 from identities))
$$;
revoke all on function public.m11_sync_run_required_product_actions(uuid,uuid),public.m11_connector_key_references(uuid) from public,anon,authenticated,service_role;
grant execute on function public.m11_sync_run_required_product_actions(uuid,uuid),public.m11_connector_key_references(uuid) to service_role;

-- Bound metadata independently of provider scope diagnostics. Oversized
-- combined successful responses fail before touching authoritative health.
do $$
declare v_definition text; v_anchor text;
begin
 select pg_get_functiondef('public.m11_valid_connector_config(uuid,jsonb)'::regprocedure) into v_definition;
 v_anchor:='if jsonb_typeof(p_config) is distinct from ''object'' then return false; end if;';
 if position(v_anchor in v_definition)=0 then raise exception 'M11 configuration bound anchor missing'; end if;
 execute replace(v_definition,v_anchor,v_anchor||E'\n if octet_length(p_config::text)>12000 then return false; end if;');
 select pg_get_functiondef('public.m11_finalize_connector_test_atomic(uuid,uuid,uuid,bigint,integer,integer,jsonb)'::regprocedure) into v_definition;
 v_anchor:='if jsonb_typeof(p_result) is distinct from ''object'' or p_result->>''outcome''';
 if position(v_anchor in v_definition)=0 then raise exception 'M11 combined result bound anchor missing'; end if;
 execute replace(v_definition,v_anchor,
  'if octet_length((p_result||jsonb_build_object(''connector'',public.m2_v2_connector_json(v_connector)))::text)>20000 or jsonb_typeof(p_result) is distinct from ''object'' or p_result->>''outcome''');
end $$;
