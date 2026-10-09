-- Normalize the lifecycle projection for the strict Task 1 contract.
-- This applies the converged base definitions to previously migrated databases.

create or replace function public.m1_normalize_lifecycle_blockers(p_reasons jsonb)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with raw as (
    select value
    from jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb))
  ), normalized as (
    select jsonb_build_object(
      'kind', 'unavailable', 'code', 'dependency_unavailable'
    ) as blocker
    where exists (
      select 1
      from raw
      where value->>'code' = 'unavailable'
         or (
           value->>'kind' = 'unavailable'
           and value->>'code' = 'dependency_unavailable'
         )
    )

    union all

    select jsonb_build_object(
      'kind', 'worker_failure', 'code', 'worker_failure'
    ) as blocker
    where exists (select 1 from raw where value->>'kind' = 'worker_failure')

    union all

    select jsonb_build_object(
      'kind', value->>'kind',
      'recordId', value->>'recordId',
      'requiredRetentionDays', (value->>'requiredRetentionDays')::integer
    ) as blocker
    from raw
    where value->>'kind' in ('product', 'evidence_class', 'obligation', 'legal_hold')
      and value->>'recordId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and value->>'requiredRetentionDays' ~ '^[0-9]+$'
  )
  select coalesce(jsonb_agg(distinct blocker order by blocker), '[]'::jsonb)
  from normalized;
$$;

create or replace function public.m1_organization_lifecycle_json(p_organization_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', l.status,
    'version', l.version,
    'changedAt', l.changed_at,
    'blockers', public.m1_normalize_lifecycle_blockers(l.purge_block_reasons),
    'error', case
      when l.status <> 'purge_blocked' then null
      when public.m1_normalize_lifecycle_blockers(l.purge_block_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        ))
      then jsonb_build_object(
        'code', 'unavailable',
        'message', 'Organization administration request could not be completed.'
      )
      else jsonb_build_object(
        'code', 'invalid_state',
        'message', 'Organization administration request could not be completed.'
      )
    end
  )
  from public.organization_lifecycles l
  where l.organization_id = p_organization_id;
$$;

create or replace function public.get_organization_lifecycle(p_organization_id uuid)
  returns table (outcome text, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organization_lifecycles where organization_id = p_organization_id) then
    return query select 'not_found'::text, null::jsonb;
  else
    return query select 'found'::text, public.m1_organization_lifecycle_json(p_organization_id);
  end if;
end;
$$;

create or replace function public.deactivate_organization_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reauth_grant_id uuid,
  p_expected_version integer,
  p_confirmation text
)
  returns table (outcome text, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_lifecycle public.organization_lifecycles%rowtype;
begin
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  if not found or not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id and role = 'owner') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  -- Check the grant before version/state so a replay does not become a version oracle.
  if not public.consume_destructive_reauth_grant_atomic(p_organization_id,
    p_actor_user_id, p_session_id, p_reauth_grant_id, p_expected_version, 'deactivate') then
    return query select 'invalid_grant'::text, null::jsonb; return;
  end if;
  if p_confirmation <> 'DEACTIVATE ORGANIZATION' then
    raise exception 'invalid confirmation' using errcode = '22023';
  end if;
  if v_lifecycle.version <> p_expected_version then
    raise exception 'stale lifecycle version' using errcode = '40001';
  end if;
  if v_lifecycle.status <> 'active' then
    raise exception 'invalid lifecycle state' using errcode = '55000';
  end if;
  update public.organization_lifecycles set status = 'deactivated',
    version = version + 1, changed_at = now(), changed_by = p_actor_user_id,
    deactivated_at = now(), purge_after = null, purge_block_reasons = '[]',
    safe_error_code = null, updated_at = now()
   where organization_id = p_organization_id;
  update public.organizations set is_active = false where id = p_organization_id;
  update public.organization_export_jobs set status = 'paused',
    safe_error_code = 'organization_deactivated', lease_owner = null,
    lease_expires_at = null, updated_at = now()
   where organization_id = p_organization_id and status in ('queued','running');
  insert into public.organization_session_revocations (
    organization_id, session_id, user_id, reason, lifecycle_version
  )
  select b.organization_id, b.session_id, b.user_id, 'organization_deactivated',
    v_lifecycle.version + 1
  from public.organization_session_bindings b
  join public.organization_members m on m.organization_id = b.organization_id
    and m.user_id = b.user_id
  where b.organization_id = p_organization_id
  on conflict (organization_id, session_id) do update set
    reason = excluded.reason, lifecycle_version = excluded.lifecycle_version,
    revoked_at = excluded.revoked_at;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.deactivated',
    'organization_lifecycle', p_organization_id::text,
    jsonb_build_object('beforeStatus', 'active', 'afterStatus', 'deactivated',
      'beforeVersion', v_lifecycle.version, 'afterVersion', v_lifecycle.version + 1));
  return query select 'deactivated'::text,
    public.m1_organization_lifecycle_json(p_organization_id);
