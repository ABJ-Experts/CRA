-- M3 terminal quality failures must not starve later immutable observations.
-- Every fixture and command is transaction-private and rolls back.
begin;
select set_config('m3_test.fixture_org',gen_random_uuid()::text,true);
insert into public.organizations(id,name,slug) values(current_setting('m3_test.fixture_org')::uuid,'M3 quality queue fixture','m3-quality-queue-'||current_setting('m3_test.fixture_org'));
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

do $$
declare
  v_org uuid:=current_setting('m3_test.fixture_org')::uuid;
  v_doc public.sbom_documents%rowtype;
  v_source public.sbom_sources%rowtype;
  v_alias uuid:=gen_random_uuid(); v_key uuid:=gen_random_uuid();
  v_old uuid; v_later uuid; v_claim record; v_result record;
  v_failures text[]:=array[]::text[];
begin
  select * into v_doc from public.sbom_documents where organization_id=v_org;
  perform * from public.finalize_sbom_document_normalization_atomic(v_org,v_doc.ingest_job_id,'normalizer-replay-worker-one',v_doc.id);
  select * into v_source from public.sbom_sources where organization_id=v_org and id=v_doc.source_id;
  perform * from public.reserve_sbom_source_atomic(v_org,v_source.product_id,v_source.release_id,v_source.actor_user_id,null,v_alias,'manual_upload',v_key,
    encode(extensions.digest('quality-alias','sha256'),'hex'),'quality-alias.json','application/json',42,v_source.declared_sha256,v_org::text||'/'||v_alias::text||'/'||v_source.declared_sha256,now()+interval '10 minutes',gen_random_uuid());
  select * into v_result from public.finalize_sbom_source_deduplicated_atomic(v_org,v_alias,v_source.actor_user_id,null,v_source.declared_sha256,42,'application/json',v_key,gen_random_uuid());
  if v_result.outcome<>'deduplicated' then raise exception 'quality alias fixture failed %',v_result.outcome; end if;
  insert into public.sbom_document_sources(organization_id,document_id,source_id,raw_object_id,release_id)
    select v_org,v_doc.id,v_alias,raw_object_id,release_id from public.sbom_sources where organization_id=v_org and id=v_alias
    on conflict (organization_id,document_id,source_id) do nothing;
  update public.sbom_sources set verified_at=now()-interval '2 minutes' where organization_id=v_org and id=v_source.id;
  update public.sbom_sources set verified_at=now()-interval '1 minute' where organization_id=v_org and id=v_alias;
  select id into v_old from public.sbom_quality_reports where organization_id=v_org and source_id=v_source.id;
  select id into v_later from public.sbom_quality_reports where organization_id=v_org and source_id=v_alias;
  if v_old is null or v_later is null then raise exception 'quality reports not enqueued'; end if;
  update public.sbom_quality_reports set state='failed',progress_stage='failed',attempt_count=max_attempts,error_code='unexpected_failure',error_message='Fixture terminal failure' where organization_id=v_org and id=v_old;
  select * into v_claim from public.claim_sbom_quality_report(v_org,'m3-quality-test',60);
  if v_claim.outcome<>'claimed' or (v_claim.work->>'id')::uuid<>v_later then v_failures:=array_append(v_failures,'terminal failed predecessor must not block later report'); end if;
  if v_claim.work#>>'{baseline,status}' is distinct from 'no_baseline' then v_failures:=array_append(v_failures,'terminal failed predecessor is never a completed baseline'); end if;
  update public.sbom_quality_reports set state='queued',progress_stage='queued',attempt_count=0,lease_owner=null,lease_expires_at=null where organization_id=v_org and id=v_later;
  update public.sbom_quality_reports set attempt_count=1,next_attempt_at=now()+interval '1 day' where organization_id=v_org and id=v_old;
  select * into v_claim from public.claim_sbom_quality_report(v_org,'m3-quality-test',60);
  if v_claim.outcome<>'empty' then v_failures:=array_append(v_failures,'retryable failed predecessor remains ordered even when retry is not due'); end if;
  update public.sbom_quality_reports set state='queued',progress_stage='queued',error_code=null,error_message=null where organization_id=v_org and id=v_old;
  select * into v_claim from public.claim_sbom_quality_report(v_org,'m3-quality-test',60);
  if v_claim.outcome<>'empty' then v_failures:=array_append(v_failures,'queued predecessor remains ordered'); end if;
  update public.sbom_quality_reports set state='processing',progress_stage='collecting_inputs',attempt_count=5,lease_owner='other-worker',lease_expires_at=now()+interval '1 minute' where organization_id=v_org and id=v_old;
  select * into v_claim from public.claim_sbom_quality_report(v_org,'m3-quality-test',60);
  if v_claim.outcome<>'empty' then v_failures:=array_append(v_failures,'live processing predecessor remains ordered at final attempt'); end if;
  update public.sbom_quality_reports set lease_expires_at=now()-interval '1 second' where organization_id=v_org and id=v_old;
  select * into v_claim from public.claim_sbom_quality_report(v_org,'m3-quality-test',60);
  if v_claim.outcome<>'claimed' then v_failures:=array_append(v_failures,'expired exhausted predecessor is recovered and skipped'); end if;
  if not exists(select 1 from public.sbom_quality_reports where organization_id=v_org and id=v_old and state='failed' and attempt_count=5 and error_code='unexpected_failure') then v_failures:=array_append(v_failures,'terminal predecessor remains readable and failed'); end if;
  update public.sbom_quality_reports set state='queued',progress_stage='queued',attempt_count=0,lease_owner=null,lease_expires_at=null where organization_id=v_org and id=v_later;
  update public.sbom_quality_reports set state='completed',progress_stage='completed',progress_percent=100,completed_at=now(),error_code=null,error_message=null,raw_inputs='{}',dimension_scores='[]',weights='{}',total_score=61 where organization_id=v_org and id=v_old;
  select * into v_claim from public.claim_sbom_quality_report(v_org,'m3-quality-test',60);
  if v_claim.outcome<>'claimed' or v_claim.work#>>'{baseline,status}'<>'available' or (v_claim.work#>>'{baseline,reportId}')::uuid<>v_old or (v_claim.work#>>'{baseline,totalScore}')::numeric<>61 then v_failures:=array_append(v_failures,'only completed predecessor can become baseline'); end if;
  select * into v_claim from public.claim_sbom_quality_report(gen_random_uuid(),'m3-quality-test',60);
  if v_claim.outcome<>'empty' then v_failures:=array_append(v_failures,'tenant substitution must not claim fixture reports'); end if;
  if cardinality(v_failures)>0 then raise exception 'quality queue failures: %',array_to_string(v_failures,'; '); end if;
  raise notice 'PASS terminal failure/expired lease progress, retryable/queued/live predecessor ordering, completed-only baseline, tenant isolation';
end $$;
-- The application worker executes this boundary as service_role.
set local role service_role;
do $$
declare v_claim record;
begin
  select * into v_claim from public.claim_sbom_quality_report(gen_random_uuid(),'m3-quality-service-role',60);
  if v_claim.outcome<>'empty' then raise exception 'service_role tenant substitution leaked work'; end if;
end $$;
reset role;
rollback;
