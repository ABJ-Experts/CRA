-- M3 SBOM intake foundation. Raw evidence is private and immutable after its
-- integrity check; every public intake mechanism converges on these RPCs.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'sbom-originals', 'sbom-originals', false, 104857600,
  array[
    'application/json', 'application/xml', 'text/xml', 'application/octet-stream',
    'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml',
    'application/spdx+json', 'application/spdx+xml'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.sbom_raw_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  media_type text not null check (media_type in (
    'application/json', 'application/xml', 'text/xml', 'application/octet-stream',
    'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml'
  )),
  storage_bucket text not null default 'sbom-originals' check (storage_bucket = 'sbom-originals'),
  storage_key text not null check (storage_key ~
    '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, sha256),
  unique (organization_id, storage_key)
);

create table public.sbom_ci_credentials (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  token_prefix text not null check (token_prefix ~ '^cra_sbom_[a-z0-9]{8}$'),
  token_salt text not null check (char_length(token_salt) between 16 and 512),
  token_hash text not null check (char_length(token_hash) between 32 and 512),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by uuid references public.users(id) on delete restrict,
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique (organization_id, id),
  unique (token_prefix),
  constraint sbom_ci_credentials_revocation_pair_check check (
    (status = 'active' and revoked_by is null and revoked_at is null)
    or (status = 'revoked' and revoked_by is not null and revoked_at is not null)
  )
);

create table public.sbom_sources (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid not null,
  actor_user_id uuid references public.users(id) on delete restrict,
  actor_credential_id uuid,
  source_kind text not null check (source_kind in (
    'manual_upload', 'ci_upload', 'integration', 'supplier', 'generated'
  )),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  original_filename text not null check (
    char_length(original_filename) between 1 and 255
    and original_filename = btrim(original_filename)
    and original_filename !~ '[\\/[:cntrl:]]'
  ),
  declared_media_type text not null check (declared_media_type in (
    'application/json', 'application/xml', 'text/xml', 'application/octet-stream',
    'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml'
  )),
  declared_byte_size bigint not null check (declared_byte_size between 1 and 104857600),
  declared_sha256 text not null check (declared_sha256 ~ '^[a-f0-9]{64}$'),
  staging_storage_key text not null check (staging_storage_key ~
    '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-f0-9]{64}$'),
  status text not null default 'upload_pending' check (status in (
    'upload_pending', 'verified', 'rejected', 'expired'
  )),
  upload_expires_at timestamptz not null,
  verified_at timestamptz,
  rejected_at timestamptz,
  rejection_code text check (rejection_code is null or rejection_code in (
    'hash_mismatch', 'byte_size_mismatch', 'media_type_mismatch', 'upload_expired'
  )),
  raw_object_id uuid,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, actor_user_id, idempotency_key),
  unique (organization_id, actor_credential_id, idempotency_key),
  unique (organization_id, staging_storage_key),
  constraint sbom_sources_release_fkey foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  constraint sbom_sources_actor_credential_fkey foreign key (organization_id, actor_credential_id)
    references public.sbom_ci_credentials(organization_id, id) on delete restrict,
  constraint sbom_sources_raw_object_fkey foreign key (organization_id, raw_object_id)
    references public.sbom_raw_objects(organization_id, id) on delete restrict,
  constraint sbom_sources_actor_kind_check check (
    (source_kind = 'manual_upload' and actor_user_id is not null and actor_credential_id is null)
    or (source_kind = 'ci_upload' and actor_user_id is null and actor_credential_id is not null)
    or (source_kind in ('integration', 'supplier', 'generated') and actor_credential_id is null)
  ),
  constraint sbom_sources_verification_state_check check (
    (status = 'upload_pending' and verified_at is null and rejected_at is null and rejection_code is null and raw_object_id is null)
    or (status = 'verified' and verified_at is not null and rejected_at is null and rejection_code is null and raw_object_id is not null)
    or (status in ('rejected', 'expired') and verified_at is null and rejected_at is not null and raw_object_id is null)
  )
);

