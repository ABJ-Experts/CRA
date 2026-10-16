begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_created record;
  v_replayed record;
  v_rehearsal_id uuid;
  v_replay_id uuid;
  v_now timestamptz := date_trunc('second', clock_timestamp());
begin
  select id into v_actor from public.users where email = 'owner@cra.test';

  select * into v_created from public.create_reporting_rehearsal_atomic(
    v_org, v_actor, 'severe_incident', v_now - interval '4 days',
    'Synthetic rehearsal only.', gen_random_uuid(), gen_random_uuid()
  );
  v_rehearsal_id := (v_created.result->'obligation'->>'id')::uuid;

  perform pg_temp.check(
    'M6-07 rehearsal is a marked manual synthetic root with no finding',
    v_created.outcome = 'created'
    and (v_created.result->'obligation'->>'isRehearsal')::boolean
    and v_created.result->'obligation'->>'rehearsalReplayOfId' is null
    and (select is_rehearsal and source_finding_id is null and rehearsal_replay_of_id is null
         from public.reporting_obligations where organization_id = v_org and id = v_rehearsal_id)
    and (select count(*) = 0 from public.reporting_deadline_alerts where obligation_id = v_rehearsal_id)
  );

  perform public.reconcile_reporting_deadline_monitoring_atomic(v_now, 1000);
  perform pg_temp.check(
    'M6-07 overdue rehearsal never materializes production alert or delivery',
    not exists (select 1 from public.reporting_deadline_alerts where obligation_id = v_rehearsal_id)
    and not exists (
      select 1 from public.reporting_deadline_alert_deliveries d
      join public.reporting_deadline_alerts a on a.organization_id = d.organization_id and a.id = d.alert_id
      where a.obligation_id = v_rehearsal_id
    )
  );

  select * into v_replayed from public.replay_reporting_rehearsal_atomic(
    v_org, v_actor, v_rehearsal_id, 'Repeat synthetic run.', 1, gen_random_uuid(), gen_random_uuid()
  );
  v_replay_id := (v_replayed.result->'obligation'->>'id')::uuid;

  perform pg_temp.check(
    'M6-07 replay cancels only the prior rehearsal and creates fresh linked stages',
    v_replayed.outcome = 'created'
    and (select status = 'cancelled' and is_rehearsal from public.reporting_obligations where id = v_rehearsal_id)
    and (select is_rehearsal and rehearsal_replay_of_id = v_rehearsal_id and source_finding_id is null
         from public.reporting_obligations where id = v_replay_id)
    and (select count(*) = 3 from public.reporting_obligation_stages where obligation_id = v_replay_id)
    and not exists (select 1 from public.reporting_stage_drafts where obligation_id = v_replay_id)
    and not exists (select 1 from public.reporting_stage_submissions where obligation_id = v_replay_id)
    and exists (select 1 from public.reporting_obligation_events where obligation_id = v_rehearsal_id and event_kind = 'rehearsal_replayed')
  );

  perform pg_temp.check(
    'M6-07 normal reporting list and summary exclude rehearsal data',
    not exists (
      select 1 from jsonb_array_elements((select result->'obligations' from public.list_reporting_obligations(v_org, v_actor, null, 100, null, null, null, 'real'))) item
      where item->>'id' in (v_rehearsal_id::text, v_replay_id::text)
    )
    and exists (
      select 1 from jsonb_array_elements((select result->'obligations' from public.list_reporting_obligations(v_org, v_actor, null, 100, null, null, null, 'rehearsal'))) item
      where item->>'id' = v_replay_id::text and (item->>'isRehearsal')::boolean
    )
    and not exists (
      select 1 from public.get_reporting_deadline_summary(v_org, v_actor)
      where summary->'nextDeadline'->>'obligationId' in (v_rehearsal_id::text, v_replay_id::text)
    )
  );
end;
$$;

select pg_temp.check(
  'M6-07 synthesis guards are durable, private, and service-only',
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.reporting_obligations'::regclass)
  and has_function_privilege('service_role', 'public.create_reporting_rehearsal_atomic(uuid,uuid,text,timestamp with time zone,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_reporting_rehearsal_atomic(uuid,uuid,text,timestamp with time zone,text,uuid,uuid)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
       where oid = 'public.create_reporting_rehearsal_atomic(uuid,uuid,text,timestamp with time zone,text,uuid,uuid)'::regprocedure)
);

select pg_temp.check(
  'M6-07 real and synthetic filing routes are mutually exclusive',
  position('o.is_rehearsal' in pg_get_functiondef('public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure)) > 0
  and position('not o.is_rehearsal' in pg_get_functiondef('public.record_reporting_stage_rehearsal_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure)) > 0
  and position('SYNTHETIC / REHEARSAL - NOT A LEGAL FILING' in pg_get_functiondef('public.record_reporting_stage_rehearsal_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure)) > 0
);

rollback;
