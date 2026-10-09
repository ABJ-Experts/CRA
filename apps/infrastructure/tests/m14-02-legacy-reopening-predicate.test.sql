-- The performance RED is the authenticated history benchmark. Reopening and
-- source parity remain independently verified against typed and legacy facts.
-- Every run-owned source/history fixture and calendar seam rolls back.
begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;fact public.vulnerability_finding_lifecycle_facts;finding uuid:=gen_random_uuid();vulnerability uuid:=gen_random_uuid();source_run uuid:=gen_random_uuid();source uuid:=gen_random_uuid();source_version uuid:=gen_random_uuid();affected uuid:=gen_random_uuid();payload jsonb;closed_payload jsonb;previous bigint;filters jsonb;dataset jsonb;pin jsonb;page jsonb;metric_bucket text;zone text;scope_kind text;lower_date date;observations integer;chart_count integer;definition text;anchor text;occurrences integer;fake_xid bigint;
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
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,closed_payload-'superseded','rollback_only_second_closed_stream_probe',fact.effective_at,false)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at)values(org,product,release,finding,'observation',previous,payload,'rollback_only_legacy_reopening_stream_probe',fact.effective_at)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,closed_payload,'rollback_only_after_TO_closed_stream_probe',(current_date+2)::timestamp at time zone'UTC',false)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,payload,'rollback_only_after_TO_reopening_stream_probe',(current_date+2)::timestamp at time zone'UTC',true);
 -- Explicit supersession is a cohort exit, never a reopening.
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,closed_payload||'{"superseded":true}','rollback_only_superseded_predecessor',fact.effective_at,false)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at)values(org,product,release,finding,'observation',previous,payload,'rollback_only_not_a_reopening',fact.effective_at)returning sequence into previous;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,is_reopening)values(org,product,release,finding,'observation',previous,closed_payload-'superseded','rollback_only_late_predecessor',fact.effective_at,false)returning sequence into previous;
 fake_xid:=pg_current_xact_id()::text::bigint+10;
 -- Test-only transaction metadata: one later commit must remain invisible.
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance,effective_at,recorded_transaction_id)values(org,product,release,finding,'observation',previous,payload,'rollback_only_late_reopening',fact.effective_at,fake_xid::text::xid8);
 foreach metric_bucket in array array['day','week','month']loop
 foreach scope_kind in array array['organization','product']loop
 filters:=jsonb_build_object('from',current_date-45,'to',current_date,'timezone','UTC','bucket',metric_bucket);
 if scope_kind='product'then filters:=filters||jsonb_build_object('productId',product);end if;
 dataset:=public.get_dashboard_trends(org,actor,filters,null);pin:=dataset->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval'1 second'),'snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check(metric_bucket||' '||scope_kind||' prebaseline buckets stay unavailable',exists(select 1 from jsonb_array_elements(dataset#>'{result,series,activity,buckets}')b where(b->>'end')::timestamptz<=(dataset#>>'{result,baselineAt}')::timestamptz)and not exists(select 1 from jsonb_array_elements(dataset#>'{result,series,activity,buckets}')b where(b->>'end')::timestamptz<=(dataset#>>'{result,baselineAt}')::timestamptz and(b->>'reopened'is not null or b->>'sourceCount'is distinct from'0')));
 select sum((b->>'reopened')::int),sum((b->>'sourceCount')::int)into observations,chart_count from jsonb_array_elements(dataset#>'{result,series,activity,buckets}')b;
 perform pg_temp.check(metric_bucket||' '||scope_kind||' genuine typed and legacy reopenings survive baseline clipping',observations=2 and chart_count=4);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 perform pg_temp.check(metric_bucket||' '||scope_kind||' clipped buckets retain exact contributing source parity',chart_count=jsonb_array_length(page#>'{result,items}'));
 end loop;
 end loop;
 foreach scope_kind in array array['organization','product']loop
 filters:=jsonb_build_object('from',current_date,'to',current_date,'timezone','UTC','bucket','day');
 if scope_kind='product'then filters:=filters||jsonb_build_object('productId',product);end if;
 pin:=public.get_dashboard_trends(org,actor,filters,null)->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval'1 second'),'snapshot',(fake_xid+1)||':'||(fake_xid+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check(scope_kind||' visible later legacy reopening adds exactly one event',dataset#>>'{result,series,activity,buckets,0,reopened}'='3');
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 select count(*)into observations from jsonb_array_elements(page#>'{result,items}')i where i->>'factKind'='reopened';
 perform pg_temp.check(scope_kind||' later legacy source count matches chart',observations=3);
 pin:=pin||jsonb_build_object('snapshot',fake_xid||':'||fake_xid||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check(scope_kind||' invisible later legacy reopening cannot change dataset',dataset#>>'{result,series,activity,buckets,0,reopened}'='2');
 end loop;
end$$;
rollback;
