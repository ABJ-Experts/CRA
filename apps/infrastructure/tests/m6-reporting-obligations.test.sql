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
  'M6 reporting tables are private tenant records',
  (select relrowsecurity and not relforcerowsecurity
     from pg_class where oid = 'public.reporting_obligations'::regclass)
  and (select relrowsecurity and not relforcerowsecurity
     from pg_class where oid = 'public.reporting_obligation_stages'::regclass)
  and not has_table_privilege('authenticated', 'public.reporting_obligations', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.reporting_obligations', 'select,insert,update,delete')
);

select pg_temp.check(
  'M6 reporting RPCs are service-only pinned security definers',
  has_function_privilege('service_role',
    'public.create_reporting_obligation_atomic(uuid,uuid,text,uuid,timestamp with time zone,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.create_reporting_obligation_atomic(uuid,uuid,text,uuid,timestamp with time zone,text,uuid,uuid)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
      from pg_proc where oid =
        'public.create_reporting_obligation_atomic(uuid,uuid,text,uuid,timestamp with time zone,text,uuid,uuid)'::regprocedure)
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_finding uuid;
  v_create record;
  v_replay record;
  v_conflict record;
  v_correct record;
  v_submission record;
  v_cancel record;
  v_obligation uuid;
  v_key uuid := gen_random_uuid();
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_finding from public.vulnerability_findings
  where organization_id = v_org and status = 'active'
  order by id
  limit 1;

  select * into v_create from public.create_reporting_obligation_atomic(
    v_org,
    v_actor,
    'actively_exploited_vulnerability',
    v_finding,
    '2026-04-14 09:20:00+00',
    'PSIRT confirmed exploitability.',
    v_key,
    gen_random_uuid()
  );
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;

  select * into v_replay from public.create_reporting_obligation_atomic(
    v_org,
    v_actor,
    'actively_exploited_vulnerability',
    v_finding,
    '2026-04-14 09:20:00+00',
    'PSIRT confirmed exploitability.',
    v_key,
    gen_random_uuid()
  );

  select * into v_conflict from public.create_reporting_obligation_atomic(
    v_org,
    v_actor,
    'severe_incident',
    v_finding,
    '2026-04-14 09:20:00+00',
    'Changed payload.',
    v_key,
    gen_random_uuid()
  );

  select * into v_correct from public.correct_reporting_obligation_anchor_atomic(
    v_org,
    v_actor,
    v_obligation,
    'awareness',
    '2026-04-14 03:20:00+00',
    'Bridge log correction.',
    'Retroactive awareness correction.',
    1,
    gen_random_uuid(),
    gen_random_uuid()
  );

  select * into v_submission from public.record_reporting_obligation_stage_submission_atomic(
    v_org,
    v_actor,
    v_obligation,
    'notification',
    '2026-04-17 08:00:00+00',
    'Manual package CRA-17',
    2,
    gen_random_uuid(),
    gen_random_uuid()
  );

  select * into v_cancel from public.cancel_reporting_obligation_atomic(
    v_org,
    v_actor,
    v_obligation,
    'Exploitability was not confirmed.',
    3,
    gen_random_uuid(),
    gen_random_uuid()
  );

  perform pg_temp.check(
    'M6 create/replay/correct/submit/cancel transition atomically',
    v_create.outcome = 'created'
    and v_replay.outcome = 'idempotent'
    and v_conflict.outcome = 'idempotency_conflict'
    and v_correct.outcome = 'updated'
    and v_submission.outcome = 'updated'
    and v_cancel.outcome = 'cancelled'
    and (select status = 'cancelled' and version = 4 from public.reporting_obligations where id = v_obligation)
    and (select count(*) = 3 from public.reporting_obligation_stages where obligation_id = v_obligation)
    and (select count(*) >= 4 from public.reporting_obligation_events where obligation_id = v_obligation)
    and (select count(*) >= 4 from public.audit_logs where entity_type = 'reporting_obligation' and entity_id = v_obligation::text)
  );

  perform pg_temp.check(
    'M6 BRD UTC deadline examples are stored at second precision',
    (select due_at = '2026-04-15 03:20:00+00'::timestamptz
       from public.reporting_obligation_stages
       where obligation_id = v_obligation and stage_kind = 'early_warning')
    and (select due_at = '2026-04-17 03:20:00+00'::timestamptz
       from public.reporting_obligation_stages
       where obligation_id = v_obligation and stage_kind = 'notification')
    and (select state = 'not_required'
       from public.reporting_obligation_stages
       where obligation_id = v_obligation and stage_kind = 'final_report')
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_incident record;
  v_obligation uuid;
  v_tick record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select * into v_incident from public.create_reporting_obligation_atomic(
    v_org,
    v_actor,
    'severe_incident',
    null,
    '2028-02-28 00:00:00+00',
    'Incident bridge opened.',
    gen_random_uuid(),
    gen_random_uuid()
  );
  v_obligation := (v_incident.result->'obligation'->>'id')::uuid;

  perform pg_temp.check(
    'M6 leap-year 72 hour deadline uses elapsed UTC time',
    (select due_at = '2028-03-02 00:00:00+00'::timestamptz
       from public.reporting_obligation_stages
       where obligation_id = v_obligation and stage_kind = 'notification')
  );

  perform public.correct_reporting_obligation_anchor_atomic(
    v_org,
    v_actor,
    v_obligation,
    'notification_submitted',
    '2026-01-31 10:00:00+00',
    null,
    'Manual notification timestamp.',
    1,
    gen_random_uuid(),
    gen_random_uuid()
  );

  perform pg_temp.check(
    'M6 calendar month clamps Jan31 to Feb28',
    (select due_at = '2026-02-28 10:00:00+00'::timestamptz
       from public.reporting_obligation_stages
       where obligation_id = v_obligation and stage_kind = 'final_report')
  );

  select * into v_tick from public.tick_reporting_obligation_stages_atomic(
    v_org,
    v_actor,
    '2028-03-03 00:00:00+00',
    gen_random_uuid()
  );

  perform pg_temp.check(
    'M6 overdue facts are durable and idempotent',
    v_tick.outcome = 'updated'
    and (select state = 'overdue' and overdue_at is not null
       from public.reporting_obligation_stages
       where obligation_id = v_obligation and stage_kind = 'notification')
  );
end;
$$;

select pg_temp.check(
  'M6 reporting export source is registered',
  exists (
    select 1
    from public.organization_export_source_tables
    where source_id = 'reporting_obligations'
      and table_name = 'reporting_obligation_stages'
  )
);

rollback;
