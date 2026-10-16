\set ON_ERROR_STOP on
\timing on
begin;
create temporary table m1201_timings(elapsed_ms numeric) on commit drop;
insert into public.vulnerability_findings(organization_id,release_id,component_identity,canonical_advisory_id,
 vulnerability_id,source_feed_key,source_record_id,source_record_version_id,affected_range_id,
 match_method,comparator_name,comparator_version,evaluated_component_value,affected_range,event_sequence,
 confidence,confidence_table_version,confidence_explanation)
select f.organization_id,f.release_id,left(f.component_identity,4000)||'-m12-load-'||n,
 'M12-LOAD-'||n,f.vulnerability_id,f.source_feed_key,f.source_record_id,f.source_record_version_id,
 f.affected_range_id,f.match_method,f.comparator_name,f.comparator_version,
 f.evaluated_component_value,f.affected_range,f.event_sequence,f.confidence,
 f.confidence_table_version,f.confidence_explanation
from public.vulnerability_findings f cross join generate_series(1,500) n
where f.organization_id='00000000-0000-4000-8000-0000000000ca'
 and f.canonical_advisory_id='CVE-2026-99001' and f.status='active';
do $$
declare v_owner uuid; v_start timestamptz; v_result record; n integer;
begin
 select id into v_owner from public.users where email='owner@cra.test';
 if (select count(*) from public.vulnerability_findings where canonical_advisory_id like 'M12-LOAD-%')<500 then
  raise exception 'load fixture failed';
 end if;
 for n in 1..21 loop
  v_start:=clock_timestamp();
  select * into v_result from public.m1201_list_tasks('00000000-0000-4000-8000-0000000000ca',v_owner,
   'all',null,null,null,null,null,null,50);
  if v_result.outcome<>'found' or jsonb_array_length(v_result.tasks)<>50 then
   raise exception 'read load result invalid: %',v_result.outcome;
  end if;
  if n>1 then insert into pg_temp.m1201_timings values(extract(epoch from clock_timestamp()-v_start)*1000); end if;
  raise notice 'M12 list sample % complete',n;
 end loop;
end $$;
select 500 as synthetic_findings,count(*) as measured_reads,
 round(min(elapsed_ms),1) as min_ms,round(percentile_cont(0.5) within group(order by elapsed_ms)::numeric,1) as p50_ms,
 round(percentile_cont(0.95) within group(order by elapsed_ms)::numeric,1) as p95_ms,
 round(percentile_cont(0.99) within group(order by elapsed_ms)::numeric,1) as p99_ms,
 round(max(elapsed_ms),1) as max_ms from pg_temp.m1201_timings;
do $$
declare v_p95 numeric; v_p99 numeric;
begin
 select percentile_cont(0.95) within group(order by elapsed_ms),
  percentile_cont(0.99) within group(order by elapsed_ms)
 into v_p95,v_p99 from pg_temp.m1201_timings;
 if v_p95>=400 or v_p99>=1000 then
  raise exception 'M12 read target missed: p95=% ms, p99=% ms',round(v_p95,1),round(v_p99,1);
 end if;
end $$;
rollback;
