-- A local M11-04 draft was applied before the M11-01 recorded-replay patch was
-- carried into its CI command overrides. Fresh installs already have the
-- projection; this repair is idempotent and preserves replay history.
do $$
declare v_oid regprocedure; v_definition text; v_anchor text;
begin
  foreach v_oid in array array[
    'public.m11_execute_connector_command_atomic(uuid,uuid,uuid,text,integer,uuid,text,text,bigint,jsonb)'::regprocedure,
    'public.m11_begin_connector_test_atomic(uuid,uuid,uuid,integer,uuid,text,text,bigint)'::regprocedure
  ] loop
    select pg_get_functiondef(v_oid) into v_definition;
    if position('coalesce(v_command.result->''connector'',public.m2_v2_connector_json(v_connector))' in v_definition)=0 then
      v_anchor:='public.m2_v2_connector_json(v_connector),public.m11_connector_command_json(v_command)';
      if position(v_anchor in v_definition)=0 then raise exception 'M11-04 replay anchor missing: %',v_oid; end if;
      v_definition:=replace(v_definition,v_anchor,
        'coalesce(v_command.result->''connector'',public.m2_v2_connector_json(v_connector)),public.m11_connector_command_json(v_command)');
    end if;
    if v_oid::text like '%m11_execute_connector_command_atomic%'
      and position('jsonb_build_object(''version'',v_connector.version,''connector'',public.m2_v2_connector_json(v_connector))' in v_definition)=0 then
      v_anchor:='jsonb_build_object(''version'',v_connector.version)';
      if position(v_anchor in v_definition)=0 then raise exception 'M11-04 command result anchor missing'; end if;
      v_definition:=replace(v_definition,v_anchor,
        'jsonb_build_object(''version'',v_connector.version,''connector'',public.m2_v2_connector_json(v_connector))');
    end if;
    execute v_definition;
  end loop;
end $$;
