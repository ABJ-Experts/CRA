begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:='00000000-0000-4000-8000-0000000000ca';actor uuid;prior public.sbom_release_coverage_facts;filters jsonb;dataset jsonb;pin jsonb;page jsonb;activity jsonb;restricted jsonb;carried jsonb;observations integer;source_count integer;revision bigint;
begin
 select id into actor from public.users where email='owner@cra.test';
 -- Reuse genuine retained observations, never fabricate or backdate a baseline.
 select f.*into prior from public.sbom_release_coverage_facts f where f.organization_id=org and f.release_id is not null and f.effective_at<current_date::timestamp at time zone'UTC'order by f.sequence desc limit 1;
 filters:=jsonb_build_object('from',current_date,'to',current_date,'timezone','UTC','bucket','day');
 if prior.sequence is not null then filters:=filters||jsonb_build_object('productId',prior.product_id);end if;
 dataset:=public.get_dashboard_trends(org,actor,filters,null);pin:=dataset->'snapshot';
 filters:=filters||jsonb_build_object('datasetRevision',dataset#>>'{result,datasetRevision}','offset',0,'limit',100);
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage'),pin);
 perform pg_temp.check('coverage sources are independently authorized',page->>'outcome'='found');
 activity:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','sourceAccess',jsonb_build_object('findings',true,'sbomCoverage',false)),pin);
 perform pg_temp.check('findings remain available when SBOM access is denied',activity->>'outcome'='found');
 perform pg_temp.check('activity never discloses carried coverage or SBOM observations',not exists(select 1 from jsonb_array_elements(activity#>'{result,items}')item where item->>'sourceType'<>'finding'or item->>'factKind'in('carried_coverage_context','coverage_observation')));
 restricted:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage','sourceAccess',jsonb_build_object('findings',true,'sbomCoverage',false)),pin);
 perform pg_temp.check('SBOM access denial rejects the source stream',restricted->>'outcome'='forbidden');
 if prior.sequence is null then
  raise notice 'M14-02 genuine prior-day coverage is unavailable in this deployment; carried-history assertions are not reconstructed';
  return;
 end if;
 select item into carried from jsonb_array_elements(page#>'{result,items}')item where item->>'factKind'='carried_coverage_context'and item->>'sourceId'=prior.release_id::text;
 perform pg_temp.check('carried state exposes one genuine latest prior observation',carried->>'id'='coverage-carried-'||prior.sequence and carried->>'effectiveAt'=public.m7_snapshot_timestamp_utc(prior.effective_at));
 perform pg_temp.check('carried source retains its exact recorded provenance',carried->>'provenance'=prior.provenance and carried->>'recordedAt'=public.m7_snapshot_timestamp_utc(prior.recorded_at));
 select count(*)into observations from jsonb_array_elements(page#>'{result,items}')item where item->>'factKind'='coverage_observation';
 select sum((bucket->>'sourceCount')::int)into source_count from jsonb_array_elements(dataset#>'{result,series,sbomCoverage,buckets}')bucket;
 perform pg_temp.check('carried context is not counted as an in-range observation',observations=source_count);
 -- A late, explicitly labelled correction replay preserves a proven effective
 -- timestamp and payload; it adds no eligibility delta. The old bound excludes it.
 select max(sequence)into revision from public.sbom_release_coverage_facts where organization_id=org and release_id=prior.release_id;
 insert into public.sbom_release_coverage_facts(organization_id,product_id,release_id,fact_kind,previous_sequence,payload,provenance,effective_at,eligible_delta,covered_delta)values(org,prior.product_id,prior.release_id,'observation',revision,prior.payload,'rollback_only_proven_prior_observation_replay',prior.effective_at,0,0);
 perform pg_temp.check('late replay cannot change a pinned carried source page',public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage'),pin)=page);
 dataset:=public.get_dashboard_trends(org,actor,filters-array['datasetRevision','offset','limit'],null);pin:=dataset->'snapshot';
 -- The caller's own uncommitted fixture is represented explicitly for SQL tests;
 -- production uses PostgreSQL's real transaction snapshot, covered separately.
 pin:=pin||jsonb_build_object('snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 filters:=filters||jsonb_build_object('datasetRevision',dataset#>>'{result,datasetRevision}');
 page:=public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','sbomCoverage'),pin);
 perform pg_temp.check('a fresh bound identifies the late proven carried revision',exists(select 1 from jsonb_array_elements(page#>'{result,items}')item where item->>'factKind'='carried_coverage_context'and item->>'sourceId'=prior.release_id::text and item->>'provenance'='rollback_only_proven_prior_observation_replay'));
end$$;
rollback;
