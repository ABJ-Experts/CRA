-- Correct already-migrated tenant-administration databases without reset.
-- The base migration carries the converged clean-install definition; this
-- additive migration changes the previously deployed function bodies/defaults.

alter table public.retention_authority_states alter column available set default false;
update public.retention_authority_states
   set available = false, safe_error_code = 'unavailable'
 where last_reconciled_at is null;

drop trigger if exists set_organization_settings_updated_at on public.organization_settings;
create trigger set_organization_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();
drop trigger if exists set_organization_lifecycles_updated_at on public.organization_lifecycles;
create trigger set_organization_lifecycles_updated_at before update on public.organization_lifecycles
  for each row execute function public.set_updated_at();
drop trigger if exists set_organization_retention_policies_updated_at on public.organization_retention_policies;
create trigger set_organization_retention_policies_updated_at before update on public.organization_retention_policies
  for each row execute function public.set_updated_at();
drop trigger if exists set_evidence_protection_watermarks_updated_at on public.evidence_protection_watermarks;
create trigger set_evidence_protection_watermarks_updated_at before update on public.evidence_protection_watermarks
  for each row execute function public.set_updated_at();
drop trigger if exists set_retention_cleanup_runs_updated_at on public.retention_cleanup_runs;
create trigger set_retention_cleanup_runs_updated_at before update on public.retention_cleanup_runs
  for each row execute function public.set_updated_at();
drop trigger if exists set_retention_cleanup_items_updated_at on public.retention_cleanup_items;
create trigger set_retention_cleanup_items_updated_at before update on public.retention_cleanup_items
  for each row execute function public.set_updated_at();
drop trigger if exists set_organization_export_jobs_updated_at on public.organization_export_jobs;
create trigger set_organization_export_jobs_updated_at before update on public.organization_export_jobs
  for each row execute function public.set_updated_at();
drop trigger if exists set_organization_purge_jobs_updated_at on public.organization_purge_jobs;
create trigger set_organization_purge_jobs_updated_at before update on public.organization_purge_jobs
  for each row execute function public.set_updated_at();
drop trigger if exists set_organization_purge_work_items_updated_at on public.organization_purge_work_items;
create trigger set_organization_purge_work_items_updated_at before update on public.organization_purge_work_items
  for each row execute function public.set_updated_at();
drop trigger if exists set_organization_deletion_artifact_work_updated_at on public.organization_deletion_artifact_work;
create trigger set_organization_deletion_artifact_work_updated_at before update on public.organization_deletion_artifact_work
  for each row execute function public.set_updated_at();

