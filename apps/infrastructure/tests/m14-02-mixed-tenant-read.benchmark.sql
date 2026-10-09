-- Read-only fairness probe alongside the primary authenticated HTTP benchmark.
-- Requires the existing synthetic second-tenant fixture, never development.
begin;
set local work_mem='4MB';
set local max_parallel_workers_per_gather=0;
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception'Isolated clone only';end if;end$$;
create temporary table mixed_timings(ms numeric);
do $$declare n integer;started timestamptz;j jsonb;filters jsonb;begin
 filters:=jsonb_build_object('from',(current_date-29)::text,'to',current_date::text,'timezone','UTC','bucket','day');
 for n in 1..50 loop
  started:=clock_timestamp();
  j:=public.get_dashboard_trends('00000000-0000-4000-8000-0000000000da','00000000-0000-4000-8000-0000000000cb',filters,null);
  insert into mixed_timings values(extract(epoch from clock_timestamp()-started)*1000);
  if j->>'outcome'<>'found'or j#>>'{result,organizationId}'<>'00000000-0000-4000-8000-0000000000da'then raise exception'Second tenant authorization/scope mismatch';end if;
  if exists(select 1 from jsonb_array_elements(j#>'{result,series,activity,buckets}')p where coalesce((p->>'opened')::bigint,0)+coalesce((p->>'closed')::bigint,0)+coalesce((p->>'reopened')::bigint,0)>0)then raise exception'Primary finding activity leaked to second tenant';end if;
  if exists(select 1 from jsonb_array_elements(j#>'{result,series,sbomCoverage,buckets}')p where coalesce((p->>'denominator')::bigint,0)>1)then raise exception'Primary release denominator leaked to second tenant';end if;
  perform pg_sleep(2);
 end loop;
end$$;
select jsonb_build_object('scope','second-tenant-sql','samples',count(*),'p95Ms',round(percentile_cont(.95)within group(order by ms)::numeric,2),'p99Ms',round(percentile_cont(.99)within group(order by ms)::numeric,2),'findingActivity',0,'maximumEligibleReleases',1,'overlap','run-alongside-primary-http')from mixed_timings;
rollback;
