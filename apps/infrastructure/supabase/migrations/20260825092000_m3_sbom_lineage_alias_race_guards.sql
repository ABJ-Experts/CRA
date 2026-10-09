-- M3-05 forward hardening for source aliases and successor races.

drop index if exists public.sbom_sources_one_chain_successor_idx;
create unique index sbom_sources_one_chain_successor_idx
  on public.sbom_sources(organization_id, release_id, supersedes_source_id)
  where supersedes_source_id is not null
    and deduplicated_from_source_id is null
    and status = 'verified';

create or replace function public.finalize_sbom_source_deduplicated_atomic(
  p_organization_id uuid,
  p_source_id uuid,
  p_actor_user_id uuid,
  p_actor_credential_id uuid,
  p_actual_sha256 text,
  p_actual_byte_size bigint,
  p_actual_media_type text,
  p_idempotency_key uuid,
  p_correlation_id uuid
) returns table(outcome text, source jsonb, job jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.sbom_sources%rowtype;
  v_raw_id uuid;
  v_canonical_source_id uuid;
  v_canonical_job_id uuid;
  v_document_id uuid;
begin
  if p_idempotency_key is null
    or p_correlation_id is null
    or p_actual_sha256 !~ '^[a-f0-9]{64}$'
    or p_actual_byte_size not between 1 and 104857600
    or not public.sbom_allowed_media_type(p_actual_media_type)
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and sources.id = p_source_id
  for update;

  if not found
    or v_source.idempotency_key <> p_idempotency_key
    or (
      p_actor_user_id is not null
      and (
        v_source.actor_user_id is distinct from p_actor_user_id
        or not public.m2_active_member(p_organization_id, p_actor_user_id)
      )
    )
    or (
      p_actor_credential_id is not null
      and (
        v_source.actor_credential_id is distinct from p_actor_credential_id
        or not exists (
          select 1 from public.sbom_ci_credentials credentials
          where credentials.organization_id = p_organization_id
            and credentials.id = p_actor_credential_id
            and credentials.status = 'active'
        )
      )
    ) then
    return query select
      case when found then 'idempotency_mismatch' else 'not_found' end::text,
      null::jsonb,
      null::jsonb;
    return;
  end if;

  if v_source.status = 'verified' then
    select jobs.id into v_canonical_job_id
    from public.sbom_ingest_jobs jobs
    where jobs.organization_id = p_organization_id
      and jobs.source_id = coalesce(v_source.deduplicated_from_source_id, v_source.id);
    return query select 'replayed'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      public.sbom_ingest_job_json(p_organization_id, v_canonical_job_id);
    return;
  end if;

  if v_source.status <> 'upload_pending' then
    return query select 'invalid_state'::text,
      public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;

  if v_source.upload_expires_at <= now() then
    update public.sbom_sources
       set status = 'expired', rejected_at = now(), rejection_code = 'upload_expired'
     where organization_id = p_organization_id and id = v_source.id;
    return query select 'expired'::text,
      public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;

  if p_actual_sha256 <> v_source.declared_sha256
    or p_actual_byte_size <> v_source.declared_byte_size
    or p_actual_media_type <> v_source.declared_media_type then
    update public.sbom_sources
       set status = 'rejected',
           rejected_at = now(),
           rejection_code = case
             when p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
             when p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
             else 'media_type_mismatch'
           end
     where organization_id = p_organization_id and id = v_source.id;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id,
      p_actor_user_id,
      'sbom.hash_mismatch',
      'sbom_source',
      v_source.id::text,
      jsonb_build_object(
        'correlationId', p_correlation_id,
        'code', case
          when p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
          when p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
          else 'media_type_mismatch'
        end
      )
    );
    return query select 'integrity_mismatch'::text,
      public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || v_source.release_id::text || ':' || v_source.declared_sha256, 0)
  );

  insert into public.sbom_raw_objects(
    organization_id, sha256, byte_size, media_type, storage_key
  ) values (
    p_organization_id,
    v_source.declared_sha256,
    v_source.declared_byte_size,
    v_source.declared_media_type,
    v_source.staging_storage_key
  )
  on conflict (organization_id, sha256) do nothing;

  select objects.id into v_raw_id
  from public.sbom_raw_objects objects
  where objects.organization_id = p_organization_id
    and objects.sha256 = v_source.declared_sha256
  for share;

  select canonical.id, canonical_job.id, graph.id
    into v_canonical_source_id, v_canonical_job_id, v_document_id
  from public.sbom_sources canonical
  join public.sbom_ingest_jobs canonical_job
    on canonical_job.organization_id = canonical.organization_id
   and canonical_job.source_id = canonical.id
   and canonical_job.input_sha256 = v_source.declared_sha256
  left join lateral (
    select documents.id, documents.state
    from public.sbom_document_sources mappings
    join public.sbom_documents documents
      on documents.organization_id = mappings.organization_id
     and documents.id = mappings.document_id
    where mappings.organization_id = canonical.organization_id
      and mappings.source_id = canonical.id
      and mappings.raw_object_id = canonical.raw_object_id
      and documents.state in ('processing', 'completed')
    order by (documents.state = 'completed') desc, documents.created_at desc, documents.id desc
    limit 1
  ) graph on true
  where canonical.organization_id = p_organization_id
    and canonical.release_id = v_source.release_id
    and canonical.id <> v_source.id
    and canonical.deduplicated_from_source_id is null
    and canonical.status = 'verified'
    and canonical.raw_object_id = v_raw_id
    and (graph.id is not null or canonical_job.status in ('queued', 'processing'))
  order by (graph.id is not null) desc, canonical_job.created_at, canonical.id
  limit 1
  for update of canonical, canonical_job;

  if found then
    update public.sbom_sources
       set status = 'verified',
           verified_at = now(),
           raw_object_id = v_raw_id,
           deduplicated_from_source_id = v_canonical_source_id
     where organization_id = p_organization_id and id = v_source.id;

    if v_document_id is not null then
      insert into public.sbom_document_sources(
        organization_id, document_id, source_id, raw_object_id, release_id
      ) values (
        p_organization_id, v_document_id, v_source.id, v_raw_id, v_source.release_id
      )
      on conflict (organization_id, document_id, source_id) do nothing;
    end if;

    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values
      (
        p_organization_id,
        p_actor_user_id,
        'sbom.upload_completed',
        'sbom_source',
        v_source.id::text,
        jsonb_build_object(
          'sha256', v_source.declared_sha256,
          'byteSize', v_source.declared_byte_size,
          'correlationId', p_correlation_id
        )
      ),
      (
        p_organization_id,
        p_actor_user_id,
        'sbom.source_deduplicated',
        'sbom_source',
        v_source.id::text,
        jsonb_strip_nulls(jsonb_build_object(
          'canonicalSourceId', v_canonical_source_id,
          'canonicalJobId', v_canonical_job_id,
          'documentId', v_document_id,
          'correlationId', p_correlation_id
        ))
      );
    return query select 'deduplicated'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      public.sbom_ingest_job_json(p_organization_id, v_canonical_job_id);
    return;
  end if;

  if v_source.supersedes_source_id is not null and exists (
    select 1
    from public.sbom_sources successor
    where successor.organization_id = p_organization_id
      and successor.release_id = v_source.release_id
      and successor.supersedes_source_id = v_source.supersedes_source_id
      and successor.deduplicated_from_source_id is null
      and successor.status = 'verified'
      and successor.id <> v_source.id
  ) then
    return query select 'conflict'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      null::jsonb;
    return;
  end if;

  update public.sbom_sources
     set status = 'verified', verified_at = now(), raw_object_id = v_raw_id
   where organization_id = p_organization_id and id = v_source.id;
  insert into public.sbom_ingest_jobs(
    organization_id, source_id, release_id, actor_user_id, actor_credential_id,
    correlation_id, idempotency_key, input_sha256
  ) values (
    p_organization_id, v_source.id, v_source.release_id, v_source.actor_user_id,
    v_source.actor_credential_id, v_source.correlation_id, v_source.idempotency_key,
    v_source.declared_sha256
  ) returning id into v_canonical_job_id;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values
    (
      p_organization_id,
      p_actor_user_id,
      'sbom.upload_completed',
      'sbom_source',
      v_source.id::text,
      jsonb_build_object(
        'sha256', v_source.declared_sha256,
        'byteSize', v_source.declared_byte_size,
        'correlationId', p_correlation_id
      )
    ),
    (
      p_organization_id,
      p_actor_user_id,
      'sbom.source_linked',
      'sbom_source',
      v_source.id::text,
      jsonb_build_object('rawObjectId', v_raw_id, 'correlationId', p_correlation_id)
    ),
    (
      p_organization_id,
      p_actor_user_id,
      'sbom.job_queued',
      'sbom_ingest_job',
      v_canonical_job_id::text,
      jsonb_build_object('sourceId', v_source.id, 'correlationId', p_correlation_id)
    );
  return query select 'queued'::text,
    public.sbom_source_json(p_organization_id, v_source.id),
    public.sbom_ingest_job_json(p_organization_id, v_canonical_job_id);
