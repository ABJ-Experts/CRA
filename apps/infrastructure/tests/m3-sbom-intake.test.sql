-- M3 SBOM intake foundation integration tests. Every fixture rolls back.
\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M3 creates exactly the four durable SBOM tables and one private evidence bucket',
  (select not public and file_size_limit = 104857600 from storage.buckets where id = 'sbom-originals')
  and to_regclass('public.sbom_raw_objects') is not null
  and to_regclass('public.sbom_sources') is not null
  and to_regclass('public.sbom_ingest_jobs') is not null
  and to_regclass('public.sbom_ci_credentials') is not null
  and (select count(*) = 4 from pg_class tables
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and tables.relkind = 'r'
      and tables.relname like 'sbom_%')
);

select pg_temp.check(
  'SBOM tables are RLS protected and private to service role',
  not exists (
    select 1 from (values
      ('sbom_raw_objects'), ('sbom_sources'), ('sbom_ingest_jobs'), ('sbom_ci_credentials')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and (
      not tables.relrowsecurity or tables.relforcerowsecurity
      or has_table_privilege('public', tables.oid, 'select')
      or has_table_privilege('anon', tables.oid, 'select')
      or has_table_privilege('authenticated', tables.oid, 'select')
    )
  )
  and has_table_privilege('service_role', 'public.sbom_sources', 'select')
  and has_table_privilege('service_role', 'public.sbom_ingest_jobs', 'update')
);

select pg_temp.check(
  'browser roles cannot call security-definer SBOM coordination RPCs',
  not has_function_privilege('authenticated',
    'public.reserve_sbom_source_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,bigint,text,text,timestamptz,uuid)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.finalize_sbom_source_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.claim_sbom_ingest_job(uuid,text,integer)', 'execute')
  and not has_function_privilege('authenticated',
    'public.get_sbom_source_for_completion(uuid,uuid,uuid,uuid,uuid)', 'execute')
);

select pg_temp.check(
  'SBOM evidence media types and CI token identifiers align with the shared contracts',
  (select array_position(allowed_mime_types, 'application/spdx+xml') is not null
    and array_position(allowed_mime_types, 'text/plain') is not null
    from storage.buckets where id = 'sbom-originals')
  and exists (select 1 from pg_constraint where conrelid = 'public.sbom_ci_credentials'::regclass
    and conname = 'sbom_ci_credentials_token_prefix_check'
    and pg_get_constraintdef(oid) like '%cra_sbom_%')
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_hash text := repeat('a', 64);
  v_reservation record;
  v_completion record;
  v_replay record;
  v_completion_source record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release
    from public.products p join public.product_releases r
      on r.organization_id = p.organization_id and r.product_id = p.id
   where p.organization_id = v_org
   order by r.created_at
   limit 1;
  if v_release is null then
    raise exception 'seeded org needs a release for SBOM tests';
  end if;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('reserve-1', 'sha256'), 'hex'), 'bom.json', 'application/json',
    15, v_hash, v_org::text || '/' || v_source::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_reservation.outcome <> 'created' or (v_reservation.source ->> 'id')::uuid <> v_source then
    raise exception 'valid SBOM reservation failed: %', v_reservation.outcome;
  end if;
  if not exists (select 1 from public.audit_logs where organization_id = v_org
    and action = 'sbom.upload_initiated' and entity_id = v_source::text) then
    raise exception 'reservation audit fact was not transactionally persisted';
  end if;
  select * into v_completion_source from public.get_sbom_source_for_completion(
    v_org, v_source, v_actor, null, v_key
  );
  if v_completion_source.outcome <> 'ready'
    or v_completion_source.storage_bucket <> 'sbom-originals'
    or v_completion_source.storage_key <> v_org::text || '/' || v_source::text || '/' || v_hash then
    raise exception 'completion lookup did not return only the actor-bound pending source';
  end if;

  select * into v_replay from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('reserve-1', 'sha256'), 'hex'), 'bom.json', 'application/json',
    15, v_hash, v_org::text || '/' || v_source::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_replay.outcome <> 'replayed' or (v_replay.source ->> 'id')::uuid <> v_source then
    raise exception 'same idempotency request did not replay reservation';
  end if;

  select * into v_completion from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 15, 'application/json', v_key, gen_random_uuid()
  );
  if v_completion.outcome <> 'queued'
     or v_completion.job is null
     or (v_completion.job ->> 'status') <> 'queued' then
    raise exception 'verified completion did not create a queued durable job: %', v_completion.outcome;
  end if;
  if (select count(*) from public.sbom_raw_objects where organization_id = v_org and sha256 = v_hash) <> 1
     or (select count(*) from public.sbom_ingest_jobs where organization_id = v_org and source_id = v_source) <> 1 then
    raise exception 'completion did not link immutable evidence and exactly one job';
  end if;
  if not ((v_completion.source ?& array[
      'id', 'organizationId', 'productId', 'releaseId', 'source', 'fileName', 'mediaType',
      'byteSize', 'sha256', 'status', 'createdAt', 'completedAt'
    ]) and not (v_completion.source ? 'stagingStorageKey'))
    or not ((v_completion.job ?& array[
      'id', 'organizationId', 'sourceId', 'releaseId', 'inputSha256', 'correlationId',
      'status', 'progress', 'attempts', 'maxAttempts', 'error', 'result', 'createdAt', 'updatedAt', 'completedAt'
    ]) and v_completion.job->'progress' ? 'message') then
    raise exception 'database JSON crossed a private or incompatible contract boundary';
  end if;

  select * into v_replay from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 15, 'application/json', v_key, gen_random_uuid()
  );
  if v_replay.outcome <> 'replayed' or (v_replay.job ->> 'id') <> (v_completion.job ->> 'id') then
    raise exception 'duplicate completion created or returned a different job';
  end if;
  begin
    update public.sbom_raw_objects set storage_key = 'tampered'
      where organization_id = v_org and sha256 = v_hash;
    raise exception 'immutable raw object update unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_rejected_source uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_reject_key uuid := gen_random_uuid();
  v_hash text := repeat('7', 64);
  v_reject_hash text := repeat('8', 64);
  v_reservation record;
  v_completion record;
  v_claim record;
  v_rejected record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release
    from public.products p join public.product_releases r
      on r.organization_id = p.organization_id and r.product_id = p.id
   where p.organization_id = v_org
   order by r.created_at
   limit 1;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('spdx-tag-value-reservation', 'sha256'), 'hex'),
    'release.spdx', 'text/plain', 64, v_hash,
    v_org::text || '/' || v_source::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'spdx', '2.3', null
  );
  if v_reservation.outcome <> 'created' then
    raise exception 'text/plain SPDX tag-value reservation failed: %', v_reservation.outcome;
  end if;

  select * into v_completion from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 64, 'text/plain', v_key, gen_random_uuid()
  );
  if v_completion.outcome <> 'queued'
     or (v_completion.source ->> 'mediaType') <> 'text/plain'
     or (v_completion.job ->> 'status') <> 'queued' then
    raise exception 'text/plain SPDX tag-value completion did not queue a job: %', v_completion.outcome;
  end if;

  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'sql-tag-value-worker', 60);
  if v_claim.outcome <> 'claimed'
    or (v_claim.work ->> 'sourceId')::uuid <> v_source then
    raise exception 'text/plain SPDX tag-value queued job was not claimable';
  end if;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_rejected_source, 'manual_upload', v_reject_key,
    encode(extensions.digest('spdx-tag-value-reject', 'sha256'), 'hex'),
    'reject.spdx', 'text/plain', 64, v_reject_hash,
    v_org::text || '/' || v_rejected_source::text || '/' || v_reject_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'spdx', '2.3', null
  );
  if v_reservation.outcome <> 'created' then
    raise exception 'text/plain reject fixture reservation failed: %', v_reservation.outcome;
  end if;

  select * into v_rejected from public.reject_sbom_source_integrity_atomic(
    v_org, v_rejected_source, v_actor, null, repeat('9', 64), 64, 'text/plain',
    v_reject_key, gen_random_uuid()
  );
  if v_rejected.outcome <> 'rejected' then
    raise exception 'text/plain integrity rejection did not preserve compatible completion semantics: %',
      v_rejected.outcome;
  end if;
