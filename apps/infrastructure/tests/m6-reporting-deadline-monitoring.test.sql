begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

select pg_temp.check(
  'M6-02 monitor tables are private and service-only',
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.reporting_deadline_alerts'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.reporting_deadline_alert_deliveries'::regclass)
  and not has_table_privilege('authenticated', 'public.reporting_deadline_alerts', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.reporting_deadline_alert_deliveries', 'select,insert,update,delete')
);

select pg_temp.check(
  'M6-02 monitor RPCs are service-only pinned security definers',
  has_function_privilege('service_role', 'public.reconcile_reporting_deadline_monitoring_atomic(timestamp with time zone,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.reconcile_reporting_deadline_monitoring_atomic(timestamp with time zone,integer)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       from pg_proc where oid = 'public.reconcile_reporting_deadline_monitoring_atomic(timestamp with time zone,integer)'::regprocedure)
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_create record;
  v_correct record;
  v_cancel record;
  v_first record;
  v_duplicate record;
  v_after_correction record;
  v_immediate_correction_alerts integer;
  v_after_cancel record;
  v_obligation uuid;
  v_stage uuid;
  v_revision integer;
  v_now timestamptz := date_trunc('second', clock_timestamp()); -- 80% through a 24-hour early warning
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select * into v_create from public.create_reporting_obligation_atomic(
    v_org, v_actor, 'severe_incident', null,
    v_now - interval '19 hours 12 minutes', 'Timer recovery test.', gen_random_uuid(), gen_random_uuid()
  );
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;
  select id, deadline_revision into v_stage, v_revision
  from public.reporting_obligation_stages
  where organization_id = v_org and obligation_id = v_obligation and stage_kind = 'early_warning';

  select * into v_first from public.reconcile_reporting_deadline_monitoring_atomic(v_now, 1000);
  select * into v_duplicate from public.reconcile_reporting_deadline_monitoring_atomic(v_now, 1000);

  perform pg_temp.check(
    'M6-02 catch-up emits crossed 50 and 75 exactly once',
    v_first.outcome = 'reconciled'
    and (select count(*) = 2 from public.reporting_deadline_alerts
         where organization_id = v_org and stage_id = v_stage and deadline_revision = v_revision
           and threshold_percent in (50, 75))
    and not exists (select 1 from public.reporting_deadline_alerts
                    where organization_id = v_org and stage_id = v_stage and deadline_revision = v_revision and threshold_percent in (90, 100))
    and v_duplicate.emitted = 0
    and (select count(*) = 2 from public.reporting_obligation_events
         where organization_id = v_org and obligation_id = v_obligation and event_kind = 'deadline_threshold_crossed')
    and (public.m6_reporting_stage_json(v_org, v_stage) ? 'elapsedPercent')
    and (public.m6_reporting_stage_json(v_org, v_stage) ? 'breachedAt')
  );

  select * into v_correct from public.correct_reporting_obligation_anchor_atomic(
    v_org, v_actor, v_obligation, 'awareness', v_now - interval '2 days',
    'Corrected awareness basis.', 'Backward correction.', 1, gen_random_uuid(), gen_random_uuid()
  );
  select count(*) into v_immediate_correction_alerts
  from public.reporting_deadline_alerts
  where organization_id = v_org and stage_id = v_stage and deadline_revision = v_revision + 1;
  select * into v_after_correction from public.reconcile_reporting_deadline_monitoring_atomic(v_now, 1000);

  perform pg_temp.check(
    'M6-02 backward anchor correction creates a new deadline revision and newly crossed facts',
    v_correct.outcome = 'updated'
    and (select deadline_revision = v_revision + 1 from public.reporting_obligation_stages where id = v_stage)
    and v_immediate_correction_alerts = 4
    and (select count(*) = 4 from public.reporting_deadline_alerts
         where organization_id = v_org and stage_id = v_stage and deadline_revision = v_revision + 1)
    and v_after_correction.emitted = 0
    and (select state = 'overdue' from public.reporting_obligation_stages where id = v_stage)
  );

  select * into v_cancel from public.cancel_reporting_obligation_atomic(
    v_org, v_actor, v_obligation, 'Cancellation monitor test.', 2, gen_random_uuid(), gen_random_uuid()
  );
  select * into v_after_cancel from public.reconcile_reporting_deadline_monitoring_atomic(v_now, 1000);

  perform pg_temp.check(
    'M6-02 cancellation stops outstanding delivery but preserves immutable breach facts',
    v_cancel.outcome = 'cancelled'
    and not exists (
      select 1 from public.reporting_deadline_alert_deliveries d
      join public.reporting_deadline_alerts a on a.organization_id = d.organization_id and a.id = d.alert_id
      where a.obligation_id = v_obligation and d.delivery_state in ('queued', 'retrying', 'leased')
    )
    and exists (select 1 from public.reporting_deadline_alerts where obligation_id = v_obligation and threshold_percent = 100)
    and v_after_cancel.outcome = 'reconciled'
  );
end;
$$;

do $$
declare
  v_health record;
begin
  perform pg_temp.check(
    'M6-02 rejects invalid skew samples',
    (select outcome = 'invalid_request' from public.observe_reporting_deadline_monitor_clock_skew_atomic(clock_timestamp(), -1))
  );
  perform pg_temp.check(
    'M6-02 records critical clock skew at one second',
    (select critical from public.observe_reporting_deadline_monitor_clock_skew_atomic(clock_timestamp(), 1000))
  );
  select * into v_health from public.get_reporting_deadline_monitor_health();
  perform pg_temp.check(
    'M6-02 monitor health retains a critical skew observation',
    v_health.outcome = 'found' and (v_health.health->>'critical')::boolean
      and (v_health.health->>'lastClockSkewMilliseconds')::integer = 1000
  );
end;
$$;

select pg_temp.check(
  'M6-02 operational records are registered for tenant export',
  exists (select 1 from public.organization_export_source_tables where source_id = 'reporting_obligations' and table_name = 'reporting_deadline_alerts')
  and exists (select 1 from public.organization_export_source_tables where source_id = 'reporting_obligations' and table_name = 'reporting_deadline_alert_deliveries')
);

rollback;
