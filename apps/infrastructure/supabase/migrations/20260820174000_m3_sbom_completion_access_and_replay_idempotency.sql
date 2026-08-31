-- Harden completion against object-key disclosure and make owner dead-letter
-- replay an explicit idempotent command.  The original source idempotency key
-- remains separate: a replay is an operator action, not a new ingestion.

alter table public.sbom_ingest_jobs
  add column replay_idempotency_key uuid,
  add column replayed_by uuid references public.users(id) on delete restrict,
  add column replayed_at timestamptz,
  add constraint sbom_ingest_jobs_replay_pair_check check (
    (replay_idempotency_key is null and replayed_by is null and replayed_at is null)
    or (replay_idempotency_key is not null and replayed_by is not null and replayed_at is not null)
  );

create unique index sbom_ingest_jobs_replay_idempotency_idx
  on public.sbom_ingest_jobs(organization_id, replayed_by, replay_idempotency_key)
  where replay_idempotency_key is not null;

create or replace function public.get_sbom_source_for_completion(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid,
  p_actor_credential_id uuid, p_idempotency_key uuid
) returns table(outcome text, source jsonb, storage_bucket text, storage_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.sbom_sources%rowtype;
begin
  if p_idempotency_key is null
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb, null::text, null::text;
    return;
  end if;

  select * into v_source from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id
  for share;

  if not found
    or v_source.idempotency_key <> p_idempotency_key
    or (p_actor_user_id is not null and (
      v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)
    ))
    or (p_actor_credential_id is not null and (
      v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (
        select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id
          and credentials.id = p_actor_credential_id and credentials.status = 'active'
      )
    )) then
    return query select 'not_found'::text, null::jsonb, null::text, null::text;
    return;
  end if;

  if v_source.status = 'upload_pending' and v_source.upload_expires_at > now() then
    return query select 'ready'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      'sbom-originals'::text, v_source.staging_storage_key;
    return;
  end if;

  if v_source.status = 'verified' then
    return query select 'replayed'::text,
      public.sbom_source_json(p_organization_id, v_source.id), null::text, null::text;
    return;
  end if;

  return query select 'not_found'::text, null::jsonb, null::text, null::text;
end;
$$;

create or replace function public.replay_sbom_ingest_job_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_job_id uuid,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_replayed public.sbom_ingest_jobs%rowtype;
begin
  if p_idempotency_key is null or p_correlation_id is null
    or not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select * into v_replayed from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.replayed_by = p_actor_user_id
    and jobs.replay_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replayed.id = p_job_id then
      return query select 'replayed'::text, public.sbom_ingest_job_json(p_organization_id, v_replayed.id);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;

  select * into v_job from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.status <> 'dead_letter' then
    return query select 'invalid_state'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
    return;
  end if;

  update public.sbom_ingest_jobs set status = 'queued', progress_stage = 'queued', progress_percent = 0,
    attempt_count = 0, next_attempt_at = now(), lease_owner = null, lease_expires_at = null,
    error_code = null, dead_lettered_at = null, replay_idempotency_key = p_idempotency_key,
    replayed_by = p_actor_user_id, replayed_at = now(), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sbom.job_replayed', 'sbom_ingest_job', p_job_id::text,
    jsonb_build_object('correlationId', p_correlation_id, 'idempotencyKey', p_idempotency_key));
  return query select 'queued'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
exception when unique_violation then
  select * into v_replayed from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.replayed_by = p_actor_user_id
    and jobs.replay_idempotency_key = p_idempotency_key;
  if found and v_replayed.id = p_job_id then
    return query select 'replayed'::text, public.sbom_ingest_job_json(p_organization_id, v_replayed.id);
  end if;
  return query select 'idempotency_mismatch'::text, null::jsonb;
end;
$$;

alter function public.get_sbom_source_for_completion(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid, uuid) owner to postgres;
revoke all on function public.get_sbom_source_for_completion(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_sbom_source_for_completion(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid, uuid) to service_role;
