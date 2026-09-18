-- A corrected anchor is a durable schedule transition, not a queued timer hint.
-- Materialize all newly crossed stage thresholds in that same transaction so
-- the correction, high-severity audit, alert facts, and delivery outbox cannot
-- diverge while the worker is unavailable.
do $$
declare
  v_definition text;
  v_refresh text := '  perform public.m6_refresh_reporting_obligation_stages(p_organization_id, p_obligation_id, v_now);';
  v_materialize text := '  perform public.m6_refresh_reporting_obligation_stages(p_organization_id, p_obligation_id, v_now);' || chr(10) ||
    '  for v_stage_id in' || chr(10) ||
    '    select id from public.reporting_obligation_stages' || chr(10) ||
    '    where organization_id = p_organization_id and obligation_id = p_obligation_id' || chr(10) ||
    '  loop' || chr(10) ||
    '    perform public.m6_materialize_reporting_deadline_alerts(p_organization_id, v_stage_id, v_now);' || chr(10) ||
    '  end loop;';
begin
  select pg_get_functiondef(
    'public.correct_reporting_obligation_anchor_atomic(uuid,uuid,uuid,text,timestamp with time zone,text,text,integer,uuid,uuid)'::regprocedure
  ) into v_definition;
  if position('v_stage_id' in v_definition) > 0 then
    return;
  end if;
  if position(v_refresh in v_definition) = 0 then
    raise exception 'M6-02 correction refresh anchor is missing';
  end if;
  v_definition := replace(
    v_definition,
    '  v_now timestamptz := date_trunc(''second'', clock_timestamp());',
    '  v_now timestamptz := date_trunc(''second'', clock_timestamp());' || chr(10) ||
    '  v_stage_id uuid;'
  );
  execute replace(v_definition, v_refresh, v_materialize);
end $$;

alter function public.correct_reporting_obligation_anchor_atomic(uuid,uuid,uuid,text,timestamptz,text,text,integer,uuid,uuid) owner to postgres;
revoke all on function public.correct_reporting_obligation_anchor_atomic(uuid,uuid,uuid,text,timestamptz,text,text,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.correct_reporting_obligation_anchor_atomic(uuid,uuid,uuid,text,timestamptz,text,text,integer,uuid,uuid) to service_role;
