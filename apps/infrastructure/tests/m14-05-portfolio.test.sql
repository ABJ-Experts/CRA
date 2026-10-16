begin;
create extension if not exists pgtap;
select plan(12);
select ok(to_regprocedure('public.get_portfolio_projection(uuid,uuid,text,jsonb)') is not null,'portfolio projection exists');
select ok(not has_function_privilege('anon','public.get_portfolio_projection(uuid,uuid,text,jsonb)','execute'),'anonymous denied');
select ok(not has_function_privilege('authenticated','public.get_portfolio_projection(uuid,uuid,text,jsonb)','execute'),'browser denied');
select ok(has_function_privilege('service_role','public.get_portfolio_projection(uuid,uuid,text,jsonb)','execute'),'service role allowed');
select ok((select provolatile='s'from pg_proc where oid='public.get_portfolio_projection(uuid,uuid,text,jsonb)'::regprocedure),'projection uses one stable read snapshot');
select ok((select proconfig @> array['search_path=public, pg_temp']from pg_proc where oid='public.get_portfolio_projection(uuid,uuid,text,jsonb)'::regprocedure),'projection pins search path');
select ok(not has_function_privilege('service_role','public.m14_05_readiness(uuid,uuid,uuid,text)','execute'),'source helpers remain private');
select is(public.get_portfolio_projection(gen_random_uuid(),gen_random_uuid(),'products','{}')->>'outcome','not_found','foreign organization concealed');
select is(public.m14_05_package_identity('pkg:npm/a@1.0?arch=x#src','1.0')->>'packageIdentity','pkg:npm/a?arch=x#src','qualifier and subpath retained');
select is(public.m14_05_package_identity('pkg:npm/a@1.0','2.0')->>'reason','versionConflict','version disagreement excluded');
select is(public.m14_05_package_identity('pkg:npm/a@1%2B2','1+2')->>'version','1+2','PURL version is decoded');
select is(public.m14_05_package_identity(null,null)->>'reason','missingPurl','CPE/name-only identity excluded');
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
create or replace function pg_temp.check(label text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-05 assertion failed: %',label;end if;raise notice 'M14-05 verified: %',label;end$$;
do $$
declare org uuid:='00000000-0000-4000-8000-0000000000ca';actor uuid;a jsonb;b jsonb;c jsonb;empty_case jsonb;j jsonb;one jsonb;rev text;first_page jsonb;second_page jsonb;detail jsonb;vulnerability uuid:=gen_random_uuid();run uuid:=gen_random_uuid();source uuid:=gen_random_uuid();source_version uuid:=gen_random_uuid();affected uuid:=gen_random_uuid();finding uuid:=gen_random_uuid();occurrence uuid:=gen_random_uuid();component uuid;assessment uuid:=gen_random_uuid();alias uuid:=gen_random_uuid();successor jsonb;pending uuid:=gen_random_uuid();operation uuid:=gen_random_uuid();target uuid:=gen_random_uuid();undofinding uuid:=gen_random_uuid();before_audit bigint;before_jobs bigint;fixture_package text:='pkg:npm/m14-05-shared-'||gen_random_uuid();
begin
 perform set_config('m14_05.fixture_package',fixture_package,true);
 select id into actor from public.users where email='owner@cra.test';
 a:=pg_temp.m14_05_seed_product(org,actor,'M14-05 rollback A');
 b:=pg_temp.m14_05_seed_product(org,actor,'M14-05 rollback B');
 c:=pg_temp.m14_05_seed_product(org,actor,'M14-05 rollback missing',false);
 perform set_config('m14_05.fixture_package','pkg:npm/m14-05-empty-fixture-'||gen_random_uuid(),true);
 perform set_config('m14_05.fixture_missing_identity_pairs','true',true);
 empty_case:=pg_temp.m14_05_seed_product(org,actor,'M14-05 rollback empty identity pairs');
 perform set_config('m14_05.fixture_missing_identity_pairs','false',true);
 perform set_config('m14_05.fixture_package',fixture_package,true);
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',empty_case->>'productId'));
 -- Six normal fixture rows plus four missing-identity rows. Removing either
 -- pre-DISTINCT NULLIF lets the coalesced join multiply these evidence rows.
 perform pg_temp.check('NULL and empty identity evidence counted exactly once',j#>>'{result,coverage,data,totalComponents}'='10');
 perform pg_temp.check('missing identity representation exclusions reconciled',
 j#>>'{result,coverage,data,excludedIdentity,missingPurl}'='3'
 and j#>>'{result,coverage,data,excludedIdentity,missingVersion}'='3'
 and j#>>'{result,coverage,data,excludedIdentity,versionConflict}'='1'
 and j#>>'{result,coverage,data,rankableComponents}'='3');

 select count(*)into before_audit from public.audit_logs;select count(*)into before_jobs from public.sbom_ingest_jobs;
 perform public.get_portfolio_projection(org,actor,'products','{}');perform public.get_portfolio_projection(org,actor,'concentration','{}');
 perform pg_temp.check('portfolio reads create no audit or background work',(select count(*)from public.audit_logs)=before_audit and(select count(*)from public.sbom_ingest_jobs)=before_jobs);
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 perform pg_temp.check('sourceful concentration succeeds',j->>'outcome'='found');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('duplicatepaths count distinct products',one->>'productCount'='2'and one->>'releaseCount'='2');
 perform pg_temp.check('different versions form distinct rows',exists(select 1 from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='2.0.0'));
 perform pg_temp.check('name-only and conflicted identity excluded',not exists(select 1 from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'='pkg:npm/m14-05-conflict'));
 perform pg_temp.check('coverage exclusions reconciled',(j#>>'{result,coverage,data,excludedIdentity,missingPurl}')::int>=2 and(j#>>'{result,coverage,data,excludedIdentity,missingVersion}')::int>=2 and(j#>>'{result,coverage,data,excludedIdentity,versionConflict}')::int>=2);
 -- Alias shares the exact raw/document lineage; it cannot inflate inventory.
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,status,upload_expires_at,verified_at,raw_object_id,correlation_id,deduplicated_from_source_id)
 select alias,org,product_id,release_id,actor,'manual_upload',gen_random_uuid(),request_digest,'alias.json',declared_media_type,declared_byte_size,declared_sha256,org||'/'||alias||'/'||declared_sha256,'verified',statement_timestamp()+interval'1 hour',statement_timestamp(),raw_object_id,gen_random_uuid(),id from public.sbom_sources where id=(a->>'sourceId')::uuid;
 insert into public.sbom_document_sources(organization_id,document_id,source_id,raw_object_id,release_id)select org,(a->>'documentId')::uuid,alias,raw_object_id,(a->>'releaseId')::uuid from public.sbom_sources where id=alias;
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',a->>'productId'));
 perform pg_temp.check('canonicaldocumentalias deduplicates inventory',j#>>'{result,coverage,data,totalComponents}'='6');
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,upload_expires_at,correlation_id,supersedes_source_id)
 select pending,org,product_id,release_id,actor,'manual_upload',gen_random_uuid(),request_digest,'pending.json',declared_media_type,declared_byte_size,declared_sha256,org||'/'||pending||'/'||declared_sha256,statement_timestamp()+interval'1 hour',gen_random_uuid(),id from public.sbom_sources where id=(a->>'sourceId')::uuid;
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',a->>'productId'));
 perform pg_temp.check('pendingreplacement cannoterase completedpredecessor',j#>>'{result,coverage,data,totalComponents}'='6');
 successor:=pg_temp.m14_05_seed_product(org,actor,'M14-05 replacement',true,false,(a->>'productId')::uuid,(a->>'releaseId')::uuid,alias);
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',a->>'productId'));
 perform pg_temp.check('eligiblecompleted successor excludes predecessorincludingalias',j#>>'{result,coverage,data,totalComponents}'='6');
 a:=a||jsonb_build_object('documentId',successor->'documentId','sourceId',successor->'sourceId');
 perform pg_temp.m14_05_seed_product(org,actor,'M14-05 independent chain',true,false,(a->>'productId')::uuid,(a->>'releaseId')::uuid);
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',a->>'productId'));
 perform pg_temp.check('independentcompletedsourcechains retained',j#>>'{result,coverage,data,totalComponents}'='12');
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 rev:=j->>'revision';
 detail:=public.get_portfolio_projection(org,actor,'detail',jsonb_build_object('expectedRevision',rev,'component',jsonb_build_object('identityDigest',public.m14_05_identity_digest(fixture_package,'1.0.0'))));
 perform pg_temp.check('detail same source revision across endpoint',detail->>'outcome'='found'and detail->>'revision'=rev and jsonb_array_length(detail#>'{result,affectedReleases,data,rows}')=2);
 first_page:=public.get_portfolio_projection(org,actor,'concentration','{"limit":1}');
 second_page:=public.get_portfolio_projection(org,actor,'concentration',jsonb_build_object('limit',1,'position',first_page->'nextPosition','expectedRevision',first_page->>'revision'));
 perform pg_temp.check('keyset tie continuation distinct',first_page#>'{result,concentration,data,rows}'<>second_page#>'{result,concentration,data,rows}');
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',c->>'productId'));
 perform pg_temp.check('missing SBOM not zero exposure',(j#>>'{result,products,data,rows,0,sbomCoverage,data,eligibleReleases}')::int=1 and(j#>>'{result,products,data,rows,0,sbomCoverage,data,coveredReleases}')::int=0 and(j#>>'{result,matchingCoverage,data,pendingReleases}')::int=1);
 perform pg_temp.check('uninitialized readiness has no counts',j#>>'{result,products,data,rows,0,readiness,state}'='not_initialized'and not(j#>'{result,products,data,rows,0,readiness}'?'data'));
 perform *from public.create_technical_file_atomic(org,actor,(a->>'productId')::uuid,gen_random_uuid());
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',a->>'productId'));
 perform pg_temp.check('initializedM7readiness remains authoritative',j#>>'{result,products,data,rows,0,readiness,state}'='available'and(j#>>'{result,products,data,rows,0,readiness,data,percent}')::numeric<100);
 perform pg_temp.check('forged product concealed',public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',gen_random_uuid()))->>'outcome'='not_found');
 perform pg_temp.check('forged entity concealed',public.get_portfolio_projection(org,actor,'products',jsonb_build_object('legalEntityId',gen_random_uuid()))->>'outcome'='not_found');
 insert into public.vulnerabilities(id,canonical_id,title)values(vulnerability,'CVE-M14-05-'||vulnerability,'Rollback finding');
 insert into public.vulnerability_feed_sync_runs(id,feed_key,run_kind,correlation_id)values(run,'osv','manual',gen_random_uuid());
 insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id)values(source,'osv','m14-05-'||source,vulnerability);
 insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload)values(source_version,source,run,repeat('a',64),'active','{}','{}');
 insert into public.vulnerability_affected_ranges(id,vulnerability_id,source_record_version_id,range_value)values(affected,vulnerability,source_version,'{}');
 insert into public.vulnerability_findings(id,organization_id,release_id,component_identity,canonical_advisory_id,vulnerability_id,source_feed_key,source_record_id,source_record_version_id,affected_range_id,match_method,comparator_name,comparator_version,evaluated_component_value,affected_range,event_sequence,confidence,confidence_table_version,confidence_explanation)values(finding,org,(a->>'releaseId')::uuid,fixture_package,'CVE-M14-05-'||vulnerability,vulnerability,'osv',source,source_version,affected,'purl_osv','m14-05-test','1','1.0.0','{}','[]',.9,'m14-05-test','Synthetic rollback-only test');
 select id into component from public.sbom_components where organization_id=org and document_id=(a->>'documentId')::uuid and document_local_ref='shared-a';
 insert into public.vulnerability_component_occurrences(id,organization_id,document_id,release_id,component_id,canonical_purl,component_identity,component_version)values(occurrence,org,(a->>'documentId')::uuid,(a->>'releaseId')::uuid,component,fixture_package||'@1.0.0',fixture_package,'1.0.0');
 insert into public.vulnerability_finding_component_occurrences(organization_id,finding_id,occurrence_id,state)values(org,finding,occurrence,'active');
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('exactcomponent finding linked once',one#>>'{findings,data,openCount}'='1'and one#>>'{findings,data,bySeverity,unknown}'='1');
 perform pg_temp.check('occurrence alone notcompletedmatching',j#>>'{result,matchingCoverage,data,evaluatedReleases}'='0');
 insert into public.vulnerability_match_jobs(organization_id,document_id,release_id,osv_promotion_sequence,mirror_captured_at,status,correlation_id,requested_by,trigger_key,completed_at,processed_component_count)
 values(org,(a->>'documentId')::uuid,(a->>'releaseId')::uuid,0,statement_timestamp(),'completed',gen_random_uuid(),actor,'m14-05-test-'||gen_random_uuid(),statement_timestamp(),6);
 j:=public.get_portfolio_projection(org,actor,'products',jsonb_build_object('productId',a->>'productId'));
 perform pg_temp.check('completedmatching currentdocument reflected explicitly',j#>>'{result,matchingCoverage,data,evaluatedReleases}'='1'and j#>>'{result,matchingCoverage,data,pendingReleases}'='0');

 insert into public.vulnerability_finding_suppressions(organization_id,finding_id,revision,reason,is_current,created_by,expires_at)values(org,finding,1,'Synthetic suppression',true,actor,statement_timestamp()+interval'1 day');
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('suppression remainsdistinctopenfinding',one#>>'{findings,data,suppressedOpenCount}'='1'and one#>>'{findings,data,openCount}'='1');
 insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by)values(assessment,org,finding,1,true,'fixed','Resolved synthetic finding','approval_not_required',false,'unknown',1,statement_timestamp(),actor,actor);
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('approvedsourceVEXclosesfindingnotreuse',one#>>'{findings,data,openCount}'='0'and one->>'productCount'='2');
 update public.vulnerability_findings set reevaluation_state='review_required'where id=finding;
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('sourceownedreviewreopensfinding',one#>>'{findings,data,openCount}'='1');
 update public.vulnerability_source_records set current_version_id=source_version where id=source;
 insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)values(vulnerability,source_version,'osv','cvss',jsonb_build_object('value',jsonb_build_object('metrics',jsonb_build_array(jsonb_build_object('cvssData',jsonb_build_object('version','3.1','baseScore',9.8,'vectorString','CVSS:3.1/AV:N')),jsonb_build_object('cvssData',jsonb_build_object('version','4.0','baseScore',4.1,'vectorString','CVSS:4.0/AV:N'))))));
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('currentpreferredCVSS4 takespriorityover3 score',one#>>'{findings,data,bySeverity,medium}'='1'and one#>>'{findings,data,bySeverity,critical}'='0');
 update public.vulnerability_findings set reevaluation_state='unchanged'where id=finding;
 insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',undofinding,'component_identity','m14-05-undo-'||undofinding))).*from public.vulnerability_findings f where f.id=finding;
 insert into public.vulnerability_finding_component_occurrences(organization_id,finding_id,occurrence_id,state)values(org,undofinding,occurrence,'active');
 insert into public.vulnerability_finding_assessment_bulk_operations(id,organization_id,created_by,operation_kind,selection_mode,submission,snapshot_digest,state,expires_at)values(operation,org,actor,'bulk','selected_rows','{}',repeat('b',64),'undone',statement_timestamp()+interval'1 hour');
 insert into public.vulnerability_finding_assessment_bulk_operation_targets(id,organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,state,applied_at,undone_at)values(target,org,operation,undofinding,1,'M14-05 rollback A','1.0.0',fixture_package,'1.0.0','undone',statement_timestamp(),statement_timestamp());
 -- Seed the bulk decision with its target from creation; decision evidence itself is immutable.
 insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by,bulk_operation_target_id)values(gen_random_uuid(),org,undofinding,1,true,'fixed','Synthetic undone resolution','approval_not_required',false,'unknown',1,statement_timestamp(),actor,actor,target);
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 select x into one from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package and x->>'version'='1.0.0';
 perform pg_temp.check('effectivebulkundo reopensfinding',one#>>'{findings,data,openCount}'='1');
 update public.products set archived_at=statement_timestamp(),archived_by=actor where id=(b->>'productId')::uuid;
 j:=public.get_portfolio_projection(org,actor,'detail',jsonb_build_object('component',jsonb_build_object('identityDigest',public.m14_05_identity_digest(fixture_package,'1.0.0'))));
 perform pg_temp.check('archive leaves single product no concentration',j->>'outcome'='not_found');
 j:=public.get_portfolio_projection(org,actor,'detail',jsonb_build_object('includeArchived',true,'component',jsonb_build_object('identityDigest',public.m14_05_identity_digest(fixture_package,'1.0.0'))));
 perform pg_temp.check('explicitarchive scope restores exact contribution',j->>'outcome'='found'and j#>>'{result,component,productCount}'='2');
 perform pg_temp.check('concurrent revision rejects prior cursor',public.get_portfolio_projection(org,actor,'concentration',jsonb_build_object('expectedRevision',rev))->>'outcome'='scope_changed');
 update public.product_releases set lifecycle='withdrawn'where id=(b->>'releaseId')::uuid;
 j:=public.get_portfolio_projection(org,actor,'concentration','{"includeArchived":true}');
 perform pg_temp.check('withdrawn excluded evenincludeArchived',not exists(select 1 from jsonb_array_elements(j#>'{result,concentration,data,rows}')x where x->>'packageIdentity'=fixture_package));
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions)values(org,'owner','{"can_view_findings":false}')on conflict(organization_id,base_role)do update set permissions=excluded.permissions;
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');
 perform pg_temp.check('findings and feeds currentoverride excluded',j#>>'{result,matchingCoverage,state}'='restricted'and j#>>'{result,feedFreshness,state}'='restricted');
 perform pg_temp.check('restricted no hiddenfindingmetadata',not(j#>'{result,matchingCoverage}'?'data')and not(j#>'{result,feedFreshness}'?'data'));
 update public.base_role_permission_overrides set permissions='{"can_view_sboms":false}'where organization_id=org and base_role='owner';
 j:=public.get_portfolio_projection(org,actor,'concentration','{}');perform pg_temp.check('componentdomain deniedbeforejoins',j->>'outcome'='found'and j#>>'{result,concentration,state}'='restricted'and not(j#>'{result,concentration}'?'data'));
 j:=public.get_portfolio_projection(org,actor,'products','{}');
 perform pg_temp.check('products independent whileSBOMdata withheld',j->>'outcome'='found'and j#>>'{result,coverage,state}'='restricted'and j#>>'{result,matchingCoverage,state}'='restricted');
 update public.users set is_active=false where id=actor;
 perform pg_temp.check('revokedactor currentaccess denied',public.get_portfolio_projection(org,actor,'products','{}')->>'outcome'='not_found');
end$$;
select * from finish();
rollback;
