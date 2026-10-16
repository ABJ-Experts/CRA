-- Durable worker composition, export coverage catalogue, and lifecycle
-- coordination for M1 tenant administration. This is intentionally additive:
-- the older implementations remain private legacy helpers so service-role
-- callers cannot bypass the active-lifecycle check added here.

insert into public.organization_export_sources (source_id, enabled, sort_order)
values
  ('organization_settings', true, 4),
  ('organization_lifecycles', true, 5),
  ('organization_retention_policies', true, 6),
  ('retention_authority_states', true, 7),
  ('retention_authoritative_facts', true, 8),
  ('retention_floor_snapshots', true, 9),
  ('retention_floor_reasons', true, 10),
  ('evidence_protection_watermarks', true, 11),
  ('retention_cleanup_runs', true, 12),
  ('retention_cleanup_items', true, 13),
  ('custom_roles', true, 14),
  ('base_role_permission_overrides', true, 15),
  ('menu_permissions', true, 16),
  ('user_role_assignments', true, 17),
  ('user_table_preferences', true, 18),
  ('organization_onboarding', true, 19),
  ('organization_onboarding_stages', true, 20),
  ('organization_onboarding_evidence', true, 21),
  ('organization_export_jobs', true, 22),
  ('organization_export_parts', true, 23),
  ('organization_export_snapshots', true, 24),
  ('organization_purge_jobs', true, 25),
  ('organization_purge_work_items', true, 26)
on conflict (source_id) do update
  set enabled = excluded.enabled, sort_order = excluded.sort_order;

-- Audit the authorized issuance of an attachment URL, never the URL itself.
create or replace function public.record_organization_export_download_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_export_jobs%rowtype;
begin
  if not exists (
    select 1
      from public.organization_members m
      join public.users u on u.id = m.user_id and u.is_active
      join public.organization_lifecycles l on l.organization_id = m.organization_id
     where m.organization_id = p_organization_id
       and m.user_id = p_actor_user_id
       and l.status = 'active'
  ) then
    return query select 'not_found'::text;
    return;
  end if;
  select * into v_job
    from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id
   for share;
  if not found
     or v_job.status <> 'completed'
     or v_job.verified_at is null
     or v_job.artifact_object_path is null
     or v_job.artifact_sha256 is null then
    return query select 'not_found'::text;
    return;
  end if;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.export_download_issued',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('verified', true, 'attachment', true)
  );
  return query select 'found'::text;
end;
$$;

alter function public.record_organization_export_download_atomic(uuid, uuid, uuid) owner to postgres;
revoke all on function public.record_organization_export_download_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_organization_export_download_atomic(uuid, uuid, uuid)
  to service_role;

