-- M3 SBOM validation persistence. Validation is a bounded report on the
-- existing ingest job; raw evidence remains immutable and private.

create or replace function public.sbom_allowed_media_type(p_value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_value in (
    'application/json',
    'application/xml',
    'text/xml',
    'text/plain',
    'application/octet-stream',
    'application/vnd.cyclonedx+json',
    'application/vnd.cyclonedx+xml',
    'application/spdx+json',
    'application/spdx+xml'
  );
$$;

update storage.buckets
set allowed_mime_types = array[
  'application/json',
  'application/xml',
  'text/xml',
  'text/plain',
  'application/octet-stream',
  'application/vnd.cyclonedx+json',
  'application/vnd.cyclonedx+xml',
  'application/spdx+json',
  'application/spdx+xml'
]
where id = 'sbom-originals';

alter table public.sbom_raw_objects
  drop constraint if exists sbom_raw_objects_media_type_check,
  add constraint sbom_raw_objects_media_type_check
    check (public.sbom_allowed_media_type(media_type));

alter table public.sbom_sources
  drop constraint if exists sbom_sources_declared_media_type_check,
  add constraint sbom_sources_declared_media_type_check
    check (public.sbom_allowed_media_type(declared_media_type));

alter table public.sbom_sources
  add column if not exists declared_format text,
  add column if not exists declared_spec_version text,
  add column if not exists supersedes_source_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_sources'::regclass
      and conname = 'sbom_sources_declared_format_check'
  ) then
    alter table public.sbom_sources
      add constraint sbom_sources_declared_format_check
        check (declared_format is null or declared_format in ('cyclonedx', 'spdx'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_sources'::regclass
      and conname = 'sbom_sources_declared_spec_version_check'
  ) then
    alter table public.sbom_sources
      add constraint sbom_sources_declared_spec_version_check
        check (
          declared_spec_version is null
          or (
            char_length(btrim(declared_spec_version)) between 1 and 40
            and declared_spec_version = btrim(declared_spec_version)
            and declared_spec_version !~ '[[:cntrl:]]'
          )
        );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_sources'::regclass
      and conname = 'sbom_sources_supersedes_not_self_check'
  ) then
    alter table public.sbom_sources
      add constraint sbom_sources_supersedes_not_self_check
        check (supersedes_source_id is null or supersedes_source_id <> id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_sources'::regclass
      and conname = 'sbom_sources_org_release_id_key'
  ) then
    alter table public.sbom_sources
      add constraint sbom_sources_org_release_id_key
        unique (organization_id, release_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_sources'::regclass
      and conname = 'sbom_sources_supersedes_same_release_fkey'
  ) then
    alter table public.sbom_sources
      add constraint sbom_sources_supersedes_same_release_fkey
        foreign key (organization_id, release_id, supersedes_source_id)
        references public.sbom_sources(organization_id, release_id, id)
        on delete restrict;
  end if;
end;
$$;

create or replace function public.prevent_sbom_source_version_metadata_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.declared_format is distinct from new.declared_format
    or old.declared_spec_version is distinct from new.declared_spec_version
    or old.supersedes_source_id is distinct from new.supersedes_source_id then
    raise exception using errcode = '55000',
      message = 'SBOM source version metadata is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_sbom_source_version_metadata_mutation on public.sbom_sources;
create trigger prevent_sbom_source_version_metadata_mutation
  before update of declared_format, declared_spec_version, supersedes_source_id
  on public.sbom_sources
  for each row execute function public.prevent_sbom_source_version_metadata_mutation();

create or replace function public.sbom_json_has_exact_keys(
  p_value jsonb,
  p_expected_keys text[]
) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_value) = 'object'
    and (
      select coalesce(array_agg(keys.key order by keys.key), array[]::text[])
      from jsonb_object_keys(p_value) as keys(key)
    ) = (
      select coalesce(array_agg(expected.key order by expected.key), array[]::text[])
      from unnest(p_expected_keys) as expected(key)
    );
