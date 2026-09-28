-- Called only by the exact-fixture concurrency harness.
do $$
declare
  v_org uuid := current_setting('m3_test.fixture_org')::uuid;
  v_actor uuid;
  v_entity uuid := gen_random_uuid();
  v_product uuid;
  v_release uuid;
  v_hash text := repeat('d', 64);
  v_source_one uuid := gen_random_uuid();
  v_source_two uuid := gen_random_uuid();
  v_key_one uuid := gen_random_uuid();
  v_key_two uuid := gen_random_uuid();
  v_report jsonb;
  v_job_one record;
  v_job_two record;
  v_claim record;
  v_begin record;
  v_persist record;
  v_finalize record;
  v_document uuid;
  v_component uuid;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner');
  insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)
  values(v_entity,v_org,'test','Graph concurrency fixture','needs_completion','inactive',v_actor,v_actor);
  insert into public.products(organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
  values(v_org,v_entity,0,'{}','Graph concurrency fixture','TEST','standalone_software',v_actor,v_actor,v_actor) returning id into v_product;
  insert into public.product_releases(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)
  values(v_org,v_product,v_entity,0,'{}','Test','1.0.0',v_actor,v_actor) returning id into v_release;
  v_report := jsonb_build_object(
    'status', 'valid',
    'detected', jsonb_build_object('format', 'cyclonedx', 'serialization', 'json', 'specificationVersion', '1.6'),
    'validator', jsonb_build_object('name', 'CRA streaming SBOM normalizer', 'version', 'm3-test', 'schemaAssetSha256', repeat('a', 64)),
    'diagnostics', '[]'::jsonb,
    'errorCount', 0,
    'warningCount', 0,
    'omittedDiagnosticCount', 0,
    'completedAt', '2026-08-24T00:00:00.000Z'
  );

  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source_one, 'manual_upload', v_key_one,
    encode(extensions.digest('normalizer-replay-one', 'sha256'), 'hex'), 'normalizer-replay-one.json', 'application/json', 42,
    v_hash, v_org::text || '/' || v_source_one::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job_one from public.finalize_sbom_source_atomic(
    v_org, v_source_one, v_actor, null, v_hash, 42, 'application/json', v_key_one, gen_random_uuid()
  );
  update public.sbom_ingest_jobs
     set next_attempt_at = now() + interval '1 day'
   where organization_id = v_org
     and source_id <> v_source_one
     and status in ('queued', 'failed');
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'normalizer-replay-worker-one', 60);
  if v_claim.outcome <> 'claimed' or (v_claim.work ->> 'sourceId')::uuid <> v_source_one then
    raise exception 'first immutable-hash job was not claimable';
  end if;
  select * into v_begin from public.begin_sbom_document_normalization_atomic(
    v_org, (v_job_one.job ->> 'id')::uuid, 'normalizer-replay-worker-one',
    'CRA streaming SBOM parser', 'm3-test', 'CRA SBOM normalizer', 'm3-03.1',
    'cyclonedx', 'json', '1.6', v_report
  );
  if v_begin.outcome <> 'created' then
    raise exception 'first immutable-hash document was not created: %', v_begin.outcome;
  end if;
  select * into v_persist from public.persist_sbom_normalization_batch_atomic(
    v_org, (v_job_one.job ->> 'id')::uuid, 'normalizer-replay-worker-one', (v_begin.document ->> 'id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'document_local_ref', 'pkg:one',
      'source_offset', 1,
      'source_byte_end', 41,
      'source_path', '$.components[0]',
      'source_line', 1,
      'original_name', 'One',
      'normalized_name', 'one',
      'original_version', '1.0.0',
      'normalized_version', '1.0.0',
      'original_purl', 'pkg:npm/one@1.0.0',
      'canonical_purl', 'pkg:npm/one@1.0.0',
      'cpe', null,
      'ecosystem', 'npm',
      'scope', null,
      'supplier', null,
      'license_expression', null,
      'hashes', '[]'::jsonb
    )),
    '[]'::jsonb,
    '[]'::jsonb,
    41
  );
  if v_persist.outcome <> 'persisted' then
    raise exception 'first immutable-hash batch was not persisted';
  end if;
  v_document := (v_begin.document->>'id')::uuid;
  select id into v_component from public.sbom_components where organization_id=v_org and document_id=v_document;
  -- In-progress writes are needed for batching, resolution and worker restart.
  update public.sbom_components set normalized_name='one-staging' where id=v_component;
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value)
    values(v_org,v_document,v_component,'other','staging-extra');
  insert into public.sbom_component_dependencies(organization_id,document_id,parent_reference,child_reference,
    source_offset,source_byte_end,source_path,edge_state,omission_code,omission_message)
    values(v_org,v_document,'pkg:one','missing',1,41,'$.dependencies','omitted','missing_dependency_reference','Missing reference');
end $$;
