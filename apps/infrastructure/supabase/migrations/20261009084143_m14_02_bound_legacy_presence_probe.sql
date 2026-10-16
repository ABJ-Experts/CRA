-- Empty legacy coverage sets must not scan unrelated historical payloads.
-- Use the existing partial index to test exact scoped visibility first. The
-- ordered scalar probe preserves a bounded index seek where EXISTS can choose
-- a full heap scan. Typed deltas, historical facts and policy remain unchanged.
do $migration$
declare definition text;changed text;anchor text;probe text;selected boolean;occurrences integer;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 changed:=definition;
 foreach selected in array array[false,true]loop
  anchor:='where metric=''sbomCoverage''and f.organization_id=org and f.release_id is not null '
   ||case when selected then'and(f.product_id=product)'else''end
   ||'and f.sequence<=cm and pg_visible_in_snapshot(f.recorded_transaction_id,snap)and f.effective_at<least(now_at,(to_date+1)::timestamp at time zone zone)and(f.eligible_delta is null or f.covered_delta is null)';
  occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
  if occurrences<>1 then raise exception'M14-02 unrecognized legacy coverage anchor product %, count %',selected,occurrences;end if;
  probe:='and(select probe.sequence from public.sbom_release_coverage_facts probe '
   ||replace(anchor,'f.','probe.')||' order by probe.product_id,probe.effective_at,probe.sequence limit 1)is not null';
  changed:=replace(changed,anchor,anchor||probe);
 end loop;
 execute changed;
end $migration$;
