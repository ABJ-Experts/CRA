-- Performance RED is the authenticated 1m p95 gate. This policy regression
-- compares charts with independently paged source facts, not SQL text/plan shape.
-- All source fixtures and future-effective boundary probes roll back.
begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;fact public.sbom_release_coverage_facts;previous bigint;filters jsonb;dataset jsonb;pin jsonb;page jsonb;metric_bucket text;zone text;scope_kind text;lower_date date;observations integer;chart_count integer;definition text;anchor text;occurrences integer;
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
 select *into fact from public.sbom_release_coverage_facts where organization_id=org and release_id=release order by sequence desc limit 1;
 perform pg_temp.check('count fixture has a genuinely captured eligible baseline',fact.eligible_delta=1 and fact.covered_delta=0);
 insert into public.sbom_release_coverage_facts(organization_id,product_id,release_id,fact_kind,previous_sequence,payload,provenance,effective_at,eligible_delta,covered_delta)values(org,product,release,'observation',fact.sequence,fact.payload,'rollback_only_zero_delta_observation',fact.effective_at,0,0)returning sequence into previous;
 insert into public.sbom_release_coverage_facts(organization_id,product_id,release_id,fact_kind,previous_sequence,payload,provenance,effective_at)values(org,product,release,'observation',previous,fact.payload,'rollback_only_legacy_zero_delta_observation',fact.effective_at)returning sequence into previous;
 insert into public.sbom_release_coverage_facts(organization_id,product_id,release_id,fact_kind,previous_sequence,payload,provenance,effective_at,eligible_delta,covered_delta)values(org,product,release,'observation',previous,fact.payload||'{"eligible":false}', 'rollback_only_after_requested_end_probe',(current_date+2)::timestamp at time zone'UTC',-1,0);
 foreach zone in array array['UTC','America/New_York','Pacific/Auckland']loop
 lower_date:=(fact.effective_at at time zone zone)::date;
 foreach metric_bucket in array array['day','week','month']loop
 foreach scope_kind in array array['organization','product']loop
 filters:=jsonb_build_object('from',lower_date,'to',lower_date,'timezone',zone,'bucket',metric_bucket);
 if scope_kind='product'then filters:=filters||jsonb_build_object('productId',product);end if;
 dataset:=public.get_dashboard_trends(org,actor,filters,null);pin:=dataset->'snapshot';
 -- Explicit test-only pin includes the visible late event, so TO rather than
 -- snapshot cutoff must exclude it from both chart and source observations.
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc((current_date+4)::timestamp at time zone'UTC'),'snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 select sum((b->>'sourceCount')::int)into chart_count from jsonb_array_elements(dataset#>'{result,series,sbomCoverage,buckets}')b;
 select count(*)into observations from jsonb_array_elements(page#>'{result,items}')item where item->>'factKind'='coverage_observation';
 perform pg_temp.check(zone||' '||metric_bucket||' '||scope_kind||' counts zero-delta and legacy observations without after-TO events',dataset->>'outcome'='found'and page->>'outcome'='found'and chart_count=3 and observations=3);
 perform pg_temp.check(zone||' '||metric_bucket||' '||scope_kind||' preserves carried denominator and actual-zero coverage',dataset#>>'{result,series,sbomCoverage,buckets,0,denominator}'='1'and dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='0'and dataset#>>'{result,series,sbomCoverage,buckets,0,value}'='0.00');
 end loop;
 end loop;
 end loop;
 -- Simulate only the date-validation read clock for portable next-day partial
 -- FROM tests. No fact timestamp, baseline, auth or visibility guard changes.
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='if to_date>(now_at at time zone zone)::date then';
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 perform pg_temp.check('partial FROM chart clock seam is exactly scoped',occurrences=1);
 execute replace(definition,anchor,'if to_date>(current_date+4) then');
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='(base_filters->>''to'')::date>(statement_timestamp()at time zone(base_filters->>''timezone''))::date';
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 perform pg_temp.check('partial FROM source clock seam is exactly scoped',occurrences=1);
 execute replace(definition,anchor,'(base_filters->>''to'')::date>(current_date+4)');
 foreach metric_bucket in array array['day','week','month']loop
 foreach scope_kind in array array['organization','product']loop
 filters:=jsonb_build_object('from',current_date+1,'to',current_date+1,'timezone','UTC','bucket',metric_bucket);
 if scope_kind='product'then filters:=filters||jsonb_build_object('productId',product);end if;
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 perform pg_temp.check(metric_bucket||' '||scope_kind||' excludes prior zero-delta observations from partial FROM count',dataset#>>'{result,series,sbomCoverage,buckets,0,sourceCount}'='0'and jsonb_array_length(page#>'{result,items}')=1 and page#>>'{result,items,0,factKind}'='carried_coverage_context');
 perform pg_temp.check(metric_bucket||' '||scope_kind||' carries denominator across partial FROM without applying after-TO exit',dataset#>>'{result,series,sbomCoverage,buckets,0,denominator}'='1'and dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='0');
 end loop;
 end loop;
end$$;
rollback;