exception when sqlstate '22023' then
  return query select 'invalid_request'::text, null::jsonb;
when sqlstate '40001' then
  return query select 'conflict'::text, null::jsonb;
when sqlstate '55000' then
  return query select 'invalid_state'::text, null::jsonb;
end;
$$;

create or replace function public.recover_organization_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reauth_grant_id uuid,
  p_expected_version integer
)
  returns table (outcome text, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_lifecycle public.organization_lifecycles%rowtype;
begin
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  if not found or not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id and role = 'owner') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not public.consume_destructive_reauth_grant_atomic(p_organization_id,
    p_actor_user_id, p_session_id, p_reauth_grant_id, p_expected_version, 'recover') then
    return query select 'invalid_grant'::text, null::jsonb; return;
  end if;
  if v_lifecycle.version <> p_expected_version then
    raise exception 'stale lifecycle version' using errcode = '40001';
  end if;
  if v_lifecycle.status not in ('deactivated','purge_scheduled','purge_blocked') then
    raise exception 'invalid lifecycle state' using errcode = '55000';
  end if;
  update public.organization_lifecycles set status = 'active', version = version + 1,
    changed_at = now(), changed_by = p_actor_user_id, purge_after = null,
    purge_block_reasons = '[]', safe_error_code = null, updated_at = now()
  where organization_id = p_organization_id;
  update public.organizations set is_active = true where id = p_organization_id;
  update public.organization_export_jobs set status = 'queued', safe_error_code = null,
    available_at = now(), updated_at = now()
  where organization_id = p_organization_id and status = 'paused';
  delete from public.organization_purge_jobs where organization_id = p_organization_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.recovered',
    'organization_lifecycle', p_organization_id::text,
    jsonb_build_object('beforeStatus', v_lifecycle.status, 'afterStatus', 'active',
      'beforeVersion', v_lifecycle.version, 'afterVersion', v_lifecycle.version + 1));
  return query select 'recovered'::text,
    public.m1_organization_lifecycle_json(p_organization_id);
exception when sqlstate '40001' then return query select 'conflict'::text, null::jsonb;
when sqlstate '55000' then return query select 'invalid_state'::text, null::jsonb;
end;
$$;

create or replace function public.schedule_organization_purge_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reauth_grant_id uuid,
  p_expected_version integer,
  p_confirmation text
)
  returns table (outcome text, purge_job_id uuid, lifecycle jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_lifecycle public.organization_lifecycles%rowtype; v_slug text; v_job uuid; v_purge_after timestamptz;
begin
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  select slug into v_slug from public.organizations where id = p_organization_id;
  if not found or not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_user_id and role = 'owner') then
    return query select 'not_found'::text, null::uuid, null::jsonb; return;
  end if;
  if not public.consume_destructive_reauth_grant_atomic(p_organization_id,
    p_actor_user_id, p_session_id, p_reauth_grant_id, p_expected_version, 'schedule_purge') then
    return query select 'invalid_grant'::text, null::uuid, null::jsonb; return;
  end if;
  if p_confirmation <> 'DELETE ' || v_slug then
    raise exception 'invalid confirmation' using errcode = '22023';
  end if;
  if v_lifecycle.version <> p_expected_version then
    raise exception 'stale lifecycle version' using errcode = '40001';
  end if;
  if v_lifecycle.status <> 'deactivated' then
    raise exception 'invalid lifecycle state' using errcode = '55000';
  end if;
  v_purge_after := now() + interval '30 days';
  update public.organization_lifecycles set status = 'purge_scheduled',
    version = version + 1, changed_at = now(), changed_by = p_actor_user_id,
    purge_after = v_purge_after, purge_block_reasons = '[]',
    safe_error_code = null, updated_at = now()
  where organization_id = p_organization_id;
  insert into public.organization_purge_jobs (
    organization_id, requested_by, lifecycle_version, purge_after, available_at
  ) values (p_organization_id, p_actor_user_id, v_lifecycle.version + 1,
    v_purge_after, v_purge_after) returning id into v_job;
  insert into public.organization_purge_work_items (
    organization_id, purge_job_id, work_kind
  ) values (p_organization_id, v_job, 'final_eligibility'),
           (p_organization_id, v_job, 'artifact_inventory'),
           (p_organization_id, v_job, 'database_delete');
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'organization.purge_scheduled',
    'organization_purge_job', v_job::text,
    jsonb_build_object('purgeAfter', v_purge_after,
      'lifecycleVersion', v_lifecycle.version + 1));
  return query select 'scheduled'::text, v_job,
    public.m1_organization_lifecycle_json(p_organization_id);