$$;

create or replace function public.sbom_json_has_sensitive_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value) loop
      if v_key ~* '(raw_?bytes|raw_?evidence|storage_?key|storage_?url|signed_?url|credential|token|secret)' then
        return true;
      end if;
      if public.sbom_json_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      if public.sbom_json_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'string' then
    if p_value #>> '{}' ~* '(secret[-_ ]?token|token[-_ ]?secret|credential[-_ ]?(id|secret|token)?|storage[-_ ]?(key|url)|signed[-_ ]?url|raw[-_ ]?(bytes|evidence)|bearer[[:space:]]+[a-z0-9._-]+|sb_secret_|sk_(live|test)_)' then
      return true;
    end if;
  end if;

  return false;
end;
$$;

alter table public.sbom_ingest_jobs
  add column if not exists validation_status text not null default 'pending',
  add column if not exists detected_format text,
  add column if not exists detected_serialization text,
  add column if not exists detected_spec_version text,
  add column if not exists validator_name text,
  add column if not exists validator_version text,
  add column if not exists validator_schema_asset_sha256 text,
  add column if not exists validation_report jsonb,
  add column if not exists validation_completed_at timestamptz;

create or replace function public.valid_sbom_validation_report(
  p_report jsonb,
  p_status text
) returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_diagnostics jsonb;
  v_counts jsonb;
  v_validator jsonb;
  v_diagnostic jsonb;