create table public.sbom_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null,
  release_id uuid not null,
  actor_user_id uuid references public.users(id) on delete restrict,
  actor_credential_id uuid,
  correlation_id uuid not null,
  idempotency_key uuid not null,
  input_sha256 text not null check (input_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in (
    'queued', 'processing', 'failed', 'completed', 'dead_letter'
  )),
  progress_stage text not null default 'queued' check (progress_stage in (
    'queued', 'claiming', 'verifying_original', 'recording_evidence', 'completed', 'failed', 'dead_letter'
  )),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  max_attempts integer not null default 5 check (max_attempts = 5),
  next_attempt_at timestamptz not null default now(),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 100),
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code in (
    'provider_unavailable', 'source_missing', 'content_hash_mismatch', 'storage_timeout',
    'authorization_changed', 'unknown_failure'
  )),
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_id),
  constraint sbom_ingest_jobs_source_fkey foreign key (organization_id, source_id)
    references public.sbom_sources(organization_id, id) on delete restrict,
  constraint sbom_ingest_jobs_actor_credential_fkey foreign key (organization_id, actor_credential_id)
    references public.sbom_ci_credentials(organization_id, id) on delete restrict,
  constraint sbom_ingest_jobs_state_check check (
    (status = 'queued' and progress_stage = 'queued' and completed_at is null and dead_lettered_at is null)
    or (status = 'processing' and progress_stage in ('claiming', 'verifying_original', 'recording_evidence') and completed_at is null and dead_lettered_at is null)
    or (status = 'failed' and progress_stage = 'failed' and completed_at is null and dead_lettered_at is null)
    or (status = 'completed' and progress_stage = 'completed' and progress_percent = 100 and completed_at is not null and dead_lettered_at is null)
    or (status = 'dead_letter' and progress_stage = 'dead_letter' and completed_at is null and dead_lettered_at is not null)
  )
);

create index sbom_sources_org_release_created_idx
  on public.sbom_sources(organization_id, release_id, created_at desc);
create index sbom_sources_expiry_idx on public.sbom_sources(upload_expires_at)
  where status = 'upload_pending';
create index sbom_ingest_jobs_claim_idx
  on public.sbom_ingest_jobs(organization_id, next_attempt_at, created_at, id)
  where status in ('queued', 'failed');
create index sbom_ingest_jobs_recovery_idx on public.sbom_ingest_jobs(organization_id, lease_expires_at)
  where status = 'processing';
create index sbom_ci_credentials_org_status_idx
  on public.sbom_ci_credentials(organization_id, status, created_at desc);

alter table public.sbom_raw_objects enable row level security;
alter table public.sbom_sources enable row level security;
alter table public.sbom_ingest_jobs enable row level security;
alter table public.sbom_ci_credentials enable row level security;
revoke all on public.sbom_raw_objects, public.sbom_sources, public.sbom_ingest_jobs,
  public.sbom_ci_credentials from public, anon, authenticated;
grant select, insert, update on public.sbom_raw_objects, public.sbom_sources,
  public.sbom_ingest_jobs, public.sbom_ci_credentials to service_role;

create or replace function public.prevent_sbom_raw_object_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = '55000', message = 'SBOM raw objects are immutable';
end;
$$;
create trigger prevent_sbom_raw_object_mutation
  before update on public.sbom_raw_objects
  for each row execute function public.prevent_sbom_raw_object_mutation();

create or replace function public.sbom_source_json(p_organization_id uuid, p_source_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', sources.id, 'organizationId', sources.organization_id,
    'productId', sources.product_id, 'releaseId', sources.release_id,
    'source', sources.source_kind, 'fileName', sources.original_filename,
    'mediaType', sources.declared_media_type, 'byteSize', sources.declared_byte_size,
    'sha256', sources.declared_sha256, 'status', sources.status,
    'createdAt', sources.created_at, 'completedAt', sources.verified_at
  ) from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id;
$$;

