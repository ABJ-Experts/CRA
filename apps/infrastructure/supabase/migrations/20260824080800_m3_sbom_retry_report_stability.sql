-- A restart replays immutable bytes and therefore receives a new observation
-- timestamp.  Only a changed validation decision is a conflict; timestamp-only
-- report changes must not strand an otherwise-completed deduplicated graph.
create or replace function public.begin_sbom_document_normalization_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text,
  p_parser_name text, p_parser_version text, p_normalizer_name text,
  p_normalizer_version text, p_format text, p_serialization text,
  p_specification_version text, p_validation_report jsonb
) returns table(outcome text, document jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.sbom_ingest_jobs%rowtype;
  v_result record;
  v_validation_status text;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_validation_report is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_validation_status := p_validation_report ->> 'status';
  if not public.valid_sbom_validation_report(p_validation_report, v_validation_status) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_job from public.sbom_ingest_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.id = p_job_id
      and jobs.status = 'processing' and jobs.lease_owner = btrim(p_worker_id)
      and jobs.lease_expires_at > now()
    for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.validation_report is not null
    and v_job.validation_status <> v_validation_status then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  if v_validation_status = 'invalid' then
    update public.sbom_ingest_jobs set validation_status = v_validation_status,
      validation_report = p_validation_report, validation_completed_at = (p_validation_report->>'completedAt')::timestamptz,
      status = 'failed', progress_stage = 'failed', error_code = 'invalid_sbom',
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where organization_id = p_organization_id and id = p_job_id;
    return query select 'failed'::text, null::jsonb; return;
  end if;
  update public.sbom_ingest_jobs set validation_status = v_validation_status,
    detected_format = p_validation_report #>> '{detected,format}',
    detected_serialization = p_validation_report #>> '{detected,serialization}',
    detected_spec_version = p_validation_report #>> '{detected,specificationVersion}',
    validator_name = p_validation_report #>> '{validator,name}',
    validator_version = p_validation_report #>> '{validator,version}',
    validator_schema_asset_sha256 = p_validation_report #>> '{validator,schemaAssetSha256}',
    validation_report = p_validation_report,
    validation_completed_at = (p_validation_report->>'completedAt')::timestamptz,
    progress_stage = 'parsing', progress_percent = greatest(progress_percent, 25), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id;
  select * into v_result from public.create_or_resume_sbom_document_normalization_atomic(
    p_organization_id, p_job_id, p_worker_id, gen_random_uuid(), p_format,
    p_serialization, p_specification_version, p_parser_name, p_parser_version,
    p_normalizer_name, p_normalizer_version
  );
  return query select v_result.outcome, v_result.document;
end;
$$;

alter function public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb) owner to postgres;
revoke all on function public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb) to service_role;