begin
  if p_status not in ('valid', 'valid_with_warnings', 'invalid') then
    return false;
  end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    return false;
  end if;
  if octet_length(p_report::text) > 524288 then
    return false;
  end if;
  if public.sbom_json_has_sensitive_key(p_report) then
    return false;
  end if;
  if not public.sbom_json_has_exact_keys(
    p_report,
    array[
      'completedAt',
      'detectedFormat',
      'detectedSerialization',
      'detectedSpecVersion',
      'diagnosticCounts',
      'diagnostics',
      'omittedDiagnosticCount',
      'status',
      'validator'
    ]
  ) then
    return false;
  end if;
  if p_report ->> 'status' is distinct from p_status then
    return false;
  end if;
  if jsonb_typeof(p_report -> 'status') <> 'string'
    or jsonb_typeof(p_report -> 'completedAt') <> 'string'
    or jsonb_typeof(p_report -> 'detectedFormat') not in ('string', 'null')
    or jsonb_typeof(p_report -> 'detectedSerialization') not in ('string', 'null')
    or jsonb_typeof(p_report -> 'detectedSpecVersion') not in ('string', 'null') then
    return false;
  end if;
  if p_report ->> 'detectedFormat' is not null
    and p_report ->> 'detectedFormat' not in ('cyclonedx', 'spdx') then
    return false;
  end if;
  if p_report ->> 'detectedSerialization' is not null
    and p_report ->> 'detectedSerialization' not in ('json', 'xml', 'tag_value') then
    return false;
  end if;
  if p_report ->> 'detectedSpecVersion' is not null
    and (
      char_length(btrim(p_report ->> 'detectedSpecVersion')) not between 1 and 40
      or p_report ->> 'detectedSpecVersion' <> btrim(p_report ->> 'detectedSpecVersion')
      or p_report ->> 'detectedSpecVersion' ~ '[[:cntrl:]]'
    ) then
    return false;
  end if;
  if coalesce(p_report ->> 'completedAt', '') !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then
    return false;
  end if;

  v_diagnostics := p_report -> 'diagnostics';
  v_counts := p_report -> 'diagnosticCounts';
  v_validator := p_report -> 'validator';
  if jsonb_typeof(v_diagnostics) <> 'array'
    or jsonb_array_length(v_diagnostics) > 100 then
    return false;
  end if;
  if not public.sbom_json_has_exact_keys(v_validator, array['name', 'version'])
    or jsonb_typeof(v_validator -> 'name') <> 'string'
    or jsonb_typeof(v_validator -> 'version') <> 'string'
    or char_length(btrim(coalesce(v_validator ->> 'name', ''))) not between 1 and 120
    or char_length(btrim(coalesce(v_validator ->> 'version', ''))) not between 1 and 80
    or v_validator ->> 'name' <> btrim(v_validator ->> 'name')
    or v_validator ->> 'version' <> btrim(v_validator ->> 'version')
    or v_validator ->> 'name' ~ '[[:cntrl:]]'
    or v_validator ->> 'version' ~ '[[:cntrl:]]' then
    return false;
  end if;
  if not public.sbom_json_has_exact_keys(v_counts, array['error', 'warning'])
    or jsonb_typeof(v_counts -> 'error') <> 'number'
    or jsonb_typeof(v_counts -> 'warning') <> 'number'
    or coalesce(v_counts ->> 'error', '') !~ '^[0-9]+$'
    or coalesce(v_counts ->> 'warning', '') !~ '^[0-9]+$' then
    return false;
  end if;
  if jsonb_typeof(p_report -> 'omittedDiagnosticCount') <> 'number'
    or coalesce(p_report ->> 'omittedDiagnosticCount', '') !~ '^[0-9]+$' then
    return false;
  end if;

  for v_diagnostic in select value from jsonb_array_elements(v_diagnostics) loop
    if not public.sbom_json_has_exact_keys(
        v_diagnostic,
        array['code', 'location', 'message', 'remediation', 'severity']
      )
      or v_diagnostic ->> 'severity' not in ('error', 'warning')
      or jsonb_typeof(v_diagnostic -> 'severity') <> 'string'
      or jsonb_typeof(v_diagnostic -> 'code') <> 'string'
      or jsonb_typeof(v_diagnostic -> 'location') <> 'string'
      or jsonb_typeof(v_diagnostic -> 'message') <> 'string'
      or jsonb_typeof(v_diagnostic -> 'remediation') <> 'string'
      or char_length(btrim(coalesce(v_diagnostic ->> 'code', ''))) not between 1 and 120
      or char_length(btrim(coalesce(v_diagnostic ->> 'location', ''))) not between 1 and 500
      or char_length(btrim(coalesce(v_diagnostic ->> 'message', ''))) not between 1 and 1000
      or char_length(btrim(coalesce(v_diagnostic ->> 'remediation', ''))) not between 1 and 1000
      or v_diagnostic ->> 'code' <> btrim(v_diagnostic ->> 'code')
      or v_diagnostic ->> 'location' <> btrim(v_diagnostic ->> 'location')
      or v_diagnostic ->> 'message' <> btrim(v_diagnostic ->> 'message')
      or v_diagnostic ->> 'remediation' <> btrim(v_diagnostic ->> 'remediation')
      or v_diagnostic ->> 'code' ~ '[[:cntrl:]]'
      or v_diagnostic ->> 'location' ~ '[[:cntrl:]]'
      or v_diagnostic ->> 'message' ~ '[[:cntrl:]]'
      or v_diagnostic ->> 'remediation' ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_ingest_jobs'::regclass
      and conname = 'sbom_ingest_jobs_validation_status_check'
  ) then
    alter table public.sbom_ingest_jobs
      add constraint sbom_ingest_jobs_validation_status_check
        check (validation_status in ('pending', 'valid', 'valid_with_warnings', 'invalid'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_ingest_jobs'::regclass
      and conname = 'sbom_ingest_jobs_validation_detection_check'
  ) then
    alter table public.sbom_ingest_jobs
      add constraint sbom_ingest_jobs_validation_detection_check
        check (
          (detected_format is null or detected_format in ('cyclonedx', 'spdx'))
          and (detected_serialization is null or detected_serialization in ('json', 'xml', 'tag_value'))
          and (
            detected_spec_version is null
            or (
              char_length(btrim(detected_spec_version)) between 1 and 40
              and detected_spec_version = btrim(detected_spec_version)
              and detected_spec_version !~ '[[:cntrl:]]'
            )
          )
        );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_ingest_jobs'::regclass
      and conname = 'sbom_ingest_jobs_validator_metadata_check'
  ) then
    alter table public.sbom_ingest_jobs
      add constraint sbom_ingest_jobs_validator_metadata_check
        check (
          (
            validator_name is null
            and validator_version is null
          )
          or (
            char_length(btrim(validator_name)) between 1 and 120
            and char_length(btrim(validator_version)) between 1 and 80
            and validator_name = btrim(validator_name)
            and validator_version = btrim(validator_version)
            and validator_name !~ '[[:cntrl:]]'
            and validator_version !~ '[[:cntrl:]]'
          )
        );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sbom_ingest_jobs'::regclass
      and conname = 'sbom_ingest_jobs_validation_terminal_check'
  ) then
    alter table public.sbom_ingest_jobs
      add constraint sbom_ingest_jobs_validation_terminal_check
        check (
          (
            validation_status = 'pending'
            and detected_format is null
            and detected_serialization is null
            and detected_spec_version is null
            and validator_name is null
            and validator_version is null
            and validation_report is null
            and validation_completed_at is null
          )
          or (
            validation_status in ('valid', 'valid_with_warnings', 'invalid')
            and validator_name is not null
            and validator_version is not null
            and validation_report is not null
            and validation_completed_at is not null
            and public.valid_sbom_validation_report(validation_report, validation_status)
          )
        );
  end if;