create or replace function public.reconcile_organization_retention_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_authority_kind text,
  p_authority_available boolean,
  p_facts jsonb
)
  returns table (outcome text, policies jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_fact jsonb;
  v_class text;
  v_record_id uuid;
  v_days integer;
  v_protect_through timestamptz;
  v_policy public.organization_retention_policies%rowtype;
  v_snapshot_id uuid;
  v_reason_json jsonb;
  v_floor integer;
begin
  if p_authority_kind not in ('product','evidence_class','obligation','legal_hold')
     or jsonb_typeof(p_facts) <> 'array' then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  -- Validate the complete provider payload before changing authority state or
  -- facts so one malformed trailing record cannot leave a partial reconcile.
  for v_fact in select value from jsonb_array_elements(p_facts) loop
    begin
      v_class := v_fact->>'evidenceClass';
      v_record_id := (v_fact->>'recordId')::uuid;
      v_days := (v_fact->>'requiredRetentionDays')::integer;
      v_protect_through := nullif(v_fact->>'protectThrough', '')::timestamptz;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
    if v_days not between 0 and 36500 or not exists (
      select 1 from public.organization_retention_policies
      where organization_id = p_organization_id and evidence_class = v_class
    ) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
  end loop;
  update public.retention_authority_states set
    available = p_authority_available, last_reconciled_at = now(),
    safe_error_code = case when p_authority_available then null else 'unavailable' end
  where organization_id = p_organization_id and authority_kind = p_authority_kind;
  if not p_authority_available then
    insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'organization.retention_authority_unavailable',
      'retention_authority', p_authority_kind, jsonb_build_object('authorityKind', p_authority_kind));
    return query select 'unavailable'::text, null::jsonb;
    return;
  end if;

  for v_fact in select value from jsonb_array_elements(p_facts) loop
    begin
      v_class := v_fact->>'evidenceClass';
      v_record_id := (v_fact->>'recordId')::uuid;
      v_days := (v_fact->>'requiredRetentionDays')::integer;
      v_protect_through := nullif(v_fact->>'protectThrough', '')::timestamptz;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
    if v_days not between 0 and 36500 or not exists (
      select 1 from public.organization_retention_policies
      where organization_id = p_organization_id and evidence_class = v_class
    ) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
    insert into public.retention_authoritative_facts (
      organization_id, evidence_class, reason_kind, source_record_id,
      required_retention_days, protect_through
    ) values (p_organization_id, v_class, p_authority_kind, v_record_id, v_days, v_protect_through)
    on conflict (organization_id, evidence_class, reason_kind, source_record_id) do update
      set required_retention_days = greatest(
            retention_authoritative_facts.required_retention_days,
            excluded.required_retention_days),
          protect_through = greatest(
            coalesce(retention_authoritative_facts.protect_through, '-infinity'),
            coalesce(excluded.protect_through, '-infinity')),
          active = true, last_observed_at = now();
    if v_protect_through is not null then
      insert into public.evidence_protection_watermarks (
        organization_id, evidence_class, protected_through
      ) values (p_organization_id, v_class, v_protect_through)
      on conflict (organization_id, evidence_class) do update
        set protected_through = greatest(
              evidence_protection_watermarks.protected_through,
              excluded.protected_through),
            updated_at = now();
    end if;
  end loop;

  for v_policy in select * from public.organization_retention_policies
    where organization_id = p_organization_id for update
  loop
    select coalesce(max(required_retention_days), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'kind', reason_kind, 'recordId', source_record_id,
        'requiredRetentionDays', required_retention_days,
        'protectThrough', protect_through
      ) order by reason_kind, source_record_id), '[]'::jsonb)
      into v_floor, v_reason_json
      from public.retention_authoritative_facts
      where organization_id = p_organization_id
        and evidence_class = v_policy.evidence_class and active;
    if v_floor <> v_policy.effective_floor_days or p_facts <> '[]'::jsonb then
      v_policy.floor_snapshot_version := v_policy.floor_snapshot_version + 1;
      insert into public.retention_floor_snapshots (
        organization_id, evidence_class, snapshot_version,
        effective_floor_days, reason_digest
      ) values (
        p_organization_id, v_policy.evidence_class, v_policy.floor_snapshot_version,
        v_floor, encode(extensions.digest(v_reason_json::text, 'sha256'), 'hex')
      ) returning id into v_snapshot_id;
      insert into public.retention_floor_reasons (
        snapshot_id, organization_id, evidence_class, reason_kind,
        source_record_id, required_retention_days, protect_through
      )
      select v_snapshot_id, p_organization_id, v_policy.evidence_class,
        f.reason_kind, f.source_record_id, f.required_retention_days, f.protect_through
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id
        and f.evidence_class = v_policy.evidence_class and f.active
      order by f.reason_kind, f.source_record_id;
      update public.organization_retention_policies set
        version = version + 1, floor_snapshot_version = v_policy.floor_snapshot_version,
        effective_floor_days = v_floor,
        effective_retention_days = greatest(requested_retention_days, v_floor),
        updated_by = p_actor_user_id, updated_at = now()
      where id = v_policy.id;
    end if;
  end loop;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.retention_reconciled',
    'organization_retention_policy_set', p_organization_id::text,
    jsonb_build_object('authorityKind', p_authority_kind, 'factCount', jsonb_array_length(p_facts)));
  return query select 'reconciled'::text, coalesce(jsonb_agg(
    public.m1_retention_policy_json(p_organization_id, p.evidence_class)
    order by p.evidence_class), '[]'::jsonb)
  from public.organization_retention_policies p where p.organization_id = p_organization_id;
end;
$$;