create or replace function public.sbom_ingest_job_json(p_organization_id uuid, p_job_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', jobs.id, 'organizationId', jobs.organization_id, 'sourceId', jobs.source_id,
    'releaseId', jobs.release_id, 'inputSha256', jobs.input_sha256,
    'correlationId', jobs.correlation_id,
    'status', jobs.status, 'progress', jsonb_build_object(
      'stage', jobs.progress_stage, 'percent', jobs.progress_percent, 'message', case jobs.progress_stage
        when 'queued' then 'Queued for original evidence verification'
        when 'claiming' then 'Claiming ingestion work'
        when 'verifying_original' then 'Verifying immutable original evidence'
        when 'recording_evidence' then 'Recording immutable original evidence'
        when 'completed' then 'Original evidence captured'
        when 'failed' then 'Ingestion retry is pending'
        else 'Ingestion requires operator replay' end
    ), 'attempts', jobs.attempt_count, 'maxAttempts', jobs.max_attempts,
    'error', case when jobs.error_code is null then null else jsonb_build_object(
      'code', case jobs.error_code
        when 'source_missing' then 'original_missing'
        when 'content_hash_mismatch' then 'hash_mismatch'
        when 'provider_unavailable' then 'storage_unavailable'
        when 'storage_timeout' then 'storage_unavailable'
        else 'unexpected_failure' end,
      'message', case jobs.error_code
        when 'source_missing' then 'The immutable original is unavailable'
        when 'content_hash_mismatch' then 'The immutable original no longer matches its hash'
        when 'provider_unavailable' then 'Storage is temporarily unavailable'
        when 'storage_timeout' then 'Storage verification timed out'
        else 'The ingestion workflow failed safely' end,
      'retryable', jobs.status <> 'dead_letter'
    ) end,
    'result', case when jobs.status = 'completed' then jsonb_build_object(
      'outcome', 'original_evidence_captured', 'sourceId', jobs.source_id, 'sha256', jobs.input_sha256
    ) else null end,
    'createdAt', jobs.created_at, 'updatedAt', jobs.updated_at, 'completedAt', jobs.completed_at
  ) from public.sbom_ingest_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id;
$$;

