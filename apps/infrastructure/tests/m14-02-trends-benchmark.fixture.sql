-- Only run through run-m14-02-trends-benchmark.sh. Rollback is the default;
-- explicit committed mode retains run-owned synthetic records in the isolated
-- clone for HTTP measurement. No source guards are disabled. Synthetic
-- history uses an already committed xid solely to exercise snapshot reads in
-- the rollback fixture. It is not a production backfill.
begin;
set local statement_timeout='20min';
-- Keep isolated profiling within the local Docker memory budget. These caps
-- are disclosed with results and must not be treated as production tuning.
set local work_mem='4MB';
set local max_parallel_workers_per_gather=0;
do $$begin if current_database()<>'cra_m14_benchmark' then raise exception 'Isolated synthetic clone only';end if;end$$;
create temporary table trend_bench_config as select :'facts'::integer facts, :'samples'::integer samples, :'cohorts'::integer cohorts;
create temporary table trend_bench_scope as
select case when :'committed'::boolean then m.organization_id else gen_random_uuid()end org, gen_random_uuid() entity,gen_random_uuid() product,
       gen_random_uuid() release, m.user_id actor,
       case when :'committed'::boolean then pg_current_xact_id()else(select recorded_transaction_id from public.vulnerability_finding_lifecycle_facts limit 1)end committed_xid
