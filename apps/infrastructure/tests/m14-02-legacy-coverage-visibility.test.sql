-- Performance RED is the authenticated 1m p95 gate. This policy regression
-- compares charts with independently paged source facts, not SQL text/plan shape.
-- All source fixtures and future-effective boundary probes roll back.
begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;fact public.sbom_release_coverage_facts;previous bigint;filters jsonb;dataset jsonb;pin jsonb;page jsonb;metric_bucket text;zone text;scope_kind text;lower_date date;observations integer;chart_count integer;definition text;anchor text;occurrences integer;legacy_sequence bigint;fake_xid bigint;
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

 -- Synthetic transaction metadata tests pinned visibility without source rewrites.
 fake_xid:=pg_current_xact_id()::text::bigint+10;
 insert into public.sbom_release_coverage_facts(organization_id,product_id,release_id,fact_kind,previous_sequence,payload,provenance,effective_at,recorded_transaction_id)
 values(org,product,release,'observation',fact.sequence,fact.payload||jsonb_build_object('covered',true),'rollback_only_legacy_visibility',clock_timestamp(),fake_xid::text::xid8)returning sequence into legacy_sequence;
 filters:=jsonb_build_object('from',(clock_timestamp()at time zone'UTC')::date,'to',(clock_timestamp()at time zone'UTC')::date,'timezone','UTC','bucket','day','productId',product,'sourceAccess',jsonb_build_object('findings',true,'sbomCoverage',true,'readiness',true));
 pin:=public.get_dashboard_trends(org,actor,filters,null)->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval'1 second'),'snapshot',(fake_xid+1)||':'||(fake_xid+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('visible legacy coverage contributes exact numerator',dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='1');
 perform pg_temp.check('visible legacy coverage retains denominator',dataset#>>'{result,series,sbomCoverage,buckets,0,denominator}'='1');
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 perform pg_temp.check('visible legacy contributing source is available',exists(select 1 from jsonb_array_elements(page#>'{result,items}')i where i->>'id'='coverage-'||legacy_sequence));
 -- The same bounds now exclude only the synthetic late transaction.
 pin:=pin||jsonb_build_object('snapshot',fake_xid||':'||fake_xid||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('hidden legacy cannot change typed coverage numerator',dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='0');
 perform pg_temp.check('hidden legacy preserves visible typed denominator',dataset#>>'{result,series,sbomCoverage,buckets,0,denominator}'='1');
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage','offset',0,'limit',100,'datasetRevision',dataset#>>'{result,datasetRevision}'),pin);
 perform pg_temp.check('hidden legacy cannot enter source page',not exists(select 1 from jsonb_array_elements(page#>'{result,items}')i where i->>'id'='coverage-'||legacy_sequence));
 -- Organization statement follows the same authorized snapshot predicates.
 filters:=filters-'productId';
 pin:=public.get_dashboard_trends(org,actor,filters,null)->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval'1 second'),'snapshot',(fake_xid+1)||':'||(fake_xid+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('organization legacy coverage uses same visible numerator',dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='1');
 pin:=pin||jsonb_build_object('snapshot',fake_xid||':'||fake_xid||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('organization hidden legacy retains typed result',dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='0');
end$$;
rollback;
