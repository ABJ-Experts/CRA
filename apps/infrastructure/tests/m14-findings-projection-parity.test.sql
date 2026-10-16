-- Mixed effective assessment/source characterization; synthetic rows roll back.
begin;
-- This scalar/frozen JSON oracle is intentionally a SMALL synthetic fixture.
-- Never run it while a held load fixture uses the same organization.
do $$begin
if exists(select 1 from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'and internal_code like 'm14-bench-%')or
(select count(*)from(select 1 from public.vulnerability_findings where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1001)bounded)>1000
then raise exception 'M14 parity requires small isolated scope; clean owned benchmark fixture first';end if;
end$$;
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
update public.base_role_permission_overrides set permissions='{}'where organization_id=(select org from m14_test_scope)and base_role='owner';
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

end$$;

create temporary table m14_parity_ids(n integer,finding_id uuid,product_id uuid,release_id uuid);
do $$declare s record;f public.vulnerability_findings;p uuid:=gen_random_uuid();r uuid:=gen_random_uuid();v uuid:=gen_random_uuid();src uuid:=gen_random_uuid();ver uuid:=gen_random_uuid();ar uuid:=gen_random_uuid();missing_v uuid:=gen_random_uuid();missing_src uuid:=gen_random_uuid();missing_ver uuid:=gen_random_uuid();missing_ar uuid:=gen_random_uuid();i integer;fid uuid;assessment uuid;source_row record;expected jsonb;j jsonb;scope_product uuid;loops integer;baseline_audit bigint;baseline_findings bigint;begin
select *into s from m14_test_scope;select *into f from public.vulnerability_findings where id=s.finding;
update public.vulnerability_source_records set current_version_id=f.source_record_version_id where id=f.source_record_id;
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)values(f.vulnerability_id,f.source_record_version_id,'osv','cvss','{"type":"cvss","value":{"version":"3.1","baseScore":7,"vectorString":"CVSS:3.1/AV:N"}}');
insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
select p,s.org,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 second parity product','m14-parity-'||p,product_type,s.actor,s.actor,s.actor from public.products where id=s.product;
insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
select r,s.org,p,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 second parity release','m14-parity-'||r,'placed_on_market',statement_timestamp(),s.actor,s.actor from public.products where id=p;
for i in 1..2 loop
insert into public.vulnerabilities(id,canonical_id,title)values(case i when 1 then v else missing_v end,'CVE-M14-PARITY-'||case i when 1 then v else missing_v end,'Synthetic M14 mixed-policy source');
insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id)values(case i when 1 then src else missing_src end,'osv','m14-parity-'||case i when 1 then src else missing_src end,case i when 1 then v else missing_v end);
insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload)select case i when 1 then ver else missing_ver end,case i when 1 then src else missing_src end,run_id,repeat('c',64),'active','{}','{}'from public.vulnerability_source_record_versions where id=f.source_record_version_id;
update public.vulnerability_source_records set current_version_id=case i when 1 then ver else missing_ver end where id=case i when 1 then src else missing_src end;
insert into public.vulnerability_affected_ranges(id,vulnerability_id,source_record_version_id,range_value)values(case i when 1 then ar else missing_ar end,case i when 1 then v else missing_v end,case i when 1 then ver else missing_ver end,'{}');
end loop;
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)values(v,ver,'osv','cvss','{"type":"cvss","value":{"version":"4.0","baseScore":9,"vectorString":"CVSS:4.0/AV:N"}}');
for i in 1..8 loop
fid:=gen_random_uuid();
insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',fid,'component_identity','m14-parity-'||fid,'release_id',case when i<=4 then s.release else r end,'reevaluation_state',case when i=5 then'review_required'else'unchanged'end,'last_evaluated_at',f.last_evaluated_at-make_interval(secs=>case when i<=4 then 0 when i<=6 then 3600 else 7200 end),'vulnerability_id',case when i<=4 then f.vulnerability_id when i=8 then missing_v else v end,'source_record_id',case when i<=4 then f.source_record_id when i=8 then missing_src else src end,'source_record_version_id',case when i<=4 then f.source_record_version_id when i=8 then missing_ver else ver end,'affected_range_id',case when i<=4 then f.affected_range_id when i=8 then missing_ar else ar end,'canonical_advisory_id','CVE-M14-PARITY-'||case when i<=4 then f.vulnerability_id when i=8 then missing_v else v end))).*;
insert into m14_parity_ids values(i,fid,case when i<=4 then s.product else p end,case when i<=4 then s.release else r end);
if i in(1,2,3,4,5,7)then
assessment:=gen_random_uuid();
insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,is_current,vex_status,vex_justification,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by,decided_at,decided_by,decision_reason)
values(assessment,s.org,fid,1,true,case when i=4 then'not_affected'else'fixed'end,case when i=4 then'component_not_present'else null end,'Synthetic mixed-policy assessment',case when i in(1,7)then'approval_not_required'when i=2 then'awaiting_approval'when i=4 then'rejected'else'approved'end,i not in(1,7),'unknown',1,statement_timestamp(),s.actor,s.actor,case when i in(3,4,5)then statement_timestamp()else null end,case when i in(3,4,5)then s.actor else null end,case when i=4 then'Synthetic rejection'else null end);
end if;
if i in(2,5)then insert into public.vulnerability_finding_suppressions(organization_id,finding_id,revision,reason,is_current,created_by,expires_at)values(s.org,fid,1,'Synthetic mixed-policy suppression',true,s.actor,statement_timestamp()+interval'1 day');end if;
end loop;
baseline_audit:=(select count(*)from public.audit_logs);baseline_findings:=(select count(*)from public.vulnerability_findings);
foreach scope_product in array array[null::uuid,s.product,p]loop
select jsonb_build_object('openCount',count(*),'suppressedOpenCount',count(*)filter(where suppressed),'bySeverity',jsonb_build_object('critical',count(*)filter(where severity='critical'),'high',count(*)filter(where severity='high'),'medium',count(*)filter(where severity='medium'),'low',count(*)filter(where severity='low'),'unknown',count(*)filter(where severity='unknown')))into expected
from(select public.m5_triage_finding_severity(x.organization_id,x.id)severity,exists(select 1 from public.vulnerability_finding_suppressions q where q.organization_id=x.organization_id and q.finding_id=x.id and q.is_current and q.ended_at is null and q.expires_at>statement_timestamp())suppressed from public.vulnerability_findings x join public.product_releases rel on rel.organization_id=s.org and rel.id=x.release_id where x.organization_id=s.org and(scope_product is null or rel.product_id=scope_product)and public.m5_finding_is_open(s.org,x.id))rows;
for loops in 1..12 loop
j:=public.m5_dashboard_findings(s.org,s.actor,scope_product);
perform pg_temp.check('mixed source scalar projection parity scope '||coalesce(scope_product::text,'overview')||' call '||loops,j->'data'=expected);
end loop;
end loop;
perform pg_temp.check('projection reads preserve source and evidence counts',baseline_audit=(select count(*)from public.audit_logs)and baseline_findings=(select count(*)from public.vulnerability_findings));
perform pg_temp.check('missing source remains unknown',(public.m5_dashboard_findings(s.org,s.actor,p)#>>'{data,bySeverity,unknown}')::integer=1);
perform pg_temp.check('foreign overview is denied',public.get_dashboard_projection(gen_random_uuid(),s.actor,'overview','{}')->>'outcome'='not_found');
update public.base_role_permission_overrides set permissions='{"can_view_findings":false}'where organization_id=s.org and base_role='owner';
j:=public.m5_dashboard_findings(s.org,s.actor,null);perform pg_temp.check('revocation denies warmed projection',j->>'state'='restricted'and not(j?'data'));
end$$;

-- Real sparse/dense source policies; no approximation of timestamp maxima.
update public.base_role_permission_overrides set permissions='{}'where organization_id=(select org from m14_test_scope)and base_role='owner';
create temporary table m14_density_ids(n integer,id uuid);
do $$declare s record;f public.vulnerability_findings;p uuid:=gen_random_uuid();r uuid:=gen_random_uuid();i integer;phase integer;loops integer;fid uuid;historical uuid;j jsonb;expected jsonb;latest timestamptz;scope_product uuid;begin
select *into s from m14_test_scope;select *into f from public.vulnerability_findings where id=s.finding;
insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)select p,s.org,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 synthetic density product','m14-density-'||p,product_type,s.actor,s.actor,s.actor from public.products where id=s.product;
insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)select r,s.org,p,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 density release','m14-density-'||r,'placed_on_market',statement_timestamp(),s.actor,s.actor from public.products where id=p;
for i in 1..60 loop
fid:=gen_random_uuid();insert into m14_density_ids values(i,fid);
insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',fid,'release_id',r,'component_identity','m14-density-'||fid,'reevaluation_state',case when i%5=0 then'review_required'else'unchanged'end,'updated_at',statement_timestamp()+make_interval(secs=>i),'last_evaluated_at','1970-01-01'::timestamptz+make_interval(years=>i*2)))).*;
-- Historical-only structural fixture (no current row) must remain unassessed.
-- Self supersession satisfies the retained deferred FK without adding current authority.
historical:=gen_random_uuid();
insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by,superseded_at,superseded_by_id)
values(historical,s.org,fid,1,false,'fixed','Synthetic historical resolution','approval_not_required',false,'unknown',1,statement_timestamp(),s.actor,s.actor,statement_timestamp(),historical);
insert into public.vulnerability_finding_suppressions(organization_id,finding_id,revision,reason,is_current,created_by,created_at,expires_at,ended_at,ended_reason)
values(s.org,fid,1,'Synthetic sparse dense suppression',i%4<>0,s.actor,statement_timestamp()-interval'2 days',case when i%4=1 then statement_timestamp()+interval'1 day'when i%4=2 then statement_timestamp()-interval'1 hour'else statement_timestamp()end,case when i%4=0 then statement_timestamp()else null end,case when i%4=0 then'expired'else null end);
end loop;
for phase in 0..2 loop
if phase>0 then
for i in (select n from m14_density_ids where (phase=1 and n in(1,60))or(phase=2 and n not in(1,60)))loop
select id into fid from m14_density_ids where n=i;
insert into public.vulnerability_finding_assessments(organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by)
values(s.org,fid,2,true,'fixed','Synthetic current density assessment',case when i%3=0 then'awaiting_approval'else'approval_not_required'end,i%3=0,'unknown',1,statement_timestamp(),s.actor,s.actor);
end loop;
end if;
foreach scope_product in array array[null::uuid,p]loop
select jsonb_build_object('openCount',count(*),'suppressedOpenCount',count(*)filter(where suppressed),'bySeverity',jsonb_build_object('critical',count(*)filter(where severity='critical'),'high',count(*)filter(where severity='high'),'medium',count(*)filter(where severity='medium'),'low',count(*)filter(where severity='low'),'unknown',count(*)filter(where severity='unknown'))),max(updated_at)into expected,latest
from(select x.updated_at,public.m5_triage_finding_severity(s.org,x.id)severity,exists(select 1 from public.vulnerability_finding_suppressions q where q.organization_id=s.org and q.finding_id=x.id and q.is_current and q.ended_at is null and q.expires_at>statement_timestamp())suppressed from public.vulnerability_findings x where x.organization_id=s.org and(scope_product is null or x.release_id=r)and public.m5_finding_is_open(s.org,x.id))rows;
for loops in 1..8 loop
j:=public.m5_dashboard_findings(s.org,s.actor,scope_product);
perform pg_temp.check('sparse dense historical policy parity scope '||coalesce(scope_product::text,'overview')||' phase '||phase||' call '||loops,j->'data'=expected);
perform pg_temp.check('open max timestamp parity scope '||coalesce(scope_product::text,'overview')||' phase '||phase||' call '||loops,j->>'updatedAt'=public.m6_utc_second_z(latest));
end loop;
end loop;
end loop;
-- Newest intrinsically closed row cannot establish the section update time.
update public.vulnerability_findings set closed_at=statement_timestamp(),closure_reason='component_removed',updated_at=statement_timestamp()+interval'3 days'where id=(select id from m14_density_ids where n=60);
fid:=gen_random_uuid();
insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',fid,'release_id',r,'component_identity','m14-closed-newest-'||fid,'closed_at',statement_timestamp(),'closure_reason','component_removed','updated_at',statement_timestamp()+interval'3 days'))).*;
select max(updated_at)into latest from public.vulnerability_findings x where x.organization_id=s.org and x.release_id=r and public.m5_finding_is_open(s.org,x.id);
perform pg_temp.check('closed fixture timestamp actually exceeds open maximum',(select max(updated_at)>latest from public.vulnerability_findings where organization_id=s.org and release_id=r));
j:=public.m5_dashboard_findings(s.org,s.actor,p);
perform pg_temp.check('newest closed timestamp excluded',j->>'updatedAt'=public.m6_utc_second_z(latest));
update public.vulnerability_findings set closed_at=statement_timestamp(),closure_reason='component_removed'where release_id=r;
j:=public.m5_dashboard_findings(s.org,s.actor,p);
perform pg_temp.check('all intrinsically closed streams are empty',j->>'state'='empty'and(j#>>'{data,openCount}')::integer=0 and(j#>>'{data,suppressedOpenCount}')::integer=0 and j->'updatedAt'='null'::jsonb);
-- last_evaluated_at is NOT NULL in retained schema; null-safe suppression join
-- is defensive and does not authorize invalid fixture data.
end$$;


-- Normal-origin forged relation is rejected before it can enter aggregates.
do $$declare f public.vulnerability_findings;failed boolean:=false;constraint_name text;fid uuid:=gen_random_uuid();foreign_release uuid;foreign_org uuid:=gen_random_uuid();foreign_product uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();actor uuid;begin
select *into f from public.vulnerability_findings where id=(select finding from m14_test_scope);
begin
insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',fid,'component_identity','m14-forged-release-'||fid,'release_id',gen_random_uuid()))).*;
exception when foreign_key_violation then get stacked diagnostics constraint_name=CONSTRAINT_NAME;failed:=constraint_name='vulnerability_findings_organization_id_release_id_fkey';
end;
perform pg_temp.check('normal trigger origin rejects forged tenant release relation',current_setting('session_replication_role')='origin'and failed);
select id into foreign_release from public.product_releases where organization_id<>f.organization_id limit 1;
if foreign_release is null then
-- Portable rollback-only foreign reference graph when development has one tenant.
select a.actor into actor from m14_test_scope a;
foreign_release:=gen_random_uuid();
insert into public.organizations(id,name,slug)values(foreign_org,'M14 synthetic FK parity tenant','m14-fk-parity-'||foreign_org);
insert into public.organization_members(organization_id,user_id,role)values(foreign_org,actor,'owner');
insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,completion_status,status,is_default,created_by,updated_by)
values(entity,foreign_org,'synthetic-fk-parity','Synthetic FK Entity','Synthetic FK Entity','1 Synthetic Street','Synthetic City','10000','DE','DE','Synthetic Contact','synthetic-fk@example.invalid','complete','active',true,actor,actor);
insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
select foreign_product,foreign_org,e.id,e.version,to_jsonb(e),'Synthetic FK Product','synthetic-fk-'||foreign_product,'standalone_software',actor,actor,actor from public.organization_legal_entities e where e.id=entity;
insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
select foreign_release,foreign_org,x.id,x.legal_entity_id,x.legal_entity_version,x.legal_entity_snapshot,'Synthetic FK Release','synthetic-fk-'||foreign_release,'placed_on_market',statement_timestamp(),actor,actor from public.products x where x.id=foreign_product;
end if;
perform pg_temp.check('existing foreign release fixture is present',foreign_release is not null);
failed:=false;fid:=gen_random_uuid();
begin
insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',fid,'component_identity','m14-cross-tenant-release-'||fid,'release_id',foreign_release))).*;
exception when foreign_key_violation then get stacked diagnostics constraint_name=CONSTRAINT_NAME;failed:=constraint_name='vulnerability_findings_organization_id_release_id_fkey';
end;
perform pg_temp.check('normal origin rejects existing cross tenant release relation',current_setting('session_replication_role')='origin'and failed);

end$$;
-- Overview may omit the release join only under the validated composite tenant FK.
do $$declare body text;begin
perform pg_temp.check('validated tenant release foreign key prerequisite',exists(select 1 from pg_constraint c where c.conrelid='public.vulnerability_findings'::regclass and c.confrelid='public.product_releases'::regclass and c.contype='f'and c.convalidated and not c.condeferrable and c.confdeltype='r'and (select bool_and(attnotnull)from pg_attribute where attrelid=c.conrelid and attname in('organization_id','release_id'))and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='organization_id'),(select attnum from pg_attribute where attrelid=c.conrelid and attname='release_id')]::smallint[] and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='organization_id'),(select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]));
select prosrc into body from pg_proc where oid='public.m5_dashboard_findings(uuid,uuid,uuid)'::regprocedure;
perform pg_temp.check('overview avoids redundant proven release join',split_part(split_part(body,'if p_product is null then',2),E'\n else\n',1)not like '%join public.product_releases%');
perform pg_temp.check('product projection retains source product release join',body like '%and r.product_id=p_product%');
end$$;
do $$begin perform pg_temp.check('effective assessment and suppression source projections are materialized once',(select prosrc like '%effective_assessments as materialized%'and prosrc like '%active_suppressions as materialized%'from pg_proc where oid='public.m5_dashboard_findings(uuid,uuid,uuid)'::regprocedure));end$$;
do $$begin perform pg_temp.check('overview counts do not retain irrelevant evaluation time',(select split_part(split_part(prosrc,'if p_product is null then',2),E'\n else\n',1)not like '%last_evaluated_at%'from pg_proc where oid='public.m5_dashboard_findings(uuid,uuid,uuid)'::regprocedure));end$$;
do $$begin perform pg_temp.check('narrow overview covering index exists',to_regclass('public.vulnerability_findings_dashboard_overview_cover_idx')is not null);end$$;
select *from finish();
rollback;
