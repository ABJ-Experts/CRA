-- The performance RED is the authenticated history benchmark. Reopening and
-- source parity remain independently verified against typed and legacy facts.
-- Every run-owned source/history fixture and calendar seam rolls back.
begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;fact public.vulnerability_finding_lifecycle_facts;finding uuid:=gen_random_uuid();vulnerability uuid:=gen_random_uuid();source_run uuid:=gen_random_uuid();source uuid:=gen_random_uuid();source_version uuid:=gen_random_uuid();affected uuid:=gen_random_uuid();payload jsonb;closed_payload jsonb;previous bigint;filters jsonb;dataset jsonb;pin jsonb;page jsonb;metric_bucket text;zone text;scope_kind text;lower_date date;observations integer;chart_count integer;definition text;anchor text;occurrences integer;empty_parent uuid:=gen_random_uuid();rootless_parent uuid:=gen_random_uuid();self_sequence bigint;before_count integer;target_org uuid:=gen_random_uuid();late_xid bigint;
begin
 select id into actor from public.users where email='owner@cra.test';
 select legal_entity_id into seed_entity from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
 insert into public.organizations(id,name,slug)values(org,'M14 rollback-only observation tenant','m14-observation-'||org);
 insert into public.organization_members(organization_id,user_id,role)values(org,actor,'owner');
 insert into public.organization_legal_entities select(jsonb_populate_record(null::public.organization_legal_entities,to_jsonb(e)||jsonb_build_object('id',entity,'organization_id',org,'identifier','m14-'||entity))).*from public.organization_legal_entities e where id=seed_entity;
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 select product,org,entity,legal_entity_version,legal_entity_snapshot,'M14 rollback-only observation product','m14-observation-'||product,product_type,actor,actor,actor from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
 select release,org,product,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 observation release','observation-'||release,'end_of_support',clock_timestamp(),actor,actor from public.products where id=product;
 set constraints all immediate;

 set constraints all deferred;
 insert into public.vulnerabilities(id,canonical_id,title)values(vulnerability,'CVE-M14-'||vulnerability,'Synthetic M14 source');
 insert into public.vulnerability_feed_sync_runs(id,feed_key,run_kind,correlation_id)values(source_run,'osv','manual',gen_random_uuid());
 insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id)values(source,'osv','m14-'||source,vulnerability);
 insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload)values(source_version,source,source_run,repeat('a',64),'active','{}','{}');
 insert into public.vulnerability_affected_ranges(id,vulnerability_id,source_record_version_id,range_value)values(affected,vulnerability,source_version,'{}');
 insert into public.vulnerability_findings(id,organization_id,release_id,component_identity,canonical_advisory_id,vulnerability_id,source_feed_key,source_record_id,source_record_version_id,affected_range_id,match_method,comparator_name,comparator_version,evaluated_component_value,affected_range,event_sequence,first_detected_at,confidence,confidence_table_version,confidence_explanation)values(finding,org,release,'m14-count-probe-'||finding,'CVE-M14-'||vulnerability,vulnerability,'osv',source,source_version,affected,'purl_osv','m14-count-probe','1','1','{}','[]',clock_timestamp(),.9,'m14-count-probe','Synthetic rollback-only test');
 set constraints all immediate;
 select *into fact from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id=finding order by sequence desc limit 1;
 perform pg_temp.check('reopening probe starts from genuinely captured open finding',fact.payload->>'open'='true'and fact.is_reopening=false);
 closed_payload:=fact.payload||jsonb_build_object('open',false,'closedEpisodes',jsonb_build_array(jsonb_build_object('at',public.m7_snapshot_timestamp_utc(fact.effective_at))));
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',fact.sequence,closed_payload,'rollback_only_closed_stream_probe',fact.effective_at,false)returning sequence into previous;
 payload:=closed_payload||'{"open":true}';
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,payload,'rollback_only_typed_reopening_stream_probe',fact.effective_at,true)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,closed_payload,'rollback_only_second_closed_stream_probe',fact.effective_at,false)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at)values(org,product,release,finding,'observation',previous,payload,'rollback_only_legacy_reopening_stream_probe',fact.effective_at)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,closed_payload,'rollback_only_after_TO_closed_stream_probe',(current_date+2)::timestamp at time zone'UTC',false)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,payload,'rollback_only_after_TO_reopening_stream_probe',(current_date+2)::timestamp at time zone'UTC',true);

 -- Only this rollback fixture bypasses capture to represent manually imported
 -- parents and a SQL-valid rootless self-reference. No authority is bypassed.
 set constraints all immediate;
 alter table public.vulnerability_findings disable trigger m14_02_capture;
 insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',empty_parent,'component_identity','m14-empty-parent-'||empty_parent))).*from public.vulnerability_findings f where id=finding;
 insert into public.vulnerability_findings select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',rootless_parent,'component_identity','m14-rootless-parent-'||rootless_parent))).*from public.vulnerability_findings f where id=finding;
 alter table public.vulnerability_findings enable trigger m14_02_capture;
 perform pg_temp.check('imported empty parent has no historical facts',not exists(select 1 from public.vulnerability_finding_lifecycle_facts where finding_id=empty_parent));
 late_xid:=pg_current_xact_id()::text::bigint+10;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,payload,provenance,effective_at,recorded_transaction_id,is_reopening)values(org,product,release,empty_parent,'observation',fact.payload,'rollback_only_later_source_commit',fact.effective_at,late_xid::text::xid8,false);
 self_sequence:=nextval(pg_get_serial_sequence('public.vulnerability_finding_lifecycle_facts','sequence'));
 insert into public.vulnerability_finding_lifecycle_facts(sequence,organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)overriding system value values(self_sequence,org,product,release,rootless_parent,'observation',self_sequence,closed_payload||jsonb_build_object('triagedAt','unused-invalid-import-timestamp','fixedAt','unused-invalid-import-timestamp','closedEpisodes',jsonb_build_array(jsonb_build_object('key','rootless-proof','at',public.m7_snapshot_timestamp_utc(fact.effective_at)))),'rollback_only_rootless_self_reference',fact.effective_at,false);
 perform pg_temp.check('rootless fact fixture remains SQL valid without invented root',not exists(select 1 from public.vulnerability_finding_lifecycle_facts where finding_id=rootless_parent and previous_sequence is null));
 filters:=jsonb_build_object('from',current_date,'to',current_date,'timezone','UTC','bucket','day');
 dataset:=public.get_dashboard_trends(org,actor,filters,null);pin:=dataset->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval'1 second'),'snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('org identity enumeration preserves rootless closure and excludes empty parent',dataset#>>'{result,series,activity,buckets,0,opened}'='1'and dataset#>>'{result,series,activity,buckets,0,closed}'='2');
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 perform pg_temp.check('org source enumeration preserves rootless provenance',exists(select 1 from jsonb_array_elements(page#>'{result,items}')i where i->>'sourceId'=rootless_parent::text and i->>'factKind'='closed:rootless-proof'));
 perform pg_temp.check('empty parent contributes no fabricated source',not exists(select 1 from jsonb_array_elements(page#>'{result,items}')i where i->>'sourceId'=empty_parent::text));
 begin delete from public.vulnerability_findings where id=rootless_parent;raise exception'Expected parent protection';exception when foreign_key_violation then perform pg_temp.check('history prevents referenced source-parent deletion',sqlerrm like '%vulnerability_finding_lifecycle_organization_id_finding_id_fkey%');end;
 insert into public.organizations(id,name,slug)values(target_org,'M14 rollback-only other tenant','m14-other-'||target_org);
 begin update public.vulnerability_findings set organization_id=target_org where id=rootless_parent;raise exception'Expected tenant protection';exception when foreign_key_violation then perform pg_temp.check('history prevents moving source parent to another tenant',true);end;
 -- Duplicate delivery still has one parent identity; it must not duplicate
 -- terminal episodes through the latest projection.
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,rootless_parent,'observation',self_sequence,closed_payload||jsonb_build_object('triagedAt','unused-invalid-import-timestamp','fixedAt','unused-invalid-import-timestamp','closedEpisodes',jsonb_build_array(jsonb_build_object('key','rootless-proof','at',public.m7_snapshot_timestamp_utc(fact.effective_at)))),'rollback_only_duplicate_revision',fact.effective_at,false);
 pin:=pin||jsonb_build_object('maxFindingSequence',(select max(sequence)::text from public.vulnerability_finding_lifecycle_facts where organization_id=org));
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('duplicate source revisions do not duplicate source-parent identity',dataset#>>'{result,series,activity,buckets,0,closed}'='2');
end$$;
rollback;
