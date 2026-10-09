-- A repeated immutable source must reuse the already-completed graph without
-- leaving its own ingest job leased.  The association retains release/source
-- provenance while the unique graph remains keyed by hash + normalizer version.
create or replace function public.create_or_resume_sbom_document_normalization_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_document_id uuid,
  p_format text, p_serialization text, p_specification_version text,
  p_parser_name text, p_parser_version text, p_normalizer_name text, p_normalizer_version text
) returns table(outcome text, document jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.sbom_ingest_jobs%rowtype;
  v_source public.sbom_sources%rowtype;
  v_document public.sbom_documents%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100
    or p_format not in ('cyclonedx', 'spdx')
    or p_serialization not in ('json', 'json_ld', 'xml', 'tag_value')
    or char_length(btrim(coalesce(p_specification_version, ''))) not between 1 and 40
    or char_length(btrim(coalesce(p_parser_name, ''))) not between 1 and 120
    or char_length(btrim(coalesce(p_parser_version, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_normalizer_name, ''))) not between 1 and 120
    or char_length(btrim(coalesce(p_normalizer_version, ''))) not between 1 and 80 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  select * into v_job from public.sbom_ingest_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.id = p_job_id
      and jobs.status = 'processing' and jobs.lease_owner = btrim(p_worker_id)
      and jobs.lease_expires_at > now()
    for update;
  if not found or v_job.validation_status not in ('valid', 'valid_with_warnings') then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;

  select * into v_source from public.sbom_sources sources
    where sources.organization_id = p_organization_id and sources.id = v_job.source_id
      and sources.status = 'verified'
    for share;
  if not found or v_source.raw_object_id is null then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  select * into v_document from public.sbom_documents documents
    where documents.organization_id = p_organization_id
      and documents.document_sha256 = v_job.input_sha256
      and documents.normalizer_version = btrim(p_normalizer_version)
    for update;

  if found then
    insert into public.sbom_document_sources(organization_id, document_id, source_id, raw_object_id, release_id)
    values (p_organization_id, v_document.id, v_source.id, v_source.raw_object_id, v_source.release_id)
    on conflict (organization_id, document_id, source_id) do nothing;

    if v_document.state = 'completed' then
      update public.sbom_ingest_jobs set status = 'completed', progress_stage = 'completed',
        progress_percent = 100, lease_owner = null, lease_expires_at = null,
        completed_at = coalesce(completed_at, now()), updated_at = now()
      where organization_id = p_organization_id and id = p_job_id;
      return query select 'replayed'::text,
        public.sbom_document_json(p_organization_id, v_document.id); return;
    end if;

    if v_document.ingest_job_id = p_job_id then
      return query select 'resumed'::text,
        public.sbom_document_json(p_organization_id, v_document.id); return;
    end if;
    return query select 'in_progress'::text,
      public.sbom_document_json(p_organization_id, v_document.id); return;
  end if;

  insert into public.sbom_documents(
    id, organization_id, source_id, raw_object_id, ingest_job_id, document_sha256,
    format, serialization, specification_version, parser_name, parser_version,
    normalizer_name, normalizer_version, validation_status, state, progress_stage
  ) values (
    p_document_id, p_organization_id, v_source.id, v_source.raw_object_id, p_job_id,
    v_job.input_sha256, p_format, p_serialization, btrim(p_specification_version),
    btrim(p_parser_name), btrim(p_parser_version), btrim(p_normalizer_name),
    btrim(p_normalizer_version), v_job.validation_status, 'processing', 'parsing'
  ) returning * into v_document;
  insert into public.sbom_document_sources(organization_id, document_id, source_id, raw_object_id, release_id)
  values (p_organization_id, v_document.id, v_source.id, v_source.raw_object_id, v_source.release_id)
  on conflict (organization_id, document_id, source_id) do nothing;
  update public.sbom_ingest_jobs set progress_stage = 'parsing',
    progress_percent = greatest(progress_percent, 25), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id;
  return query select 'created'::text, public.sbom_document_json(p_organization_id, v_document.id);
end;
$$;

alter function public.create_or_resume_sbom_document_normalization_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,text) owner to postgres;
revoke all on function public.create_or_resume_sbom_document_normalization_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_or_resume_sbom_document_normalization_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,text) to service_role;
