-- CRA-M5-03 metadata boundary. Deliberately read-only against the shared
-- local fixture database; behavioral target cases live at the API boundary.
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %', p_label;
  else raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M5 bulk ledger is tenant-scoped, RLS protected, and browser-private',
  not exists (
    select 1
    from (values
      ('vulnerability_finding_assessment_bulk_operations'),
      ('vulnerability_finding_assessment_bulk_operation_targets')
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
  'M5 bulk RPCs are service-role-only security definers with pinned paths',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public' and procedures.proname = any (array[
      'create_vulnerability_assessment_bulk_preview_atomic',
      'execute_vulnerability_assessment_bulk_operation_atomic',
      'retry_vulnerability_assessment_bulk_operation_atomic',
      'undo_vulnerability_assessment_bulk_operation_atomic',
      'get_vulnerability_assessment_bulk_operation'
    ]) and (
      not procedures.prosecdef or procedures.proconfig is null
      or not ('search_path=public, pg_temp' = any(procedures.proconfig))
      or exists (
        select 1 from information_schema.routine_privileges privileges
        where privileges.routine_schema='public' and privileges.routine_name=procedures.proname
          and privileges.grantee in ('public','anon','authenticated')
      )
    )
  )
);

select pg_temp.check(
  'M5 bulk preview has bounded snapshots and propagation matches identity plus version',
  pg_get_functiondef('public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text)'::regprocedure)
    ~ 'between 1 and 500'
  and pg_get_functiondef('public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text)'::regprocedure)
    ~ 'o.component_identity=so.component_identity'
  and pg_get_functiondef('public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text)'::regprocedure)
    ~ 'o.component_version=so.component_version'
  and pg_get_functiondef('public.execute_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text)'::regprocedure)
    ~ 'limit 100'
);