end;
$$;

create or replace function public.sbom_source_json(p_organization_id uuid, p_source_id uuid)
returns jsonb
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
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id;
$$;

create or replace function public.sbom_validation_summary_json(
  p_organization_id uuid,
  p_source_id uuid
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'status', jobs.validation_status,
        'diagnosticCounts', coalesce(
          jobs.validation_report -> 'diagnosticCounts',
          jsonb_build_object('error', 0, 'warning', 0)
        ),
        'omittedDiagnosticCount', coalesce(
          (jobs.validation_report ->> 'omittedDiagnosticCount')::integer,
          0
        ),
        'completedAt', jobs.validation_completed_at
      )
      from public.sbom_ingest_jobs jobs
      where jobs.organization_id = p_organization_id
        and jobs.source_id = p_source_id
    ),
    jsonb_build_object(
      'status', 'pending',
      'diagnosticCounts', jsonb_build_object('error', 0, 'warning', 0),
      'omittedDiagnosticCount', 0,
      'completedAt', null
    )
  );
$$;

create or replace function public.sbom_validation_report_json(
  p_organization_id uuid,
  p_source_id uuid
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select jobs.validation_report
      from public.sbom_ingest_jobs jobs
      where jobs.organization_id = p_organization_id
        and jobs.source_id = p_source_id
        and jobs.validation_report is not null
    ),
    jsonb_build_object(
      'status', 'pending',
      'detectedFormat', null,
      'detectedSerialization', null,
      'detectedSpecVersion', null,
      'validator', jsonb_build_object(
        'name', 'CRA deterministic SBOM validator',
        'version', 'pending'
      ),
      'diagnostics', '[]'::jsonb,
      'diagnosticCounts', jsonb_build_object('error', 0, 'warning', 0),
      'omittedDiagnosticCount', 0,
      'completedAt', null
    )
  );
$$;