exception when unique_violation then
  select jobs.id into v_canonical_job_id
  from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.source_id = p_source_id;
  return query select 'replayed'::text,
    public.sbom_source_json(p_organization_id, p_source_id),
    public.sbom_ingest_job_json(p_organization_id, v_canonical_job_id);
end;
$$;

create or replace function public.enqueue_sbom_diff_report_atomic(
  p_organization_id uuid,
  p_source_id uuid,
  p_baseline_source_id uuid
) returns table(outcome text, report jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.sbom_sources%rowtype;
  v_baseline public.sbom_sources%rowtype;
  v_document uuid;
  v_baseline_document uuid;
  v_report public.sbom_diff_reports%rowtype;
begin
  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and sources.id = p_source_id
    and sources.deduplicated_from_source_id is null
  for share;
  select * into v_baseline
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and sources.id = p_baseline_source_id
    and sources.deduplicated_from_source_id is null
  for share;
  if not found
    or v_source.release_id <> v_baseline.release_id
    or p_source_id = p_baseline_source_id then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select mappings.document_id into v_document
  from public.sbom_document_sources mappings
  join public.sbom_documents documents
    on documents.organization_id = mappings.organization_id
   and documents.id = mappings.document_id
   and documents.state = 'completed'
  where mappings.organization_id = p_organization_id
    and mappings.source_id = p_source_id
  order by documents.completed_at desc, documents.id desc
  limit 1;
  select mappings.document_id into v_baseline_document
  from public.sbom_document_sources mappings
  join public.sbom_documents documents
    on documents.organization_id = mappings.organization_id
   and documents.id = mappings.document_id
   and documents.state = 'completed'
  where mappings.organization_id = p_organization_id
    and mappings.source_id = p_baseline_source_id
  order by documents.completed_at desc, documents.id desc
  limit 1;
  if v_document is null or v_baseline_document is null or v_document = v_baseline_document then
    return query select 'no_comparable_version'::text, null::jsonb;
    return;
  end if;
  insert into public.sbom_diff_reports(
    organization_id, source_id, baseline_source_id, release_id,
    document_id, baseline_document_id
  ) values (
    p_organization_id, p_source_id, p_baseline_source_id, v_source.release_id,
    v_document, v_baseline_document
  )
  on conflict (organization_id, source_id, baseline_source_id, comparator_version)
  do nothing
  returning * into v_report;
  if v_report.id is null then
    select * into v_report
    from public.sbom_diff_reports reports
    where reports.organization_id = p_organization_id
      and reports.source_id = p_source_id
      and reports.baseline_source_id = p_baseline_source_id
      and reports.comparator_version = 'm4-unavailable.v1';
  end if;
  return query select
    case when v_report.state = 'completed' then 'completed' else 'queued' end,
    public.sbom_diff_report_json(p_organization_id, v_report.id);
end;
$$;

create or replace function public.get_sbom_source_diff_report(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_baseline_source_id uuid
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.sbom_sources%rowtype;
  v_baseline_source_id uuid;
  v_report_id uuid;
begin
  if not public.sbom_actor_can_view(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and sources.id = p_source_id
    and sources.deduplicated_from_source_id is null;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_baseline_source_id := coalesce(p_baseline_source_id, v_source.supersedes_source_id);
  if v_baseline_source_id is null then
    return query select 'no_comparable_version'::text,
      jsonb_build_object('baselineSourceId', null);
    return;
  end if;
  if not exists (
    select 1
    from public.sbom_sources baseline
    where baseline.organization_id = p_organization_id
      and baseline.id = v_baseline_source_id
      and baseline.release_id = v_source.release_id
      and baseline.deduplicated_from_source_id is null
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select reports.id into v_report_id
  from public.sbom_diff_reports reports
  where reports.organization_id = p_organization_id
    and reports.source_id = p_source_id
    and reports.baseline_source_id = v_baseline_source_id
  order by reports.created_at desc, reports.id desc
  limit 1;
  if v_report_id is null then
    return query select 'not_started'::text,
      jsonb_build_object('baselineSourceId', v_baseline_source_id);
    return;
  end if;
  return query select 'found'::text,
    jsonb_build_object('report', public.sbom_diff_report_json(p_organization_id, v_report_id));
end;
$$;

alter function public.finalize_sbom_source_deduplicated_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) owner to postgres;
alter function public.enqueue_sbom_diff_report_atomic(uuid, uuid, uuid) owner to postgres;
alter function public.get_sbom_source_diff_report(uuid, uuid, uuid, uuid) owner to postgres;

revoke all on function
  public.sbom_source_json(uuid, uuid),
  public.finalize_sbom_source_deduplicated_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid),
  public.enqueue_sbom_diff_report_atomic(uuid, uuid, uuid),
  public.get_sbom_source_diff_report(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.finalize_sbom_source_deduplicated_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) to service_role;
grant execute on function public.enqueue_sbom_diff_report_atomic(uuid, uuid, uuid) to service_role;
grant execute on function public.get_sbom_source_diff_report(uuid, uuid, uuid, uuid) to service_role;