exception when unique_violation then
  return query select 'conflict'::text, null::uuid, null::jsonb;
when sqlstate '22023' then return query select 'invalid_request'::text, null::uuid, null::jsonb;
when sqlstate '40001' then return query select 'conflict'::text, null::uuid, null::jsonb;
when sqlstate '55000' then return query select 'invalid_state'::text, null::uuid, null::jsonb;
end;
$$;

create or replace function public.claim_organization_purge_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (
    outcome text, purge_job_id uuid, lease_owner uuid,
    checkpoint_version integer, blocked_reasons jsonb
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_purge_jobs%rowtype; v_lifecycle public.organization_lifecycles%rowtype; v_reasons jsonb;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_lifecycle from public.organization_lifecycles
    where organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_job from public.organization_purge_jobs
   where organization_id = p_organization_id
     and status in ('scheduled','retry','running')
     and purge_after <= now() and available_at <= now()
     and (status <> 'running' or lease_expires_at <= now())
   for update skip locked;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
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
      updated_at = now() where id = v_job.id;
    update public.organization_lifecycles set status = 'purge_blocked',
      version = version + 1, changed_at = now(),
      purge_block_reasons = public.m1_normalize_lifecycle_blockers(v_reasons),
      safe_error_code = case when public.m1_normalize_lifecycle_blockers(v_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        )) then 'unavailable' else 'invalid_state' end,
      updated_at = now()
    where organization_id = p_organization_id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.purge_blocked', 'organization_purge_job',
      v_job.id::text, jsonb_build_object('reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_job.id, null::uuid,
      v_job.checkpoint_version, v_reasons; return;
  end if;
  if v_lifecycle.status not in ('purge_scheduled','purging') then
    return query select 'invalid_state'::text, v_job.id, null::uuid,
      v_job.checkpoint_version, '[]'::jsonb; return;
  end if;
  update public.organization_purge_jobs set status = 'running',
    lease_owner = p_lease_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1, updated_at = now() where id = v_job.id;
  update public.organization_lifecycles set status = 'purging',
    version = case when status = 'purging' then version else version + 1 end,
    changed_at = case when status = 'purging' then changed_at else now() end,
    purge_block_reasons = '[]', safe_error_code = null, updated_at = now()
  where organization_id = p_organization_id;
  update public.organization_purge_work_items w set status = 'completed',
    checkpoint_version = w.checkpoint_version + 1, updated_at = now()
  where w.organization_id = p_organization_id and w.purge_job_id = v_job.id
    and w.work_kind = 'final_eligibility';
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purge_claimed', 'organization_purge_job',
    v_job.id::text, jsonb_build_object('checkpointVersion', v_job.checkpoint_version));
  return query select 'claimed'::text, v_job.id, p_lease_owner,
    v_job.checkpoint_version, '[]'::jsonb;
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
      version = version + 1, changed_at = now(),
      purge_block_reasons = public.m1_normalize_lifecycle_blockers(v_reasons),
      safe_error_code = case when public.m1_normalize_lifecycle_blockers(v_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        )) then 'unavailable' else 'invalid_state' end,
      updated_at = now()
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
        'kind', 'worker_failure', 'code', 'worker_failure')),
      updated_at = now()
    where l.organization_id = p_organization_id and l.status = 'purging';
  end if;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.purge_failed', 'organization_purge_job',
    p_purge_job_id::text, jsonb_build_object('status', v_status,
      'safeErrorCode', p_safe_error_code));
  return query select 'recorded'::text, v_status;
end;
$$;

alter function public.m1_normalize_lifecycle_blockers(jsonb) owner to postgres;
alter function public.m1_organization_lifecycle_json(uuid) owner to postgres;
alter function public.get_organization_lifecycle(uuid) owner to postgres;
revoke all on function public.m1_normalize_lifecycle_blockers(jsonb) from public, anon, authenticated;
revoke all on function public.m1_organization_lifecycle_json(uuid) from public, anon, authenticated;
revoke all on function public.get_organization_lifecycle(uuid) from public, anon, authenticated;
grant execute on function public.get_organization_lifecycle(uuid) to service_role;

update public.organization_lifecycles l
   set purge_block_reasons = public.m1_normalize_lifecycle_blockers(l.purge_block_reasons),
       safe_error_code = case
         when public.m1_normalize_lifecycle_blockers(l.purge_block_reasons)
              @> jsonb_build_array(jsonb_build_object(
                'kind', 'unavailable', 'code', 'dependency_unavailable'
              ))
         then 'unavailable'
         else 'invalid_state'
       end
 where l.status = 'purge_blocked';
