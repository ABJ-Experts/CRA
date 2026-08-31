-- Align M3 SBOM report persistence with the shared runtime contract.  The
-- report remains immutable evidence; this migration only reshapes report
-- metadata that was already durably stored on ingest jobs.

alter table public.sbom_ingest_jobs
  add column if not exists validator_schema_asset_sha256 text;

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
  v_validator jsonb;
  v_detected jsonb;
  v_diagnostic jsonb;
  v_error_count integer;
  v_warning_count integer;
begin
  if p_status not in ('valid', 'valid_with_warnings', 'invalid')
    or p_report is null
    or jsonb_typeof(p_report) <> 'object'
    or octet_length(p_report::text) > 524288
    or public.sbom_json_has_sensitive_key(p_report)
    or not public.sbom_json_has_exact_keys(p_report, array[
      'completedAt', 'detected', 'diagnostics', 'errorCount',
      'omittedDiagnosticCount', 'status', 'validator', 'warningCount'
    ])
    or p_report ->> 'status' is distinct from p_status
    or jsonb_typeof(p_report -> 'status') <> 'string'
    or jsonb_typeof(p_report -> 'completedAt') <> 'string'
    or jsonb_typeof(p_report -> 'detected') not in ('object', 'null')
    or jsonb_typeof(p_report -> 'validator') <> 'object'
    or jsonb_typeof(p_report -> 'diagnostics') <> 'array'
    or jsonb_typeof(p_report -> 'errorCount') <> 'number'
    or jsonb_typeof(p_report -> 'warningCount') <> 'number'
    or jsonb_typeof(p_report -> 'omittedDiagnosticCount') <> 'number'
    or coalesce(p_report ->> 'completedAt', '') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$'
    or coalesce(p_report ->> 'errorCount', '') !~ '^[0-9]+$'
    or coalesce(p_report ->> 'warningCount', '') !~ '^[0-9]+$'
    or coalesce(p_report ->> 'omittedDiagnosticCount', '') !~ '^[0-9]+$'
    or jsonb_array_length(p_report -> 'diagnostics') > 100 then
    return false;
  end if;

  v_error_count := (p_report ->> 'errorCount')::integer;
  v_warning_count := (p_report ->> 'warningCount')::integer;
  if (p_status = 'invalid' and v_error_count = 0)
    or (p_status = 'valid_with_warnings' and (v_error_count <> 0 or v_warning_count = 0))
    or (p_status = 'valid' and (v_error_count <> 0 or v_warning_count <> 0)) then
    return false;
  end if;

  v_detected := p_report -> 'detected';
  if v_detected <> 'null'::jsonb and (
    not public.sbom_json_has_exact_keys(v_detected, array['format', 'serialization', 'specificationVersion'])
    or jsonb_typeof(v_detected -> 'format') <> 'string'
    or jsonb_typeof(v_detected -> 'serialization') <> 'string'
    or jsonb_typeof(v_detected -> 'specificationVersion') <> 'string'
    or v_detected ->> 'format' not in ('cyclonedx', 'spdx')
    or v_detected ->> 'serialization' not in ('json', 'xml', 'tag_value')
    or char_length(btrim(coalesce(v_detected ->> 'specificationVersion', ''))) not between 1 and 40
    or v_detected ->> 'specificationVersion' <> btrim(v_detected ->> 'specificationVersion')
    or v_detected ->> 'specificationVersion' ~ '[[:cntrl:] ]'
  ) then
    return false;
  end if;

  v_validator := p_report -> 'validator';
  if not public.sbom_json_has_exact_keys(v_validator, array['name', 'schemaAssetSha256', 'version'])
    or jsonb_typeof(v_validator -> 'name') <> 'string'
    or jsonb_typeof(v_validator -> 'version') <> 'string'
    or jsonb_typeof(v_validator -> 'schemaAssetSha256') <> 'string'
    or char_length(btrim(coalesce(v_validator ->> 'name', ''))) not between 1 and 120
    or char_length(btrim(coalesce(v_validator ->> 'version', ''))) not between 1 and 80
    or v_validator ->> 'name' <> btrim(v_validator ->> 'name')
    or v_validator ->> 'version' <> btrim(v_validator ->> 'version')
    or v_validator ->> 'name' ~ '[[:cntrl:]]'
    or v_validator ->> 'version' ~ '[[:cntrl:]]'
    or coalesce(v_validator ->> 'schemaAssetSha256', '') !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  v_diagnostics := p_report -> 'diagnostics';
  for v_diagnostic in select value from jsonb_array_elements(v_diagnostics) loop
    if not public.sbom_json_has_exact_keys(v_diagnostic, array['code', 'location', 'message', 'remediation', 'severity'])
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