create or replace function public.claim_retention_cleanup_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (
    outcome text, cleanup_run_id uuid, lease_owner uuid,
    checkpoint_version integer, blocked_reasons jsonb
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_run public.retention_cleanup_runs%rowtype;
  v_reasons jsonb;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  select * into v_run from public.retention_cleanup_runs
   where organization_id = p_organization_id
     and (
       (status in ('queued','retry') and available_at <= now())
       or (status = 'running' and lease_expires_at <= now())
     )
   order by created_at for update skip locked limit 1;
  if not found then
    return query select case when exists (select 1 from public.organizations where id = p_organization_id)
      then 'none_available' else 'not_found' end,
      null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  if exists (select 1 from public.retention_authority_states
    where organization_id = p_organization_id and not available) then
    v_reasons := coalesce((select jsonb_agg(jsonb_build_object(
      'kind', authority_kind, 'code', 'unavailable') order by authority_kind)
      from public.retention_authority_states
      where organization_id = p_organization_id and not available), '[]'::jsonb);
    update public.retention_cleanup_runs set status = 'retry', safe_error_code = 'unavailable',
      safe_diagnostics = jsonb_build_object('authorityRecheck', 'failed_closed'),
      blocked_reasons = v_reasons, attempt_count = attempt_count + 1,
      available_at = now() + interval '1 minute', updated_at = now()
    where id = v_run.id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.retention_cleanup_unavailable',
      'retention_cleanup_run', v_run.id::text, jsonb_build_object('outcome', 'unavailable'));
    return query select 'unavailable'::text, v_run.id, null::uuid,
      v_run.checkpoint_version, v_reasons;
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', f.reason_kind, 'recordId', f.source_record_id,
    'requiredRetentionDays', f.required_retention_days,
    'protectThrough', f.protect_through
  ) order by f.reason_kind, f.source_record_id), '[]'::jsonb)
  into v_reasons
  from public.retention_authoritative_facts f
  where f.organization_id = p_organization_id
    and f.evidence_class = v_run.evidence_class and f.active
    and (f.reason_kind = 'legal_hold' or f.protect_through > now());
  if jsonb_array_length(v_reasons) > 0 then
    update public.retention_cleanup_runs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      updated_at = now() where id = v_run.id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.retention_cleanup_blocked',
      'retention_cleanup_run', v_run.id::text,
      jsonb_build_object('reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_run.id, null::uuid,
      v_run.checkpoint_version, v_reasons;
    return;
  end if;
  update public.retention_cleanup_runs set status = 'running',
    lease_owner = p_lease_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()),
    safe_error_code = null, safe_diagnostics = null, blocked_reasons = '[]', updated_at = now()
  where id = v_run.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_claimed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('checkpointVersion', v_run.checkpoint_version));
  return query select 'claimed'::text, v_run.id, p_lease_owner,
    v_run.checkpoint_version, '[]'::jsonb;
end;
$$;

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
begin
  select * into v_run from public.retention_cleanup_runs
  where id = p_cleanup_run_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_run.status <> 'running' or v_run.lease_owner <> p_lease_owner
     or v_run.lease_expires_at <= now() or v_run.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_run.checkpoint_version; return;
  end if;
  -- The authoritative check is repeated in the completion transaction, after
  -- the worker has selected candidates and immediately before accepting delete.
  if exists (select 1 from public.retention_authority_states
      where organization_id = p_organization_id and not available)
     or exists (select 1 from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id and f.evidence_class = v_run.evidence_class
        and f.active and (f.reason_kind = 'legal_hold' or f.protect_through > now())) then
    update public.retention_cleanup_runs set status = 'blocked',
      safe_error_code = 'retention_protected', lease_owner = null, lease_expires_at = null,
      updated_at = now() where id = v_run.id;
    return query select 'blocked'::text, v_run.checkpoint_version; return;
  end if;
  if jsonb_typeof(p_item_results) <> 'array' then
    return query select 'invalid_request'::text, v_run.checkpoint_version; return;
  end if;
  if jsonb_array_length(p_item_results) <> (
    select count(*) from public.retention_cleanup_items
    where organization_id = p_organization_id and cleanup_run_id = p_cleanup_run_id
      and status = 'pending'
  ) then
    return query select 'invalid_request'::text, v_run.checkpoint_version; return;
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
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_completed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('checkpointVersion', v_run.checkpoint_version + 1,
      'itemCount', jsonb_array_length(p_item_results)));
  return query select 'completed'::text, v_run.checkpoint_version + 1;
end;
$$;