create or replace function public.reserve_sbom_source_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid,
  p_actor_user_id uuid, p_actor_credential_id uuid, p_source_id uuid, p_source_kind text,
  p_idempotency_key uuid, p_request_digest text, p_original_filename text,
  p_declared_media_type text, p_declared_byte_size bigint, p_declared_sha256 text,
  p_staging_storage_key text, p_upload_expires_at timestamptz, p_correlation_id uuid
) returns table(outcome text, source jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.sbom_sources%rowtype;
begin
  if p_source_id is null or p_idempotency_key is null or p_correlation_id is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_source_kind not in ('manual_upload', 'ci_upload', 'integration', 'supplier', 'generated')
    or p_declared_media_type not in ('application/json', 'application/xml', 'text/xml', 'application/octet-stream',
      'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml')
    or p_declared_byte_size not between 1 and 104857600
    or p_declared_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(p_original_filename) not between 1 and 255
    or p_original_filename <> btrim(p_original_filename) or p_original_filename ~ '[\\/[:cntrl:]]'
    or p_staging_storage_key <> p_organization_id::text || '/' || p_source_id::text || '/' || p_declared_sha256
    or p_upload_expires_at <= now() or p_upload_expires_at > now() + interval '20 minutes'
    or (p_source_kind = 'manual_upload' and (p_actor_user_id is null or p_actor_credential_id is not null))
    or (p_source_kind = 'ci_upload' and (p_actor_user_id is not null or p_actor_credential_id is null))
    or (p_source_kind in ('integration', 'supplier', 'generated') and p_actor_credential_id is not null) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if p_actor_user_id is not null and not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_actor_credential_id is not null and not exists (
    select 1 from public.sbom_ci_credentials credentials
    where credentials.organization_id = p_organization_id and credentials.id = p_actor_credential_id
      and credentials.status = 'active'
  ) then return query select 'not_found'::text, null::jsonb; return; end if;
  if not exists (select 1 from public.product_releases releases
    where releases.organization_id = p_organization_id and releases.product_id = p_product_id
      and releases.id = p_release_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_existing from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and ((p_actor_user_id is not null and sources.actor_user_id = p_actor_user_id)
      or (p_actor_credential_id is not null and sources.actor_credential_id = p_actor_credential_id))
    and sources.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.request_digest = p_request_digest then
      return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_existing.id);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;
  insert into public.sbom_sources(
    id, organization_id, product_id, release_id, actor_user_id, actor_credential_id,
    source_kind, idempotency_key, request_digest, original_filename, declared_media_type,
    declared_byte_size, declared_sha256, staging_storage_key, upload_expires_at, correlation_id
  ) values (
    p_source_id, p_organization_id, p_product_id, p_release_id, p_actor_user_id, p_actor_credential_id,
    p_source_kind, p_idempotency_key, p_request_digest, p_original_filename, p_declared_media_type,
    p_declared_byte_size, p_declared_sha256, p_staging_storage_key, p_upload_expires_at, p_correlation_id
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sbom.upload_initiated', 'sbom_source', p_source_id::text,
    jsonb_build_object('releaseId', p_release_id, 'source', p_source_kind,
      'sha256', p_declared_sha256, 'byteSize', p_declared_byte_size,
      'correlationId', p_correlation_id, 'requestDigest', p_request_digest));
  return query select 'created'::text, public.sbom_source_json(p_organization_id, p_source_id);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.finalize_sbom_source_atomic(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid, p_actor_credential_id uuid,
  p_actual_sha256 text, p_actual_byte_size bigint, p_actual_media_type text, p_correlation_id uuid
) returns table(outcome text, source jsonb, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.sbom_sources%rowtype; v_raw_id uuid; v_job_id uuid;
begin
  if p_correlation_id is null or p_actual_sha256 !~ '^[a-f0-9]{64}$'
    or p_actual_byte_size not between 1 and 104857600
    or p_actual_media_type not in ('application/json', 'application/xml', 'text/xml', 'application/octet-stream',
      'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml')
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb; return;
  end if;
  select * into v_source from public.sbom_sources sources
    where sources.organization_id = p_organization_id and sources.id = p_source_id for update;
  if not found
    or (p_actor_user_id is not null and (v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)))
    or (p_actor_credential_id is not null and (v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id and credentials.id = p_actor_credential_id
      and credentials.status = 'active'))) then
    return query select 'not_found'::text, null::jsonb, null::jsonb; return;
  end if;
  if v_source.status = 'verified' then
    select id into v_job_id from public.sbom_ingest_jobs
      where organization_id = p_organization_id and source_id = v_source.id;
    return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_source.id),
      public.sbom_ingest_job_json(p_organization_id, v_job_id); return;
  end if;
  if v_source.status <> 'upload_pending' then
    return query select 'invalid_state'::text, public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;
  if v_source.upload_expires_at <= now() then
    update public.sbom_sources set status = 'expired', rejected_at = now(), rejection_code = 'upload_expired'
      where organization_id = p_organization_id and id = v_source.id;
    return query select 'expired'::text, public.sbom_source_json(p_organization_id, v_source.id), null::jsonb; return;
  end if;
  if p_actual_sha256 <> v_source.declared_sha256 or p_actual_byte_size <> v_source.declared_byte_size
    or p_actual_media_type <> v_source.declared_media_type then
    update public.sbom_sources set status = 'rejected', rejected_at = now(), rejection_code = case
      when p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
      when p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
      else 'media_type_mismatch' end
    where organization_id = p_organization_id and id = v_source.id;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'sbom.hash_mismatch', 'sbom_source', v_source.id::text,
      jsonb_build_object('correlationId', p_correlation_id, 'code', case
        when p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
        when p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
        else 'media_type_mismatch' end));
    return query select 'integrity_mismatch'::text, public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;
  insert into public.sbom_raw_objects(organization_id, sha256, byte_size, media_type, storage_key)
  values (p_organization_id, v_source.declared_sha256, v_source.declared_byte_size,
    v_source.declared_media_type, v_source.staging_storage_key)
  on conflict (organization_id, sha256) do nothing;
  select id into v_raw_id from public.sbom_raw_objects
    where organization_id = p_organization_id and sha256 = v_source.declared_sha256 for share;
  update public.sbom_sources set status = 'verified', verified_at = now(), raw_object_id = v_raw_id
    where organization_id = p_organization_id and id = v_source.id;
  insert into public.sbom_ingest_jobs(
    organization_id, source_id, release_id, actor_user_id, actor_credential_id, correlation_id,
    idempotency_key, input_sha256
  ) values (
    p_organization_id, v_source.id, v_source.release_id, v_source.actor_user_id,
    v_source.actor_credential_id, v_source.correlation_id, v_source.idempotency_key, v_source.declared_sha256
  ) returning id into v_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values
    (p_organization_id, p_actor_user_id, 'sbom.upload_completed', 'sbom_source', v_source.id::text,
      jsonb_build_object('sha256', v_source.declared_sha256, 'byteSize', v_source.declared_byte_size,
        'correlationId', p_correlation_id)),
    (p_organization_id, p_actor_user_id, 'sbom.source_linked', 'sbom_source', v_source.id::text,
      jsonb_build_object('rawObjectId', v_raw_id, 'correlationId', p_correlation_id)),
    (p_organization_id, p_actor_user_id, 'sbom.job_queued', 'sbom_ingest_job', v_job_id::text,
      jsonb_build_object('sourceId', v_source.id, 'correlationId', p_correlation_id));
  return query select 'queued'::text, public.sbom_source_json(p_organization_id, v_source.id),
    public.sbom_ingest_job_json(p_organization_id, v_job_id);