end $$;
rollback;

select pg_temp.check(
  'M3 validation adds no normalized SBOM component, finding, or report tables',
  not exists (
    select 1
    from pg_class tables
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public'
      and tables.relkind = 'r'
      and (
        tables.relname in ('sbom_validation_reports', 'sbom_components', 'sbom_findings')
        or tables.relname like 'sbom_%component%'
        or tables.relname like 'sbom_%finding%'
        or tables.relname like 'sbom_%report%'
      )
  )
);

select pg_temp.check(
  'browser roles cannot call SBOM validation persistence and report RPCs',
  not has_function_privilege('authenticated',
    'public.record_sbom_validation_atomic(uuid,uuid,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.list_sbom_sources_for_release(uuid,uuid,uuid,uuid,integer,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.get_sbom_validation_report(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.record_sbom_validation_atomic(uuid,uuid,text,jsonb)', 'execute')
  and has_function_privilege('service_role',
    'public.list_sbom_sources_for_release(uuid,uuid,uuid,uuid,integer,text)', 'execute')
  and has_function_privilege('service_role',
    'public.get_sbom_validation_report(uuid,uuid,uuid)', 'execute')
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_original_source uuid := gen_random_uuid();
  v_corrected_source uuid := gen_random_uuid();
  v_missing_link_source uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_hash text := repeat('d', 64);
  v_report jsonb;
  v_reservation record;
  v_completion record;
  v_claim record;
  v_recorded record;
  v_report_result record;
  v_list_result record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release
    from public.products p join public.product_releases r
      on r.organization_id = p.organization_id and r.product_id = p.id
   where p.organization_id = v_org
   order by r.created_at
   limit 1;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_original_source, 'manual_upload', v_key,
    encode(extensions.digest('validation-original', 'sha256'), 'hex'), 'invalid.spdx.json',
    'application/json', 27, v_hash, v_org::text || '/' || v_original_source::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'spdx', '2.3', null
  );
  if v_reservation.outcome <> 'created'
    or (v_reservation.source ->> 'declaredFormat') <> 'spdx'
    or (v_reservation.source ->> 'declaredSpecVersion') <> '2.3'
    or v_reservation.source ? 'storageKey' then
    raise exception 'declared metadata crossed the source boundary incorrectly: %', v_reservation.source;
  end if;

  select * into v_completion from public.finalize_sbom_source_atomic(
    v_org, v_original_source, v_actor, null, v_hash, 27, 'application/json', v_key, gen_random_uuid()
  );
  if v_completion.outcome <> 'queued' then
    raise exception 'validation fixture completion did not queue a job: %', v_completion.outcome;
  end if;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_corrected_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('validation-corrected', 'sha256'), 'hex'), 'corrected.spdx.json',
    'application/json', 27, repeat('e', 64),
    v_org::text || '/' || v_corrected_source::text || '/' || repeat('e', 64),
    now() + interval '10 minutes', gen_random_uuid(), 'spdx', '2.3', v_original_source
  );
  if v_reservation.outcome <> 'created'
    or (v_reservation.source ->> 'supersedesSourceId')::uuid <> v_original_source then
    raise exception 'same-release corrected source did not link to its immutable predecessor';
  end if;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_missing_link_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('validation-missing-link', 'sha256'), 'hex'), 'missing-link.spdx.json',
    'application/json', 27, repeat('f', 64),
    v_org::text || '/' || v_missing_link_source::text || '/' || repeat('f', 64),
    now() + interval '10 minutes', gen_random_uuid(), 'spdx', '2.3', gen_random_uuid()
  );
  if v_reservation.outcome <> 'not_found' then
    raise exception 'missing or foreign superseded source was disclosed: %', v_reservation.outcome;
  end if;

  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'sql-validator', 60);
  if v_claim.outcome <> 'claimed'
    or (v_claim.work ->> 'sourceId')::uuid <> v_original_source then
    raise exception 'validation job was not claimable';
  end if;

  v_report := jsonb_build_object(
    'status', 'invalid',
    'detected', jsonb_build_object(
      'format', 'spdx',
      'serialization', 'json',
      'specificationVersion', '2.3'
    ),
    'validator', jsonb_build_object(
      'name', 'CRA deterministic SBOM validator',
      'version', 'm3-test',
      'schemaAssetSha256', repeat('a', 64)
    ),
    'diagnostics', jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'missing_required_field',
      'location', '$',
      'message', 'The SBOM is missing a required field.',
      'remediation', 'Add the required SPDX field.'
    )),
    'errorCount', 1,
    'warningCount', 0,
    'omittedDiagnosticCount', 0,
    'completedAt', '2026-08-21T00:00:00.000Z'
  );

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    v_report || jsonb_build_object('storageKey', 'private/raw/key')
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted unexpected top-level private field: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(
      v_report,
      '{validator}',
      (v_report -> 'validator') || jsonb_build_object('token', 'secret-token-value'),
      false
    )
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted unexpected validator private field: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(
      v_report,
      '{diagnostics,0}',
      (v_report -> 'diagnostics' -> 0) || jsonb_build_object('credentialId', gen_random_uuid()),
      false
    )
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted unexpected diagnostic private field: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(
      v_report,
      '{errorCount}',
      to_jsonb('one'::text),
      false
    )
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted malformed errorCount field: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(v_report, '{detected,specificationVersion}', to_jsonb(23), false)
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted numeric detectedSpecVersion scalar: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(v_report, '{validator,name}', to_jsonb(123), false)
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted numeric validator name scalar: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(v_report, '{diagnostics,0,code}', to_jsonb(true), false)
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted boolean diagnostic code scalar: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(v_report, '{warningCount}', to_jsonb(false), false)
  );
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted boolean diagnostic count scalar: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator',
    jsonb_set(v_report, '{validator,name}', to_jsonb('secret-token-value'::text), false)
  );
  if v_recorded.outcome = 'recorded'
    and exists (
      select 1 from public.audit_logs
      where organization_id = v_org
        and action = 'sbom.validation_recorded'
        and entity_id = v_completion.job ->> 'id'
        and changes::text ~* 'secret-token-value'
    ) then
    raise exception 'validation report accepted and audited sensitive validator string';
  end if;
  if v_recorded.outcome <> 'invalid_request' then
    raise exception 'validation report accepted sensitive validator string: %',
      v_recorded.outcome;
  end if;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator', v_report
  );
  if v_recorded.outcome <> 'completed'
    or v_recorded.job -> 'result' ->> 'outcome' <> 'original_evidence_captured' then
    raise exception 'validation report and legacy evidence completion were not atomic';
  end if;

  begin
    update public.sbom_ingest_jobs
       set validation_status = 'valid', validation_report = null
     where organization_id = v_org and id = (v_completion.job ->> 'id')::uuid;
    raise exception 'terminal validation status accepted a missing report';
  exception when check_violation then
    null;
  end;

  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'sql-validator', v_report
  );
  if v_recorded.outcome <> 'completed'
    or v_recorded.job ->> 'completedAt' is null
    or v_recorded.job -> 'result' ->> 'outcome' <> 'original_evidence_captured' then
    raise exception 'same terminal validation report was not idempotently completed';
  end if;

  -- Simulate the former report-then-complete crash window.  A reclaimed worker
  -- must finish legacy evidence using the already-immutable report, not stamp a
  -- fresh validation completion or produce a second audit fact.
  update public.sbom_ingest_jobs
     set status = 'processing', progress_stage = 'recording_evidence', progress_percent = 90,
         lease_owner = 'reclaimed-validator', lease_expires_at = now() + interval '60 seconds',
         completed_at = null
   where organization_id = v_org and id = (v_completion.job ->> 'id')::uuid;
  select * into v_recorded from public.record_sbom_validation_atomic(
    v_org, (v_completion.job ->> 'id')::uuid, 'reclaimed-validator',
    jsonb_set(v_report, '{completedAt}', to_jsonb('2027-01-01T00:00:00.000Z'::text))
  );
  if v_recorded.outcome <> 'completed'
    or exists (
      select 1 from public.sbom_ingest_jobs
      where organization_id = v_org and id = (v_completion.job ->> 'id')::uuid
        and validation_report ->> 'completedAt' <> v_report ->> 'completedAt'
    )
    or (select count(*) from public.audit_logs
        where organization_id = v_org and action = 'sbom.validation_recorded'
          and entity_id = v_completion.job ->> 'id') <> 1 then
    raise exception 'reclaimed report-only job did not preserve its immutable report and single audit fact';
  end if;
  if not exists (
    select 1 from public.sbom_ingest_jobs
    where organization_id = v_org
      and id = (v_completion.job ->> 'id')::uuid
      and status = 'completed'
      and validation_status = 'invalid'
      and validation_report ->> 'status' = 'invalid'
      and validation_completed_at is not null
  ) then
    raise exception 'invalid terminal validation report did not coexist with completed legacy job';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where organization_id = v_org
      and action = 'sbom.validation_recorded'
      and entity_id = v_completion.job ->> 'id'
      and changes ->> 'status' = 'invalid'
      and changes ? 'diagnosticCounts'
      and changes::text !~* 'storage|signed|credential|token|secret|rawBytes|raw_bytes'
  ) then
    raise exception 'validation audit fact was absent or included private material';
  end if;

  select * into v_report_result from public.get_sbom_validation_report(
    v_org, v_actor, v_original_source
  );
  if v_report_result.outcome <> 'found'
    or v_report_result.report ->> 'status' <> 'invalid'
    or v_report_result.report::text ~* 'storage|signed|credential|token|secret|rawBytes|raw_bytes'
    or v_report_result.source::text ~* 'storage|signed|credential|token|secret|rawBytes|raw_bytes' then
    raise exception 'validation report RPC leaked private material or missed the report';
  end if;

  select * into v_list_result from public.list_sbom_sources_for_release(
    v_org, v_actor, v_product, v_release, 25, null
  );
  if v_list_result.outcome <> 'found'
    or jsonb_array_length(v_list_result.sources) < 2
    or v_list_result.sources::text !~ 'invalid'
    or v_list_result.sources::text ~* 'storage|signed|credential|token|secret|rawBytes|raw_bytes' then
    raise exception 'source list RPC did not return redacted validation summaries';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_product uuid; v_release uuid; v_source uuid := gen_random_uuid();
  v_job record; v_replay record; v_audit_count integer;
  v_key uuid := gen_random_uuid(); v_hash text := repeat('c', 64);
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('replay-keyed', 'sha256'), 'hex'), 'replay.json', 'application/json', 10,
    v_hash, v_org::text || '/' || v_source::text || '/' || v_hash, now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 10, 'application/json', gen_random_uuid()
  );
  update public.sbom_ingest_jobs set status = 'dead_letter', progress_stage = 'dead_letter',
    error_code = 'unknown_failure', dead_lettered_at = now()
    where organization_id = v_org and id = (v_job.job ->> 'id')::uuid;
  select count(*) into v_audit_count from public.audit_logs where organization_id = v_org
    and action = 'sbom.job_replayed' and entity_id = v_job.job ->> 'id';
  select * into v_replay from public.replay_sbom_ingest_job_atomic(
    v_org, v_actor, (v_job.job ->> 'id')::uuid, v_key, gen_random_uuid()
  );
  if v_replay.outcome <> 'queued' then raise exception 'dead-letter replay failed: %', v_replay.outcome; end if;
  select * into v_replay from public.replay_sbom_ingest_job_atomic(
    v_org, v_actor, (v_job.job ->> 'id')::uuid, v_key, gen_random_uuid()
  );
  if v_replay.outcome <> 'replayed'
    or (select count(*) from public.audit_logs where organization_id = v_org
      and action = 'sbom.job_replayed' and entity_id = v_job.job ->> 'id') <> v_audit_count + 1 then
    raise exception 'same replay idempotency key did not return exactly one durable replay';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_foreign_org uuid := gen_random_uuid();
  v_foreign_source uuid := gen_random_uuid();
  v_result record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  select * into v_result from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('zero', 'sha256'), 'hex'), 'empty.json', 'application/json', 0,
    repeat('0', 64), v_org::text || '/' || v_source::text || '/' || repeat('0', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_result.outcome <> 'invalid_request'
     or exists(select 1 from public.sbom_sources where organization_id = v_org and id = v_source) then
    raise exception 'zero byte input was not rejected before source creation';
  end if;

  select * into v_result from public.reserve_sbom_source_atomic(
    v_foreign_org, v_product, v_release, v_actor, null, v_foreign_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('foreign', 'sha256'), 'hex'), 'bom.json', 'application/json', 1,
    repeat('1', 64), v_foreign_org::text || '/' || v_foreign_source::text || '/' || repeat('1', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_result.outcome <> 'not_found' then
    raise exception 'cross-tenant release identifier was disclosed';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_job record;
  v_claim record;
  v_failed record;
  v_replayed record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('worker', 'sha256'), 'hex'), 'worker.json', 'application/json', 10,
    repeat('b', 64), v_org::text || '/' || v_source::text || '/' || repeat('b', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, repeat('b', 64), 10, 'application/json', v_key, gen_random_uuid()
  );
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'sql-worker', 60);
  if v_claim.outcome <> 'claimed' or (v_claim.job ->> 'status') <> 'processing' then
    raise exception 'queued job was not atomically claimed';
  end if;
  select * into v_failed from public.fail_sbom_ingest_job(
    v_org, (v_job.job ->> 'id')::uuid, 'sql-worker', 'provider_unavailable'
  );
  if v_failed.outcome <> 'retrying' or (v_failed.job ->> 'status') <> 'failed' then
    raise exception 'failure was not durably recorded for bounded retry';
  end if;
  update public.sbom_ingest_jobs set next_attempt_at = now() - interval '1 second'
    where organization_id = v_org and id = (v_job.job ->> 'id')::uuid;
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'sql-worker-2', 60);
  perform * from public.complete_sbom_ingest_job(
    v_org, (v_job.job ->> 'id')::uuid, 'sql-worker-2'
  );
  select * into v_replayed from public.replay_sbom_ingest_job_atomic(
    v_org, v_actor, (v_job.job ->> 'id')::uuid, gen_random_uuid()
  );
  if v_replayed.outcome <> 'invalid_state' then
    raise exception 'completed job accepted an unsafe operator replay';
  end if;
end $$;
rollback;
