-- M3-05 completion-time content reuse.  A source remains immutable evidence,
-- while a byte-identical source can share the release-local canonical worker
-- and normalized graph without allocating another ingest job.

alter table public.sbom_sources
  drop constraint sbom_sources_deduplicated_alias_check;

drop index if exists public.sbom_sources_one_chain_successor_idx;
create unique index sbom_sources_one_chain_successor_idx
  on public.sbom_sources(organization_id, release_id, supersedes_source_id)
  where supersedes_source_id is not null
    and deduplicated_from_source_id is null
    and status = 'verified';

-- A declared supersession is immutable user intent.  It may also be an alias
-- when its bytes are identical; lineage readers already exclude aliases.
create or replace function public.prevent_sbom_source_dedup_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.deduplicated_from_source_id is distinct from new.deduplicated_from_source_id then
    if old.deduplicated_from_source_id is not null
      or new.status <> 'verified'
      or new.raw_object_id is null
      or new.deduplicated_from_source_id is null
      or not exists (
        select 1
        from public.sbom_sources canonical
        join public.sbom_ingest_jobs canonical_job
          on canonical_job.organization_id = canonical.organization_id
         and canonical_job.source_id = canonical.id
         and canonical_job.input_sha256 = new.declared_sha256
        left join lateral (
          select documents.id, documents.state
          from public.sbom_document_sources mappings
          join public.sbom_documents documents
            on documents.organization_id = mappings.organization_id
           and documents.id = mappings.document_id
          where mappings.organization_id = canonical.organization_id
            and mappings.source_id = canonical.id
            and mappings.raw_object_id = canonical.raw_object_id
          order by (documents.state = 'completed') desc, documents.created_at desc, documents.id desc
          limit 1
        ) graph on true
        where canonical.organization_id = new.organization_id
          and canonical.release_id = new.release_id
          and canonical.id = new.deduplicated_from_source_id
          and canonical.deduplicated_from_source_id is null
          and canonical.status = 'verified'
          and canonical.raw_object_id = new.raw_object_id
          and (
            graph.state in ('processing', 'completed')
            or canonical_job.status in ('queued', 'processing')
          )
      ) then
      raise exception using errcode = '55000',
        message = 'SBOM deduplication provenance is finalization-only';
    end if;
  end if;
  return new;
end;
$$;

-- If aliases completed while the canonical job was still queued, attach their
-- immutable source provenance as soon as the worker creates its document.
create or replace function public.link_sbom_deduplicated_sources_to_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.sbom_document_sources(
    organization_id, document_id, source_id, raw_object_id, release_id
  )
  select
    new.organization_id,
    new.id,
    aliases.id,
    aliases.raw_object_id,
    aliases.release_id
  from public.sbom_sources aliases
  where aliases.organization_id = new.organization_id
    and aliases.deduplicated_from_source_id = new.source_id
    and aliases.status = 'verified'
    and aliases.raw_object_id = new.raw_object_id
  on conflict (organization_id, document_id, source_id) do nothing;
  return new;
end;
$$;

drop trigger if exists link_sbom_deduplicated_sources_after_document_created on public.sbom_documents;
create trigger link_sbom_deduplicated_sources_after_document_created
  after insert on public.sbom_documents
  for each row execute function public.link_sbom_deduplicated_sources_to_document();