from public.organization_members m join public.users u on u.id=m.user_id
where u.email='owner@cra.test' and m.organization_id='00000000-0000-4000-8000-0000000000ca' limit 1;
do $$begin if(select count(*)from trend_bench_scope)<>1 or(select committed_xid from trend_bench_scope)is null then raise exception 'Run synthetic bootstrap and trends migration first';end if;end$$;
insert into public.organizations
select (jsonb_populate_record(null::public.organizations,to_jsonb(o)||jsonb_build_object('id',s.org,'name','Synthetic M14-02 rollback benchmark','slug','m14-trends-'||s.org))).*
from public.organizations o cross join trend_bench_scope s where o.id='00000000-0000-4000-8000-0000000000ca' on conflict(id)do nothing;
insert into public.organization_members(organization_id,user_id,role)select org,actor,'owner'from trend_bench_scope on conflict(organization_id,user_id)do nothing;
-- Epoch baselines must come from the authoritative source capture migration.
-- The harness never manufactures or backdates a completeness marker.
do $$begin if not exists(select 1 from public.vulnerability_finding_lifecycle_facts f join trend_bench_scope s on s.org=f.organization_id where f.finding_id is null) or not exists(select 1 from public.sbom_release_coverage_facts f join trend_bench_scope s on s.org=f.organization_id where f.release_id is null) then raise exception 'Apply source-owned tenant baseline capture before benchmark';end if;end$$;
-- Existing baselines remain immutable. Every synthetic terminal/activity event
-- falls within this genuinely captured interval; durations retain explicit
-- synthetic detection provenance. This is not historical production evidence.
insert into public.organization_legal_entities
select (jsonb_populate_record(null::public.organization_legal_entities,to_jsonb(e)||jsonb_build_object('id',s.entity,'organization_id',s.org,'identifier','synthetic-trends-'||s.entity,'is_default',false))).*
from public.organization_legal_entities e cross join trend_bench_scope s where e.id='00000000-0000-4000-8000-0000000000cc';
insert into public.products(
 id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,description,responsible_owner_id,archived_at,archived_by,version,created_at,updated_at,created_by,updated_by,retention_until,retention_protection_until,retention_status,retention_rule_version,retention_recalculated_at,retention_recalculated_by
)
select r.id,r.organization_id,r.legal_entity_id,r.legal_entity_version,r.legal_entity_snapshot,r.name,r.internal_code,r.product_type,r.description,r.responsible_owner_id,r.archived_at,r.archived_by,r.version,r.created_at,r.updated_at,r.created_by,r.updated_by,r.retention_until,r.retention_protection_until,r.retention_status,r.retention_rule_version,r.retention_recalculated_at,r.retention_recalculated_by
from public.products p cross join trend_bench_scope s join public.organization_legal_entities e on e.id=s.entity
cross join lateral jsonb_populate_record(null::public.products,(to_jsonb(p)-'internal_code_normalized')||jsonb_build_object('id',s.product,'organization_id',s.org,'internal_code','synthetic-trends-'||s.product,'legal_entity_id',s.entity,'legal_entity_snapshot',to_jsonb(e)))r
where p.id='00000000-0000-4000-8000-0000000000cd';
-- Keep existing M4 release reconciliation enabled. Wide cohorts use <=1000
-- findings per genuine release, avoiding an unrelated single-release bulk
-- setup artefact while still exercising every distinct finding identity.
create temporary table trend_bench_releases as select n,case when n=1 then s.release else gen_random_uuid() end id from trend_bench_scope s cross join generate_series(1,ceil(:'cohorts'::numeric/1000)::integer)n;
insert into public.product_releases(
 id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,description,lifecycle,archived_at,archived_by,version,created_at,updated_at,created_by,updated_by,placed_on_market_at
)
select r.id,r.organization_id,r.product_id,r.legal_entity_id,r.legal_entity_version,r.legal_entity_snapshot,r.label,r.release_version,r.description,r.lifecycle,r.archived_at,r.archived_by,r.version,r.created_at,r.updated_at,r.created_by,r.updated_by,r.placed_on_market_at
from public.product_releases p cross join trend_bench_scope s cross join trend_bench_releases ri join public.organization_legal_entities e on e.id=s.entity
cross join lateral jsonb_populate_record(null::public.product_releases,(to_jsonb(p)-'release_version_normalized')||jsonb_build_object('id',ri.id,'organization_id',s.org,'product_id',s.product,'legal_entity_id',s.entity,'legal_entity_snapshot',to_jsonb(e),'release_version','synthetic-trends-release-'||ri.n,'label','Synthetic release '||ri.n))r
where p.id='00000000-0000-4000-8000-0000000000ce';
create temporary table trend_bench_findings as select f.n,gen_random_uuid()id,(select id from trend_bench_releases r where r.n=1+(f.n-1)/1000) release_id from generate_series(1,:'cohorts'::integer) f(n);
insert into public.vulnerability_findings
select (jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',i.id,'organization_id',s.org,'release_id',i.release_id,'component_identity','synthetic-trend-'||i.n))).*
from public.vulnerability_findings f cross join trend_bench_scope s cross join trend_bench_findings i where f.id='00000000-0000-4000-8000-0000000000d5';
-- Finish the genuine synthetic source operation before appending individually
-- proven fixture history. Capture remains enabled; otherwise the deferred
-- initial-state observation would supersede our historical terminal cohort.
set constraints all immediate;
set constraints all deferred;
create temporary table trend_bench_clock as
select greatest(
 (select effective_at from public.vulnerability_finding_lifecycle_facts where organization_id=s.org and finding_id is null),
 (select effective_at from public.sbom_release_coverage_facts where organization_id=s.org and release_id is null)
)+interval '1 millisecond' baseline_start, clock_timestamp()-interval '1 millisecond' observation_end
from trend_bench_scope s;
do $$begin if exists(select 1 from trend_bench_clock where observation_end<=baseline_start) then raise exception 'Synthetic observations must follow genuine baseline';end if;end$$;
with allocated as materialized(
 select n,nextval(pg_get_serial_sequence('public.vulnerability_finding_lifecycle_facts','sequence'))seq,
        1+(n-1)%:'cohorts'::integer finding_n from generate_series(1,:'facts'::integer)n
), chained as(select *,lag(seq)over(partition by finding_n order by n)prev from allocated)
insert into public.vulnerability_finding_lifecycle_facts(sequence,organization_id,product_id,release_id,finding_id,fact_kind,effective_at,previous_sequence,payload,provenance,recorded_transaction_id,is_reopening) overriding system value
select c.seq,s.org,s.product,i.release_id,i.id,'observation',t.baseline_start+(t.observation_end-t.baseline_start)*(c.n::double precision/:'facts'::integer),coalesce(c.prev,(select max(sequence)from public.vulnerability_finding_lifecycle_facts where organization_id=s.org and finding_id=i.id)),
 jsonb_build_object('open',(c.n/:'cohorts'::integer)%2=0,'superseded',false,'firstDetectedAt',date_trunc('day',now())-interval'29 days','triagedAt',t.baseline_start+(t.observation_end-t.baseline_start)*0.25,'fixedAt',t.baseline_start+(t.observation_end-t.baseline_start)*0.75,'closedAt',t.baseline_start+(t.observation_end-t.baseline_start)*0.75,'closedEpisodes',jsonb_build_array(jsonb_build_object('key','synthetic-first-closure','at',t.baseline_start+(t.observation_end-t.baseline_start)*0.5,'assessmentId',null,'assessmentRevision',1)),'assessmentId',null,'assessmentRevision',1,'reevaluationState','current'),
 'synthetic_benchmark',s.committed_xid,
 case when c.prev is not null then (c.n/:'cohorts'::integer)%2=0
 else coalesce((select payload->>'open'='false' and coalesce(payload->>'superseded','false')='false' from public.vulnerability_finding_lifecycle_facts where organization_id=s.org and finding_id=i.id order by sequence desc limit 1),false) and (c.n/:'cohorts'::integer)%2=0 end
 from chained c cross join trend_bench_scope s cross join trend_bench_clock t join trend_bench_findings i on i.n=c.finding_n;
with allocated as materialized(select n,nextval(pg_get_serial_sequence('public.sbom_release_coverage_facts','sequence'))seq from generate_series(1,greatest(100,:'facts'::integer/10))n),
chained as(select *,lag(seq)over(order by n)prev from allocated)
insert into public.sbom_release_coverage_facts(sequence,organization_id,product_id,release_id,fact_kind,effective_at,previous_sequence,payload,provenance,recorded_transaction_id,eligible_delta,covered_delta)overriding system value
select seq,s.org,s.product,s.release,'observation',t.baseline_start+(t.observation_end-t.baseline_start)*(n::double precision/greatest(100,:'facts'::integer/10)),coalesce(prev,(select max(sequence)from public.sbom_release_coverage_facts where organization_id=s.org and release_id=s.release)),jsonb_build_object('eligible',true,'covered',n%2=0,'sources','[]'::jsonb),'synthetic_benchmark',committed_xid,
 case when prev is not null then 0 else 1-coalesce((select (payload->>'eligible')::boolean::int from public.sbom_release_coverage_facts where organization_id=s.org and release_id=s.release order by sequence desc limit 1),0) end,
 (n%2=0)::int-case when prev is not null then ((n-1)%2=0)::int else coalesce((select ((payload->>'eligible')::boolean and (payload->>'covered')::boolean)::int from public.sbom_release_coverage_facts where organization_id=s.org and release_id=s.release order by sequence desc limit 1),0) end
 from chained cross join trend_bench_scope s cross join trend_bench_clock t;
analyze public.vulnerability_finding_lifecycle_facts;
analyze public.sbom_release_coverage_facts;
\if :committed
commit;
select jsonb_build_object('heldDatasetReady',true,'organizationId',org,'productId',product,'syntheticFacts',:'facts'::integer,'provenance','isolated-synthetic-only','observationStart',t.baseline_start,'observationEnd',t.observation_end)from trend_bench_scope cross join trend_bench_clock t;
\if :vacuum
-- This maintenance marks committed clone pages all-visible for realistic
-- historical index-only reads. It removes no logical source/fact records and
-- runs after COMMIT with no source workflow locks held.
vacuum(analyze) public.vulnerability_finding_lifecycle_facts;
vacuum(analyze) public.sbom_release_coverage_facts;
\endif
\endif
\if :skip_timing
select jsonb_build_object('sqlTimingSkipped',true,'reason','committed fixture prepared for separate guarded profiling');
\quit
\endif
create temporary table trend_bench_results(endpoint text,elapsed_ms numeric,response_bytes integer,backend_memory_bytes bigint);
do $$declare s record;k integer;started timestamptz;j jsonb;pin jsonb;filters jsonb;e text;mem bigint;revision text;begin
 select *into s from trend_bench_scope;
 filters:=jsonb_build_object('from',(current_date-29)::text,'to',current_date::text,'timezone','UTC','bucket','day','productId',s.product);
 foreach e in array array['trends','sources','capture_authoritative_reconciliation']loop
 for k in 1..(select samples from trend_bench_config)loop
 started:=clock_timestamp();
 if e='trends'then
   j:=public.get_dashboard_trends(s.org,s.actor,filters,null);pin:=j->'snapshot';revision:=j#>>'{result,datasetRevision}';
   if coalesce((select sum((b->>'sampleCount')::integer)from jsonb_array_elements(j#>'{result,series,triage,buckets}')b),0)<>(select cohorts from trend_bench_config)
      or coalesce((select sum((b->>'sampleCount')::integer)from jsonb_array_elements(j#>'{result,series,remediation,buckets}')b),0)<>(select cohorts from trend_bench_config) then
     raise exception 'Synthetic fixture must exercise every configured resolved duration cohort before reconciliation';
   end if;
   if exists(select 1 from jsonb_array_elements(j#>'{result,series,sbomCoverage,buckets}')b where (b->>'denominator')::integer>(select count(*)from trend_bench_releases)) then
     raise exception 'Synthetic coverage fixture exceeded its genuine eligible release count';
   end if;
 elsif e='sources'then
   j:=public.get_dashboard_trend_sources(s.org,s.actor,filters||jsonb_build_object('metric','activity','offset',0,'limit',20,'datasetRevision',revision),pin);
 else
   perform public.m14_02_capture_finding(s.org,(select id from trend_bench_findings where n=1));j:='{}';
 end if;
 select sum(total_bytes)into mem from pg_backend_memory_contexts;
 insert into trend_bench_results values(e,extract(epoch from clock_timestamp()-started)*1000,octet_length(j::text),mem);
 if e in('trends','sources')and j->>'outcome'<>'found'then raise exception 'Benchmark projection failed: %',j->>'outcome';end if;
 if public.get_dashboard_trends(gen_random_uuid(),s.actor,filters,null)->>'outcome'<>'not_found'then raise exception 'Foreign tenant disclosed projection';end if;
 end loop;end loop;
end$$;
select jsonb_build_object('syntheticFacts',c.facts,'cohorts',c.cohorts,'eligibleReleases',(select count(*)from trend_bench_releases),'readinessObservations',0,'historyStart',(select baseline_start from trend_bench_clock),'historyEnd',(select observation_end from trend_bench_clock),'captureMayReconcileSyntheticState',true,'samples',count(*),'endpoint',r.endpoint,'p95Ms',round(percentile_cont(.95)within group(order by elapsed_ms)::numeric,2),'p99Ms',round(percentile_cont(.99)within group(order by elapsed_ms)::numeric,2),'maxResponseBytes',max(response_bytes),'maxBackendMemoryBytes',max(backend_memory_bytes),'scope',case when :'committed'::boolean then'isolated-committed-sql'else'isolated-rollback-sql'end)from trend_bench_results r cross join trend_bench_config c group by c.facts,c.cohorts,r.endpoint;
\if :committed
select pg_sleep(:'hold_seconds'::integer);
\else
rollback;
\endif