create or replace function public.reserve_sbom_source_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid,
  p_actor_user_id uuid, p_actor_credential_id uuid, p_source_id uuid, p_source_kind text,
  p_idempotency_key uuid, p_request_digest text, p_original_filename text,
  p_declared_media_type text, p_declared_byte_size bigint, p_declared_sha256 text,
  p_staging_storage_key text, p_upload_expires_at timestamptz, p_correlation_id uuid,
  p_declared_format text, p_declared_spec_version text, p_supersedes_source_id uuid
) returns table(outcome text, source jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.sbom_sources%rowtype;
begin
  if p_source_id is null or p_idempotency_key is null or p_correlation_id is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_source_kind not in ('manual_upload', 'ci_upload', 'integration', 'supplier', 'generated')
    or not public.sbom_allowed_media_type(p_declared_media_type)
    or p_declared_byte_size not between 1 and 104857600
    or p_declared_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(p_original_filename) not between 1 and 255
    or p_original_filename <> btrim(p_original_filename)
    or p_original_filename ~ '[\\/[:cntrl:]]'
    or p_staging_storage_key <> p_organization_id::text || '/' || p_source_id::text || '/' || p_declared_sha256
    or p_upload_expires_at <= now()
    or p_upload_expires_at > now() + interval '20 minutes'
    or (p_declared_format is not null and p_declared_format not in ('cyclonedx', 'spdx'))
    or (
      p_declared_spec_version is not null
      and (
        char_length(btrim(p_declared_spec_version)) not between 1 and 40
        or p_declared_spec_version <> btrim(p_declared_spec_version)
        or p_declared_spec_version ~ '[[:cntrl:]]'
      )
    )
    or (p_source_kind = 'manual_upload' and (p_actor_user_id is null or p_actor_credential_id is not null))
    or (p_source_kind = 'ci_upload' and (p_actor_user_id is not null or p_actor_credential_id is null))
    or (p_source_kind in ('integration', 'supplier', 'generated') and p_actor_credential_id is not null) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  if p_actor_user_id is not null and not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if p_actor_credential_id is not null and not exists (
    select 1 from public.sbom_ci_credentials credentials
    where credentials.organization_id = p_organization_id
      and credentials.id = p_actor_credential_id
      and credentials.status = 'active'
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if not exists (
    select 1 from public.product_releases releases
    where releases.organization_id = p_organization_id
      and releases.product_id = p_product_id
      and releases.id = p_release_id
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if p_supersedes_source_id is not null and not exists (
    select 1 from public.sbom_sources previous
    where previous.organization_id = p_organization_id
      and previous.release_id = p_release_id
      and previous.id = p_supersedes_source_id
      and previous.status = 'verified'
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select * into v_existing from public.sbom_sources sources
  where sources.organization_id = p_organization_id
    and (
      (p_actor_user_id is not null and sources.actor_user_id = p_actor_user_id)
      or (p_actor_credential_id is not null and sources.actor_credential_id = p_actor_credential_id)
    )
    and sources.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.request_digest = p_request_digest then
      return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_existing.id);
      return;
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;

  insert into public.sbom_sources(
    id, organization_id, product_id, release_id, actor_user_id, actor_credential_id,
    source_kind, idempotency_key, request_digest, original_filename, declared_media_type,
    declared_byte_size, declared_sha256, staging_storage_key, upload_expires_at, correlation_id,
    declared_format, declared_spec_version, supersedes_source_id
  ) values (
    p_source_id, p_organization_id, p_product_id, p_release_id, p_actor_user_id, p_actor_credential_id,
    p_source_kind, p_idempotency_key, p_request_digest, p_original_filename, p_declared_media_type,
    p_declared_byte_size, p_declared_sha256, p_staging_storage_key, p_upload_expires_at, p_correlation_id,
    p_declared_format, p_declared_spec_version, p_supersedes_source_id
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id,
    p_actor_user_id,
    'sbom.upload_initiated',
    'sbom_source',
    p_source_id::text,
    jsonb_build_object(
      'releaseId', p_release_id,
      'source', p_source_kind,
      'sha256', p_declared_sha256,
      'byteSize', p_declared_byte_size,
      'correlationId', p_correlation_id,
      'requestDigest', p_request_digest,
      'declaredFormat', p_declared_format,
      'declaredSpecVersion', p_declared_spec_version,
      'supersedesSourceId', p_supersedes_source_id
    )
  );
  return query select 'created'::text, public.sbom_source_json(p_organization_id, p_source_id);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.finalize_sbom_source_atomic(
  p_organization_id uuid,
  p_source_id uuid,
  p_actor_user_id uuid,
  p_actor_credential_id uuid,
  p_actual_sha256 text,
  p_actual_byte_size bigint,
  p_actual_media_type text,
  p_correlation_id uuid
) returns table(outcome text, source jsonb, job jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.sbom_sources%rowtype;
  v_raw_id uuid;
  v_job_id uuid;
begin
  if p_correlation_id is null
    or p_actual_sha256 !~ '^[a-f0-9]{64}$'
    or p_actual_byte_size not between 1 and 104857600
    or not public.sbom_allowed_media_type(p_actual_media_type)
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id
  for update;
  if not found
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
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;

  if v_source.status = 'verified' then
    select id into v_job_id
    from public.sbom_ingest_jobs
    where organization_id = p_organization_id and source_id = v_source.id;
    return query select
      'replayed'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      public.sbom_ingest_job_json(p_organization_id, v_job_id);
    return;
  end if;

  if v_source.status <> 'upload_pending' then
    return query select
      'invalid_state'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      null::jsonb;
    return;
  end if;

  if v_source.upload_expires_at <= now() then
    update public.sbom_sources
       set status = 'expired',
           rejected_at = now(),
           rejection_code = 'upload_expired'
     where organization_id = p_organization_id and id = v_source.id;
    return query select
      'expired'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      null::jsonb;
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
    return query select
      'integrity_mismatch'::text,
      public.sbom_source_json(p_organization_id, v_source.id),
      null::jsonb;
    return;
  end if;

  insert into public.sbom_raw_objects(organization_id, sha256, byte_size, media_type, storage_key)
  values (
    p_organization_id,
    v_source.declared_sha256,
    v_source.declared_byte_size,
    v_source.declared_media_type,
    v_source.staging_storage_key
  )
  on conflict (organization_id, sha256) do nothing;

  select id into v_raw_id
  from public.sbom_raw_objects
  where organization_id = p_organization_id and sha256 = v_source.declared_sha256
  for share;

  update public.sbom_sources
     set status = 'verified',
         verified_at = now(),
         raw_object_id = v_raw_id
   where organization_id = p_organization_id and id = v_source.id;

  insert into public.sbom_ingest_jobs(
    organization_id,
    source_id,
    release_id,
    actor_user_id,
    actor_credential_id,
    correlation_id,
    idempotency_key,
    input_sha256
  ) values (
    p_organization_id,
    v_source.id,
    v_source.release_id,
    v_source.actor_user_id,
    v_source.actor_credential_id,
    v_source.correlation_id,
    v_source.idempotency_key,
    v_source.declared_sha256
  )
  returning id into v_job_id;

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
      v_job_id::text,
      jsonb_build_object('sourceId', v_source.id, 'correlationId', p_correlation_id)
    );

  return query select
    'queued'::text,
    public.sbom_source_json(p_organization_id, v_source.id),
    public.sbom_ingest_job_json(p_organization_id, v_job_id);
exception when unique_violation then
  select id into v_job_id
  from public.sbom_ingest_jobs
  where organization_id = p_organization_id and source_id = p_source_id;
  return query select
    'replayed'::text,
    public.sbom_source_json(p_organization_id, p_source_id),
    public.sbom_ingest_job_json(p_organization_id, v_job_id);
end;
$$;

create or replace function public.reject_sbom_source_integrity_atomic(
  p_organization_id uuid,
  p_source_id uuid,
  p_actor_user_id uuid,
  p_actor_credential_id uuid,
  p_actual_sha256 text,
  p_actual_byte_size bigint,
  p_actual_media_type text,
  p_correlation_id uuid
) returns table(outcome text, source jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.sbom_sources%rowtype;
  v_code text;
begin
  if p_correlation_id is null
    or ((p_actor_user_id is null) = (p_actor_credential_id is null))
    or (p_actual_sha256 is not null and p_actual_sha256 !~ '^[a-f0-9]{64}$')
    or (p_actual_byte_size is not null and (p_actual_byte_size < 0 or p_actual_byte_size > 104857600))
    or (p_actual_media_type is not null and not public.sbom_allowed_media_type(p_actual_media_type)) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id
  for update;
  if not found
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
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  if v_source.status = 'rejected' then
    return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_source.id);
    return;
  end if;

  if v_source.status <> 'upload_pending' then
    return query select 'invalid_state'::text, public.sbom_source_json(p_organization_id, v_source.id);
    return;
  end if;

  v_code := case
    when p_actual_sha256 is null or p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
    when p_actual_byte_size is null or p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
    when p_actual_media_type is null or p_actual_media_type <> v_source.declared_media_type then 'media_type_mismatch'
    else 'hash_mismatch'
  end;

  update public.sbom_sources
     set status = 'rejected',
         rejected_at = now(),
         rejection_code = v_code
   where organization_id = p_organization_id and id = v_source.id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id,
    p_actor_user_id,
    'sbom.hash_mismatch',
    'sbom_source',
    v_source.id::text,
    jsonb_build_object('correlationId', p_correlation_id, 'code', v_code)
  );
  return query select 'rejected'::text, public.sbom_source_json(p_organization_id, v_source.id);
end;
$$;

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
    and jobs.status = 'processing'
    and jobs.lease_owner = btrim(p_worker_id)
    and jobs.lease_expires_at > now()
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  if v_job.validation_report is not null then
    if v_job.validation_report = p_report then
      return query select 'recorded'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
      return;
    end if;
    return query select 'invalid_state'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
    return;
  end if;

  update public.sbom_ingest_jobs
     set validation_status = v_status,
         detected_format = p_report ->> 'detectedFormat',
         detected_serialization = p_report ->> 'detectedSerialization',
         detected_spec_version = p_report ->> 'detectedSpecVersion',
         validator_name = p_report #>> '{validator,name}',
         validator_version = p_report #>> '{validator,version}',
         validation_report = p_report,
         validation_completed_at = v_completed_at,
         progress_stage = 'recording_evidence',
         progress_percent = greatest(progress_percent, 90),
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
      'detectedFormat', p_report ->> 'detectedFormat',
      'detectedSerialization', p_report ->> 'detectedSerialization',
      'detectedSpecVersion', p_report ->> 'detectedSpecVersion',
      'validator', jsonb_build_object(
        'name', p_report #>> '{validator,name}',
        'version', p_report #>> '{validator,version}'
      ),
      'diagnosticCounts', jsonb_build_object(
        'error', (p_report #>> '{diagnosticCounts,error}')::integer,
        'warning', (p_report #>> '{diagnosticCounts,warning}')::integer
      ),
      'omittedDiagnosticCount', (p_report ->> 'omittedDiagnosticCount')::integer,
      'correlationId', v_job.correlation_id
    )
  );

  return query select 'recorded'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

create or replace function public.list_sbom_sources_for_release(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_limit integer,
  p_cursor text
) returns table(outcome text, sources jsonb, next_cursor text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if p_limit not between 1 and 100
    or not public.m2_active_member(p_organization_id, p_actor_user_id)
    or not exists (
      select 1 from public.product_releases releases
      where releases.organization_id = p_organization_id
        and releases.product_id = p_product_id
        and releases.id = p_release_id
    ) then
    return query select 'not_found'::text, null::jsonb, null::text;
    return;
  end if;

  if p_cursor is not null then
    begin
      v_cursor_created_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb, null::text;
      return;
    end;
  end if;

  select page.created_at, page.id into v_next_created_at, v_next_id
  from (
    select source_rows.id, source_rows.created_at
    from public.sbom_sources source_rows
    where source_rows.organization_id = p_organization_id
      and source_rows.product_id = p_product_id
      and source_rows.release_id = p_release_id
      and (
        p_cursor is null
        or (source_rows.created_at, source_rows.id) < (v_cursor_created_at, v_cursor_id)
      )
    order by source_rows.created_at desc, source_rows.id desc
    limit p_limit + 1
  ) page
  order by page.created_at desc, page.id desc
  offset p_limit
  limit 1;

  return query
  select
    'found'::text,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'source', public.sbom_source_json(p_organization_id, listed.id),
        'validation', public.sbom_validation_summary_json(p_organization_id, listed.id)
      )
      order by listed.created_at desc, listed.id desc
    ), '[]'::jsonb),
    case when v_next_id is null then null
      else v_next_created_at::text || '|' || v_next_id::text end
  from (
    select source_rows.id, source_rows.created_at
    from public.sbom_sources source_rows
    where source_rows.organization_id = p_organization_id
      and source_rows.product_id = p_product_id
      and source_rows.release_id = p_release_id
      and (
        p_cursor is null
        or (source_rows.created_at, source_rows.id) < (v_cursor_created_at, v_cursor_id)
      )
    order by source_rows.created_at desc, source_rows.id desc
    limit p_limit
  ) listed;