exception when unique_violation then
  select id into v_job_id from public.sbom_ingest_jobs
    where organization_id = p_organization_id and source_id = p_source_id;
  return query select 'replayed'::text, public.sbom_source_json(p_organization_id, p_source_id),
    public.sbom_ingest_job_json(p_organization_id, v_job_id);
end;
$$;

create or replace function public.reject_sbom_source_integrity_atomic(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid, p_actor_credential_id uuid,
  p_actual_sha256 text, p_actual_byte_size bigint, p_actual_media_type text, p_correlation_id uuid
) returns table(outcome text, source jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.sbom_sources%rowtype; v_code text;
begin
  if p_correlation_id is null
    or ((p_actor_user_id is null) = (p_actor_credential_id is null))
    or (p_actual_sha256 is not null and p_actual_sha256 !~ '^[a-f0-9]{64}$')
    or (p_actual_byte_size is not null and (p_actual_byte_size < 0 or p_actual_byte_size > 104857600))
    or (p_actual_media_type is not null and p_actual_media_type not in (
      'application/json', 'application/xml', 'text/xml', 'application/octet-stream',
      'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml'
    )) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_source from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id for update;
  if not found
    or (p_actor_user_id is not null and (v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)))
    or (p_actor_credential_id is not null and (v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id and credentials.id = p_actor_credential_id
          and credentials.status = 'active'))) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_source.status = 'rejected' then
    return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_source.id); return;
  end if;
  if v_source.status <> 'upload_pending' then
    return query select 'invalid_state'::text, public.sbom_source_json(p_organization_id, v_source.id); return;
  end if;
  v_code := case
    when p_actual_sha256 is null or p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
    when p_actual_byte_size is null or p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
    when p_actual_media_type is null or p_actual_media_type <> v_source.declared_media_type then 'media_type_mismatch'
    else 'hash_mismatch'
  end;
  update public.sbom_sources set status = 'rejected', rejected_at = now(), rejection_code = v_code
  where organization_id = p_organization_id and id = v_source.id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sbom.hash_mismatch', 'sbom_source', v_source.id::text,
    jsonb_build_object('correlationId', p_correlation_id, 'code', v_code));
  return query select 'rejected'::text, public.sbom_source_json(p_organization_id, v_source.id);
end;
$$;

create or replace function public.get_sbom_ingest_job(
  p_organization_id uuid, p_actor_user_id uuid, p_job_id uuid
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) or not exists (
    select 1 from public.sbom_ingest_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.id = p_job_id
  ) then return query select 'not_found'::text, null::jsonb; return; end if;
  return query select 'found'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

