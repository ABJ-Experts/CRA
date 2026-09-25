-- One idempotent, uniquely tagged LOCAL fixture for the M5-06 browser flow.
-- It creates only its own uniquely tagged product, release, SBOM, and finding
-- records; it creates no policies, targets, or shared records and
-- must never be applied to a hosted/shared database.
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_entity uuid;
  v_product uuid := 'c6060000-0000-4000-8000-000000000001';
  v_release uuid := 'c6060000-0000-4000-8000-000000000002';
  v_vulnerability uuid;
  v_source_record uuid;
  v_source_version uuid;
  v_feed_key text;
  v_range uuid;
  v_raw_object uuid;
  v_source uuid;
  v_job uuid;
  v_document uuid;
  v_component uuid;
  v_occurrence uuid;
  v_document_hash text := repeat('c', 64);
  v_finding uuid := 'c6060000-0000-4000-8000-000000000006';
  v_component_identity text;
  v_component_version text;
  v_assessment record;
  v_result record;
begin
  select id into v_owner from public.users
    where email = 'owner@cra.test';
  select id into v_admin from public.users
    where email = 'admin@cra.test';
  select id into v_entity from public.organization_legal_entities
    where organization_id = v_org and is_default;
  select id into v_vulnerability from public.vulnerabilities order by id limit 1;
  select records.id, records.current_version_id, records.feed_key
    into v_source_record, v_source_version, v_feed_key
  from public.vulnerability_source_records records
  where records.current_version_id is not null
  order by records.id limit 1;

  if v_owner is null or v_admin is null or v_entity is null
    or v_vulnerability is null or v_source_record is null or v_source_version is null then
    raise exception 'The normal local seed is incomplete; M5-06 fixture was not created';
  end if;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_by, updated_by
  ) values (
    v_product, v_org, v_entity, 0, '{}'::jsonb,
    'M5-06 E2E export scope', 'M5-06-E2E-EXPORT',
    'standalone_software', v_owner, v_owner, v_owner
  ) on conflict (id) do nothing;
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values (
    v_release, v_org, v_product, v_entity, 0, '{}'::jsonb,
    'M5-06 E2E release', '1.0.0-m5-06-e2e', 'development', v_owner, v_owner
  ) on conflict (id) do nothing;

  select id into v_raw_object from public.sbom_raw_objects
  where organization_id = v_org and sha256 = v_document_hash;
  if v_raw_object is null then
    insert into public.sbom_raw_objects(
      organization_id, sha256, byte_size, media_type, storage_key
    ) values (
      v_org, v_document_hash, 1, 'application/json',
      v_org::text || '/' || gen_random_uuid()::text || '/' || v_document_hash
    ) returning id into v_raw_object;
    insert into public.sbom_sources(
      id, organization_id, product_id, release_id, actor_user_id, source_kind,
      idempotency_key, request_digest, original_filename, declared_media_type,
      declared_byte_size, declared_sha256, staging_storage_key, status,
      upload_expires_at, verified_at, raw_object_id, correlation_id
    ) values (
      gen_random_uuid(), v_org, v_product, v_release, v_owner, 'manual_upload', gen_random_uuid(),
      repeat('b', 64), 'm5-vex-export-e2e.json', 'application/json', 1,
      v_document_hash, v_org::text || '/' || gen_random_uuid()::text || '/' || v_document_hash,
      'verified', clock_timestamp() + interval '10 minutes', clock_timestamp(),
      v_raw_object, gen_random_uuid()
    ) returning id into v_source;
    insert into public.sbom_ingest_jobs(
      organization_id, source_id, release_id, actor_user_id, correlation_id,
      idempotency_key, input_sha256, status, progress_stage, progress_percent,
      completed_at
    ) values (
      v_org, v_source, v_release, v_owner, gen_random_uuid(), gen_random_uuid(),
      v_document_hash, 'completed', 'completed', 100, clock_timestamp()
    ) returning id into v_job;
    insert into public.sbom_documents(
      organization_id, source_id, raw_object_id, ingest_job_id, document_sha256,
      format, serialization, specification_version, parser_name, parser_version,
      normalizer_name, normalizer_version, validation_status, state,
      progress_stage, progress_component_count, component_count, completed_at
    ) values (
      v_org, v_source, v_raw_object, v_job, v_document_hash, 'cyclonedx', 'json',
      '1.6', 'm5-e2e', '1', 'm5-e2e', '1', 'valid', 'completed', 'completed',
      1, 1, clock_timestamp()
    ) returning id into v_document;
    insert into public.sbom_components(
      organization_id, document_id, document_local_ref, source_offset, source_path,
      source_byte_end, original_name, normalized_name, original_version,
      normalized_version, original_purl, canonical_purl, ecosystem
    ) values (
      v_org, v_document, 'm5-vex-export-e2e', 0, '/components/0', 1,
      'm5-vex-export-e2e', 'm5-vex-export-e2e', '1.0.0', '1.0.0',
      'pkg:npm/m5-vex-export-e2e@1.0.0',
      'pkg:npm/m5-vex-export-e2e@1.0.0', 'npm'
    ) returning id into v_component;
    insert into public.vulnerability_component_occurrences(
      organization_id, document_id, release_id, component_id, canonical_purl,
      component_identity, component_version
    ) values (
      v_org, v_document, v_release, v_component,
      'pkg:npm/m5-vex-export-e2e@1.0.0',
      'pkg:npm/m5-vex-export-e2e@1.0.0', '1.0.0'
    ) returning id into v_occurrence;
  else
    select documents.id, components.id, occurrences.id,
      occurrences.component_identity, occurrences.component_version
      into v_document, v_component, v_occurrence, v_component_identity,
        v_component_version
    from public.sbom_documents documents
    join public.sbom_components components
      on components.organization_id = documents.organization_id
      and components.document_id = documents.id
    join public.vulnerability_component_occurrences occurrences
      on occurrences.organization_id = documents.organization_id
      and occurrences.document_id = documents.id
    where documents.organization_id = v_org and documents.document_sha256 = v_document_hash
    limit 1;
  end if;
  v_component_identity := coalesce(v_component_identity, 'pkg:npm/m5-vex-export-e2e@1.0.0');
  v_component_version := coalesce(v_component_version, '1.0.0');

  insert into public.vulnerability_affected_ranges(
    vulnerability_id, source_record_version_id, ecosystem, package_name,
    range_type, range_value, event_sequence
  ) values (
    v_vulnerability, v_source_version, 'npm', 'm5-vex-export-e2e',
    'SEMVER', '{"events":[{"introduced":"0"}]}'::jsonb, '[]'::jsonb
  ) on conflict (source_record_version_id, ecosystem, package_name, range_type, range_value)
    do nothing returning id into v_range;
  if v_range is null then
    select id into v_range from public.vulnerability_affected_ranges
    where source_record_version_id = v_source_version and ecosystem = 'npm'
      and package_name = 'm5-vex-export-e2e' and range_type = 'SEMVER'
      and range_value = '{"events":[{"introduced":"0"}]}'::jsonb;
  end if;

  insert into public.vulnerability_findings(
    id, organization_id, release_id, component_identity, canonical_advisory_id,
    vulnerability_id, source_feed_key, source_record_id, source_record_version_id,
    affected_range_id, match_method, comparator_name, comparator_version,
    evaluated_component_value, affected_range, event_sequence, confidence,
    confidence_table_version, confidence_explanation, reevaluation_state
  ) values (
    v_finding, v_org, v_release, v_component_identity,
    'CVE-M5-06-E2E-0002', v_vulnerability, v_feed_key, v_source_record,
    v_source_version, v_range, 'purl_osv', 'm5-vex-export-e2e', '1',
    v_component_version, '{"versions":["1.0.0"]}'::jsonb,
    '[]'::jsonb, 0.91, 'm5-vex-export-e2e',
    'Local-only M5-06 VEX export verification fixture.', 'unchanged'
  ) on conflict (id) do nothing;

  insert into public.vulnerability_finding_component_occurrences(
    finding_id, occurrence_id, organization_id
  )
  select v_finding, v_occurrence, v_org
  on conflict do nothing;

  if not exists (
    select 1 from public.vulnerability_finding_assessments
    where organization_id = v_org and finding_id = v_finding and is_current
  ) then
    select * into v_result
    from public.submit_vulnerability_finding_vex_assessment_atomic(
      v_org, v_owner, v_finding, 'affected', null,
      'M5-06 local browser fixture: affected statement for strict CycloneDX rejection.',
      '[]'::jsonb, 'Initial M5-06 local export fixture.', 0,
      'c6060000-0000-4000-8000-000000000007', repeat('6', 64)
    );
    if v_result.outcome not in ('submitted', 'idempotent') then
      raise exception 'M5-06 fixture assessment submit failed: %', v_result.outcome;
    end if;
  end if;

  select * into v_assessment
  from public.vulnerability_finding_assessments
  where organization_id = v_org and finding_id = v_finding and is_current;
  if v_assessment.approval_state = 'awaiting_approval' then
    select * into v_result
    from public.approve_vulnerability_finding_vex_assessment_atomic(
      v_org, v_admin, v_finding, v_assessment.id, v_assessment.version,
      null, 'c6060000-0000-4000-8000-000000000008', repeat('7', 64)
    );
    if v_result.outcome not in ('approved', 'idempotent') then
      raise exception 'M5-06 fixture assessment approval failed: %', v_result.outcome;
    end if;
  end if;
end;
$$;
