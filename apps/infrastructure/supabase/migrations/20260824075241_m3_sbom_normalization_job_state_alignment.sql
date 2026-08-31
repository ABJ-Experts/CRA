create or replace function public.checkpoint_sbom_ingest_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_progress_stage text,
  p_progress_percent integer, p_lease_seconds integer
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_progress_stage not in (
    'claiming', 'verifying_original', 'recording_evidence', 'parsing', 'batching', 'resolving_graph'
  )
    or p_progress_percent not between 1 and 99 or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  update public.sbom_ingest_jobs set progress_stage = p_progress_stage,
    progress_percent = greatest(progress_percent, p_progress_percent),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id and status = 'processing'
    and lease_owner = btrim(p_worker_id) and lease_expires_at > now();
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  return query select 'checkpointed'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

create or replace function public.fail_sbom_ingest_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_error_code text
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_delay_seconds integer;
begin
  if p_error_code not in (
    'provider_unavailable', 'source_missing', 'content_hash_mismatch', 'storage_timeout',
    'authorization_changed', 'unknown_failure', 'normalization_byte_limit_exceeded',
    'normalization_component_limit_exceeded'
  ) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_job from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id and jobs.status = 'processing'
    and jobs.lease_owner = btrim(p_worker_id) and jobs.lease_expires_at > now() for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.attempt_count >= v_job.max_attempts then
    update public.sbom_ingest_jobs set status = 'dead_letter', progress_stage = 'dead_letter', error_code = p_error_code,
      lease_owner = null, lease_expires_at = null, dead_lettered_at = now(), updated_at = now()
    where organization_id = p_organization_id and id = p_job_id;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, v_job.actor_user_id, 'sbom.job_failed', 'sbom_ingest_job', p_job_id::text,
      jsonb_build_object('code', p_error_code, 'terminal', true, 'correlationId', v_job.correlation_id));
    return query select 'dead_letter'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id); return;
  end if;
  v_delay_seconds := least(900, 15 * (2 ^ greatest(v_job.attempt_count - 1, 0))::integer);
  update public.sbom_ingest_jobs set status = 'failed', progress_stage = 'failed', error_code = p_error_code,
    lease_owner = null, lease_expires_at = null,
    next_attempt_at = now() + make_interval(secs => floor(random() * (v_delay_seconds + 1))::integer), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, v_job.actor_user_id, 'sbom.job_failed', 'sbom_ingest_job', p_job_id::text,
    jsonb_build_object('code', p_error_code, 'terminal', false, 'correlationId', v_job.correlation_id));
  return query select 'retrying'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

alter function public.checkpoint_sbom_ingest_job(uuid,uuid,text,text,integer,integer) owner to postgres;
alter function public.fail_sbom_ingest_job(uuid,uuid,text,text) owner to postgres;

revoke all on function public.checkpoint_sbom_ingest_job(uuid,uuid,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.fail_sbom_ingest_job(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.checkpoint_sbom_ingest_job(uuid,uuid,text,text,integer,integer) to service_role;
grant execute on function public.fail_sbom_ingest_job(uuid,uuid,text,text) to service_role;
