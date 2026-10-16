-- Caller owns transaction. No trigger bypass, updates to unrelated data, or storage egress.
create or replace function pg_temp.m14_05_seed_product(p_org uuid,p_actor uuid,p_label text,p_sbom boolean default true,p_archived boolean default false,p_product uuid default null,p_release uuid default null,p_supersedes uuid default null)
returns jsonb language plpgsql as $$
declare product uuid:=coalesce(p_product,gen_random_uuid());release uuid:=coalesce(p_release,gen_random_uuid());raw uuid:=gen_random_uuid();source uuid:=gen_random_uuid();job uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();hash text:=md5(source::text)||md5(doc::text);done record;fixture_package text:=coalesce(nullif(current_setting('m14_05.fixture_package',true),''),'pkg:npm/m14-05-shared');
begin
 if p_product is null then
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 select product,p_org,legal_entity_id,legal_entity_version,legal_entity_snapshot,p_label,'m14-05-'||product,product_type,p_actor,p_actor,p_actor from public.products where organization_id=p_org limit 1;
 if not found then raise exception 'fixture requires an existing tenant product';end if;
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
 select release,p_org,product,legal_entity_id,legal_entity_version,legal_entity_snapshot,p_label,'1.0.0','placed_on_market',statement_timestamp(),p_actor,p_actor from public.products where id=product;
 end if;
 if p_sbom then
 insert into public.sbom_raw_objects(id,organization_id,sha256,byte_size,media_type,storage_key)values(raw,p_org,hash,2,'application/json',p_org||'/'||source||'/'||hash);
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,status,upload_expires_at,verified_at,raw_object_id,correlation_id,supersedes_source_id)
 values(source,p_org,product,release,p_actor,'manual_upload',gen_random_uuid(),hash,'m14-05.json','application/json',2,hash,p_org||'/'||source||'/'||hash,'verified',statement_timestamp()+interval'1 hour',statement_timestamp(),raw,gen_random_uuid(),p_supersedes);
 insert into public.sbom_ingest_jobs(id,organization_id,source_id,release_id,actor_user_id,correlation_id,idempotency_key,input_sha256,status,progress_stage,progress_percent,lease_owner,lease_expires_at,validation_status,validator_name,validator_version,validation_completed_at,validation_report)
 values(job,p_org,source,release,p_actor,gen_random_uuid(),gen_random_uuid(),hash,'processing','recording_evidence',50,'m14-05-fixture',statement_timestamp()+interval'1 hour','valid','m14-05-test','1',statement_timestamp(),jsonb_build_object('completedAt',public.m6_utc_second_z(statement_timestamp()),'detected',jsonb_build_object('format','cyclonedx','serialization','json','specificationVersion','1.6'),'diagnostics','[]'::jsonb,'errorCount',0,'omittedDiagnosticCount',0,'status','valid','validator',jsonb_build_object('name','m14-05-test','schemaAssetSha256',hash,'version','1'),'warningCount',0));
 insert into public.sbom_documents(id,organization_id,source_id,raw_object_id,ingest_job_id,document_sha256,format,serialization,specification_version,parser_name,parser_version,normalizer_name,normalizer_version,validation_status)
 values(doc,p_org,source,raw,job,hash,'cyclonedx','json','1.6','m14-05-test','1','m14-05-test','1','valid');
 insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,original_name,normalized_name,normalized_version,canonical_purl)
 values(p_org,doc,'shared-a',0,100,'$.components[0]','Shared','shared','1.0.0',fixture_package||'@1.0.0'),(p_org,doc,'shared-path-duplicate',1,100,'$.components[1]','Shared','shared','1.0.0',fixture_package||'@1.0.0'),(p_org,doc,'other-version',2,100,'$.components[2]','Shared','shared','2.0.0',fixture_package||'@2.0.0'),(p_org,doc,'unknown-version',3,100,'$.components[3]','Unknown','unknown',null,'pkg:npm/m14-05-unknown'),(p_org,doc,'name-only',4,100,'$.components[4]','Shared','shared','1.0.0',null),(p_org,doc,'conflicting-version',5,100,'$.components[5]','Conflicting','conflicting','2.0.0','pkg:npm/m14-05-conflict@1.0.0');
 -- Optional rollback-only identity boundary fixture: each row is source evidence,
 -- even when its missing identity representation differs between NULL and empty.
 if current_setting('m14_05.fixture_missing_identity_pairs',true)='true' then
 insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,original_name,normalized_name,normalized_version,canonical_purl)
 values(p_org,doc,'null-version-pair',6,100,'$.components[6]','Missing version','missing-version',null,'pkg:npm/m14-05-empty-pair'),
 (p_org,doc,'empty-version-pair',7,100,'$.components[7]','Missing version','missing-version','','pkg:npm/m14-05-empty-pair'),
 (p_org,doc,'null-purl-pair',8,100,'$.components[8]','Missing identity','missing-identity','1.0.0',null),
 (p_org,doc,'empty-purl-pair',9,100,'$.components[9]','Missing identity','missing-identity','1.0.0','');
 end if;
 insert into public.sbom_document_sources(organization_id,document_id,source_id,raw_object_id,release_id)values(p_org,doc,source,raw,release)on conflict do nothing;
 select *into done from public.finalize_sbom_document_normalization_atomic(p_org,job,'m14-05-fixture',doc);
 if done.outcome<>'completed'then raise exception 'fixture completion failed: %',done.outcome;end if;
 end if;
 if p_archived then update public.products set archived_at=statement_timestamp(),archived_by=p_actor where id=product;end if;
 return jsonb_build_object('productId',product,'releaseId',release,'documentId',case when p_sbom then doc else null end,'sourceId',case when p_sbom then source else null end);
end$$;