end;
$$;

create or replace function public.get_sbom_validation_report(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid
) returns table(outcome text, source jsonb, report jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;

  if not exists (
    select 1
    from public.sbom_sources source_rows
    where source_rows.organization_id = p_organization_id
      and source_rows.id = p_source_id
  ) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;

  return query select
    'found'::text,
    public.sbom_source_json(p_organization_id, p_source_id),
    public.sbom_validation_report_json(p_organization_id, p_source_id);
end;
$$;

alter function public.sbom_allowed_media_type(text) owner to postgres;
alter function public.prevent_sbom_source_version_metadata_mutation() owner to postgres;
alter function public.sbom_json_has_exact_keys(jsonb, text[]) owner to postgres;
alter function public.sbom_json_has_sensitive_key(jsonb) owner to postgres;
alter function public.valid_sbom_validation_report(jsonb, text) owner to postgres;
alter function public.sbom_source_json(uuid, uuid) owner to postgres;
alter function public.sbom_validation_summary_json(uuid, uuid) owner to postgres;
alter function public.sbom_validation_report_json(uuid, uuid) owner to postgres;
alter function public.reserve_sbom_source_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text, timestamptz, uuid, text, text, uuid) owner to postgres;
alter function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) owner to postgres;
alter function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) owner to postgres;
alter function public.record_sbom_validation_atomic(uuid, uuid, text, jsonb) owner to postgres;
alter function public.list_sbom_sources_for_release(uuid, uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.get_sbom_validation_report(uuid, uuid, uuid) owner to postgres;

revoke all on function
  public.sbom_allowed_media_type(text),
  public.prevent_sbom_source_version_metadata_mutation(),
  public.sbom_json_has_exact_keys(jsonb, text[]),
  public.sbom_json_has_sensitive_key(jsonb),
  public.valid_sbom_validation_report(jsonb, text),
  public.sbom_source_json(uuid, uuid),
  public.sbom_validation_summary_json(uuid, uuid),
  public.sbom_validation_report_json(uuid, uuid),
  public.reserve_sbom_source_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text, timestamptz, uuid, text, text, uuid),
  public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.record_sbom_validation_atomic(uuid, uuid, text, jsonb),
  public.list_sbom_sources_for_release(uuid, uuid, uuid, uuid, integer, text),
  public.get_sbom_validation_report(uuid, uuid, uuid)
from public, anon, authenticated;

revoke all on function
  public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid),
  public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid)
from service_role;

grant execute on function
  public.reserve_sbom_source_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text, timestamptz, uuid, text, text, uuid),
  public.record_sbom_validation_atomic(uuid, uuid, text, jsonb),
  public.list_sbom_sources_for_release(uuid, uuid, uuid, uuid, integer, text),
  public.get_sbom_validation_report(uuid, uuid, uuid)
to service_role;
