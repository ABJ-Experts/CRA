-- Exhausted crashed leases must terminate durably instead of remaining failed
-- forever. Existing stranded exhausted failures are recovered on the next scoped
-- claim. Originals and normalized graphs remain untouched; no new retry budget.
create or replace function public.claim_sbom_ingest_job(
  p_organization_id uuid, p_worker_id text, p_lease_seconds integer
) returns table(outcome text, job jsonb, work jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb; return;
  end if;
  with recovered as (
    update public.sbom_ingest_jobs set status = case when attempt_count >= max_attempts then 'dead_letter' else 'failed' end,
      progress_stage = case when attempt_count >= max_attempts then 'dead_letter' else 'failed' end,
      dead_lettered_at = case when attempt_count >= max_attempts then now() else null end, lease_owner = null,
      lease_expires_at = null, error_code = coalesce(error_code, 'unknown_failure'), next_attempt_at = now(), updated_at = now()
    where organization_id = p_organization_id and ((status = 'processing' and lease_expires_at <= now())
      or (status = 'failed' and attempt_count >= max_attempts))
    returning id, actor_user_id, correlation_id, status
  )
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  select p_organization_id, recovered.actor_user_id, 'sbom.job_failed', 'sbom_ingest_job', recovered.id::text,
    jsonb_build_object('code', case when recovered.status = 'dead_letter' then 'retry_budget_exhausted' else 'worker_lease_expired' end,
      'terminal', recovered.status = 'dead_letter', 'correlationId', recovered.correlation_id)
  from recovered;
  if exists (select 1 from public.sbom_ingest_jobs jobs where jobs.organization_id = p_organization_id
    and jobs.status = 'processing' and jobs.lease_expires_at > now()) then
    return query select 'empty'::text, null::jsonb, null::jsonb; return;
  end if;
  select * into v_job from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.status in ('queued', 'failed')
    and jobs.next_attempt_at <= now() and jobs.attempt_count < jobs.max_attempts
  order by jobs.next_attempt_at, jobs.created_at, jobs.id for update skip locked limit 1;
  if not found then return query select 'empty'::text, null::jsonb, null::jsonb; return; end if;
  update public.sbom_ingest_jobs set status = 'processing', progress_stage = 'verifying_original',
    progress_percent = greatest(progress_percent, 1), attempt_count = attempt_count + 1,
    lease_owner = btrim(p_worker_id), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    error_code = null, updated_at = now()
  where organization_id = p_organization_id and id = v_job.id;
  return query select 'claimed'::text, public.sbom_ingest_job_json(p_organization_id, v_job.id),
    jsonb_build_object('sourceId', v_job.source_id, 'inputSha256', v_job.input_sha256,
      'correlationId', v_job.correlation_id, 'actorUserId', v_job.actor_user_id,
      'actorCredentialId', v_job.actor_credential_id, 'idempotencyKey', v_job.idempotency_key);
end;
$$;

revoke all on function public.claim_sbom_ingest_job(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.claim_sbom_ingest_job(uuid,text,integer) to service_role;
