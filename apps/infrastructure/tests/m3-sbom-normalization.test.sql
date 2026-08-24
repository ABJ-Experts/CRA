-- M3-03 normalized SBOM graph database contract.  This suite is intentionally
-- transaction-local: it validates the migration surface without leaving tenant
-- evidence or test records in the local stack.
begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

select pg_temp.check(
  'normalization tables are tenant scoped, indexed, RLS enabled, and browser-private',
  (select relrowsecurity from pg_class where oid = 'public.sbom_documents'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.sbom_document_sources'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.sbom_components'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.sbom_component_identities'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.sbom_component_dependencies'::regclass)
  and not has_table_privilege('authenticated', 'public.sbom_documents', 'select')
  and not has_table_privilege('authenticated', 'public.sbom_components', 'select')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_components_org_canonical_purl_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_components_org_name_version_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_components_document_depth_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sbom_component_dependencies_parent_child_idx')
);

select pg_temp.check(
  'normalization worker RPC is service-role-only and pinned',
  not has_function_privilege('authenticated',
    'public.finalize_sbom_document_normalization_atomic(uuid,uuid,text,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.finalize_sbom_document_normalization_atomic(uuid,uuid,text,uuid)', 'execute')
  and (select proconfig::text like '%search_path=public, pg_temp%'
       from pg_proc where oid = 'public.finalize_sbom_document_normalization_atomic(uuid,uuid,text,uuid)'::regprocedure)
  and not has_function_privilege('authenticated',
    'public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb)', 'execute')
  and has_function_privilege('service_role',
    'public.begin_sbom_document_normalization_atomic(uuid,uuid,text,text,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint)', 'execute')
  and has_function_privilege('service_role',
    'public.persist_sbom_normalization_batch_atomic(uuid,uuid,text,uuid,jsonb,jsonb,jsonb,bigint)', 'execute')
);

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
  v_checkpoint record;
  v_failed record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('normalizer-state', 'sha256'), 'hex'), 'normalizer-state.json', 'application/json', 10,
    repeat('c', 64), v_org::text || '/' || v_source::text || '/' || repeat('c', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, repeat('c', 64), 10, 'application/json', v_key, gen_random_uuid()
  );
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'normalizer-state-worker', 60);
  if v_claim.outcome <> 'claimed' then
    raise exception 'normalization state test could not claim job';
  end if;
  select * into v_checkpoint from public.checkpoint_sbom_ingest_job(
    v_org, (v_job.job ->> 'id')::uuid, 'normalizer-state-worker', 'parsing', 30, 60
  );
  if v_checkpoint.outcome <> 'checkpointed' or (v_checkpoint.job #>> '{progress,stage}') <> 'parsing' then
    raise exception 'normalization parsing checkpoint was not accepted';
  end if;
  select * into v_failed from public.fail_sbom_ingest_job(
    v_org, (v_job.job ->> 'id')::uuid, 'normalizer-state-worker', 'normalization_component_limit_exceeded'
  );
  if v_failed.outcome not in ('retrying', 'dead_letter') then
    raise exception 'normalization limit error was not durably recorded';
  end if;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
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
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
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
  select * into v_finalize from public.finalize_sbom_document_normalization_atomic(
    v_org, (v_job_one.job ->> 'id')::uuid, 'normalizer-replay-worker-one', (v_begin.document ->> 'id')::uuid
  );
  if v_finalize.outcome <> 'completed' then
    raise exception 'first immutable-hash document was not completed';
  end if;

  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source_two, 'manual_upload', v_key_two,
    encode(extensions.digest('normalizer-replay-two', 'sha256'), 'hex'), 'normalizer-replay-two.json', 'application/json', 42,
    v_hash, v_org::text || '/' || v_source_two::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job_two from public.finalize_sbom_source_atomic(
    v_org, v_source_two, v_actor, null, v_hash, 42, 'application/json', v_key_two, gen_random_uuid()
  );
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'normalizer-replay-worker-two', 60);
  if v_claim.outcome <> 'claimed' or (v_claim.work ->> 'sourceId')::uuid <> v_source_two then
    raise exception 'second immutable-hash job was not claimable';
  end if;
  select * into v_begin from public.begin_sbom_document_normalization_atomic(
    v_org, (v_job_two.job ->> 'id')::uuid, 'normalizer-replay-worker-two',
    'CRA streaming SBOM parser', 'm3-test', 'CRA SBOM normalizer', 'm3-03.1',
    'cyclonedx', 'json', '1.6', v_report
  );
  if v_begin.outcome <> 'replayed'
    or (select count(*) from public.sbom_documents where organization_id = v_org and document_sha256 = v_hash and normalizer_version = 'm3-03.1') <> 1
    or (select count(*) from public.sbom_document_sources where organization_id = v_org and document_id = (v_begin.document ->> 'id')::uuid) <> 2
    or not exists(select 1 from public.sbom_ingest_jobs where organization_id = v_org and id = (v_job_two.job ->> 'id')::uuid and status = 'completed') then
    raise exception 'completed immutable-hash replay did not preserve one graph with two provenances';
  end if;
end $$;

rollback;
