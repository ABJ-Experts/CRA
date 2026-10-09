-- The performance RED is the authenticated history benchmark. Reopening and
-- source parity remain independently verified against typed and legacy facts.
-- Every run-owned source/history fixture and calendar seam rolls back.
begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;fact public.vulnerability_finding_lifecycle_facts;finding uuid:=gen_random_uuid();vulnerability uuid:=gen_random_uuid();source_run uuid:=gen_random_uuid();source uuid:=gen_random_uuid();source_version uuid:=gen_random_uuid();affected uuid:=gen_random_uuid();payload jsonb;closed_payload jsonb;previous bigint;filters jsonb;dataset jsonb;pin jsonb;page jsonb;metric_bucket text;zone text;scope_kind text;lower_date date;observations integer;chart_count integer;definition text;anchor text;occurrences integer;
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
 foreach metric_bucket in array array['day','week','month']loop
 foreach scope_kind in array array['organization','product']loop
 filters:=jsonb_build_object('from',current_date,'to',current_date,'timezone','UTC','bucket',metric_bucket);
 if scope_kind='product'then filters:=filters||jsonb_build_object('productId',product);end if;
 dataset:=public.get_dashboard_trends(org,actor,filters,null);pin:=dataset->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc((current_date+4)::timestamp at time zone'UTC'),'snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 select count(*)into observations from jsonb_array_elements(page#>'{result,items}')item where item->>'factKind'='reopened';
 perform pg_temp.check(metric_bucket||' '||scope_kind||' typed and legacy reopenings match sources without after-TO events',dataset#>>'{result,series,activity,buckets,0,reopened}'='2'and observations=2);
 select sum((b->>'sourceCount')::int)into chart_count from jsonb_array_elements(dataset#>'{result,series,activity,buckets}')b;
 perform pg_temp.check(metric_bucket||' '||scope_kind||' chart table and all contributing sources have exact parity',chart_count=jsonb_array_length(page#>'{result,items}')and chart_count=4);
 end loop;
 end loop;
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='if to_date>(now_at at time zone zone)::date then';
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 perform pg_temp.check('zero activity chart clock seam is exactly scoped',occurrences=1);
 execute replace(definition,anchor,'if to_date>(current_date+4) then');
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='(base_filters->>''to'')::date>(statement_timestamp()at time zone(base_filters->>''timezone''))::date';
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 perform pg_temp.check('zero activity source clock seam is exactly scoped',occurrences=1);
 execute replace(definition,anchor,'(base_filters->>''to'')::date>(current_date+4)');
 foreach metric_bucket in array array['day','week','month']loop
 filters:=jsonb_build_object('from',current_date+1,'to',current_date+1,'timezone','UTC','bucket',metric_bucket,'productId',product);
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 perform pg_temp.check(metric_bucket||' partial range has actual-zero activity and no invented sources',dataset#>>'{result,series,activity,buckets,0,opened}'='0'and dataset#>>'{result,series,activity,buckets,0,closed}'='0'and dataset#>>'{result,series,activity,buckets,0,reopened}'='0'and dataset#>>'{result,series,activity,buckets,0,sourceCount}'='0'and page#>'{result,items}'='[]'::jsonb);
 end loop;
end$$;
rollback;
