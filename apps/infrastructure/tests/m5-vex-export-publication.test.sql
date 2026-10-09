-- CRA-M5-06 persistence/security contract. Stateful worker flows belong to
-- API integration tests; these metadata checks are safe against shared local data.
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL %', p_label; end if;
end;
$$;

select pg_temp.check(
  'M5-06 exports and publication evidence are private tenant-scoped tables',
  not exists (
    select 1
    from (values
      ('vulnerability_vex_export_snapshots'),
      ('vulnerability_vex_export_snapshot_assessments'),
      ('vulnerability_vex_publication_targets'),
      ('vulnerability_vex_publication_jobs'),
      ('vulnerability_vex_publication_attempts')
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
  'M5-06 snapshots use immutable assessment references, a private object locator, and a deterministic scope key',
  exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_vex_export_snapshots'::regclass
    and pg_get_constraintdef(oid) like '%release_id, export_format, specification_version, scope_digest%')
  and exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_vex_export_snapshot_assessments'::regclass
    and pg_get_constraintdef(oid) like '%snapshot_id, finding_id%')
  and position('VEX export snapshots are immutable' in
    pg_get_functiondef('public.m5_vex_export_prevent_snapshot_mutation()'::regprocedure)) > 0
  and position('assessmentRevisionReferences' in
    pg_get_functiondef('public.m5_vex_export_snapshot_json(uuid,uuid)'::regprocedure)) > 0
  and position('storageObjectPath' in
    pg_get_functiondef('public.get_vulnerability_vex_export_storage_locator(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('byteSize' in
    pg_get_functiondef('public.get_vulnerability_vex_export_storage_locator(uuid,uuid,uuid)'::regprocedure)) > 0
  and exists (select 1 from pg_proc
    where oid = 'public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid)'::regprocedure
      and prosecdef and proconfig @> array['search_path=public, pg_temp'])
);

select pg_temp.check(
  'M5-06 export commands lock and restrict scopes to effective approved revisions',
  position('for update' in lower(pg_get_functiondef(
    'public.create_vulnerability_vex_export_snapshot_atomic(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,uuid,uuid)'::regprocedure))) > 0
  and position('approval_state in (''approved'', ''approval_not_required'')' in
    pg_get_functiondef('public.m5_vex_export_scope_payload(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('can_export_findings' in
    pg_get_functiondef('public.preview_vulnerability_vex_export_scope(uuid,uuid,uuid,uuid,text)'::regprocedure)) > 0
  and position('scope_conflict' in
    pg_get_functiondef('public.create_vulnerability_vex_export_snapshot_atomic(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,uuid,uuid)'::regprocedure)) > 0
);

select pg_temp.check(
  'M5-06 publication RPCs are service-only pinned security definers with leases and target confirmation',
  has_function_privilege('service_role',
    'public.enqueue_vulnerability_vex_publication_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.enqueue_vulnerability_vex_publication_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,text,uuid,uuid)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
    where oid = 'public.claim_vulnerability_vex_publication_job(uuid,uuid,integer)'::regprocedure)
  and position('p_confirm_target is not true' in pg_get_functiondef(
    'public.enqueue_vulnerability_vex_publication_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,text,uuid,uuid)'::regprocedure)) > 0
  and position('skip locked' in lower(pg_get_functiondef(
    'public.claim_vulnerability_vex_publication_job(uuid,uuid,integer)'::regprocedure))) > 0
  and position('can_manage_finding_publication' in pg_get_functiondef(
    'public.list_vulnerability_vex_publication_targets(uuid,uuid)'::regprocedure)) > 0
);