create or replace function public.fail_retention_cleanup_atomic(
  p_organization_id uuid,
  p_cleanup_run_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_safe_error_code text,
  p_retryable boolean,
  p_safe_diagnostics jsonb default null
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_run public.retention_cleanup_runs%rowtype; v_status text;
begin
  select * into v_run from public.retention_cleanup_runs
  where id = p_cleanup_run_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_run.status <> 'running' or v_run.lease_owner <> p_lease_owner
     or v_run.lease_expires_at <= now()
     or v_run.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_run.status; return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64
     or (p_safe_diagnostics is not null and jsonb_typeof(p_safe_diagnostics) <> 'object') then
    return query select 'invalid_request'::text, v_run.status; return;
  end if;
  v_status := case when p_retryable and v_run.attempt_count < v_run.max_attempts
    then 'retry' else 'dead_letter' end;
  update public.retention_cleanup_runs set status = v_status,
    safe_error_code = p_safe_error_code, safe_diagnostics = p_safe_diagnostics,
    available_at = now() + interval '1 minute', lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = v_run.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.retention_cleanup_failed',
    'retention_cleanup_run', v_run.id::text,
    jsonb_build_object('status', v_status, 'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
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
     or p_manifest_file_count <> v_actual_count
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

create or replace function public.fail_organization_export_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_safe_error_code text,
  p_retryable boolean,
  p_pause boolean default false,
  p_safe_diagnostics jsonb default null
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype; v_status text;
begin
  select * into v_job from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.status; return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64
     or (p_safe_diagnostics is not null and jsonb_typeof(p_safe_diagnostics) <> 'object') then
    return query select 'invalid_request'::text, v_job.status; return;
  end if;
  v_status := case when p_pause then 'paused'
    when p_retryable and v_job.attempt_count < v_job.max_attempts then 'queued'
    when p_retryable then 'dead_letter' else 'failed' end;
  update public.organization_export_jobs set status = v_status,
    safe_error_code = p_safe_error_code, safe_diagnostics = p_safe_diagnostics,
    available_at = now() + interval '1 minute', lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = p_export_job_id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_failed', 'organization_export_job',
    p_export_job_id::text, jsonb_build_object('status', v_status,
      'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
end;
$$;

create or replace function public.complete_organization_purge_atomic(
  p_organization_id uuid,
  p_purge_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
)
  returns table (outcome text, deletion_proof_id uuid)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_purge_jobs%rowtype;
  v_lifecycle public.organization_lifecycles%rowtype;
  v_slug text;
  v_proof uuid;
  v_reasons jsonb;
begin
  select * into v_job from public.organization_purge_jobs
   where id = p_purge_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  select slug into v_slug from public.organizations where id = p_organization_id;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version
     or v_lifecycle.status <> 'purging' then
    return query select 'conflict'::text, null::uuid; return;
  end if;
  -- Final, same-transaction authority check. Any missing authority or newly
  -- observed hold aborts deletion and retains every controlling reason.
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
      where f.organization_id = p_organization_id and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  if jsonb_array_length(v_reasons) > 0 then
    update public.organization_purge_jobs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_purge_job_id and organization_id = p_organization_id;
    update public.organization_lifecycles set status = 'purge_blocked',
      version = version + 1, changed_at = now(), purge_block_reasons = v_reasons,
      safe_error_code = 'invalid_state', updated_at = now()
    where organization_id = p_organization_id and status = 'purging';
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.purge_blocked', 'organization_purge_job',
      p_purge_job_id::text, jsonb_build_object(
        'phase', 'final_completion_recheck',
        'reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, null::uuid; return;
  end if;
  insert into public.organization_deletion_proofs (
    deleted_organization_id, organization_slug_digest, purge_job_id,
    lifecycle_version, database_deleted_at
  ) values (
    p_organization_id, encode(extensions.digest(v_slug, 'sha256'), 'hex'),
    p_purge_job_id, v_lifecycle.version, now()
  ) returning id into v_proof;
  insert into public.organization_deletion_artifact_work (
    deletion_proof_id, bucket_id, object_prefix
  ) values (v_proof, 'tenant-exports', p_organization_id::text || '/');
  update public.organization_purge_work_items w set status = 'completed',
    checkpoint_version = w.checkpoint_version + 1, updated_at = now()
  where organization_id = p_organization_id and purge_job_id = p_purge_job_id
    and work_kind in ('artifact_inventory','database_delete');
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purged', 'organization_deletion_proof',
    v_proof::text, jsonb_build_object('lifecycleVersion', v_lifecycle.version));
  -- Cascades remove tenant rows, including the old tenant audit stream and job.
  -- The proof/artifact work above has no tenant FK and survives this statement.
  delete from public.organizations where id = p_organization_id;
  return query select 'purged'::text, v_proof;
end;
$$;

create or replace function public.fail_organization_purge_atomic(
  p_organization_id uuid,
  p_purge_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_safe_error_code text,
  p_retryable boolean,
  p_safe_diagnostics jsonb default null
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_purge_jobs%rowtype; v_status text;
begin
  select * into v_job from public.organization_purge_jobs
   where id = p_purge_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.status; return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64
     or (p_safe_diagnostics is not null and jsonb_typeof(p_safe_diagnostics) <> 'object') then
    return query select 'invalid_request'::text, v_job.status; return;
  end if;
  v_status := case when p_retryable and v_job.attempt_count < v_job.max_attempts
    then 'retry' else 'dead_letter' end;
  update public.organization_purge_jobs set status = v_status,
    safe_error_code = p_safe_error_code, safe_diagnostics = p_safe_diagnostics,
    available_at = now() + interval '1 minute', lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = p_purge_job_id;
  if v_status = 'dead_letter' then
    update public.organization_lifecycles l set status = 'purge_blocked',
      version = l.version + 1, changed_at = now(), safe_error_code = 'invalid_state',
      purge_block_reasons = jsonb_build_array(jsonb_build_object(
        'kind', 'worker_failure', 'code', p_safe_error_code)), updated_at = now()
    where l.organization_id = p_organization_id and l.status = 'purging';
  end if;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purge_failed', 'organization_purge_job',
    p_purge_job_id::text, jsonb_build_object('status', v_status,
      'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
end;
$$;