update public.sbom_ingest_jobs
set validation_report = jsonb_build_object(
      'status', validation_report ->> 'status',
      'detected', case when validation_report ->> 'detectedFormat' is null then null
        else jsonb_build_object(
          'format', validation_report ->> 'detectedFormat',
          'serialization', validation_report ->> 'detectedSerialization',
          'specificationVersion', validation_report ->> 'detectedSpecVersion'
        ) end,
      'validator', (validation_report -> 'validator') || jsonb_build_object(
        'schemaAssetSha256', case
          when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSerialization' = 'xml' and validation_report ->> 'detectedSpecVersion' = '1.4' then 'd2c58c5964fd4c9ccdd59f08fd102bb7ee8f7ea956c99b7834d8d45ca2fba938'
          when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSerialization' = 'xml' and validation_report ->> 'detectedSpecVersion' = '1.5' then 'ef27af4cbc6dc7dd7e7211b77d9768394be8f54514cc99e9b13b07c305502eb8'
          when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSerialization' = 'xml' and validation_report ->> 'detectedSpecVersion' = '1.6' then 'cec528b86a638c8aebb0c326648d40d6f24813e61db4204f47cb82ac93d856a9'
          when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSpecVersion' = '1.4' then '51b79463558376e6397802cce4fd792037a941cda89f9a7cc0abd1b5cbeb67b7'
          when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSpecVersion' = '1.5' then '067f7824b08653839ea050ae9e09ca48375eadc2652b0e2a299476e7db90335b'
          when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSpecVersion' = '1.6' then '3e92dddbc30cf7f6a02b80f0942b1a4cfd4fb1c26f1dfc4310afa9d613cafb93'
          when validation_report ->> 'detectedFormat' = 'spdx' and validation_report ->> 'detectedSerialization' = 'json' and validation_report ->> 'detectedSpecVersion' = '2.2' then 'c8328d14c33621a6be917569ad4c323d370220412edbaddc37ccf1e93e3ca88a'
          when validation_report ->> 'detectedFormat' = 'spdx' and validation_report ->> 'detectedSerialization' = 'json' and validation_report ->> 'detectedSpecVersion' = '2.3' then '239208b7ac287b3cf5d9a9af23f9d69863971102a5e1587a27a398b43490b89b'
          when validation_report ->> 'detectedFormat' = 'spdx' and validation_report ->> 'detectedSerialization' = 'json' and validation_report ->> 'detectedSpecVersion' = '3.0' then 'c72b0928f094c83e5c127784edb1ebca2af74a104fcacc007c332b23cbc788bd'
          else 'f382bf7c3cbb961733e571fbbd397e6fadb9729739cc6bbdc45710a277c9ffd5'
        end),
      'diagnostics', validation_report -> 'diagnostics',
      'errorCount', (validation_report #>> '{diagnosticCounts,error}')::integer,
      'warningCount', (validation_report #>> '{diagnosticCounts,warning}')::integer,
      'omittedDiagnosticCount', (validation_report ->> 'omittedDiagnosticCount')::integer,
      'completedAt', validation_report ->> 'completedAt'
    ),
    detected_format = validation_report ->> 'detectedFormat',
    detected_serialization = validation_report ->> 'detectedSerialization',
    detected_spec_version = validation_report ->> 'detectedSpecVersion',
    validator_schema_asset_sha256 = case
      when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSerialization' = 'xml' and validation_report ->> 'detectedSpecVersion' = '1.4' then 'd2c58c5964fd4c9ccdd59f08fd102bb7ee8f7ea956c99b7834d8d45ca2fba938'
      when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSerialization' = 'xml' and validation_report ->> 'detectedSpecVersion' = '1.5' then 'ef27af4cbc6dc7dd7e7211b77d9768394be8f54514cc99e9b13b07c305502eb8'
      when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSerialization' = 'xml' and validation_report ->> 'detectedSpecVersion' = '1.6' then 'cec528b86a638c8aebb0c326648d40d6f24813e61db4204f47cb82ac93d856a9'
      when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSpecVersion' = '1.4' then '51b79463558376e6397802cce4fd792037a941cda89f9a7cc0abd1b5cbeb67b7'
      when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSpecVersion' = '1.5' then '067f7824b08653839ea050ae9e09ca48375eadc2652b0e2a299476e7db90335b'
      when validation_report ->> 'detectedFormat' = 'cyclonedx' and validation_report ->> 'detectedSpecVersion' = '1.6' then '3e92dddbc30cf7f6a02b80f0942b1a4cfd4fb1c26f1dfc4310afa9d613cafb93'
      when validation_report ->> 'detectedFormat' = 'spdx' and validation_report ->> 'detectedSerialization' = 'json' and validation_report ->> 'detectedSpecVersion' = '2.2' then 'c8328d14c33621a6be917569ad4c323d370220412edbaddc37ccf1e93e3ca88a'
      when validation_report ->> 'detectedFormat' = 'spdx' and validation_report ->> 'detectedSerialization' = 'json' and validation_report ->> 'detectedSpecVersion' = '2.3' then '239208b7ac287b3cf5d9a9af23f9d69863971102a5e1587a27a398b43490b89b'
      when validation_report ->> 'detectedFormat' = 'spdx' and validation_report ->> 'detectedSerialization' = 'json' and validation_report ->> 'detectedSpecVersion' = '3.0' then 'c72b0928f094c83e5c127784edb1ebca2af74a104fcacc007c332b23cbc788bd'
      else 'f382bf7c3cbb961733e571fbbd397e6fadb9729739cc6bbdc45710a277c9ffd5'
    end
where validation_report ? 'detectedFormat';

alter table public.sbom_ingest_jobs
  drop constraint if exists sbom_ingest_jobs_validator_schema_asset_sha256_check,
  add constraint sbom_ingest_jobs_validator_schema_asset_sha256_check
    check (
      validation_status = 'pending'
      or validator_schema_asset_sha256 ~ '^[a-f0-9]{64}$'
    );

create or replace function public.sbom_validation_summary_json(
  p_organization_id uuid,
  p_source_id uuid
) returns jsonb
language sql stable set search_path = public, pg_temp
as $$
  select coalesce((select jsonb_build_object(
    'status', jobs.validation_status,
    'errorCount', coalesce((jobs.validation_report ->> 'errorCount')::integer, 0),
    'warningCount', coalesce((jobs.validation_report ->> 'warningCount')::integer, 0),
    'omittedDiagnosticCount', coalesce((jobs.validation_report ->> 'omittedDiagnosticCount')::integer, 0),
    'completedAt', jobs.validation_completed_at
  ) from public.sbom_ingest_jobs jobs where jobs.organization_id = p_organization_id and jobs.source_id = p_source_id),
  jsonb_build_object('status', 'pending', 'errorCount', 0, 'warningCount', 0, 'omittedDiagnosticCount', 0, 'completedAt', null));
$$;

create or replace function public.sbom_validation_report_json(
  p_organization_id uuid,
  p_source_id uuid
) returns jsonb
language sql stable set search_path = public, pg_temp
as $$
  select coalesce((select jobs.validation_report from public.sbom_ingest_jobs jobs where jobs.organization_id = p_organization_id and jobs.source_id = p_source_id and jobs.validation_report is not null),
    jsonb_build_object('status', 'pending', 'detected', null, 'validator', null, 'diagnostics', '[]'::jsonb, 'errorCount', 0, 'warningCount', 0, 'omittedDiagnosticCount', 0, 'completedAt', null));
$$;

create or replace function public.record_sbom_validation_atomic(
  p_organization_id uuid, p_job_id uuid, p_worker_id text, p_report jsonb
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job public.sbom_ingest_jobs%rowtype; v_status text; v_completed_at timestamptz;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_report is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_status := p_report ->> 'status';
  if not public.valid_sbom_validation_report(p_report, v_status) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_completed_at := (p_report ->> 'completedAt')::timestamptz;
  select * into v_job from public.sbom_ingest_jobs jobs
   where jobs.organization_id = p_organization_id and jobs.id = p_job_id and jobs.status = 'processing'
     and jobs.lease_owner = btrim(p_worker_id) and jobs.lease_expires_at > now() for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_job.validation_report is not null then
    if v_job.validation_report = p_report then return query select 'recorded'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id); return; end if;
    return query select 'invalid_state'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id); return;
  end if;
  update public.sbom_ingest_jobs set
    validation_status = v_status,
    detected_format = p_report #>> '{detected,format}',
    detected_serialization = p_report #>> '{detected,serialization}',
    detected_spec_version = p_report #>> '{detected,specificationVersion}',
    validator_name = p_report #>> '{validator,name}',
    validator_version = p_report #>> '{validator,version}',
    validator_schema_asset_sha256 = p_report #>> '{validator,schemaAssetSha256}',
    validation_report = p_report, validation_completed_at = v_completed_at,
    progress_stage = 'recording_evidence', progress_percent = greatest(progress_percent, 90), updated_at = now()
  where organization_id = p_organization_id and id = p_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes) values (
    p_organization_id, v_job.actor_user_id, 'sbom.validation_recorded', 'sbom_ingest_job', p_job_id::text,
    jsonb_build_object('sourceId', v_job.source_id, 'status', v_status, 'detected', p_report -> 'detected',
      'validator', p_report -> 'validator', 'errorCount', (p_report ->> 'errorCount')::integer,
      'warningCount', (p_report ->> 'warningCount')::integer,
      'omittedDiagnosticCount', (p_report ->> 'omittedDiagnosticCount')::integer,
      'correlationId', v_job.correlation_id));
  return query select 'recorded'::text, public.sbom_ingest_job_json(p_organization_id, p_job_id);
end;
$$;

alter function public.valid_sbom_validation_report(jsonb, text) owner to postgres;
alter function public.sbom_validation_summary_json(uuid, uuid) owner to postgres;
alter function public.sbom_validation_report_json(uuid, uuid) owner to postgres;
alter function public.record_sbom_validation_atomic(uuid, uuid, text, jsonb) owner to postgres;
