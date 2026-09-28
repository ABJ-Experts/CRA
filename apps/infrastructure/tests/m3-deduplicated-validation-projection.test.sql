-- Verified same-content alias validation reuse; all fixtures roll back.
begin;
select set_config('m3_test.fixture_org',gen_random_uuid()::text,true);
insert into public.organizations(id,name,slug) values(current_setting('m3_test.fixture_org')::uuid,'M3 paging fixture','m3-paging-'||current_setting('m3_test.fixture_org'));
-- Every fixture row is private to this transaction and rolls back.
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
  v_index integer;
  v_source uuid;
  v_request uuid;
  v_invitation uuid;
  v_primary uuid := gen_random_uuid();
  v_limit integer;
  v_kind text;
  v_failures text[] := array[]::text[];
  v_read record;
  v_bad text;
  v_secondary_release uuid := gen_random_uuid();
  v_document uuid;
  v_component uuid;
  v_read_report jsonb;
  v_original jsonb;
  v_diag jsonb;
  v_status text;
  v_bad_source uuid;
  v_bad_raw uuid:=gen_random_uuid();
  v_bad_release uuid:=gen_random_uuid();
  v_override jsonb;
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

  perform * from public.reserve_sbom_source_atomic(v_org,v_product,v_release,v_actor,null,v_source_two,'manual_upload',v_key_two,
    encode(extensions.digest('alias-validation','sha256'),'hex'),'alias.json','application/json',42,
    v_hash,v_org::text||'/'||v_source_two::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid());
  select * into v_read from public.finalize_sbom_source_deduplicated_atomic(v_org,v_source_two,v_actor,null,v_hash,42,'application/json',v_key_two,gen_random_uuid());
  if v_read.outcome<>'deduplicated' then raise exception 'Alias fixture failed: %',v_read.outcome; end if;
  select validation_report into v_original from public.sbom_ingest_jobs where organization_id=v_org and source_id=v_source_one;
  v_read_report:=public.sbom_validation_report_json(v_org,v_source_two);
  if v_read_report is distinct from v_original then v_failures:=array_append(v_failures,'verified alias must reuse exact canonical report'); end if;
  if public.sbom_validation_summary_json(v_org,v_source_two)->>'status'<>'valid' then v_failures:=array_append(v_failures,'alias summary remains pending'); end if;
  if public.sbom_validation_report_json(gen_random_uuid(),v_source_two)->>'status'<>'pending' then raise exception 'tenant substitution leaked report'; end if;
  execute 'set local role service_role';
  select * into v_read from public.get_sbom_validation_report(v_org,v_actor,v_source_two);
  if v_read.outcome<>'found' or v_read.report is distinct from v_original then v_failures:=array_append(v_failures,'public scoped report RPC alias reuse incorrect'); end if;
  select * into v_read from public.get_sbom_validation_report(gen_random_uuid(),v_actor,v_source_two);
  if v_read.outcome<>'not_found' then raise exception 'public scoped report RPC leaked tenant'; end if;
  execute 'reset role';
  -- Own job (even pending) wins over the canonical report.
  insert into public.sbom_ingest_jobs(organization_id,source_id,release_id,actor_user_id,correlation_id,idempotency_key,input_sha256)
    values(v_org,v_source_two,v_release,v_actor,gen_random_uuid(),gen_random_uuid(),v_hash);
  if public.sbom_validation_report_json(v_org,v_source_two)->>'status'<>'pending' then raise exception 'own pending job lost precedence'; end if;
  delete from public.sbom_ingest_jobs where organization_id=v_org and source_id=v_source_two;
  -- Project truthful canonical warning/invalid/pending status without mutating stored reports.
  v_diag:=jsonb_build_object('severity','warning','code','test_content_warning','location','$','message','Content warning','remediation','Review content');
  foreach v_status in array array['valid_with_warnings','invalid','pending'] loop
    if v_status='pending' then
      update public.sbom_ingest_jobs set validation_status='pending',validation_report=null,validation_completed_at=null,
        validator_name=null,validator_version=null,validator_schema_asset_sha256=null,detected_format=null,detected_serialization=null,detected_spec_version=null
        where organization_id=v_org and source_id=v_source_one;
    else
      v_report:=v_original||jsonb_build_object('status',v_status,'diagnostics',jsonb_build_array(v_diag),'warningCount',1,'errorCount',case when v_status='invalid' then 1 else 0 end);
      if v_status='invalid' then v_report:=v_report||jsonb_build_object('diagnostics',jsonb_build_array(v_diag,v_diag||jsonb_build_object('severity','error','code','test_content_error'))); end if;
      update public.sbom_ingest_jobs set validation_status=v_status,validation_report=v_report,validation_completed_at=(v_report->>'completedAt')::timestamptz
        where organization_id=v_org and source_id=v_source_one;
    end if;
    if public.sbom_validation_report_json(v_org,v_source_two)->>'status'<>v_status then v_failures:=array_append(v_failures,'alias incorrect status '||v_status); end if;
  end loop;
  update public.sbom_ingest_jobs set validation_status='valid',validation_report=v_original,validation_completed_at=(v_original->>'completedAt')::timestamptz,
    validator_name='CRA streaming SBOM normalizer',validator_version='m3-test',validator_schema_asset_sha256=repeat('a',64),detected_format='cyclonedx',detected_serialization='json',detected_spec_version='1.6'
    where organization_id=v_org and source_id=v_source_one;
  -- Use a fresh wrong-declaration alias: metadata remains immutable after reservation.
  v_source:=gen_random_uuid();
  perform * from public.reserve_sbom_source_atomic(v_org,v_product,v_release,v_actor,null,v_source,'manual_upload',gen_random_uuid(),
    repeat('f',64),'wrong.json','application/json',42,v_hash,v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid(),'spdx','2.3',null);
  select idempotency_key into v_key_two from public.sbom_sources where organization_id=v_org and id=v_source;
  select * into v_read from public.finalize_sbom_source_deduplicated_atomic(v_org,v_source,v_actor,null,v_hash,42,'application/json',v_key_two,gen_random_uuid());
  v_read_report:=public.sbom_validation_report_json(v_org,v_source);
  if v_read_report->>'status'<>'valid_with_warnings' or(v_read_report->>'warningCount')::integer<>2
    or jsonb_array_length(v_read_report->'diagnostics')<>2 then v_failures:=array_append(v_failures,'alias declared metadata mismatch not projected'); end if;
  if(select validation_report from public.sbom_ingest_jobs where organization_id=v_org and source_id=v_source_one) is distinct from v_original then raise exception 'canonical persisted report changed'; end if;

  v_report:=v_original||jsonb_build_object('status','invalid','errorCount',1,'diagnostics',jsonb_build_array(v_diag||jsonb_build_object('severity','error','code','test_content_error')));
  update public.sbom_ingest_jobs set validation_status='invalid',validation_report=v_report where organization_id=v_org and source_id=v_source_one;
  v_read_report:=public.sbom_validation_report_json(v_org,v_source);
  if v_read_report->>'status'<>'invalid' or(v_read_report->>'errorCount')::integer<>1 or(v_read_report->>'warningCount')::integer<>2 then
    v_failures:=array_append(v_failures,'alias metadata warnings masked invalid content'); end if;
  -- Replacing canonical source metadata warnings must not warn a correctly declared alias.
  v_report:=v_original||jsonb_build_object('status','valid_with_warnings','warningCount',1,'diagnostics',jsonb_build_array(v_diag||jsonb_build_object('code','declared_format_mismatch')));
  update public.sbom_ingest_jobs set validation_status='valid_with_warnings',validation_report=v_report where organization_id=v_org and source_id=v_source_one;
  if public.sbom_validation_report_json(v_org,v_source_two)->>'status'<>'valid' then v_failures:=array_append(v_failures,'canonical declaration warning incorrectly inherited'); end if;
  -- Bounded diagnostic projection preserves actual total counts and omitted diagnostics.
  select jsonb_agg(v_diag) into v_report from generate_series(1,100);
  v_report:=v_original||jsonb_build_object('status','valid_with_warnings','warningCount',100,'diagnostics',v_report);
  update public.sbom_ingest_jobs set validation_status='valid_with_warnings',validation_report=v_report where organization_id=v_org and source_id=v_source_one;
  v_read_report:=public.sbom_validation_report_json(v_org,v_source);
  if jsonb_array_length(v_read_report->'diagnostics')<>100 or(v_read_report->>'warningCount')::integer<>102 or(v_read_report->>'omittedDiagnosticCount')::integer<>2 then
    v_failures:=array_append(v_failures,'bounded alias diagnostics/counts incorrect'); end if;
  if(select validation_report from public.sbom_ingest_jobs where organization_id=v_org and source_id=v_source_one) is distinct from v_report then raise exception 'projection rewrote canonical report'; end if;
  update public.sbom_ingest_jobs set validation_status='valid',validation_report=v_original where organization_id=v_org and source_id=v_source_one;
  insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)
    values(v_bad_release,v_org,v_product,v_entity,0,'{}','Other','2.0.0',v_actor,v_actor);
  insert into public.sbom_raw_objects(id,organization_id,sha256,byte_size,media_type,storage_key)
    values(v_bad_raw,v_org,repeat('e',64),42,'application/json',v_org::text||'/'||gen_random_uuid()::text||'/'||repeat('e',64));
  -- Direct corrupt provenance cannot grant fallback even if a legacy row passed old constraints.
  foreach v_override in array array[jsonb_build_object('declared_sha256',repeat('c',64)),
    jsonb_build_object('raw_object_id',v_bad_raw),jsonb_build_object('release_id',v_bad_release)] loop
    v_bad_source:=gen_random_uuid();
    begin
    insert into public.sbom_sources select (jsonb_populate_record(null::public.sbom_sources,
      (select to_jsonb(src) from public.sbom_sources src where organization_id=v_org and id=v_source_two)
      ||v_override||jsonb_build_object('id',v_bad_source,'idempotency_key',gen_random_uuid(),
        'staging_storage_key',v_org::text||'/'||v_bad_source::text||'/'||repeat('d',64)))).*;
    if public.sbom_validation_report_json(v_org,v_bad_source)->>'status'<>'pending' then raise exception 'Corrupt alias scope leaked canonical report: %',v_override; end if;
    exception when foreign_key_violation then
      if not(v_override?'release_id') then raise; end if;
    end;
  end loop;
  if cardinality(v_failures)>0 then raise exception 'Alias validation failures: %',v_failures; end if;
end $$;
rollback;
