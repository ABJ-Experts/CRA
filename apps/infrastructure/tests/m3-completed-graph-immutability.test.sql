-- Completed graph guards: transaction-local fixtures; no retained data is modified.
begin;
do $$ begin
  if exists(select 1 from (values ('sbom_documents'),('sbom_document_sources'),
    ('sbom_components'),('sbom_component_identities'),('sbom_component_dependencies'),
    ('sbom_raw_objects'),('sbom_sources')) tables(name)
    where has_table_privilege('service_role','public.'||name,'TRUNCATE')
      or has_table_privilege('service_role','public.'||name,'TRIGGER')
      or has_table_privilege('service_role','public.'||name,'REFERENCES')) then
    raise exception 'Service-role graph ACL permits bypassing retained row guards';
  end if;
end $$;
create function pg_temp.expect_immutable(p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when sqlstate '55000' then return; end;
  raise exception 'completed graph change was accepted: %', p_sql;
end $$;
set local role service_role;
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
  v_document uuid;
  v_component uuid;
  v_staging_document uuid := gen_random_uuid();
  v_staging_component uuid := gen_random_uuid();
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
  select * into v_finalize from public.finalize_sbom_document_normalization_atomic(
    v_org, (v_job_one.job ->> 'id')::uuid, 'normalizer-replay-worker-one', (v_begin.document ->> 'id')::uuid
  );
  if v_finalize.outcome <> 'completed' then
    raise exception 'first immutable-hash document was not completed';
  end if;

  -- The legacy lineage worker may materialize a deterministic secondary index;
  -- it cannot replace original identity evidence or forge the projection.
  perform * from public.ensure_sbom_component_diff_identities_atomic(v_org,v_document,100);
  if not exists(select 1 from public.sbom_component_identities where organization_id=v_org
    and document_id=v_document and component_id=v_component and identity_type='purl_package'
    and original_value='pkg:npm/one@1.0.0' and canonical_value='pkg:npm/one') then
    raise exception 'Legacy deterministic package lookup was not materialized';
  end if;
  perform pg_temp.expect_immutable(format('insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value) values(%L,%L,%L,%L,%L,%L)',v_org,v_document,v_component,'purl_package','pkg:npm/tampered@1.0.0','pkg:npm/tampered'));
  -- A new parser/normalizer version stages independently; it cannot rewrite
  -- or steal rows from a previously published version.
  insert into public.sbom_documents
    select (jsonb_populate_record(null::public.sbom_documents,to_jsonb(d)||jsonb_build_object(
      'id',v_staging_document,'normalizer_version','m3-03.2-fixture','state','processing',
      'progress_stage','parsing','completed_at',null))).*
    from public.sbom_documents d where d.id=v_document;
  insert into public.sbom_components(id,organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,original_name,normalized_name)
    values(v_staging_component,v_org,v_staging_document,'staging',1,41,'$.components[0]','Staging','staging');
  perform pg_temp.expect_immutable(format('update public.sbom_components set document_id=%L where id=%L',v_staging_document,v_component));
  perform pg_temp.expect_immutable(format('update public.sbom_components set document_id=%L where id=%L',v_document,v_staging_component));
  delete from public.sbom_components where id=v_staging_component;
  delete from public.sbom_documents where id=v_staging_document;

  -- Service-role RLS bypass does not bypass immutable retained evidence.
  perform pg_temp.expect_immutable(format('update public.sbom_documents set parser_version=%L where id=%L','tampered',v_document));
  perform pg_temp.expect_immutable(format('delete from public.sbom_documents where id=%L',v_document));
  perform pg_temp.expect_immutable(format('update public.sbom_components set normalized_name=%L where document_id=%L','tampered',v_document));
  perform pg_temp.expect_immutable(format('delete from public.sbom_components where document_id=%L',v_document));
  perform pg_temp.expect_immutable(format('update public.sbom_component_identities set canonical_value=%L where document_id=%L','tampered',v_document));
  perform pg_temp.expect_immutable(format('delete from public.sbom_component_identities where document_id=%L',v_document));
  perform pg_temp.expect_immutable(format('update public.sbom_component_dependencies set child_reference=%L where document_id=%L','tampered',v_document));
  perform pg_temp.expect_immutable(format('delete from public.sbom_component_dependencies where document_id=%L',v_document));
  perform pg_temp.expect_immutable(format('insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_path,original_name,normalized_name) values(%L,%L,%L,1,%L,%L,%L)',v_org,v_document,'extra','$.components[1]','Extra','extra'));
  perform pg_temp.expect_immutable(format('insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value) values(%L,%L,%L,%L,%L)',v_org,v_document,v_component,'other','extra'));
  perform pg_temp.expect_immutable(format('insert into public.sbom_component_dependencies(organization_id,document_id,parent_reference,child_reference,source_offset,source_path) values(%L,%L,%L,%L,1,%L)',v_org,v_document,'pkg:one','extra','$.dependencies'));
end $$;
reset role;
rollback;