create or replace function public.sbom_source_json(
  p_organization_id uuid,
  p_source_id uuid
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', sources.id,
    'organizationId', sources.organization_id,
    'productId', sources.product_id,
    'releaseId', sources.release_id,
    'source', sources.source_kind,
    'fileName', sources.original_filename,
    'mediaType', sources.declared_media_type,
    'byteSize', sources.declared_byte_size,
    'sha256', sources.declared_sha256,
    'status', sources.status,
    'createdAt', sources.created_at,
    'completedAt', sources.verified_at
  )
  || case when sources.declared_format is null then '{}'::jsonb
      else jsonb_build_object('declaredFormat', sources.declared_format) end
  || case when sources.declared_spec_version is null then '{}'::jsonb
      else jsonb_build_object('declaredSpecVersion', sources.declared_spec_version) end
  || case when sources.supersedes_source_id is null then '{}'::jsonb
      else jsonb_build_object('supersedesSourceId', sources.supersedes_source_id) end
  || case when sources.deduplicated_from_source_id is null then '{}'::jsonb
      else jsonb_build_object('deduplicatedFromSourceId', sources.deduplicated_from_source_id) end
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id;
$$;

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

  -- Serialize same-release byte identity completion.  A hash collision only
  -- causes harmless extra serialization; it cannot cross tenant/release rows.
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