-- Artifact cleanup continues after the tenant row has been removed. These are
-- platform-proof rows, therefore they are the documented exception to the
-- organization-first worker rule.
create or replace function public.claim_organization_deletion_artifact_work_atomic(
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (outcome text, work_id uuid, bucket_id text, object_prefix text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_work public.organization_deletion_artifact_work%rowtype;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select * into v_work
    from public.organization_deletion_artifact_work
   where status in ('queued', 'retry', 'running') and available_at <= now()
     and (status <> 'running' or lease_expires_at <= now())
   order by created_at
   for update skip locked
   limit 1;
  if not found then
    return query select 'none_available'::text, null::uuid, null::text, null::text;
    return;
  end if;
  update public.organization_deletion_artifact_work
     set status = 'running', lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = attempt_count + 1, updated_at = now()
   where id = v_work.id;
  return query select 'claimed'::text, v_work.id, v_work.bucket_id, v_work.object_prefix;
end;
$$;

create or replace function public.complete_organization_deletion_artifact_work_atomic(
  p_work_id uuid,
  p_lease_owner uuid
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_work public.organization_deletion_artifact_work%rowtype;
begin
  select * into v_work from public.organization_deletion_artifact_work
   where id = p_work_id for update;
  if not found then return query select 'not_found'::text; return; end if;
  if v_work.status <> 'running' or v_work.lease_owner <> p_lease_owner
     or v_work.lease_expires_at <= now() then
    return query select 'conflict'::text;
    return;
  end if;
  update public.organization_deletion_artifact_work
     set status = 'completed', lease_owner = null, lease_expires_at = null,
         safe_error_code = null, updated_at = now()
   where id = p_work_id;
  update public.organization_deletion_proofs proof
     set artifact_deletion_completed_at = now()
   where proof.id = v_work.deletion_proof_id
     and not exists (
       select 1 from public.organization_deletion_artifact_work pending
        where pending.deletion_proof_id = proof.id
          and pending.status <> 'completed'
     );
  return query select 'completed'::text;
end;
$$;

create or replace function public.fail_organization_deletion_artifact_work_atomic(
  p_work_id uuid,
  p_lease_owner uuid,
  p_safe_error_code text,
  p_retryable boolean
)
  returns table (outcome text, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_work public.organization_deletion_artifact_work%rowtype; v_status text;
begin
  select * into v_work from public.organization_deletion_artifact_work
   where id = p_work_id for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if v_work.status <> 'running' or v_work.lease_owner <> p_lease_owner
     or v_work.lease_expires_at <= now() then
    return query select 'conflict'::text, v_work.status;
    return;
  end if;
  if p_safe_error_code is null or length(p_safe_error_code) > 64 then
    return query select 'invalid_request'::text, v_work.status;
    return;
  end if;
  v_status := case when p_retryable and v_work.attempt_count < v_work.max_attempts
    then 'retry' else 'dead_letter' end;
  update public.organization_deletion_artifact_work
     set status = v_status, safe_error_code = p_safe_error_code,
         available_at = now() + interval '1 minute', lease_owner = null,
         lease_expires_at = null, updated_at = now()
   where id = p_work_id;
  return query select 'recorded'::text, v_status;
end;
$$;

alter function public.claim_organization_deletion_artifact_work_atomic(uuid, integer) owner to postgres;
alter function public.complete_organization_deletion_artifact_work_atomic(uuid, uuid) owner to postgres;
alter function public.fail_organization_deletion_artifact_work_atomic(uuid, uuid, text, boolean) owner to postgres;
revoke all on function public.claim_organization_deletion_artifact_work_atomic(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_organization_deletion_artifact_work_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_organization_deletion_artifact_work_atomic(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_organization_deletion_artifact_work_atomic(uuid, integer) to service_role;
grant execute on function public.complete_organization_deletion_artifact_work_atomic(uuid, uuid) to service_role;
grant execute on function public.fail_organization_deletion_artifact_work_atomic(uuid, uuid, text, boolean) to service_role;

-- Public invitation acceptance has no active-organization guard, so lifecycle
-- is serialized inside its durable transaction. The generic `not_found`
-- result does not reveal the target organization.
alter function public.accept_invitation_atomic(text, uuid, text)
  rename to accept_invitation_atomic_legacy_unchecked;
revoke all on function public.accept_invitation_atomic_legacy_unchecked(text, uuid, text)
  from public, anon, authenticated, service_role;

create function public.accept_invitation_atomic(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
  returns table (
    outcome text, invitation_id uuid, organization_id uuid,
    organization_name text, organization_slug text
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_organization_id uuid;
begin
  select i.organization_id into v_organization_id
    from public.invitations i where i.token_hash = p_token_hash for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;
  perform 1 from public.organization_lifecycles l
   where l.organization_id = v_organization_id and l.status = 'active' for share;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;
  return query select * from public.accept_invitation_atomic_legacy_unchecked(
    p_token_hash, p_user_id, p_email
  );
end;
$$;

alter function public.accept_invitation_atomic(text, uuid, text) owner to postgres;
revoke all on function public.accept_invitation_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_invitation_atomic(text, uuid, text) to service_role;

-- Resends and inward onboarding evidence can be invoked without HTTP guards by
-- owning modules. Keep their normal success semantics but make inactive
-- tenants indistinguishable from an absent target.
alter function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  rename to resend_invitation_atomic_legacy_unchecked;
revoke all on function public.resend_invitation_atomic_legacy_unchecked(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create function public.resend_invitation_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
  returns table (outcome text, invitation_id uuid, email text, organization_name text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  perform 1 from public.organization_lifecycles l
   where l.organization_id = p_organization_id and l.status = 'active' for share;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  return query select * from public.resend_invitation_atomic_legacy_unchecked(
    p_organization_id, p_invitation_id, p_actor_user_id, p_actor_email, p_token_hash, p_expires_at
  );
end;
$$;

alter function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz) owner to postgres;
revoke all on function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  to service_role;

alter function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  rename to record_organization_onboarding_evidence_atomic_legacy_unchecked;
revoke all on function public.record_organization_onboarding_evidence_atomic_legacy_unchecked(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create function public.record_organization_onboarding_evidence_atomic(
  p_organization_id uuid,
  p_stage text,
  p_resource_id uuid,
  p_actor_user_id uuid,
  p_available boolean default true
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  perform 1 from public.organization_lifecycles l
   where l.organization_id = p_organization_id and l.status = 'active' for share;
  if not found then return query select 'not_found'::text; return; end if;
  return query select * from public.record_organization_onboarding_evidence_atomic_legacy_unchecked(
    p_organization_id, p_stage, p_resource_id, p_actor_user_id, p_available
  );
end;
$$;

alter function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean) owner to postgres;
revoke all on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  to service_role;

alter function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  rename to record_invitation_delivery_onboarding_atomic_legacy_unchecked;
revoke all on function public.record_invitation_delivery_onboarding_atomic_legacy_unchecked(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.record_invitation_delivery_onboarding_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  perform 1 from public.organization_lifecycles l
   where l.organization_id = p_organization_id and l.status = 'active' for share;
  if not found then return query select 'not_found'::text; return; end if;
  return query select * from public.record_invitation_delivery_onboarding_atomic_legacy_unchecked(
    p_organization_id, p_invitation_id, p_actor_user_id
  );
end;
$$;

alter function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid) owner to postgres;
revoke all on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  to service_role;
