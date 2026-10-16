-- CRA-M4-07 reachability evidence and advisory-review security gates.
-- This suite is intentionally metadata-only: volatile fixtures belong in API
-- integration coverage, while these assertions pin the database boundary.
\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %', p_label;
  else raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M4-07 keeps immutable reachability and review ledgers tenant-scoped and browser-inaccessible',
  not exists (
    select 1
    from (values
      ('vulnerability_reachability_results'),
      ('vulnerability_finding_review_events')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and (
      not tables.relrowsecurity or tables.relforcerowsecurity
      or has_table_privilege('anon', tables.oid, 'select')
      or has_table_privilege('authenticated', tables.oid, 'select')
      or not has_table_privilege('service_role', tables.oid, 'select,insert,update')
    )
  )
);

select pg_temp.check(
  'M4-07 result and event idempotency prevent duplicate evidence or notifications',
  exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_reachability_results'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) like '%organization_id, finding_id, material_fingerprint%')
  and exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_finding_review_events'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) like '%organization_id, finding_id, material_fingerprint%')
);

select pg_temp.check(
  'M4-07 database functions are service-role-only security definers with a pinned path',
  not exists (
    select 1
    from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public' and procedures.proname = any (array[
      'record_vulnerability_reachability_result_atomic',
      'get_vulnerability_finding_reachability_evidence',
      'get_vulnerability_finding_advisory_review',
      'claim_vulnerability_finding_review_notification',
      'complete_vulnerability_finding_review_notification',
      'mark_vulnerability_reachability_stale_for_finding'
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
    'public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb)', 'execute')
  and has_function_privilege('service_role',
    'public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean)', 'execute')
  and has_function_privilege('service_role',
    'public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid)', 'execute')
);

select pg_temp.check(
  'M4-07 trigger-only stale helper has no direct execution grant',
  not has_function_privilege(
    'public',
    'public.m4_07_mark_reachability_stale_after_occurrence_change()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.m4_07_mark_reachability_stale_after_occurrence_change()',
    'execute'
  )
);

select pg_temp.check(
  'M4-07 validates evidence required for not_reachable and preserves advisory history as review_required',
  pg_get_functiondef('public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb)'::regprocedure)
    ~ 'not_reachable'
  and pg_get_functiondef('public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean)'::regprocedure)
    ~ 'review_required'
  and pg_get_functiondef('public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean)'::regprocedure)
    ~ 'record_vulnerability_finding_advisory_review_atomic'
  and pg_get_functiondef('public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean)'::regprocedure)
    ~ 'sbom_actor_can_view'
  and pg_get_functiondef('public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean)'::regprocedure)
    ~ 'p_include_stale'
);