-- Missing canonical PURLs are deliberate unresolved facts, not rows to skip.
-- The cursor orders them before package identities without NULL tuple semantics.
create or replace function public.list_sbom_diff_component_facts(
  p_organization_id uuid,
  p_report_id uuid,
  p_worker_id text,
  p_side text,
  p_limit integer,
  p_cursor text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.sbom_diff_reports%rowtype;
  v_document_id uuid;
  v_cursor jsonb;
  v_identity_rank integer := 0;
  v_identity text := '';
  v_offset bigint := 0;
  v_id uuid;
  v_rows jsonb;
begin
  if p_side not in ('current', 'baseline') or p_limit not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  select * into v_report
  from public.sbom_diff_reports reports
  where reports.organization_id = p_organization_id
    and reports.id = p_report_id
    and reports.state = 'processing'
    and reports.lease_owner = btrim(p_worker_id)
    and reports.lease_expires_at > now();
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_document_id := case when p_side = 'current' then v_report.document_id else v_report.baseline_document_id end;
  perform public.ensure_sbom_component_diff_identities_atomic(p_organization_id, v_document_id, 5000);
  if nullif(p_cursor, '') is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb;
      if jsonb_typeof(v_cursor) <> 'array' or jsonb_array_length(v_cursor) <> 4 then
        raise exception 'invalid cursor';
      end if;
      v_identity_rank := (v_cursor ->> 0)::integer;
      v_identity := coalesce(v_cursor ->> 1, '');
      v_offset := (v_cursor ->> 2)::bigint;
      v_id := (v_cursor ->> 3)::uuid;
      if v_identity_rank not in (0, 1) then raise exception 'invalid cursor'; end if;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'componentId', rows.id,
        'packageIdentity', rows.package_identity,
        'canonicalPurl', rows.canonical_purl,
        'normalizedName', rows.normalized_name,
        'normalizedVersion', rows.normalized_version,
        'ecosystem', rows.ecosystem,
        'sourceOffset', rows.source_offset
      ) order by rows.identity_rank, coalesce(rows.package_identity, ''), rows.source_offset, rows.id
    ),
    '[]'::jsonb
  ) into v_rows
  from (
    select
      components.id,
      case when components.canonical_purl is null then null else public.sbom_purl_package_identity(components.canonical_purl) end as package_identity,
      case when components.canonical_purl is null then 0 else 1 end as identity_rank,
      components.canonical_purl,
      components.normalized_name,
      components.normalized_version,
      components.ecosystem,
      components.source_offset
    from public.sbom_components components
    where components.organization_id = p_organization_id
      and components.document_id = v_document_id
      and (
        case when components.canonical_purl is null then 0 else 1 end,
        coalesce(case when components.canonical_purl is null then null else public.sbom_purl_package_identity(components.canonical_purl) end, ''),
        components.source_offset,
        components.id
      ) > (
        v_identity_rank,
        v_identity,
        v_offset,
        coalesce(v_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    order by
      case when components.canonical_purl is null then 0 else 1 end,
      coalesce(case when components.canonical_purl is null then null else public.sbom_purl_package_identity(components.canonical_purl) end, ''),
      components.source_offset,
      components.id
    limit p_limit
  ) rows;
  return query select
    'found'::text,
    jsonb_build_object(
      'items', v_rows,
      'nextCursor', case
        when jsonb_array_length(v_rows) = p_limit then encode(
          convert_to(
            jsonb_build_array(
              case when (v_rows -> (p_limit - 1) ->> 'packageIdentity') is null then 0 else 1 end,
              v_rows -> (p_limit - 1) -> 'packageIdentity',
              (v_rows -> (p_limit - 1) ->> 'sourceOffset')::bigint,
              v_rows -> (p_limit - 1) ->> 'componentId'
            )::text,
            'utf8'
          ),
          'base64'
        )
        else null
      end
    );
end;
$$;

create or replace function public.sbom_diff_report_json(
  p_organization_id uuid,
  p_report_id uuid
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', reports.id,
    'sourceId', reports.source_id,
    'baselineSourceId', reports.baseline_source_id,
    'releaseId', reports.release_id,
    'documentId', reports.document_id,
    'baselineDocumentId', reports.baseline_document_id,
    'state', reports.state,
    'comparisonStatus', case
      when reports.state = 'failed' then 'failed'
      when reports.state <> 'completed' then 'ready'
      when not exists (
        select 1
        from public.sbom_diff_component_changes changes
        where changes.organization_id = reports.organization_id
          and changes.report_id = reports.id
          and changes.change_type <> 'unchanged'
      ) then 'identical'
      else 'partial_integration_unavailable'
    end,
    'comparatorVersion', reports.comparator_version,
    'findingDelta', jsonb_build_object('state', reports.finding_delta_state),
    'counts', jsonb_build_object('componentChanges', reports.progress_change_count),
    'progress', jsonb_build_object(
      'stage', reports.progress_stage,
      'percent', reports.progress_percent
    ),
    'error', case when reports.error_code is null then null else jsonb_build_object(
      'code', reports.error_code,
      'message', reports.error_message,
      'retryable', reports.attempt_count < reports.max_attempts
    ) end,
    'completedAt', reports.completed_at,
    'createdAt', reports.created_at,
    'updatedAt', reports.updated_at
  )
  from public.sbom_diff_reports reports
  where reports.organization_id = p_organization_id and reports.id = p_report_id;
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

create or replace function public.list_sbom_diff_component_changes(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_report_id uuid,
  p_limit integer,
  p_cursor text,
  p_change_type text,
  p_ecosystem text,
  p_q text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cursor jsonb;
  v_created timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  if not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
    or p_limit not between 1 and 100
    or (p_change_type is not null and p_change_type not in ('added', 'removed', 'unchanged', 'upgraded', 'downgraded', 'unresolved'))
    or not exists (
      select 1 from public.sbom_diff_reports reports
      where reports.organization_id = p_organization_id and reports.id = p_report_id
    ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if nullif(p_cursor, '') is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb;
      if jsonb_typeof(v_cursor) <> 'array' or jsonb_array_length(v_cursor) <> 2 then
        raise exception 'invalid cursor';
      end if;
      v_created := (v_cursor ->> 0)::timestamptz;
      v_id := (v_cursor ->> 1)::uuid;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rows.id,
        'diffId', rows.report_id,
        'change', rows.change_type,
        'identity', rows.canonical_package_identity,
        'ecosystem', rows.ecosystem,
        'currentComponentId', rows.current_component_id,
        'baselineComponentId', rows.baseline_component_id,
        'currentSourceOffset', rows.current_source_offset,
        'baselineSourceOffset', rows.baseline_source_offset,
        'currentPurl', rows.current_purl,
        'baselinePurl', rows.baseline_purl,
        'currentVersion', rows.current_version,
        'baselineVersion', rows.baseline_version,
        'explanation', rows.explanation,
        'createdAt', rows.created_at
      ) order by rows.created_at, rows.id
    ),
    '[]'::jsonb
  ) into v_rows
  from (
    select
      changes.*,
      current_component.source_offset as current_source_offset,
      baseline_component.source_offset as baseline_source_offset,
      current_component.canonical_purl as current_purl,
      baseline_component.canonical_purl as baseline_purl
    from public.sbom_diff_component_changes changes
    left join public.sbom_components current_component
      on current_component.organization_id = changes.organization_id
     and current_component.id = changes.current_component_id
    left join public.sbom_components baseline_component
      on baseline_component.organization_id = changes.organization_id
     and baseline_component.id = changes.baseline_component_id
    where changes.organization_id = p_organization_id
      and changes.report_id = p_report_id
      and (v_cursor is null or (changes.created_at, changes.id) > (v_created, v_id))
      and (p_change_type is null or changes.change_type = p_change_type)
      and (p_ecosystem is null or changes.ecosystem = p_ecosystem)
      and (
        nullif(btrim(p_q), '') is null
        or changes.canonical_package_identity ilike '%' || btrim(p_q) || '%'
        or current_component.normalized_name ilike '%' || btrim(p_q) || '%'
        or baseline_component.normalized_name ilike '%' || btrim(p_q) || '%'
      )
    order by changes.created_at, changes.id
    limit p_limit
  ) rows;
  return query select 'found'::text,
    jsonb_build_object(
      'changes', v_rows,
      'nextCursor', case when jsonb_array_length(v_rows) = p_limit then
        public.sbom_diff_cursor_encode(
          (v_rows -> (p_limit - 1) ->> 'createdAt')::timestamptz,
          (v_rows -> (p_limit - 1) ->> 'id')::uuid
        )
        else null end
    );
end;
$$;

-- M4 will populate this projection later.  Keep the cursor-shaped read
-- boundary stable now, even though the unavailable state has no rows.
create or replace function public.get_sbom_diff_findings(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_report_id uuid,
  p_limit integer,
  p_cursor text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit not between 1 and 100
    or (p_cursor is not null and char_length(p_cursor) > 512)
    or not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
    or not exists (
      select 1 from public.sbom_diff_reports reports
      where reports.organization_id = p_organization_id and reports.id = p_report_id
    ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    jsonb_build_object(
      'state', 'partial_integration_unavailable',
      'items', '[]'::jsonb,
      'nextCursor', null
    );
end;
$$;

alter function public.prevent_sbom_source_dedup_mutation() owner to postgres;
alter function public.link_sbom_deduplicated_sources_to_document() owner to postgres;
  alter function public.sbom_source_json(uuid, uuid) owner to postgres;
alter function public.finalize_sbom_source_deduplicated_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) owner to postgres;
alter function public.sbom_diff_report_json(uuid, uuid) owner to postgres;
alter function public.get_sbom_source_diff_report(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.list_sbom_diff_component_facts(uuid, uuid, text, text, integer, text) owner to postgres;
alter function public.list_sbom_diff_component_changes(uuid, uuid, uuid, integer, text, text, text, text) owner to postgres;
alter function public.get_sbom_diff_findings(uuid, uuid, uuid, integer, text) owner to postgres;

revoke all on function
  public.link_sbom_deduplicated_sources_to_document(),
  public.sbom_source_json(uuid, uuid),
  public.finalize_sbom_source_deduplicated_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid),
  public.get_sbom_source_diff_report(uuid, uuid, uuid, uuid),
  public.get_sbom_diff_findings(uuid, uuid, uuid, integer, text)
from public, anon, authenticated;
grant execute on function public.finalize_sbom_source_deduplicated_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid)
to service_role;
grant execute on function public.get_sbom_source_diff_report(uuid, uuid, uuid, uuid)
to service_role;
grant execute on function public.get_sbom_diff_findings(uuid, uuid, uuid, integer, text)
to service_role;
