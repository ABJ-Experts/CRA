-- Repair the already-applied M1 artifact-inventory export functions without
-- editing historical migrations. Preserve later registry additions by patching
-- the live function definitions in place.
do $$
declare
  v_definition text;
  v_anchor text;
  v_replacement text;
begin
  select pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
  ) into v_definition;

  v_anchor := '  select coalesce(jsonb_agg(
    jsonb_build_object(
      ''bucketId'', source.bucket_id,';

  v_replacement := '  if exists (
    select 1
      from storage.objects objects
      join storage.buckets buckets on buckets.id = objects.bucket_id
     where buckets.public = false
       and objects.bucket_id <> ''tenant-exports''
       and objects.name like p_organization_id::text || ''/%''
       and (
         objects.name ~ ''(^|/)[.][.]?(/|$)''
         or position(''//'' in objects.name) > 0
       )
  ) then
    return query select ''invalid_request''::text, v_job.checkpoint_version;
    return;
  end if;

' || v_anchor;

  if position('objects.name ~ ''(^|/)[.][.]?(/|$)''' in v_definition) = 0 then
    if position(v_anchor in v_definition) = 0 then
      raise exception 'M1 artifact inventory anchor missing';
    end if;
    v_definition := replace(v_definition, v_anchor, v_replacement);
  end if;

  execute v_definition;
end $$;

do $$
declare
  v_definition text;
  v_missing_snapshot_old text;
  v_missing_snapshot_new text;
  v_inventory_old text;
  v_inventory_new text;
begin
  select pg_get_functiondef(
    'public.complete_organization_export_atomic(uuid,uuid,uuid,integer,integer,text,text,text)'::regprocedure
  ) into v_definition;

  v_missing_snapshot_old := '  if not found then
    return query select ''verification_failed''::text,
      jsonb_build_object(''id'', p_export_job_id, ''status'', ''failed'',
        ''errorCode'', ''verification_failed'');
    return;
  end if;';

  v_missing_snapshot_new := '  if not found then
    update public.organization_export_jobs set status = ''failed'',
      safe_error_code = ''verification_failed'',
      safe_diagnostics = jsonb_build_object(''verification'', ''failed_closed''),
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_export_job_id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, ''organization.export_verification_failed'',
      ''organization_export_job'', p_export_job_id::text,
      jsonb_build_object(''safeErrorCode'', ''verification_failed''));
    return query select ''verification_failed''::text,
      jsonb_build_object(''id'', p_export_job_id, ''status'', ''failed'',
        ''errorCode'', ''verification_failed'');
    return;
  end if;';

  if position(v_missing_snapshot_old in v_definition) > 0 then
    v_definition := replace(v_definition, v_missing_snapshot_old, v_missing_snapshot_new);
  elsif position('if not found then
    update public.organization_export_jobs set status = ''failed''' in v_definition) = 0 then
    raise exception 'M1 missing-snapshot branch anchor missing';
  end if;

  v_inventory_old := '     or v_artifact_count <> v_inventory_count
     or exists (';
  v_inventory_new := '     or v_snapshot.materialized_at is null
     or jsonb_typeof(v_snapshot.artifact_inventory) <> ''array''
     or v_artifact_count <> v_inventory_count
     or exists (';

  if position('or v_snapshot.materialized_at is null' in v_definition) = 0 then
    if position(v_inventory_old in v_definition) = 0 then
      raise exception 'M1 inventory verification anchor missing';
    end if;
    v_definition := replace(v_definition, v_inventory_old, v_inventory_new);
  end if;

  execute v_definition;
end $$;

alter function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) to service_role;

alter function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) owner to postgres;
revoke all on function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) to service_role;
