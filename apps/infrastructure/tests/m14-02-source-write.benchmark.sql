-- Controlled timestamp corrections to one run-owned synthetic finding while
-- measuring reads. Authoritative deferred capture runs at each commit. Facts
-- remain append-only in the isolated clone; no source guards are disabled.
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception'Isolated clone only';end if;end$$;
create temporary table writer_scope as
select f.organization_id,f.id finding,f.first_detected_at original
from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
where p.id=:'product_id'::uuid and p.internal_code like 'synthetic-trends-%'and f.component_identity like'synthetic-trend-%'order by f.id limit 1;
do $$begin if(select count(*)from writer_scope)<>1 then raise exception'Only exact run-owned synthetic product may be corrected';end if;end$$;
create temporary table write_timings(ms numeric);
do $$declare n integer;s record;t timestamptz;elapsed numeric;begin
 select *into s from writer_scope;
 for n in 1..10 loop
  t:=clock_timestamp();
  update public.vulnerability_findings set first_detected_at=clock_timestamp()-interval'1 hour'-n*interval'1 second'where organization_id=s.organization_id and id=s.finding;
  commit;
  elapsed:=extract(epoch from clock_timestamp()-t)*1000;
  insert into write_timings values(elapsed);
  perform pg_sleep(5);
 end loop;
 update public.vulnerability_findings set first_detected_at=s.original where organization_id=s.organization_id and id=s.finding;
 commit;
end$$;
select jsonb_build_object('scope','synthetic-source-write-and-capture','samples',count(*),'p95Ms',round(percentile_cont(.95)within group(order by ms)::numeric,2),'p99Ms',round(percentile_cont(.99)within group(order by ms)::numeric,2),'sourceRestored',true,'history','append-only-retained-in-clone')from write_timings;
