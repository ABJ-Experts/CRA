-- The existing worker checkpoint is also the lease-renewal boundary. Keep its
-- original stages and permit the durable normalizer stages introduced in M3-03.
create or replace function public.checkpoint_sbom_ingest_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_progress_stage text,
  p_progress_percent integer, p_lease_seconds integer
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_progress_stage not in (
    'claiming', 'verifying_original', 'recording_evidence',
    'parsing', 'batching', 'resolving_graph'
  ) or p_progress_percent not between 1 and 99 or p_lease_seconds not between 10 and 300 then
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

alter function public.checkpoint_sbom_ingest_job(uuid,uuid,text,text,integer,integer) owner to postgres;
revoke all on function public.checkpoint_sbom_ingest_job(uuid,uuid,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.checkpoint_sbom_ingest_job(uuid,uuid,text,text,integer,integer) to service_role;
