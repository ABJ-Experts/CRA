-- A validation report is a terminal evidence fact.  Persist it, its safe audit
-- summary, and the legacy M3-01 completion state in one transaction.  This
-- replaces the former report-then-complete gap without changing the public
-- sbom_ingest_job_json contract.
create or replace function public.record_sbom_validation_atomic(
  p_organization_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_report jsonb
) returns table(outcome text, job jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.sbom_ingest_jobs%rowtype;
  v_status text;
  v_completed_at timestamptz;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100
    or p_report is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  v_status := p_report ->> 'status';
  if not public.valid_sbom_validation_report(p_report, v_status) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  v_completed_at := (p_report ->> 'completedAt')::timestamptz;

  select * into v_job
  from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id
    and jobs.id = p_job_id
    and (
      jobs.status = 'completed'
      or (
        jobs.status = 'processing'
        and jobs.lease_owner = btrim(p_worker_id)
        and jobs.lease_expires_at > now()
      )
    )
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  -- A former deployment could have persisted a report before legacy completion.
  -- Once a reclaimed lease reaches this point, complete it using that immutable
  -- report rather than overwriting its completedAt or validation result.
  if v_job.validation_report is not null then
    if v_job.status = 'completed' then
      if v_job.validation_report = p_report then
        return query select 'completed'::text,
          public.sbom_ingest_job_json(p_organization_id, p_job_id);
        return;
      end if;
      return query select 'invalid_state'::text,
        public.sbom_ingest_job_json(p_organization_id, p_job_id);
      return;
    end if;

    update public.sbom_ingest_jobs
       set status = 'completed',
           progress_stage = 'completed',
           progress_percent = 100,
           lease_owner = null,
           lease_expires_at = null,
           completed_at = coalesce(completed_at, now()),
           updated_at = now()
     where organization_id = p_organization_id and id = p_job_id;
    return query select 'completed'::text,
      public.sbom_ingest_job_json(p_organization_id, p_job_id);
    return;
  end if;

  if v_job.status <> 'processing' then
    return query select 'invalid_state'::text,
      public.sbom_ingest_job_json(p_organization_id, p_job_id);
    return;
  end if;

  update public.sbom_ingest_jobs
     set validation_status = v_status,
         detected_format = p_report #>> '{detected,format}',
         detected_serialization = p_report #>> '{detected,serialization}',
         detected_spec_version = p_report #>> '{detected,specificationVersion}',
         validator_name = p_report #>> '{validator,name}',
         validator_version = p_report #>> '{validator,version}',
         validator_schema_asset_sha256 = p_report #>> '{validator,schemaAssetSha256}',
         validation_report = p_report,
         validation_completed_at = v_completed_at,
         status = 'completed',
         progress_stage = 'completed',
         progress_percent = 100,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where organization_id = p_organization_id and id = p_job_id;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id,
    v_job.actor_user_id,
    'sbom.validation_recorded',
    'sbom_ingest_job',
    p_job_id::text,
    jsonb_build_object(
      'sourceId', v_job.source_id,
      'status', v_status,
      'detectedFormat', p_report #>> '{detected,format}',
      'detectedSerialization', p_report #>> '{detected,serialization}',
      'detectedSpecVersion', p_report #>> '{detected,specificationVersion}',
      'validator', jsonb_build_object(
        'name', p_report #>> '{validator,name}',
        'version', p_report #>> '{validator,version}'
      ),
      'diagnosticCounts', jsonb_build_object(
        'error', (p_report ->> 'errorCount')::integer,
        'warning', (p_report ->> 'warningCount')::integer
      ),
      'omittedDiagnosticCount', (p_report ->> 'omittedDiagnosticCount')::integer,
      'correlationId', v_job.correlation_id
    )
  );

  return query select 'completed'::text,
    public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

alter function public.record_sbom_validation_atomic(uuid, uuid, text, jsonb) owner to postgres;
revoke all on function public.record_sbom_validation_atomic(uuid, uuid, text, jsonb) from public;
grant execute on function public.record_sbom_validation_atomic(uuid, uuid, text, jsonb) to service_role;
