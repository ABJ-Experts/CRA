-- A completed export is always a verified downloadable archive. Do not permit
-- legacy callers to complete a job without the canonical private ZIP path.
create or replace function public.complete_organization_export_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_manifest_file_count integer,
  p_manifest_sha256 text,
  p_artifact_sha256 text,
  p_artifact_object_path text default null
)
  returns table (outcome text, export_job jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype; v_actual_count integer;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  select count(*) into v_actual_count from public.organization_export_parts
    where organization_id = p_organization_id and export_job_id = p_export_job_id;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
     or v_actual_count <= 0
     or p_manifest_file_count <> v_actual_count
     or v_actual_count <> v_job.completed_parts
     or v_job.completed_parts <> v_job.total_parts
     or p_artifact_object_path is null
     or p_artifact_object_path <> (
       p_organization_id::text || '/' || p_export_job_id::text
         || '/organization-export-v1.zip'
     ) then
    update public.organization_export_jobs set status = 'failed',
      safe_error_code = 'verification_failed',
      safe_diagnostics = jsonb_build_object('verification', 'failed_closed'),
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_export_job_id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.export_verification_failed',
      'organization_export_job', p_export_job_id::text,
      jsonb_build_object('safeErrorCode', 'verification_failed'));
    return query select 'verification_failed'::text,
      jsonb_build_object('id', p_export_job_id, 'status', 'failed',
        'errorCode', 'verification_failed');
    return;
  end if;
  update public.organization_export_jobs set status = 'completed',
    manifest_format_version = 1, manifest_sha256 = p_manifest_sha256,
    artifact_sha256 = p_artifact_sha256, artifact_object_path = p_artifact_object_path,
    manifest_file_count = p_manifest_file_count, verified_at = now(),
    safe_error_code = null, safe_diagnostics = null,
    lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = p_export_job_id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_completed', 'organization_export_job',
    p_export_job_id::text, jsonb_build_object('formatVersion', 1,
      'fileCount', p_manifest_file_count, 'verified', true));
  return query select 'completed'::text,
    jsonb_build_object('id', p_export_job_id, 'status', 'completed',
      'manifest', jsonb_build_object('formatVersion', 1, 'sha256', p_manifest_sha256,
        'fileCount', p_manifest_file_count, 'verifiedAt', now()));
end;
$$;

alter function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) owner to postgres;
revoke all on function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_organization_export_atomic(
  uuid, uuid, uuid, integer, integer, text, text, text
) to service_role;
