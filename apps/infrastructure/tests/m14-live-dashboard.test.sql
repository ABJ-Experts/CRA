begin;
create extension if not exists pgtap;
select plan(8);
select ok(to_regprocedure('public.get_dashboard_projection(uuid,uuid,text,jsonb)') is not null,'private dashboard facade exists');
select ok(to_regprocedure('public.m5_finding_is_open(uuid,uuid)') is not null,'pure shared open predicate exists');
select is(public.get_dashboard_projection(gen_random_uuid(),gen_random_uuid(),'overview','{}')->>'outcome','not_found','foreign identity cannot read dashboard');
select ok(not has_function_privilege('authenticated','public.get_dashboard_projection(uuid,uuid,text,jsonb)','execute'),'browser cannot bypass dashboard authorization');
select ok(has_function_privilege('service_role','public.get_dashboard_projection(uuid,uuid,text,jsonb)','execute'),'service role may call facade');
select ok((select provolatile='s' from pg_proc where oid='public.get_dashboard_projection(uuid,uuid,text,jsonb)'::regprocedure),'dashboard facade is stable read');
select ok((select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_dashboard_projection(uuid,uuid,text,jsonb)'::regprocedure),'facade pins search path');
select is(public.m5_finding_is_open(gen_random_uuid(),gen_random_uuid()),false,'unknown finding is never open');
create temporary table m14_test_scope(org uuid,actor uuid,product uuid,release uuid,finding uuid);
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14 check failed: %',name;end if;raise notice 'M14 verified: %',name;end $$;
do $$begin perform pg_temp.check('private observation severity helper exists',to_regprocedure('public.m5_triage_observation_severity(uuid,timestamp with time zone)')is not null);perform pg_temp.check('measured open projection covering index exists',to_regclass('public.vulnerability_findings_dashboard_open_cover_idx')is not null);perform pg_temp.check('overview and product query branches avoid optional OR selectivity',(select prosrc !~* 'p_product[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+r[.]product_id[[:space:]]*=[[:space:]]*p_product'from pg_proc where oid='public.m5_dashboard_findings(uuid,uuid,uuid)'::regprocedure));end$$;
do $$
declare org uuid:='00000000-0000-4000-8000-0000000000ca'; actor uuid; finding uuid:='00000000-0000-4000-8000-0000000014ff'; a uuid:=gen_random_uuid(); f public.vulnerability_findings; product uuid:=gen_random_uuid();release uuid:=gen_random_uuid(); vulnerability uuid:=gen_random_uuid();run uuid:=gen_random_uuid();source uuid:=gen_random_uuid();source_version uuid:=gen_random_uuid();affected uuid:=gen_random_uuid(); j jsonb; before_state jsonb; after_state jsonb;
begin
 select id into actor from public.users where email='owner@cra.test';
 perform pg_temp.check('seed owner exists',actor is not null);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 select product,org,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 synthetic product','m14-'||product,product_type,actor,actor,actor from public.products where organization_id=org limit 1;
 perform pg_temp.check('own synthetic product exists',exists(select 1 from public.products where id=product));
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
 select release,org,product,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 release','m14-'||release,'end_of_support',statement_timestamp(),actor,actor from public.products where id=product;
 insert into m14_test_scope values(org,actor,product,release,finding);
 insert into public.vulnerabilities(id,canonical_id,title)values(vulnerability,'CVE-M14-'||vulnerability,'Synthetic M14 source');
 insert into public.vulnerability_feed_sync_runs(id,feed_key,run_kind,correlation_id)values(run,'osv','manual',gen_random_uuid());
 insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id)values(source,'osv','m14-'||source,vulnerability);
 insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload)values(source_version,source,run,repeat('a',64),'active','{}','{}');
 insert into public.vulnerability_affected_ranges(id,vulnerability_id,source_record_version_id,range_value)values(affected,vulnerability,source_version,'{}');
 insert into public.vulnerability_findings(id,organization_id,release_id,component_identity,canonical_advisory_id,vulnerability_id,source_feed_key,source_record_id,source_record_version_id,affected_range_id,match_method,comparator_name,comparator_version,evaluated_component_value,affected_range,event_sequence,confidence,confidence_table_version,confidence_explanation)values(finding,org,release,'m14-test-'||finding,'CVE-M14-'||vulnerability,vulnerability,'osv',source,source_version,affected,'purl_osv','m14-test','1','1','{}','[]',.9,'m14-test','Synthetic rollback-only test');
 perform pg_temp.check('unassessed finding open',public.m5_finding_is_open(org,finding));
 insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by)values(a,org,finding,1,true,'fixed','Resolved synthetic finding','approval_not_required',false,'unknown',1,statement_timestamp(),actor,actor);
 perform pg_temp.check('effective exemption resolved',not public.m5_finding_is_open(org,finding));
 update public.vulnerability_findings set reevaluation_state='review_required'where id=finding;
 perform pg_temp.check('renewed review reopens',public.m5_finding_is_open(org,finding));
 insert into public.vulnerability_finding_suppressions(organization_id,finding_id,revision,reason,is_current,created_by,expires_at)values(org,finding,1,'Synthetic suppression',true,actor,statement_timestamp()+interval '1 day');
 perform pg_temp.check('suppression remains open',public.m5_finding_is_open(org,finding));
 perform pg_temp.check('foreign tenant cannot see finding',not public.m5_finding_is_open(gen_random_uuid(),finding));
 j:=public.get_dashboard_projection(org,actor,'overview','{}');
 perform pg_temp.check('source sections available',j#>>'{result,products,state}'='available' and j#>>'{result,findings,state}'='available');
 perform pg_temp.check('summary includes suppression',(j#>>'{result,findings,data,suppressedOpenCount}')::integer>=1);
 perform pg_temp.check('safe feeds exclude provider config',not exists(select 1 from jsonb_array_elements(j#>'{result,feedFreshness,data}')i where i ? 'lastFailureReason' or i ? 'scheduleIntervalSeconds' or i ? 'currentRun'));
 update public.vulnerability_feed_configs set enabled=true,sync_state='syncing'where feed_key='osv';
 j:=public.m4_dashboard_feed_freshness(org,actor);
 perform pg_temp.check('safe feed status preserves native syncing state',exists(select 1 from jsonb_array_elements(j->'data')i where i->>'feedKey'='osv'and i->>'status'='syncing'));
 before_state:=jsonb_build_object('audit',(select count(*)from public.audit_logs),'alerts',(select count(*)from public.reporting_deadline_alerts),'findings',(select jsonb_agg(to_jsonb(x)order by id)from public.vulnerability_findings x where x.organization_id=org),'jobs',(select count(*)from public.sbom_ingest_jobs),'triage',(select jsonb_agg(to_jsonb(x)order by finding_id)from public.vulnerability_finding_triage_states x where x.organization_id=org),'assessments',(select count(*)from public.vulnerability_finding_assessments),'events',(select count(*)from public.reporting_obligation_events));
 perform public.get_dashboard_projection(org,actor,'overview','{}');
 after_state:=jsonb_build_object('audit',(select count(*)from public.audit_logs),'alerts',(select count(*)from public.reporting_deadline_alerts),'findings',(select jsonb_agg(to_jsonb(x)order by id)from public.vulnerability_findings x where x.organization_id=org),'jobs',(select count(*)from public.sbom_ingest_jobs),'triage',(select jsonb_agg(to_jsonb(x)order by finding_id)from public.vulnerability_finding_triage_states x where x.organization_id=org),'assessments',(select count(*)from public.vulnerability_finding_assessments),'events',(select count(*)from public.reporting_obligation_events));
 perform pg_temp.check('read does not alter evidence or work queues',before_state=after_state);
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions)values(org,'owner','{"can_view_findings":false}')on conflict(organization_id,base_role)do update set permissions=excluded.permissions;
 j:=public.get_dashboard_projection(org,actor,'overview','{}');
 perform pg_temp.check('findings hard override withholds data',j#>>'{result,findings,state}'='restricted'and not(j#>'{result,findings}'?'data'));
 perform pg_temp.check('feed freshness hard override',j#>>'{result,feedFreshness,state}'='restricted');
 perform pg_temp.check('unrelated healthy section survives',j#>>'{result,products,state}'='available');
 perform pg_temp.check('forged product indistinguishable',public.get_dashboard_projection(org,actor,'posture',jsonb_build_object('productId',gen_random_uuid()))->>'outcome'='not_found');
end $$;
do $$
declare s record;r record;j jsonb;obligation uuid;stage uuid; rehearsal uuid;
begin
 select *into s from m14_test_scope;
 update public.base_role_permission_overrides set permissions='{}'where organization_id=s.org and base_role='owner';
 select *into r from public.create_reporting_obligation_atomic(s.org,s.actor,'actively_exploited_vulnerability',s.finding,statement_timestamp()-interval'4 days','Synthetic rollback-only awareness',gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('real reporting obligation created',r.outcome='created');obligation:=(r.result#>>'{obligation,id}')::uuid;
 update public.reporting_obligation_stages set state='overdue',overdue_at=due_at where obligation_id=obligation and state='running'and due_at<statement_timestamp();
 select *into r from public.create_reporting_rehearsal_atomic(s.org,s.actor,'severe_incident',statement_timestamp()-interval'4 days','Synthetic rehearsal',gen_random_uuid(),gen_random_uuid());rehearsal:=(r.result#>>'{obligation,id}')::uuid;
 j:=public.m6_dashboard_obligations(s.org,s.actor,jsonb_build_object('productId',s.product,'limit',100));
 perform pg_temp.check('stored overdue first',j#>>'{section,data,rows,0,state}'='overdue');
 perform pg_temp.check('pending anchor never invents deadline',exists(select 1 from jsonb_array_elements(j#>'{section,data,rows}')i where i->>'state'='pending_anchor'and i->>'dueAt'is null and i->>'elapsedPercent'is null));
 perform pg_temp.check('rehearsals excluded',not exists(select 1 from jsonb_array_elements((public.m6_dashboard_obligations(s.org,s.actor,'{"limit":100}'))#>'{section,data,rows}')i where i->>'obligationId'=rehearsal::text));
 select id into stage from public.reporting_obligation_stages where obligation_id=obligation and state='overdue'order by due_at limit 1;
 update public.reporting_obligation_stages set state='submitted',submitted_at=statement_timestamp(),submission_reference='M14 late submission'where id=stage;
 j:=public.m6_dashboard_obligations(s.org,s.actor,jsonb_build_object('productId',s.product,'limit',100,'state','history'));
 perform pg_temp.check('late submission retains breach',exists(select 1 from jsonb_array_elements(j#>'{section,data,rows}')i where i->>'stageId'=stage::text and i->>'state'='submitted'and i->>'breachedAt'is not null));
 j:=public.m6_dashboard_obligations(s.org,s.actor,jsonb_build_object('productId',s.product,'limit',100));
 perform pg_temp.check('submitted stage does not count down',not exists(select 1 from jsonb_array_elements(j#>'{section,data,rows}')i where i->>'stageId'=stage::text));
 update public.products set archived_at=statement_timestamp(),archived_by=s.actor where id=s.product;
 j:=public.m6_dashboard_obligations(s.org,s.actor,jsonb_build_object('productId',s.product,'limit',100));
 perform pg_temp.check('active archived product obligations remain visible',jsonb_array_length(j#>'{section,data,rows}')>0);
 update public.products set archived_at=null,archived_by=null where id=s.product;
 update public.reporting_obligations set status='cancelled',cancelled_at=statement_timestamp(),cancelled_by_user_id=s.actor,cancellation_reason='Synthetic cancellation'where id=obligation;
 j:=public.m6_dashboard_obligations(s.org,s.actor,jsonb_build_object('productId',s.product,'limit',100));
 perform pg_temp.check('cancelled obligation does not count down',jsonb_array_length(j#>'{section,data,rows}')=0);
end$$;

do $$
declare s record;second_release uuid:=gen_random_uuid();raw uuid:=gen_random_uuid();canonical uuid:=gen_random_uuid();alias uuid:=gen_random_uuid();pending uuid:=gen_random_uuid();job uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();j jsonb;r record;section uuid;
begin
 select *into s from m14_test_scope;
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
 select second_release,s.org,s.product,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 alias release','m14-'||second_release,'placed_on_market',statement_timestamp(),s.actor,s.actor from public.products where id=s.product;
 j:=public.m3_dashboard_coverage(s.org,s.actor,s.product);
 perform pg_temp.check('uncovered market releases explicit denominator',(j#>>'{data,eligibleReleases}')::integer=2 and(j#>>'{data,coveredReleases}')::integer=0);
 insert into public.sbom_raw_objects(id,organization_id,sha256,byte_size,media_type,storage_key)values(raw,s.org,repeat('c',64),2,'application/json',s.org||'/'||canonical||'/'||repeat('c',64));
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,status,upload_expires_at,verified_at,raw_object_id,correlation_id)
 values(canonical,s.org,s.product,s.release,s.actor,'manual_upload',gen_random_uuid(),repeat('d',64),'fixture.json','application/json',2,repeat('c',64),s.org||'/'||canonical||'/'||repeat('c',64),'verified',statement_timestamp()+interval'1 hour',statement_timestamp(),raw,gen_random_uuid());
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,status,upload_expires_at,verified_at,raw_object_id,correlation_id,deduplicated_from_source_id)
 values(alias,s.org,s.product,s.release,s.actor,'manual_upload',gen_random_uuid(),repeat('e',64),'alias.json','application/json',2,repeat('c',64),s.org||'/'||alias||'/'||repeat('c',64),'verified',statement_timestamp()+interval'1 hour',statement_timestamp(),raw,gen_random_uuid(),canonical);
 insert into public.sbom_ingest_jobs(id,organization_id,source_id,release_id,actor_user_id,correlation_id,idempotency_key,input_sha256,status,progress_stage,progress_percent,completed_at,validation_status,validator_name,validator_version,validation_completed_at,validation_report)
 values(job,s.org,canonical,s.release,s.actor,gen_random_uuid(),gen_random_uuid(),repeat('c',64),'completed','completed',100,statement_timestamp(),'valid_with_warnings','m14-test','1',statement_timestamp(),jsonb_build_object('completedAt',public.m6_utc_second_z(statement_timestamp()),'detected',jsonb_build_object('format','cyclonedx','serialization','json','specificationVersion','1.6'),'diagnostics','[]'::jsonb,'errorCount',0,'omittedDiagnosticCount',0,'status','valid_with_warnings','validator',jsonb_build_object('name','m14-test','schemaAssetSha256',repeat('a',64),'version','1'),'warningCount',1));
 insert into public.sbom_documents(id,organization_id,source_id,raw_object_id,ingest_job_id,document_sha256,format,serialization,specification_version,parser_name,parser_version,normalizer_name,normalizer_version,validation_status,state,progress_stage,completed_at,warning_count)
 values(doc,s.org,canonical,raw,job,repeat('c',64),'cyclonedx','json','1.6','m14-test','1','m14-test','1','valid_with_warnings','completed','completed',statement_timestamp(),1);
 insert into public.sbom_document_sources(organization_id,document_id,source_id,raw_object_id,release_id)values(s.org,doc,canonical,raw,s.release),(s.org,doc,alias,raw,s.release)on conflict do nothing;
 j:=public.m3_dashboard_coverage(s.org,s.actor,s.product);
 perform pg_temp.check('canonical aliases deduplicate exact release',(j#>>'{data,coveredReleases}')::integer=1 and(j#>>'{data,eligibleReleases}')::integer=2 and(j#>>'{data,percent}')::numeric=50);
 insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,upload_expires_at,correlation_id,supersedes_source_id)
 values(pending,s.org,s.product,s.release,s.actor,'manual_upload',gen_random_uuid(),repeat('f',64),'replacement.json','application/json',2,repeat('f',64),s.org||'/'||pending||'/'||repeat('f',64),statement_timestamp()+interval'1 hour',gen_random_uuid(),canonical);
 j:=public.m3_dashboard_coverage(s.org,s.actor,s.product);
 perform pg_temp.check('pending replacement preserves valid predecessor',(j#>>'{data,coveredReleases}')::integer=1);
 update public.product_releases set lifecycle='withdrawn'where id=second_release;
 j:=public.m3_dashboard_coverage(s.org,s.actor,s.product);
 perform pg_temp.check('withdrawn release excluded',(j#>>'{data,eligibleReleases}')::integer=1 and(j#>>'{data,coveredReleases}')::integer=1);
 j:=public.m7_dashboard_readiness(s.org,s.actor,jsonb_build_object('productId',s.product));
 perform pg_temp.check('missing file withholds counts per product',j#>>'{section,data,rows,0,state}'='not_initialized'and not(j#>'{section,data,rows,0}'?'percent'));
 select *into r from public.create_technical_file_atomic(s.org,s.actor,s.product,gen_random_uuid());
 perform pg_temp.check('synthetic file created',r.outcome in ('created','existing'));
 j:=public.m7_dashboard_readiness(s.org,s.actor,jsonb_build_object('productId',s.product));
 perform pg_temp.check('incomplete file never green100',j#>>'{section,data,rows,0,status}'<>'complete'and(j#>>'{section,data,rows,0,percent}')::numeric<100);
 select sect.id into section from public.technical_file_sections sect join public.technical_files f on f.id=sect.technical_file_id and f.organization_id=s.org where sect.organization_id=s.org and f.product_id=s.product and sect.section_key='release_sbom';
 insert into public.technical_file_section_sources(organization_id,section_id,source_kind,record_id,observed_revision,title)values(s.org,section,'sbom_document',doc,repeat('c',64),'Synthetic SBOM');
 update public.base_role_permission_overrides set permissions='{"can_view_sboms":false}'where organization_id=s.org and base_role='owner';
 j:=public.m7_dashboard_readiness(s.org,s.actor,jsonb_build_object('productId',s.product));
 perform pg_temp.check('hidden linked source withholds per-product progress',j#>>'{section,data,rows,0,state}'='restricted'and not(j#>'{section,data,rows,0}'?'completeSections'));
 perform pg_temp.check('foreign source helper denies',not public.m7_dashboard_source_can(gen_random_uuid(),s.actor,s.product,'sbom_document',doc));
 update public.base_role_permission_overrides set permissions='{}'where organization_id=s.org and base_role='owner';
 update public.technical_file_sections set applicability='not_applicable',non_applicability_reason='Synthetic no applicable sections'where technical_file_id=(select id from public.technical_files where organization_id=s.org and product_id=s.product and status='active');
 j:=public.m7_dashboard_readiness(s.org,s.actor,jsonb_build_object('productId',s.product));
 perform pg_temp.check('zero applicable sections never green100',j#>>'{section,data,rows,0,status}'='empty'and j#>>'{section,data,rows,0,percent}'is null);
end$$;

do $$
declare s record;f public.vulnerability_findings;undone_finding uuid:='00000000-0000-4000-8000-0000000014a1';assessment uuid:=gen_random_uuid();operation uuid:=gen_random_uuid();target uuid:=gen_random_uuid();j jsonb;
begin
 select *into s from m14_test_scope;select *into f from public.vulnerability_findings where id=s.finding;
 insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',undone_finding,'component_identity','m14-undo-'||undone_finding,'reevaluation_state','unchanged'))).*;
 insert into public.vulnerability_finding_assessment_bulk_operations(id,organization_id,created_by,operation_kind,selection_mode,submission,snapshot_digest,state,expires_at)values(operation,s.org,s.actor,'bulk','selected_rows','{}',repeat('b',64),'undone',statement_timestamp()+interval'1 hour');
 insert into public.vulnerability_finding_assessment_bulk_operation_targets(id,organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,state,applied_at,undone_at)values(target,s.org,operation,undone_finding,1,'M14 synthetic product','M14 release','m14-undo-'||undone_finding,'1','undone',statement_timestamp(),statement_timestamp());
 insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by,bulk_operation_target_id)values(assessment,s.org,undone_finding,1,true,'fixed','Synthetic undone resolution','approval_not_required',false,'unknown',1,statement_timestamp(),s.actor,s.actor,target);
 perform pg_temp.check('undone first assessment is absent',public.m5_bulk_effective_assessment_id(s.org,undone_finding)is null);
 perform pg_temp.check('undone resolution reopens finding',public.m5_finding_is_open(s.org,undone_finding));
 j:=public.m5_dashboard_findings(s.org,s.actor,s.product);
 perform pg_temp.check('set-based projection includes undone and renewed findings',(j#>>'{data,openCount}')::integer=2);
 select result into j from public.list_finding_triage_queue_raw(s.org,s.actor,jsonb_build_object('openOnly',true,'productIds',jsonb_build_array(s.product)),100,null,null,null);
 perform pg_temp.check('open drilldown includes effective undone finding',exists(select 1 from jsonb_array_elements(j->'rows')i where i#>>'{finding,id}'=undone_finding::text));
 select result into j from public.list_finding_triage_queue_raw(s.org,s.actor,jsonb_build_object('openOnly',true,'productIds',jsonb_build_array(s.product),'vexStatuses',jsonb_build_array('fixed')),100,null,null,null);
 perform pg_temp.check('open drilldown VEX filter uses effective undo identity',not exists(select 1 from jsonb_array_elements(j->'rows')i where i#>>'{finding,id}'=undone_finding::text));
 select result into j from public.list_finding_triage_queue(s.org,s.actor,jsonb_build_object('openOnly',true,'productIds',jsonb_build_array(s.product),'vexStatuses',jsonb_build_array('fixed')),1,null,'firstDetectedAt','asc');
 perform pg_temp.check('effective VEX filter precedes public queue limit',jsonb_array_length(j->'rows')=1 and j#>>'{rows,0,finding,id}'=s.finding::text);
 perform pg_temp.check('pending and rejected resolutions remain open',public.m5_finding_open_policy('active',null,null,'unchanged','fixed','awaiting_approval')and public.m5_finding_open_policy('active',null,null,'unchanged','not_affected','rejected'));
 perform pg_temp.check('approved resolutions close unless review renewed',not public.m5_finding_open_policy('active',null,null,'unchanged','fixed','approved')and public.m5_finding_open_policy('active',null,null,'review_required','fixed','approved'));
 perform pg_temp.check('closed and superseded findings excluded',not public.m5_finding_open_policy('active',statement_timestamp(),null,'unchanged',null,null)and not public.m5_finding_open_policy('superseded',null,statement_timestamp(),'unchanged',null,null));
end$$;

-- Failure injection rolls back with all synthetic evidence.
create or replace function public.m3_dashboard_coverage(p_org uuid,p_actor uuid,p_product uuid default null)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$begin raise exception 'synthetic internal source failure';end$$;
-- Characterize the frozen severity mapping using controlled source output,
-- then restore the real M4 implementation inside this rollback-only fixture.
create temporary table m14_severity_probe(value jsonb);
do $$declare source_definition text;s record;p record;expected text;actual text;begin
 select *into s from m14_test_scope;
 source_definition:=pg_get_functiondef('public.m4_03_intelligence_with_provenance_json(uuid,timestamp with time zone)'::regprocedure);
 execute $stub$create or replace function public.m4_03_intelligence_with_provenance_json(p_vulnerability_id uuid,p_assessed_at timestamptz)
 returns jsonb language sql stable security definer set search_path=public,pg_temp as 'select value from pg_temp.m14_severity_probe'$stub$;
 for p in select *from(values(null::numeric,'unknown'),(-1,'unknown'),(0,'low'),(3.9,'low'),(4,'medium'),(6.9,'medium'),(7,'high'),(8.9,'high'),(9,'critical'),(10,'critical'))t(score,severity)loop
 delete from m14_severity_probe;
 insert into m14_severity_probe values(jsonb_build_object('cvss',jsonb_build_object('preferred',jsonb_build_object('baseScore',p.score))));
 actual:=public.m5_triage_observation_severity((select vulnerability_id from public.vulnerability_findings where id=s.finding),statement_timestamp());
 perform pg_temp.check('observation severity boundary '||coalesce(p.score::text,'null'),actual=p.severity);
 perform pg_temp.check('finding severity preserves boundary '||coalesce(p.score::text,'null'),public.m5_triage_finding_severity(s.org,s.finding)=p.severity);
 end loop;
 perform pg_temp.check('severity lookup remains tenant scoped',public.m5_triage_finding_severity(gen_random_uuid(),s.finding)is null);
 perform pg_temp.check('observation severity is private',not has_function_privilege('service_role','public.m5_triage_observation_severity(uuid,timestamp with time zone)','execute')and not has_function_privilege('authenticated','public.m5_triage_observation_severity(uuid,timestamp with time zone)','execute'));
 perform pg_temp.check('findings JIT setting is function scoped',(select proconfig @>array['jit=off','search_path=public, pg_temp']from pg_proc where oid='public.m5_dashboard_findings(uuid,uuid,uuid)'::regprocedure));
 delete from m14_severity_probe;insert into m14_severity_probe values('{"cvss":{"preferred":{"baseScore":"malformed"}}}');
 begin perform public.m5_triage_observation_severity(gen_random_uuid(),statement_timestamp());raise exception 'malformed severity silently accepted';exception when invalid_text_representation then perform pg_temp.check('malformed severity remains source error',true);end;
 execute source_definition;
end$$;
do $$declare actor uuid; j jsonb;begin select id into actor from public.users where email='owner@cra.test';j:=public.get_dashboard_projection('00000000-0000-4000-8000-0000000000ca',actor,'overview','{}');perform pg_temp.check('source failure isolated',j#>>'{result,sbomCoverage,state}'='unavailable'and not(j#>'{result,sbomCoverage}'?'data')and j#>>'{result,products,state}'='available');end$$;

select * from finish();
rollback;
