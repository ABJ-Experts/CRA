-- The entire fixture, including the simulated worker lease, is rolled back.
-- No pre-existing source, supplier, or document ID is used.
begin;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_product uuid := gen_random_uuid();
  v_release uuid := gen_random_uuid();
  v_supplier_a uuid := gen_random_uuid();
  v_supplier_b uuid := gen_random_uuid();
  v_request_a uuid := gen_random_uuid();
  v_request_b uuid := gen_random_uuid();
  v_invitation_a uuid := gen_random_uuid();
  v_invitation_b uuid := gen_random_uuid();
  v_submission_a uuid := gen_random_uuid();
  v_submission_b uuid := gen_random_uuid();
  v_source_a uuid := gen_random_uuid();
  v_source_b uuid := gen_random_uuid();
  v_review_id uuid := gen_random_uuid();
  v_hash text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_token_a text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_token_b text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_session_a text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_session_b text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_key_a uuid := gen_random_uuid();
  v_key_b uuid := gen_random_uuid();
  v_job_id uuid;
  v_document_id uuid;
  v_result record;
  v_report jsonb := jsonb_build_object(
    'status','valid',
    'detected',jsonb_build_object('format','cyclonedx','serialization','json','specificationVersion','1.6'),
    'validator',jsonb_build_object('name','CRA streaming SBOM normalizer','version','m9-06-test','schemaAssetSha256',repeat('a',64)),
    'diagnostics','[]'::jsonb,'errorCount',0,'warningCount',0,
    'omittedDiagnosticCount',0,'completedAt','2026-09-23T00:00:00.000Z');
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_entity from public.organization_legal_entities
   where organization_id=v_org and is_default;
  if v_actor is null or v_entity is null then
    raise exception 'local seeded owner and legal entity are required';
  end if;
  insert into public.supplier_organizations(id,organization_id,name,created_by,updated_by)
  values(v_supplier_a,v_org,'M9-06 supplier A '||left(v_supplier_a::text,8),v_actor,v_actor),
        (v_supplier_b,v_org,'M9-06 supplier B '||left(v_supplier_b::text,8),v_actor,v_actor);
  insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,
    legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
  values(v_product,v_org,v_entity,0,'{}'::jsonb,'M9-06 alias product',
    'M906-'||v_product::text,'standalone_software',v_actor,v_actor,v_actor);
  insert into public.product_releases(id,organization_id,product_id,legal_entity_id,
    legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,created_by,updated_by)
  values(v_release,v_org,v_product,v_entity,0,'{}'::jsonb,'M9-06 alias release',
    '1.0-'||v_release::text,'development',v_actor,v_actor);
  insert into public.sbom_supplier_requests(id,organization_id,product_id,release_id,
    supplier_display_name,allowed_component_ref,status,expires_at,idempotency_key,
    request_digest,created_by,supplier_id)
  values(v_request_a,v_org,v_product,v_release,'Supplier A','pkg:npm/m906-alias@1.0.0',
    'open',now()+interval '1 day',gen_random_uuid(),repeat('a',64),v_actor,v_supplier_a),
    (v_request_b,v_org,v_product,v_release,'Supplier B','pkg:npm/m906-alias@1.0.0',
    'open',now()+interval '1 day',gen_random_uuid(),repeat('b',64),v_actor,v_supplier_b);

  select * into v_result from public.create_supplier_sbom_invitation_atomic(
    v_org,v_actor,v_request_a,v_invitation_a,v_token_a,now()+interval '1 day',
    gen_random_uuid(),repeat('c',64),gen_random_uuid());
  if v_result.outcome<>'created' then raise exception 'supplier A invitation: %',v_result.outcome; end if;
  select * into v_result from public.create_supplier_sbom_invitation_atomic(
    v_org,v_actor,v_request_b,v_invitation_b,v_token_b,now()+interval '1 day',
    gen_random_uuid(),repeat('d',64),gen_random_uuid());
  if v_result.outcome<>'created' then raise exception 'supplier B invitation: %',v_result.outcome; end if;
  select * into v_result from public.consume_supplier_sbom_invitation_atomic(
    v_token_a,v_session_a,now()+interval '25 minutes');
  if v_result.outcome<>'created' then raise exception 'supplier A session: %',v_result.outcome; end if;
  select * into v_result from public.consume_supplier_sbom_invitation_atomic(
    v_token_b,v_session_b,now()+interval '25 minutes');
  if v_result.outcome<>'created' then raise exception 'supplier B session: %',v_result.outcome; end if;

  select * into v_result from public.reserve_supplier_sbom_submission_atomic(
    v_session_a,v_submission_a,v_source_a,v_key_a,repeat('e',64),'supplier-a.json',
    'application/json',256,v_hash,gen_random_uuid(),'cyclonedx','1.6');
  if v_result.outcome<>'created' then raise exception 'supplier A reserve: %',v_result.outcome; end if;
  select * into v_result from public.finalize_supplier_sbom_submission_atomic(
    v_session_a,v_source_a,v_key_a,v_hash,256,'application/json',gen_random_uuid());
  if v_result.outcome<>'queued' then raise exception 'supplier A finalize: %',v_result.outcome; end if;
  v_job_id:=(v_result.job->>'id')::uuid;

  -- Claim only this transaction's own job. This avoids touching unrelated
  -- queued jobs in a developer's local stack while exercising normalizer RPCs.
  update public.sbom_ingest_jobs set status='processing',progress_stage='verifying_original',
    progress_percent=1,lease_owner='m906-alias-test',
    lease_expires_at=now()+interval '1 minute',attempt_count=attempt_count+1
    where organization_id=v_org and id=v_job_id and source_id=v_source_a and status='queued';
  if not found then raise exception 'canonical job was not queued'; end if;
  select * into v_result from public.begin_sbom_document_normalization_atomic(
    v_org,v_job_id,'m906-alias-test','CRA streaming SBOM parser','m9-06-test',
    'CRA SBOM normalizer','m9-06-test','cyclonedx','json','1.6',v_report);
  if v_result.outcome<>'created' then raise exception 'normalization begin: %',v_result.outcome; end if;
  v_document_id:=(v_result.document->>'id')::uuid;
  insert into public.sbom_components(organization_id,document_id,document_local_ref,
    source_offset,source_byte_end,source_path,source_line,original_name,normalized_name,
    original_version,normalized_version,original_purl,canonical_purl,hashes)
  values(v_org,v_document_id,'component-a',1,80,'$.components[0]',1,'M9-06 alias',
    'm9-06 alias','1.0.0','1.0.0','pkg:npm/m906-alias@1.0.0',
    'pkg:npm/m906-alias@1.0.0','[]'::jsonb);
  select * into v_result from public.finalize_sbom_document_normalization_atomic(
    v_org,v_job_id,'m906-alias-test',v_document_id);
  if v_result.outcome<>'completed' then raise exception 'normalization finalize: %',v_result.outcome; end if;
  if (select status from public.sbom_supplier_submissions where id=v_submission_a)<>'awaiting_review'
  then raise exception 'canonical supplier did not reach review'; end if;

  select * into v_result from public.reserve_supplier_sbom_submission_atomic(
    v_session_b,v_submission_b,v_source_b,v_key_b,repeat('f',64),'supplier-b.json',
    'application/json',256,v_hash,gen_random_uuid(),'cyclonedx','1.6');
  if v_result.outcome<>'created' then raise exception 'supplier B reserve: %',v_result.outcome; end if;
  select * into v_result from public.finalize_supplier_sbom_submission_atomic(
    v_session_b,v_source_b,v_key_b,v_hash,256,'application/json',gen_random_uuid());
  if v_result.outcome<>'deduplicated' then raise exception 'supplier B did not deduplicate: %',v_result.outcome; end if;
  if (select status from public.sbom_supplier_submissions where id=v_submission_b)<>'awaiting_review'
    or not exists(select 1 from public.sbom_document_sources
      where organization_id=v_org and document_id=v_document_id and source_id=v_source_b)
    or (select deduplicated_from_source_id from public.sbom_sources where id=v_source_b)<>v_source_a
  then raise exception 'completed alias did not retain terminal review state and document edge'; end if;
  if (select count(distinct supplier_id) from public.sbom_supplier_requests
      where id in (v_request_a,v_request_b))<>2
    or (select count(distinct declared_sha256) from public.sbom_sources
      where id in (v_source_a,v_source_b))<>1
  then raise exception 'different suppliers or identical-byte identity were lost'; end if;

  select * into v_result from public.validate_sbom_composite_scope(
    v_org,v_actor,v_product,v_release,jsonb_build_array(v_source_b));
  if v_result.outcome<>'conflict' then raise exception 'unreviewed alias entered composite: %',v_result.outcome; end if;
  select * into v_result from public.review_supplier_sbom_submission_atomic(
    v_org,v_actor,v_submission_a,'accept','Supplier source reviewed',gen_random_uuid(),gen_random_uuid());
  if v_result.outcome<>'accepted' then raise exception 'canonical review: %',v_result.outcome; end if;
  select * into v_result from public.review_supplier_sbom_submission_atomic(
    v_org,v_actor,v_submission_b,'accept','Supplier source reviewed',gen_random_uuid(),gen_random_uuid());
  if v_result.outcome<>'accepted' then raise exception 'alias review: %',v_result.outcome; end if;
  select * into v_result from public.validate_sbom_composite_scope(
    v_org,v_actor,v_product,v_release,jsonb_build_array(v_source_b));
  if v_result.outcome<>'compatible' then raise exception 'accepted alias is not composite compatible: %',v_result.outcome; end if;
  select * into v_result from public.create_sbom_composite_review_atomic(
    v_org,v_actor,v_review_id,v_product,v_release,'m9-06-test',repeat('0',64),
    jsonb_build_array(jsonb_build_object('sourceId',v_source_b)),gen_random_uuid());
  if v_result.outcome<>'created' then raise exception 'composite create: %',v_result.outcome; end if;
  if not exists(select 1 from public.sbom_composite_review_inputs
      where organization_id=v_org and review_id=v_review_id and source_id=v_source_b
        and document_id=v_document_id and supplier_submission_id=v_submission_b)
    or not exists(select 1 from public.sbom_composite_component_provenance
      where organization_id=v_org and review_id=v_review_id and source_id=v_source_b
        and source_document_id=v_document_id and supplier_submission_id=v_submission_b)
    or exists(select 1 from public.sbom_composite_review_inputs
      where organization_id=v_org and review_id=v_review_id and source_id=v_source_a)
  then raise exception 'alias source/submission composite provenance was lost or replaced by canonical source'; end if;
end $$;

rollback;