create or replace function public.get_sbom_source_download(
  p_organization_id uuid, p_actor_user_id uuid, p_source_id uuid, p_correlation_id uuid
) returns table(outcome text, storage_bucket text, storage_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_raw public.sbom_raw_objects%rowtype;
begin
  if p_correlation_id is null or not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::text, null::text; return;
  end if;
  select raw.* into v_raw from public.sbom_sources sources
    join public.sbom_raw_objects raw on raw.organization_id = sources.organization_id and raw.id = sources.raw_object_id
    where sources.organization_id = p_organization_id and sources.id = p_source_id and sources.status = 'verified'
    for share;
  if not found then return query select 'not_found'::text, null::text, null::text; return; end if;
  return query select 'found'::text, v_raw.storage_bucket, v_raw.storage_key;
end;
$$;

create or replace function public.list_due_sbom_ingest_organizations(p_limit integer)
returns table(organization_id uuid, oldest_due_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 500 then return; end if;
  return query
  select jobs.organization_id, min(case when jobs.status = 'processing' then jobs.lease_expires_at else jobs.next_attempt_at end)
  from public.sbom_ingest_jobs jobs
  where (jobs.status in ('queued', 'failed') and jobs.next_attempt_at <= now())
    or (jobs.status = 'processing' and jobs.lease_expires_at <= now())
  group by jobs.organization_id
  order by min(case when jobs.status = 'processing' then jobs.lease_expires_at else jobs.next_attempt_at end), jobs.organization_id
  limit p_limit;
end;
$$;

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
    update public.sbom_ingest_jobs set status = 'failed', progress_stage = 'failed', lease_owner = null,
      lease_expires_at = null, error_code = coalesce(error_code, 'unknown_failure'), next_attempt_at = now(), updated_at = now()
    where organization_id = p_organization_id and status = 'processing' and lease_expires_at <= now()
    returning id, actor_user_id, correlation_id
  )
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  select p_organization_id, recovered.actor_user_id, 'sbom.job_failed', 'sbom_ingest_job', recovered.id::text,
    jsonb_build_object('code', 'worker_lease_expired', 'terminal', false, 'correlationId', recovered.correlation_id)
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

create or replace function public.checkpoint_sbom_ingest_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_progress_stage text,
  p_progress_percent integer, p_lease_seconds integer
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_progress_stage not in ('claiming', 'verifying_original', 'recording_evidence')
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

create or replace function public.complete_sbom_ingest_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id text
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.sbom_ingest_jobs set status = 'completed', progress_stage = 'completed',
    progress_percent = 100, lease_owner = null, lease_expires_at = null, completed_at = now(), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id and status = 'processing'
    and lease_owner = btrim(p_worker_id) and lease_expires_at > now();
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  return query select 'completed'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

create or replace function public.fail_sbom_ingest_job(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_error_code text
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_delay_seconds integer;
begin
  if p_error_code not in ('provider_unavailable', 'source_missing', 'content_hash_mismatch', 'storage_timeout', 'authorization_changed', 'unknown_failure') then
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

create or replace function public.replay_sbom_ingest_job_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_job_id uuid, p_correlation_id uuid
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.sbom_ingest_jobs%rowtype;
begin
  if p_correlation_id is null or not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not exists (select 1 from public.organization_members memberships
    where memberships.organization_id = p_organization_id and memberships.user_id = p_actor_user_id
      and memberships.role = 'owner') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_job from public.sbom_ingest_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.status <> 'dead_letter' then return query select 'invalid_state'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id); return; end if;
  update public.sbom_ingest_jobs set status = 'queued', progress_stage = 'queued', progress_percent = 0,
    attempt_count = 0, next_attempt_at = now(), lease_owner = null, lease_expires_at = null,
    error_code = null, dead_lettered_at = null, updated_at = now()
  where organization_id = p_organization_id and id = p_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sbom.job_replayed', 'sbom_ingest_job', p_job_id::text,
    jsonb_build_object('correlationId', p_correlation_id));
  return query select 'queued'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

