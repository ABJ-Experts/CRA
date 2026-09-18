-- M3-04 quality persistence contract. The transaction is intentionally
-- read-only with respect to product evidence so it can run on the shared local
-- stack without deleting or resetting tenant data.
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
  'quality tables are tenant scoped, RLS enabled, indexed, and browser private',
  (select relrowsecurity from pg_class where oid = 'public.organization_sbom_quality_settings'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.sbom_quality_reports'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.sbom_quality_findings'::regclass)
  and not has_table_privilege('authenticated', 'public.organization_sbom_quality_settings', 'select')
  and not has_table_privilege('authenticated', 'public.sbom_quality_reports', 'select')
  and not has_table_privilege('authenticated', 'public.sbom_quality_findings', 'select')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_quality_reports_org_source_created_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_quality_reports_org_release_state_created_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_quality_findings_report_created_idx')
);

select pg_temp.check(
  'quality worker and API RPCs are service role only and pin search path',
  not has_function_privilege('authenticated', 'public.claim_sbom_quality_report(uuid,text,integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_sbom_quality_report(uuid,text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.persist_sbom_quality_report_atomic(uuid,uuid,text,jsonb,jsonb,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.persist_sbom_quality_report_atomic(uuid,uuid,text,jsonb,jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_sbom_quality_report(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.get_sbom_quality_report(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.list_sbom_quality_findings(uuid,uuid,uuid,integer,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.list_sbom_quality_findings(uuid,uuid,uuid,integer,text,text,text)', 'execute')
  and (select proconfig::text like '%search_path=public, pg_temp%'
       from pg_proc where oid = 'public.claim_sbom_quality_report(uuid,text,integer)'::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%'
       from pg_proc where oid = 'public.persist_sbom_quality_report_atomic(uuid,uuid,text,jsonb,jsonb,boolean)'::regprocedure)
);

select pg_temp.check(
  'quality formula and BSI ruleset are immutable schema constants',
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_quality_reports'::regclass
      and conname = 'sbom_quality_reports_state_check'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.organization_sbom_quality_settings'::regclass
      and conname like '%bsi_ruleset_version%'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sbom_components' and column_name = 'supplier_values'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sbom_components' and column_name = 'license_values'
  )
);

rollback;
