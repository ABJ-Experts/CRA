-- Portable calendar policy test: simulate tomorrow's READ validation clock only.
-- Facts/baselines retain their genuine capture times. Authentication, scope,
-- snapshot visibility, source policy and immutable guards are never stubbed.
-- Both function definitions and all run-owned fixtures roll back together.
begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare definition text;anchor text;replacement text;count integer;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='if to_date>(now_at at time zone zone)::date then';
 replacement:='if to_date>((current_date+1)::timestamp+interval''12 hours'')::date then';
 count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 perform pg_temp.check('calendar seam replaces exactly one chart validation clock',count=1);
 execute replace(definition,anchor,replacement);
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='(base_filters->>''to'')::date>(statement_timestamp()at time zone(base_filters->>''timezone''))::date';
 replacement:='(base_filters->>''to'')::date>((current_date+1)::timestamp+interval''12 hours'')::date';
 count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 perform pg_temp.check('calendar seam replaces exactly one source validation clock',count=1);
 execute replace(definition,anchor,replacement);
end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;fact public.sbom_release_coverage_facts;filters jsonb;dataset jsonb;pin jsonb;page jsonb;activity jsonb;
begin
 select id into actor from public.users where email='owner@cra.test';
 select legal_entity_id into seed_entity from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
 insert into public.organizations(id,name,slug)values(org,'M14 rollback-only calendar tenant','m14-calendar-'||org);
 insert into public.organization_members(organization_id,user_id,role)values(org,actor,'owner');
 insert into public.organization_legal_entities select(jsonb_populate_record(null::public.organization_legal_entities,to_jsonb(e)||jsonb_build_object('id',entity,'organization_id',org,'identifier','m14-'||entity))).*from public.organization_legal_entities e where id=seed_entity;
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 select product,org,entity,legal_entity_version,legal_entity_snapshot,'M14 rollback-only calendar product','m14-calendar-'||product,product_type,actor,actor,actor from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
 select release,org,product,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 calendar release','calendar-'||release,'end_of_support',clock_timestamp(),actor,actor from public.products where id=product;
 set constraints all immediate;
 select *into fact from public.sbom_release_coverage_facts where organization_id=org and release_id=release order by sequence desc limit 1;
 perform pg_temp.check('calendar fixture captures actual current eligible release',fact.eligible_delta=1 and fact.covered_delta=0 and (fact.effective_at at time zone'UTC')::date=(clock_timestamp()at time zone'UTC')::date);
 filters:=jsonb_build_object('from',current_date+1,'to',current_date+1,'timezone','UTC','bucket','day','productId',product);
 dataset:=public.get_dashboard_trends(org,actor,filters,null);pin:=dataset->'snapshot';
 pin:=pin||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc((current_date+1)::timestamp+interval'12 hours'),'snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 dataset:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('next-day carry uses genuine denominator without invented observations',dataset#>>'{result,series,sbomCoverage,buckets,0,denominator}'='1'and dataset#>>'{result,series,sbomCoverage,buckets,0,numerator}'='0'and dataset#>>'{result,series,sbomCoverage,buckets,0,sourceCount}'='0');
 filters:=filters||jsonb_build_object('datasetRevision',dataset#>>'{result,datasetRevision}','offset',0,'limit',100);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage'),pin);
 perform pg_temp.check('next-day source is one labelled carried observation',jsonb_array_length(page#>'{result,items}')=1 and page#>>'{result,items,0,factKind}'='carried_coverage_context');
 perform pg_temp.check('carried observation preserves true timestamp and provenance',page#>>'{result,items,0,effectiveAt}'=public.m7_snapshot_timestamp_utc(fact.effective_at)and page#>>'{result,items,0,provenance}'=fact.provenance);
 activity:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','sourceAccess',jsonb_build_object('findings',true,'sbomCoverage',false)),pin);
 perform pg_temp.check('actual carry cannot enter a finding-only source stream',activity->>'outcome'='found'and activity#>'{result,items}'='[]'::jsonb);
 perform pg_temp.check('actual carry is forbidden when coverage source permission is denied',public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage','sourceAccess',jsonb_build_object('findings',true,'sbomCoverage',false)),pin)->>'outcome'='forbidden');
end$$;
rollback;