create or replace function public.create_sbom_ci_credential_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_credential_id uuid, p_label text,
  p_token_prefix text, p_token_salt text, p_token_hash text
) returns table(outcome text, credential jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_credential_id is null or char_length(btrim(p_label)) not between 1 and 100
    or p_token_prefix !~ '^cra_sbom_[a-z0-9]{8}$'
    or char_length(p_token_salt) not between 16 and 512 or char_length(p_token_hash) not between 32 and 512
    or not public.m2_active_member(p_organization_id, p_actor_user_id)
    or not exists (select 1 from public.organization_members memberships
      where memberships.organization_id = p_organization_id and memberships.user_id = p_actor_user_id
        and memberships.role = 'owner') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  insert into public.sbom_ci_credentials(id, organization_id, label, token_prefix, token_salt, token_hash, created_by)
  values (p_credential_id, p_organization_id, btrim(p_label), p_token_prefix, p_token_salt, p_token_hash, p_actor_user_id);
  return query select 'created'::text, jsonb_build_object('id', p_credential_id, 'label', btrim(p_label),
    'tokenPrefix', p_token_prefix, 'status', 'active');
exception when unique_violation then return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.resolve_sbom_ci_credential(
  p_organization_id uuid, p_credential_id uuid
) returns table(outcome text, credential_id uuid, token_salt text, token_hash text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.sbom_ci_credentials credentials
    where credentials.organization_id = p_organization_id and credentials.id = p_credential_id
      and credentials.status = 'active') then
    return query select 'not_found'::text, null::uuid, null::text, null::text; return;
  end if;
  return query select 'found'::text, credentials.id, credentials.token_salt, credentials.token_hash
  from public.sbom_ci_credentials credentials
  where credentials.organization_id = p_organization_id and credentials.id = p_credential_id;
end;
$$;

create or replace function public.record_sbom_ci_credential_use(
  p_organization_id uuid, p_credential_id uuid
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.sbom_ci_credentials set last_used_at = now()
  where organization_id = p_organization_id and id = p_credential_id and status = 'active';
  if not found then return query select 'not_found'::text; return; end if;
  return query select 'recorded'::text;
end;
$$;

create or replace function public.revoke_sbom_ci_credential_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_credential_id uuid
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
    or not exists (select 1 from public.organization_members memberships
      where memberships.organization_id = p_organization_id and memberships.user_id = p_actor_user_id
        and memberships.role = 'owner') then
    return query select 'not_found'::text; return;
  end if;
  update public.sbom_ci_credentials set status = 'revoked', revoked_by = p_actor_user_id, revoked_at = now()
  where organization_id = p_organization_id and id = p_credential_id and status = 'active';
  if not found then return query select 'not_found'::text; return; end if;
  return query select 'revoked'::text;
end;
$$;

alter function public.sbom_source_json(uuid, uuid) owner to postgres;
alter function public.sbom_ingest_job_json(uuid, uuid) owner to postgres;
alter function public.reserve_sbom_source_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text, timestamptz, uuid) owner to postgres;
alter function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) owner to postgres;
alter function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) owner to postgres;
alter function public.get_sbom_ingest_job(uuid, uuid, uuid) owner to postgres;
alter function public.get_sbom_source_download(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.list_due_sbom_ingest_organizations(integer) owner to postgres;
alter function public.claim_sbom_ingest_job(uuid, text, integer) owner to postgres;
alter function public.checkpoint_sbom_ingest_job(uuid, uuid, text, text, integer, integer) owner to postgres;
alter function public.complete_sbom_ingest_job(uuid, uuid, text) owner to postgres;
alter function public.fail_sbom_ingest_job(uuid, uuid, text, text) owner to postgres;
alter function public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.create_sbom_ci_credential_atomic(uuid, uuid, uuid, text, text, text, text) owner to postgres;
alter function public.resolve_sbom_ci_credential(uuid, uuid) owner to postgres;
alter function public.record_sbom_ci_credential_use(uuid, uuid) owner to postgres;
alter function public.revoke_sbom_ci_credential_atomic(uuid, uuid, uuid) owner to postgres;

revoke all on function
  public.sbom_source_json(uuid, uuid), public.sbom_ingest_job_json(uuid, uuid),
  public.reserve_sbom_source_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text, timestamptz, uuid),
  public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.get_sbom_ingest_job(uuid, uuid, uuid), public.get_sbom_source_download(uuid, uuid, uuid, uuid),
  public.list_due_sbom_ingest_organizations(integer), public.claim_sbom_ingest_job(uuid, text, integer),
  public.checkpoint_sbom_ingest_job(uuid, uuid, text, text, integer, integer), public.complete_sbom_ingest_job(uuid, uuid, text),
  public.fail_sbom_ingest_job(uuid, uuid, text, text), public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid),
  public.create_sbom_ci_credential_atomic(uuid, uuid, uuid, text, text, text, text),
  public.resolve_sbom_ci_credential(uuid, uuid), public.revoke_sbom_ci_credential_atomic(uuid, uuid, uuid)
  , public.record_sbom_ci_credential_use(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.reserve_sbom_source_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text, timestamptz, uuid),
  public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.get_sbom_ingest_job(uuid, uuid, uuid), public.get_sbom_source_download(uuid, uuid, uuid, uuid),
  public.list_due_sbom_ingest_organizations(integer), public.claim_sbom_ingest_job(uuid, text, integer),
  public.checkpoint_sbom_ingest_job(uuid, uuid, text, text, integer, integer), public.complete_sbom_ingest_job(uuid, uuid, text),
  public.fail_sbom_ingest_job(uuid, uuid, text, text), public.replay_sbom_ingest_job_atomic(uuid, uuid, uuid, uuid),
  public.create_sbom_ci_credential_atomic(uuid, uuid, uuid, text, text, text, text),
  public.resolve_sbom_ci_credential(uuid, uuid), public.record_sbom_ci_credential_use(uuid, uuid),
  public.revoke_sbom_ci_credential_atomic(uuid, uuid, uuid)
to service_role;
