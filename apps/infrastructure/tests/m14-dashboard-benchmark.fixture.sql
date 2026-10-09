-- Run only through run-m14-dashboard-benchmark.sh against the isolated database.
-- Rollback is the default. Explicit committed mode measures normal RPC-visible
-- rows, then removes only this generated run's exact synthetic IDs.
\if :{?committed}
\else
\set committed false
\endif
\if :{?hold_seconds}
\else
\set hold_seconds 0
\endif
\if :{?benchmark_run_id}
\else
select gen_random_uuid()::text as benchmark_run_id \gset
\endif
\if :{?source_groups}
\else
\set source_groups 1
\endif
\if :{?insert_window}
\else
\set insert_window 50000
\endif
\if :{?assessments}
\else
\set assessments 0
\endif
\if :{?suppressions}
\else
\set suppressions 0
\endif
begin;
do $$begin if current_database()<>'cra_m14_benchmark' then raise exception 'Synthetic benchmark writes require isolated cra_m14_benchmark';end if;end$$;
set local statement_timeout='20min';
create temporary table m14_benchmark_config(products integer,findings integer,samples integer,run_id uuid,hold_seconds integer,source_groups integer,insert_window integer,assessments integer,suppressions integer);
insert into m14_benchmark_config values(:'products'::integer,:'findings'::integer,:'samples'::integer,:'benchmark_run_id'::uuid,:'hold_seconds'::integer,:'source_groups'::integer,:'insert_window'::integer,:'assessments'::integer,:'suppressions'::integer);
do $$declare c record;begin select *into c from m14_benchmark_config;if c.products not between 1 and 10000 or c.findings not between 1 and 1000000 or c.samples not between 2 and 100 or c.hold_seconds not between 0 and 600 or c.source_groups not between 1 and least(c.findings,10000) or c.insert_window not between 1 and 100000 or c.assessments not between 0 and least(c.findings,10000) or c.suppressions not between 0 and least(c.findings,10000) then raise exception 'benchmark bounds invalid';end if;end$$;
analyze m14_benchmark_config;
select jsonb_build_object('benchmarkRunId',run_id,'holdSeconds',hold_seconds,'assessmentCount',assessments,'suppressionCount',suppressions,'committed',:'committed'::boolean)from m14_benchmark_config;
create temporary table m14_benchmark_scope as
select m.organization_id,m.user_id actor from public.organization_members m join public.users u on u.id=m.user_id where u.email='owner@cra.test'and m.organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
create temporary table m14_benchmark_ids as select n,gen_random_uuid()product_id,gen_random_uuid()release_id from generate_series(1,:'products'::integer)n;
-- Bypass write-side audit/reconciliation work only while loading disposable
-- synthetic rows. This fixture measures reads, never write performance.
set local session_replication_role=replica;
do $bench$declare cols text;begin select string_agg(quote_ident(attname),','order by attnum)into cols from pg_attribute where attrelid='public.products'::regclass and attnum>0 and not attisdropped and attgenerated='';execute 'insert into public.products('||cols||') select '||cols||' from ('||$query$select (jsonb_populate_record(null::public.products,to_jsonb(p)||jsonb_build_object('id',i.product_id,'name','M14 disposable benchmark '||i.n,'internal_code','m14-bench-'||c.run_id||'-'||i.product_id,'internal_code_normalized','m14-bench-'||c.run_id||'-'||i.product_id,'archived_at',null,'archived_by',null))).*
from m14_benchmark_ids i cross join m14_benchmark_config c cross join lateral(select p.*from public.products p join m14_benchmark_scope s on s.organization_id=p.organization_id limit 1)p$query$||')records';end$bench$;
do $bench$declare cols text;begin select string_agg(quote_ident(attname),','order by attnum)into cols from pg_attribute where attrelid='public.product_releases'::regclass and attnum>0 and not attisdropped and attgenerated='';execute 'insert into public.product_releases('||cols||') select '||cols||' from ('||$query$select (jsonb_populate_record(null::public.product_releases,to_jsonb(r)||jsonb_build_object('id',i.release_id,'product_id',i.product_id,'label','Benchmark release','release_version','m14-'||i.release_id,'release_version_normalized','m14-'||i.release_id,'archived_at',null,'archived_by',null,'placed_on_market_at',statement_timestamp(),'lifecycle','placed_on_market'))).*
from m14_benchmark_ids i cross join lateral(select r.*from public.product_releases r join m14_benchmark_scope s on s.organization_id=r.organization_id limit 1)r$query$||')records';end$bench$;
-- Distinct, owned immutable source graphs exercise severity/observation work.
-- Default source_groups=1 keeps the original bootstrap-only fixture compatible.
create temporary table m14_benchmark_sources as
select n,gen_random_uuid()vulnerability_id,gen_random_uuid()source_record_id,
gen_random_uuid()source_record_version_id,gen_random_uuid()affected_range_id
from generate_series(1,case when :'source_groups'::integer=1 then 0 else :'source_groups'::integer end)n;
alter table m14_benchmark_sources add primary key(n);
alter table m14_benchmark_sources add column canonical_id text;
update m14_benchmark_sources i set canonical_id='CVE-M14-BENCH-'||c.run_id||'-'||i.vulnerability_id from m14_benchmark_config c;
insert into public.vulnerabilities(id,canonical_id,title)
select i.vulnerability_id,i.canonical_id,'Synthetic M14 benchmark advisory'from m14_benchmark_sources i;
insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id,source_updated_at)
select i.source_record_id,'osv','m14-bench-'||c.run_id||'-'||i.source_record_id,i.vulnerability_id,statement_timestamp()from m14_benchmark_sources i cross join m14_benchmark_config c;
insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload)
select i.source_record_version_id,i.source_record_id,'00000000-0000-4000-8000-0000000000d0',repeat('a',64),'active','{"synthetic":true}','{"synthetic":true}'from m14_benchmark_sources i;
update public.vulnerability_source_records r set current_version_id=i.source_record_version_id from m14_benchmark_sources i where r.id=i.source_record_id;
insert into public.vulnerability_affected_ranges(id,vulnerability_id,source_record_version_id,range_value)
select affected_range_id,vulnerability_id,source_record_version_id,'{}'from m14_benchmark_sources;
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)
select vulnerability_id,source_record_version_id,'osv','cvss',jsonb_build_object('type','cvss','value',jsonb_build_object('version','3.1','baseScore',case n%4 when 0 then 9 when 1 then 7 when 2 then 4 else 1 end,'vectorString','CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'))from m14_benchmark_sources;
analyze m14_benchmark_sources;
analyze m14_benchmark_ids;
analyze public.vulnerabilities;
-- Freeze the neutral bootstrap template before windows add more candidate rows.
create temporary table m14_benchmark_finding_template as
select f.*from public.vulnerability_findings f join m14_benchmark_scope s on s.organization_id=f.organization_id
where f.id='00000000-0000-4000-8000-0000000000d5';
do $$begin if(select count(*)from m14_benchmark_finding_template)<>1 then raise exception 'Missing isolated neutral finding template';end if;end$$;
analyze m14_benchmark_finding_template;
-- Copy typed source columns directly. A JSON roundtrip per row obscures large
-- read benchmarks with fixture-generation cost and adds no coverage.
do $bench$
declare cols text; projection text;c record;window_start integer;window_end integer;
begin
 select *into c from m14_benchmark_config;
 select string_agg(quote_ident(attname),','order by attnum),
 string_agg(case
 when attname='id' then 'gen_random_uuid()'
 when attname='release_id' then 'i.release_id'
 when attname in ('vulnerability_id','source_record_id','source_record_version_id','affected_range_id')then 'coalesce(v.'||quote_ident(attname)||',f.'||quote_ident(attname)||')'
 when attname='canonical_advisory_id'then 'coalesce(v.canonical_id,f.canonical_advisory_id)'
 when attname='last_evaluated_at'then format('f.last_evaluated_at-make_interval(secs=>3600*((g.n-1)/%s%%4)::integer)',c.source_groups)
 when attname='component_identity' then '''m14-bench-component-''||g.n'
 when attname='status' then '''active'''
 when attname='reevaluation_state' then '''unchanged'''
 when attname in ('closed_at','closure_reason','superseded_at','human_verdict','human_rationale','human_assessed_by','human_assessed_at') then 'null'
 else 'f.'||quote_ident(attname) end,','order by attnum)
 into cols,projection from pg_attribute where attrelid='public.vulnerability_findings'::regclass and attnum>0 and not attisdropped and attgenerated='';
 -- Literal validated bounds let PostgreSQL estimate the generated rows exactly.
 -- Windows retain global n, so product/source/observation mapping is unchanged.
 for window_start in select generate_series(1,c.findings,c.insert_window) loop
  window_end:=least(c.findings,window_start+c.insert_window-1);
  execute 'insert into public.vulnerability_findings('||cols||') select '||projection||
   format(' from generate_series(%s,%s)g(n) join m14_benchmark_ids i on i.n=1+((g.n-1)%%%s) left join m14_benchmark_sources v on v.n=1+((g.n-1)%%%s)cross join m14_benchmark_finding_template f',window_start,window_end,c.products,c.source_groups);
  raise notice 'M14 fixture loaded findings %/% (window %..%, run %)',window_end,c.findings,window_start,window_end,c.run_id;
 end loop;
end$bench$;
-- Bounded policy cohorts use generated ordinals; pending fixed remains unresolved.
-- No source-owned write workflow or audit trigger is benchmarked in replica loading.
create temporary table m14_benchmark_policy_ids(n integer primary key,finding_id uuid unique);
do $$declare c record;begin
 select *into c from m14_benchmark_config;
 if greatest(c.assessments,c.suppressions)>0 then
  insert into m14_benchmark_policy_ids
  select substring(f.component_identity from '^m14-bench-component-([0-9]+)$')::integer,f.id
  from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id
  cross join m14_benchmark_scope scope
  where f.organization_id=scope.organization_id and substring(f.component_identity from '^m14-bench-component-([0-9]+)$')::integer<=greatest(c.assessments,c.suppressions);
  if(select count(*)from m14_benchmark_policy_ids)<>greatest(c.assessments,c.suppressions)then raise exception 'Policy finding cohort incomplete';end if;
 end if;
end$$;
analyze m14_benchmark_policy_ids;
insert into public.vulnerability_finding_assessments(organization_id,finding_id,revision,is_current,vex_status,detail,approval_state,approval_required,policy_severity,policy_version,submitted_at,submitted_by,updated_by)
select scope.organization_id,i.finding_id,1,true,'fixed','Synthetic pending benchmark assessment','awaiting_approval',true,'unknown',1,statement_timestamp(),scope.actor,scope.actor
from m14_benchmark_policy_ids i cross join m14_benchmark_config c cross join m14_benchmark_scope scope where i.n<=c.assessments;
insert into public.vulnerability_finding_suppressions(organization_id,finding_id,revision,reason,is_current,created_by,created_at,expires_at)
select scope.organization_id,i.finding_id,1,'Synthetic benchmark suppression',true,scope.actor,statement_timestamp(),statement_timestamp()+interval '1 day'
from m14_benchmark_policy_ids i cross join m14_benchmark_config c cross join m14_benchmark_scope scope where i.n<=c.suppressions;
set local session_replication_role=origin;
-- Synthetic rows are uncommitted, so autovacuum cannot learn this tenant size.
-- Collect planner statistics in the disposable database before measured reads.
analyze public.products;
analyze public.product_releases;
analyze public.vulnerability_findings;
analyze public.vulnerability_finding_assessments;
analyze public.vulnerability_finding_assessment_bulk_operation_targets;
analyze public.vulnerability_finding_suppressions;
analyze m14_benchmark_ids;
analyze m14_benchmark_scope;
analyze public.organization_members;
analyze public.organization_legal_entities;
analyze public.vulnerabilities;
analyze public.vulnerability_source_records;
analyze public.vulnerability_source_record_versions;
analyze public.vulnerability_affected_ranges;
analyze public.vulnerability_enrichments;
analyze m14_benchmark_sources;
-- CHECK/unique constraints remain enforced during loading. Validate every
-- synthetic tenant/release/source relationship bypassed by replica-mode FKs.
do $$declare c record;begin
 select *into c from m14_benchmark_config;
 if current_setting('session_replication_role')<>'origin' or exists(select 1 from pg_trigger where tgrelid in ('public.products'::regclass,'public.product_releases'::regclass,'public.vulnerability_findings'::regclass)and tgenabled='D')then raise exception 'benchmark triggers are not enabled before reads';end if;
 if (select count(*)from public.products p join m14_benchmark_ids i on i.product_id=p.id)<>c.products
 or(select count(*)from public.product_releases r join m14_benchmark_ids i on i.release_id=r.id)<>c.products
 or(select count(*)from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id)<>c.findings then raise exception 'benchmark synthetic fixture count mismatch';end if;
 if (select count(*) from m14_benchmark_ids i left join public.products p on p.id=i.product_id left join public.product_releases r on r.id=i.release_id
 left join public.organization_legal_entities e on e.id=p.legal_entity_id and e.organization_id=p.organization_id
 left join public.organization_members m on m.organization_id=p.organization_id and m.user_id=p.responsible_owner_id
 cross join m14_benchmark_scope s
 where p.id is null or r.id is null or e.id is null or m.id is null or p.organization_id<>s.organization_id or r.organization_id<>s.organization_id or r.product_id<>p.id or r.legal_entity_id<>p.legal_entity_id or r.legal_entity_version<>p.legal_entity_version)>0
 then raise exception 'benchmark product/release tenant relationships invalid';end if;
 if (select count(*) from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id
 left join public.product_releases r on r.id=f.release_id and r.organization_id=f.organization_id
 cross join m14_benchmark_scope scope where r.id is null or f.organization_id<>scope.organization_id)>0
 then raise exception 'benchmark finding/release tenant relationships invalid';end if;
 -- Every generated finding retains its trusted source reference tuple. Check
 -- each distinct tuple once, while validating tenant/release on every row.
 if (with source_keys as materialized(
 select distinct f.vulnerability_id,f.source_record_id,f.source_record_version_id,f.affected_range_id
 from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id)
 select count(*) from source_keys f
 left join public.vulnerabilities v on v.id=f.vulnerability_id
 left join public.vulnerability_source_records src on src.id=f.source_record_id and src.vulnerability_id=f.vulnerability_id
 left join public.vulnerability_source_record_versions ver on ver.id=f.source_record_version_id and ver.source_record_id=f.source_record_id
 left join public.vulnerability_affected_ranges a on a.id=f.affected_range_id and a.vulnerability_id=f.vulnerability_id and a.source_record_version_id=f.source_record_version_id
 where v.id is null or src.id is null or ver.id is null or a.id is null)>0
 then raise exception 'benchmark finding/source tenant relationships invalid';end if;
 if c.source_groups>1 and exists(select 1 from m14_benchmark_sources i where public.m5_triage_observation_severity(i.vulnerability_id,statement_timestamp())<>case i.n%4 when 0 then 'critical'when 1 then 'high'when 2 then 'medium'else 'low'end)then raise exception 'rich source severity did not match authoritative projection';end if;
 if(select count(distinct(f.vulnerability_id,f.last_evaluated_at))from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id)<least(c.findings,4*c.source_groups)then raise exception 'rich observation diversity incomplete';end if;
end$$;
\if :committed
commit;
vacuum(analyze) public.vulnerability_findings;
begin;
\endif
-- Compare the bounded generated product against the source-owned scalar policy.
-- Never invoke a per-finding policy over the million-row tenant merely to test it.
do $$declare c record;s record;actual jsonb;expected bigint;product uuid;severity text;begin
 select *into c from m14_benchmark_config;select *into s from m14_benchmark_scope;
 select product_id into product from m14_benchmark_ids where n=1;
 select count(*)into expected from public.vulnerability_findings f join public.product_releases r on r.id=f.release_id and r.organization_id=f.organization_id
 where f.organization_id=s.organization_id and r.product_id=product and public.m5_finding_is_open(s.organization_id,f.id);
 actual:=public.m5_dashboard_findings(s.organization_id,s.actor,product);
 if(actual#>>'{data,openCount}')::bigint is distinct from expected then raise exception 'bounded product open policy parity failed';end if;
 actual:=public.m5_dashboard_findings(s.organization_id,s.actor,null);
 if(actual#>>'{data,openCount}')::bigint is distinct from c.findings+1 or(actual#>>'{data,suppressedOpenCount}')::bigint is distinct from c.suppressions then raise exception 'Pending assessment/open suppression arithmetic mismatch';end if;
 if(select count(*)from public.vulnerability_finding_assessments a join m14_benchmark_policy_ids i on i.finding_id=a.finding_id where a.organization_id=s.organization_id and a.is_current and a.vex_status='fixed' and a.approval_state='awaiting_approval')<>c.assessments
 or(select count(*)from public.vulnerability_finding_suppressions p join m14_benchmark_policy_ids i on i.finding_id=p.finding_id where p.organization_id=s.organization_id and p.is_current and p.expires_at>statement_timestamp())<>c.suppressions then raise exception 'Policy fixture counts incomplete';end if;
 if c.source_groups>1 and c.source_groups%4=0 and c.findings%c.source_groups=0 then
  actual:=public.m5_dashboard_findings(s.organization_id,s.actor,null);
  foreach severity in array array['critical','high','medium','low']loop
   if(actual#>>array['data','bySeverity',severity])::bigint is distinct from c.findings/4 then raise exception 'rich severity counts incomplete: %',severity;end if;
  end loop;
  if(actual#>>'{data,bySeverity,unknown}')::bigint is distinct from 1 then raise exception 'bootstrap unknown severity was not preserved';end if;
 end if;
end$$;
create temporary table m14_benchmark_results(endpoint text,elapsed_ms numeric,response_bytes integer,backend_memory_bytes bigint,sampleOrdinal integer);
do $$declare s record;c record;k integer;e text;t timestamptz;j jsonb;mem bigint;begin
 select *into s from m14_benchmark_scope;select *into c from m14_benchmark_config;
 foreach e in array array['overview','obligations','readiness','ingestion','posture']loop
 for k in 1..c.samples loop
 t:=clock_timestamp();j:=public.get_dashboard_projection(s.organization_id,s.actor,e,case when e='posture'then jsonb_build_object('productId',(select product_id from m14_benchmark_ids where n=1))else '{"limit":20}'::jsonb end);
 select sum(total_bytes)into mem from pg_backend_memory_contexts;
 insert into m14_benchmark_results values(e,extract(epoch from clock_timestamp()-t)*1000,octet_length(j::text),mem,k);
 if e='overview'and(j#>>'{result,findings,state}'<>'available'or (j#>>'{result,findings,data,openCount}')::bigint<c.findings or exists(select 1 from jsonb_each(j->'result')v where v.value->>'state'='unavailable'))then raise exception 'benchmark source failed or incomplete data';end if;
 if j->>'outcome'<>'found'then raise exception 'benchmark failed authorization';end if;
 if public.get_dashboard_projection(gen_random_uuid(),s.actor,e,'{}')->>'outcome'<>'not_found'then raise exception 'mixed tenant leaked';end if;
 end loop;end loop;
end$$;
select jsonb_build_object('syntheticProducts',c.products,'syntheticFindings',c.findings,'sourceGroups',c.source_groups,'assessmentCount',c.assessments,'suppressionCount',c.suppressions,'endpoint',r.endpoint,'samples',count(*),'p95Ms',round(percentile_cont(.95)within group(order by elapsed_ms)::numeric,2),'p99Ms',round(percentile_cont(.99)within group(order by elapsed_ms)::numeric,2),'maxResponseBytes',max(response_bytes),'first5P95Ms',round(percentile_cont(.95)within group(order by elapsed_ms)filter(where sampleOrdinal<=5)::numeric,2),'steadyP95Ms',round(percentile_cont(.95)within group(order by elapsed_ms)filter(where sampleOrdinal>5)::numeric,2),'maxBackendMemoryBytes',max(backend_memory_bytes))from m14_benchmark_results r cross join m14_benchmark_config c group by c.products,c.findings,c.source_groups,c.assessments,c.suppressions,r.endpoint;
\if :committed
-- Release timing snapshot/source relation locks before holding this owned fixture.
-- Temporary run registries preserve rows across COMMIT for exact cleanup below.
commit;
select jsonb_build_object('heldDatasetReady',true,'benchmarkRunId',run_id,'syntheticProducts',products,'syntheticFindings',findings,'holdSeconds',hold_seconds,'assessmentCount',assessments,'suppressionCount',suppressions,'sourceGroups',source_groups)from m14_benchmark_config;
select pg_sleep(hold_seconds)from m14_benchmark_config;
\else
rollback;
\endif
\if :committed
begin;
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception 'committed cleanup requires isolated database';end if;end$$;
set local session_replication_role=replica;
delete from public.vulnerability_finding_assessments where organization_id='00000000-0000-4000-8000-0000000000ca'and finding_id in(select f.id from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id where f.organization_id='00000000-0000-4000-8000-0000000000ca');
delete from public.vulnerability_finding_suppressions where organization_id='00000000-0000-4000-8000-0000000000ca'and finding_id in(select f.id from public.vulnerability_findings f join m14_benchmark_ids i on i.release_id=f.release_id where f.organization_id='00000000-0000-4000-8000-0000000000ca');
delete from public.vulnerability_findings where organization_id='00000000-0000-4000-8000-0000000000ca'and release_id in(select release_id from m14_benchmark_ids);
delete from public.product_releases where organization_id='00000000-0000-4000-8000-0000000000ca'and id in(select release_id from m14_benchmark_ids);
delete from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'and id in(select product_id from m14_benchmark_ids);
delete from public.vulnerability_enrichments where vulnerability_id in(select vulnerability_id from m14_benchmark_sources);
delete from public.vulnerability_affected_ranges where id in(select affected_range_id from m14_benchmark_sources);
delete from public.vulnerability_source_record_versions where id in(select source_record_version_id from m14_benchmark_sources);
delete from public.vulnerability_source_records where id in(select source_record_id from m14_benchmark_sources);
delete from public.vulnerabilities where id in(select vulnerability_id from m14_benchmark_sources);
set local session_replication_role=origin;
commit;
\endif
