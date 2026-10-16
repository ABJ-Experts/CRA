-- Enforce exact cleanup/export ledgers and persist final cleanup blocks.
-- Additive correction for databases that already applied the foundation.

create or replace function public.complete_retention_cleanup_atomic(
  p_organization_id uuid,
  p_cleanup_run_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_item_results jsonb
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_run public.retention_cleanup_runs%rowtype;
  v_result jsonb;
  v_item public.retention_cleanup_items%rowtype;
  v_current_watermark timestamptz;
  v_reasons jsonb;
begin
  select * into v_run from public.retention_cleanup_runs
  where id = p_cleanup_run_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_run.status <> 'running' or v_run.lease_owner <> p_lease_owner
     or v_run.lease_expires_at <= now() or v_run.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_run.checkpoint_version; return;
  end if;
  if p_item_results is null or jsonb_typeof(p_item_results) <> 'array' then
    return query select 'invalid_request'::text, v_run.checkpoint_version; return;
  end if;
  if jsonb_array_length(p_item_results) <> (
      select count(*) from public.retention_cleanup_items
      where organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id
        and status = 'pending'
    )
    or jsonb_array_length(p_item_results) <> (
      select count(distinct value->>'itemId') from jsonb_array_elements(p_item_results)
    )
    or exists (
      select 1 from jsonb_array_elements(p_item_results) supplied(value)
      where jsonb_typeof(value) <> 'object'
        or value->>'itemId' is null
        or value->>'status' is null
        or value->>'status' not in ('deleted','skipped_protected','failed')
        or not exists (
          select 1 from public.retention_cleanup_items i
          where i.id::text = value->>'itemId'
            and i.organization_id = p_organization_id
            and i.cleanup_run_id = p_cleanup_run_id and i.status = 'pending'
        )
    )
    or exists (
      select 1 from public.retention_cleanup_items i
      where i.organization_id = p_organization_id
        and i.cleanup_run_id = p_cleanup_run_id and i.status = 'pending'
        and not exists (
          select 1 from jsonb_array_elements(p_item_results) supplied(value)
          where value->>'itemId' = i.id::text
        )
    ) then
    return query select 'invalid_request'::text, v_run.checkpoint_version; return;
  end if;
  -- The authoritative check is repeated in the completion transaction, after
  -- the worker has selected candidates and immediately before accepting delete.
  select coalesce(jsonb_agg(reason order by reason->>'kind', reason->>'recordId'), '[]'::jsonb)
    into v_reasons from (
      select jsonb_build_object('kind', s.authority_kind, 'code', 'unavailable') reason
      from public.retention_authority_states s
      where s.organization_id = p_organization_id and not s.available
      union all
      select jsonb_build_object('kind', f.reason_kind, 'recordId', f.source_record_id,
        'requiredRetentionDays', f.required_retention_days,
        'protectThrough', f.protect_through)
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id
        and f.evidence_class = v_run.evidence_class and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  if jsonb_array_length(v_reasons) > 0 then
    update public.retention_cleanup_runs set status = 'blocked',
      safe_error_code = 'retention_protected', lease_owner = null, lease_expires_at = null,
      blocked_reasons = v_reasons,
      updated_at = now() where id = v_run.id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.retention_cleanup_blocked',
      'retention_cleanup_run', v_run.id::text,
      jsonb_build_object('phase', 'final_completion_recheck',
        'reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_run.checkpoint_version; return;
  end if;
  select protected_through into v_current_watermark
    from public.evidence_protection_watermarks
   where organization_id = p_organization_id and evidence_class = v_run.evidence_class;
  for v_result in select value from jsonb_array_elements(p_item_results) loop
    begin
      select * into strict v_item from public.retention_cleanup_items
       where id = (v_result->>'itemId')::uuid
         and organization_id = p_organization_id
         and cleanup_run_id = p_cleanup_run_id and status = 'pending'
       for update;
    exception when others then
      return query select 'invalid_request'::text, v_run.checkpoint_version; return;
    end;
    if v_result->>'status' not in ('deleted','skipped_protected','failed') then
      return query select 'invalid_request'::text, v_run.checkpoint_version; return;
    end if;
    if v_result->>'status' = 'deleted' and (
      v_item.protection_watermark < v_current_watermark
      or v_item.observed_at > now() - make_interval(days => (
        select effective_retention_days from public.organization_retention_policies
         where organization_id = p_organization_id and evidence_class = v_run.evidence_class
      ))
    ) then
      update public.retention_cleanup_runs set status = 'blocked',
        safe_error_code = 'retention_protected', lease_owner = null,
        lease_expires_at = null, blocked_reasons = jsonb_build_array(jsonb_build_object(
          'kind', 'evidence_watermark', 'recordId', v_item.source_record_id)),
        updated_at = now() where id = v_run.id;
      insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
      values (p_organization_id, 'organization.retention_cleanup_blocked',
        'retention_cleanup_run', v_run.id::text,
        jsonb_build_object('phase', 'final_completion_recheck', 'reasonCount', 1));
      return query select 'blocked'::text, v_run.checkpoint_version; return;
    end if;
  end loop;
  for v_result in select value from jsonb_array_elements(p_item_results) loop
    update public.retention_cleanup_items set
      status = v_result->>'status',
      safe_error_code = nullif(v_result->>'safeErrorCode', ''),
      attempt_count = attempt_count + 1, updated_at = now()
    where id = (v_result->>'itemId')::uuid
      and organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id;
  end loop;
  update public.retention_cleanup_runs r set status = 'completed',
    checkpoint_version = r.checkpoint_version + 1, completed_at = now(),
    lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = v_run.id;
  if exists (select 1 from public.retention_cleanup_items
    where organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id
      and status = 'pending') then
    raise exception 'cleanup completion left pending items' using errcode = 'check_violation';
  end if;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_completed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('checkpointVersion', v_run.checkpoint_version + 1,
      'itemCount', jsonb_array_length(p_item_results)));
  return query select 'completed'::text, v_run.checkpoint_version + 1;
end;
$$;

create or replace function public.checkpoint_organization_export_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_completed_parts integer,
  p_total_parts integer,
  p_parts jsonb
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_part jsonb;
  v_predicted_count integer;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array'
     or p_total_parts <= 0 or p_completed_parts < v_job.completed_parts
     or p_total_parts < p_completed_parts
     or jsonb_array_length(p_parts) <> (
       select count(distinct (value->>'sourceId', value->>'partNumber'))
       from jsonb_array_elements(p_parts)
     ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    begin
      if jsonb_typeof(v_part) <> 'object'
         or not exists (select 1 from public.organization_export_sources
           where source_id = v_part->>'sourceId' and enabled)
         or (v_part->>'sha256') !~ '^[0-9a-f]{64}$'
         or coalesce((v_part->>'partNumber')::integer, 0) <= 0
         or coalesce((v_part->>'byteSize')::bigint, -1) < 0
         or (v_part->>'objectPath') !~ ('^' || p_organization_id::text || '/') then
        return query select 'invalid_request'::text, v_job.checkpoint_version; return;
      end if;
    exception when others then
      return query select 'invalid_request'::text, v_job.checkpoint_version; return;
    end;
  end loop;
  select count(*) into v_predicted_count from (
    select source_id, part_number
    from public.organization_export_parts
    where organization_id = p_organization_id and export_job_id = p_export_job_id
    union
    select value->>'sourceId', (value->>'partNumber')::integer
    from jsonb_array_elements(p_parts)
  ) ledger;
  if v_predicted_count <> p_completed_parts then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    insert into public.organization_export_parts (
      organization_id, export_job_id, source_id, part_number, object_path, sha256, byte_size
    ) values (p_organization_id, p_export_job_id, v_part->>'sourceId',
      (v_part->>'partNumber')::integer, v_part->>'objectPath', v_part->>'sha256',
      (v_part->>'byteSize')::bigint)
    on conflict (organization_id, export_job_id, source_id, part_number) do update
      set object_path = excluded.object_path, sha256 = excluded.sha256,
          byte_size = excluded.byte_size;
  end loop;
  update public.organization_export_jobs j set completed_parts = p_completed_parts,
    total_parts = p_total_parts, checkpoint_version = j.checkpoint_version + 1,
    updated_at = now() where id = p_export_job_id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_checkpointed',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('checkpointVersion', v_job.checkpoint_version + 1,
      'completedParts', p_completed_parts, 'totalParts', p_total_parts));
  return query select 'checkpointed'::text, v_job.checkpoint_version + 1;
end;
$$;

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
     or p_artifact_object_path is not null
        and p_artifact_object_path !~ ('^' || p_organization_id::text || '/') then
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
