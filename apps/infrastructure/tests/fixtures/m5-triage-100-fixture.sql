-- Local-only, explicitly test-owned M5 fixture. It creates exactly one
-- normalized component occurrence and 100 findings for the seeded owner.
-- The M4 mirror source version is intentionally retained after cleanup: M4
-- source-version evidence is immutable by database design.
do $$
declare
  v_marker constant text := 'M5-E2E-LOCAL-20260907';
  v_hash constant text := repeat('a', 64);
  v_version_hash constant text := repeat('b', 64);
  v_organization_id uuid;
  v_user_id uuid;
  v_product_id uuid;
  v_release_id uuid;
  v_raw_object_id uuid;
  v_source_id uuid;
  v_job_id uuid;
  v_document_id uuid;
  v_component_id uuid;
  v_occurrence_id uuid;
  v_vulnerability_id uuid;
  v_feed_run_id uuid;
  v_source_record_id uuid;
  v_source_record_version_id uuid;
  v_affected_range_id uuid;
begin
  select members.organization_id, users.id, releases.product_id, releases.id
  into v_organization_id, v_user_id, v_product_id, v_release_id
  from public.users users
  join public.organization_members members
    on members.user_id = users.id and members.role = 'owner'
  join public.product_releases releases
    on releases.organization_id = members.organization_id
  where lower(users.email) = 'owner@cra.test'
  order by releases.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'The local seeded owner product/release fixture is unavailable';
  end if;

  -- Remove only a prior run's tenant-local facts before recreating this exact
  -- fixture. Immutable mirror evidence is not deleted.
  delete from public.vulnerability_findings
  where organization_id = v_organization_id
    and canonical_advisory_id like v_marker || '-%';

  select id into v_vulnerability_id
  from public.vulnerabilities
  where canonical_id = v_marker;
  if v_vulnerability_id is null then
    insert into public.vulnerabilities(canonical_id, title, summary)
    values (v_marker, 'M5 local triage fixture', 'Test-only local M5 triage evidence.')
    returning id into v_vulnerability_id;
  end if;

  select id into v_source_record_id
  from public.vulnerability_source_records
  where feed_key = 'osv' and source_record_key = v_marker;
  if v_source_record_id is null then
    insert into public.vulnerability_feed_sync_runs(
      feed_key, run_kind, status, correlation_id, staging_complete,
      expected_record_count, records_received, records_promoted, started_at, completed_at
    ) values ('osv', 'manual', 'completed', gen_random_uuid(), true, 1, 1, 1,
      clock_timestamp(), clock_timestamp())
    returning id into v_feed_run_id;
    insert into public.vulnerability_source_records(feed_key, source_record_key, vulnerability_id)
    values ('osv', v_marker, v_vulnerability_id)
    returning id into v_source_record_id;
    insert into public.vulnerability_source_record_versions(
      source_record_id, run_id, record_sha256, record_state, raw_payload, normalized_payload
    ) values (v_source_record_id, v_feed_run_id, v_version_hash, 'active', '{}'::jsonb, '{}'::jsonb)
    returning id into v_source_record_version_id;
    update public.vulnerability_source_records
    set current_version_id = v_source_record_version_id
    where id = v_source_record_id;
  else
    select current_version_id into v_source_record_version_id
    from public.vulnerability_source_records where id = v_source_record_id;
  end if;

  select id into v_affected_range_id
  from public.vulnerability_affected_ranges
  where source_record_version_id = v_source_record_version_id
    and ecosystem = 'npm' and package_name = 'm5-triage-fixture';
  if v_affected_range_id is null then
    insert into public.vulnerability_affected_ranges(
      vulnerability_id, source_record_version_id, ecosystem, package_name, range_type, range_value
    ) values (v_vulnerability_id, v_source_record_version_id, 'npm', 'm5-triage-fixture',
      'semver', '{"versions":["1.0.0"]}'::jsonb)
    returning id into v_affected_range_id;
  end if;

  select id into v_raw_object_id from public.sbom_raw_objects
  where organization_id = v_organization_id and sha256 = v_hash;
  if v_raw_object_id is null then
    insert into public.sbom_raw_objects(organization_id, sha256, byte_size, media_type, storage_key)
    values (v_organization_id, v_hash, 1, 'application/json',
      v_organization_id::text || '/' || gen_random_uuid()::text || '/' || v_hash)
    returning id into v_raw_object_id;
    insert into public.sbom_sources(
      id, organization_id, product_id, release_id, actor_user_id, source_kind,
      idempotency_key, request_digest, original_filename, declared_media_type,
      declared_byte_size, declared_sha256, staging_storage_key, status, upload_expires_at,
      verified_at, raw_object_id, correlation_id
    ) values (
      gen_random_uuid(), v_organization_id, v_product_id, v_release_id, v_user_id, 'manual_upload',
      gen_random_uuid(), repeat('c', 64), 'm5-triage-fixture.json', 'application/json',
      1, v_hash, v_organization_id::text || '/' || gen_random_uuid()::text || '/' || v_hash,
      'verified', clock_timestamp() + interval '10 minutes', clock_timestamp(), v_raw_object_id,
      gen_random_uuid()
    ) returning id into v_source_id;
    insert into public.sbom_ingest_jobs(
      organization_id, source_id, release_id, actor_user_id, correlation_id, idempotency_key,
      input_sha256, status, progress_stage, progress_percent, completed_at
    ) values (v_organization_id, v_source_id, v_release_id, v_user_id, gen_random_uuid(),
      gen_random_uuid(), v_hash, 'completed', 'completed', 100, clock_timestamp())
    returning id into v_job_id;
    insert into public.sbom_documents(
      organization_id, source_id, raw_object_id, ingest_job_id, document_sha256, format,
      serialization, specification_version, parser_name, parser_version, normalizer_name,
      normalizer_version, validation_status, state, progress_stage,
      progress_component_count, component_count, completed_at
    ) values (v_organization_id, v_source_id, v_raw_object_id, v_job_id, v_hash, 'cyclonedx',
      'json', '1.5', 'm5-fixture', '1', 'm5-fixture', '1', 'valid', 'completed',
      'completed', 1, 1, clock_timestamp())
    returning id into v_document_id;
    insert into public.sbom_components(
      organization_id, document_id, document_local_ref, source_offset, source_path, source_byte_end,
      original_name, normalized_name, original_version, normalized_version, original_purl,
      canonical_purl, ecosystem
    ) values (v_organization_id, v_document_id, 'm5-triage-fixture', 0, '/components/0', 1,
      'm5-triage-fixture', 'm5-triage-fixture', '1.0.0', '1.0.0',
      'pkg:npm/m5-triage-fixture@1.0.0', 'pkg:npm/m5-triage-fixture@1.0.0', 'npm')
    returning id into v_component_id;
    insert into public.vulnerability_component_occurrences(
      organization_id, document_id, release_id, component_id, canonical_purl, component_identity,
      component_version
    ) values (v_organization_id, v_document_id, v_release_id, v_component_id,
      'pkg:npm/m5-triage-fixture@1.0.0', 'pkg:npm/m5-triage-fixture@1.0.0', '1.0.0')
    returning id into v_occurrence_id;
  else
    select documents.id, components.id, occurrences.id
    into v_document_id, v_component_id, v_occurrence_id
    from public.sbom_documents documents
    join public.sbom_components components
      on components.organization_id = documents.organization_id and components.document_id = documents.id
    join public.vulnerability_component_occurrences occurrences
      on occurrences.organization_id = documents.organization_id and occurrences.document_id = documents.id
    where documents.organization_id = v_organization_id and documents.document_sha256 = v_hash
    limit 1;
  end if;

  with inserted as (
    insert into public.vulnerability_findings(
      organization_id, release_id, component_identity, canonical_advisory_id, vulnerability_id,
      source_feed_key, source_record_id, source_record_version_id, affected_range_id, match_method,
      comparator_name, comparator_version, evaluated_component_value, affected_range, event_sequence,
      confidence, confidence_table_version, confidence_explanation
    )
    select v_organization_id, v_release_id, 'pkg:npm/m5-triage-fixture@1.0.0',
      v_marker || '-' || lpad(series::text, 3, '0'), v_vulnerability_id, 'osv',
      v_source_record_id, v_source_record_version_id, v_affected_range_id, 'purl_osv',
      'semver', '1', '1.0.0', '{"versions":["1.0.0"]}'::jsonb, '[]'::jsonb,
      0.9500, 'm5-fixture-v1', 'Test-only M5 triage fixture.'
    from generate_series(1, 100) as series
    on conflict (organization_id, release_id, component_identity, canonical_advisory_id) do nothing
    returning id
  )
  insert into public.vulnerability_finding_component_occurrences(
    finding_id, occurrence_id, organization_id
  )
  select id, v_occurrence_id, v_organization_id from inserted;

  if (select count(*) from public.vulnerability_findings
      where organization_id = v_organization_id and canonical_advisory_id like v_marker || '-%') <> 100 then
    raise exception 'M5 fixture did not create exactly 100 findings';
  end if;
  raise notice 'Created 100 M5 triage findings for local browser verification.';
end;
$$;
