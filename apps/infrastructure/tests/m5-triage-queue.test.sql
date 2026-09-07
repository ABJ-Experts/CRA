-- CRA-M5-01 triage queue database boundary. This test is metadata-only so it
-- is safe against the shared local development fixture set.
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %', p_label;
  else raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M5 saved views are RLS protected and service-role only',
  not exists (
    select 1 from (values
      ('vulnerability_triage_saved_views'),
      ('vulnerability_triage_saved_view_defaults'),
      ('vulnerability_triage_saved_view_commands')
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
  'M5 RPCs are security definers with pinned paths and no browser grants',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public' and procedures.proname = any (array[
      'list_finding_triage_queue', 'get_finding_triage_detail', 'list_finding_saved_views',
      'create_finding_saved_view_atomic', 'update_finding_saved_view_atomic',
      'delete_finding_saved_view_atomic', 'set_finding_saved_view_default_atomic'
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
    'public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)', 'execute')
  and has_function_privilege('service_role',
    'public.create_finding_saved_view_atomic(uuid,uuid,text,jsonb,text,text,uuid,uuid)', 'execute')
);

select pg_temp.check(
  'M5 saved views use optimistic versions, tenant names, and durable idempotency',
  exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_triage_saved_views'::regclass
    and pg_get_constraintdef(oid) like '%version > 0%')
  and exists (select 1 from pg_index indexes
    where indexes.indexrelid = 'public.vulnerability_triage_saved_views_org_name_idx'::regclass)
  and exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_triage_saved_view_commands'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) like '%organization_id, actor_user_id, idempotency_key%')
);

select pg_temp.check(
  'M5 queue uses active tenant keyset indexes and opaque cursor encoding',
  exists (select 1 from pg_index indexes
    where indexes.indexrelid = 'public.vulnerability_findings_triage_active_cursor_idx'::regclass)
  and strpos(
    pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure),
    'translate(replace(encode(convert_to'
  ) > 0
  and pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure)
    ~ 'p_organization_id'
  and pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure)
    ~ 'findingStates'
);

select pg_temp.check(
  'M5 detail uses the shared reEvaluationState wire key',
  pg_get_functiondef('public.get_finding_triage_detail(uuid,uuid,uuid)'::regprocedure)
    ~ '''reEvaluationState'''
);
