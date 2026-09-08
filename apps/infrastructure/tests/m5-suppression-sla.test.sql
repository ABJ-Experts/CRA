-- CRA-M5-04 metadata contract. Behavioral concurrency cases execute through
-- the API/live-stack suite because this shared database is not reset here.
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %', p_label;
  else raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M5-04 state is tenant-scoped, RLS protected, and browser-private',
  not exists (
    select 1
    from (values
      ('vulnerability_finding_suppressions'),
      ('vulnerability_triage_sla_policies'),
      ('vulnerability_finding_triage_states'),
      ('vulnerability_triage_alert_events'),
      ('vulnerability_triage_commands')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and (
      not tables.relrowsecurity or tables.relforcerowsecurity
      or has_table_privilege('anon', tables.oid, 'select,insert,update,delete')
      or has_table_privilege('authenticated', tables.oid, 'select,insert,update,delete')
      or not has_table_privilege('service_role', tables.oid, 'select,insert,update,delete')
    )
  )
);

select pg_temp.check(
  'M5-04 suppression is finite, append-only, and tenant-bound to a finding',
  exists (select 1 from pg_index where indexrelid =
    'public.vulnerability_finding_suppressions_one_current_idx'::regclass)
  and exists (select 1 from pg_constraint where conrelid =
    'public.vulnerability_finding_suppressions'::regclass
    and pg_get_constraintdef(oid) like '%expires_at > created_at%')
  and exists (select 1 from pg_constraint where conrelid =
    'public.vulnerability_finding_suppressions'::regclass
    and pg_get_constraintdef(oid) like '%organization_id, finding_id%')
);

select pg_temp.check(
  'M5-04 policies, state versions, and durable event deduplication exist',
  exists (select 1 from pg_constraint where conrelid =
    'public.vulnerability_triage_sla_policies'::regclass
    and pg_get_constraintdef(oid) like '%target_minutes%')
  and exists (select 1 from pg_constraint where conrelid =
    'public.vulnerability_finding_triage_states'::regclass
    and pg_get_constraintdef(oid) like '%version > 0%')
  and exists (select 1 from pg_constraint where conrelid =
    'public.vulnerability_triage_alert_events'::regclass
    and pg_get_constraintdef(oid) like '%event_key%')
);

select pg_temp.check(
  'M5-04 mutable triage state retains the repository updated_at trigger invariant',
  exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.vulnerability_finding_triage_states'::regclass
      and not trigger.tgisinternal
      and trigger.tgfoid = 'public.set_updated_at'::regproc
  )
);

select pg_temp.check(
  'M5-04 unconfigured states retain observed severity without read-version churn',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vulnerability_finding_triage_states'
      and column_name = 'last_observed_severity'
      and is_nullable = 'NO'
  )
  and position(
    'last_observed_severity is distinct from v_severity'
    in pg_get_functiondef('public.m5_triage_ensure_state(uuid,uuid,uuid)'::regprocedure)
  ) > 0
);

select pg_temp.check(
  'M5-04 policy setup remains prospective when a detail read first materializes state',
  pg_get_functiondef('public.m5_triage_ensure_state(uuid,uuid,uuid)'::regprocedure)
    like '%v_finding_created_at >= policy.updated_at%'
);

select pg_temp.check(
  'M5-04 RPCs are pinned security definers and service-role only',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public' and procedures.proname = any (array[
      'assign_finding_triage_atomic', 'suppress_finding_triage_atomic',
      'set_vulnerability_triage_sla_policy_atomic', 'list_vulnerability_triage_sla_policies',
      'list_due_vulnerability_triage_alert_organizations',
      'claim_vulnerability_triage_alert', 'get_vulnerability_triage_alert_details',
      'complete_vulnerability_triage_alert'
    ]) and (
      not procedures.prosecdef or procedures.proconfig is null
      or not ('search_path=public, pg_temp' = any(procedures.proconfig))
      or exists (
        select 1 from information_schema.routine_privileges privileges
        where privileges.routine_schema = 'public' and privileges.routine_name = procedures.proname
          and privileges.grantee in ('public', 'anon', 'authenticated')
      )
    )
  )
  and has_function_privilege('service_role',
    'public.assign_finding_triage_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.claim_vulnerability_triage_alert(uuid,text,integer)', 'execute')
);
