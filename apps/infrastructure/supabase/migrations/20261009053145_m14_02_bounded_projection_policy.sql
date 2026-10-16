-- Bound partial calendar buckets to the requested end, inline scalar streams,
-- and count reopenings through bounded index ranges without sorting each event.
-- Deployment namespace invalidates earlier pins without modifying source epochs.
do $migration$
declare definition text;changed text;anchor text;replacement text;occurrences integer;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);changed:=definition;
 anchor:=$anchor$e.at<now_at group by 1$anchor$;replacement:=$replacement$e.at<least(now_at,(to_date+1)::timestamp at time zone zone)group by 1$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$d.at<now_at group by 1$anchor$;replacement:=$replacement$d.at<least(now_at,(to_date+1)::timestamp at time zone zone)group by 1$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$f.effective_at<now_at and$anchor$;replacement:=$replacement$f.effective_at<least(now_at,(to_date+1)::timestamp at time zone zone)and$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>4 then raise exception 'M14-02 bounded projection anchor count %, expected 4',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$ facts as materialized($anchor$;replacement:=$replacement$ facts as not materialized($replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$coverage_deltas as materialized($anchor$;replacement:=$replacement$coverage_deltas as not materialized($replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$
 union all select finding_id,'reopened',effective_at from facts where fact_kind='observation'and is_reopening)$anchor$;replacement:=$replacement$)$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$coalesce(et.reopened,0)reopened$anchor$;replacement:=$replacement$(select count(*)from facts f where metric='activity'and f.fact_kind='observation'and f.is_reopening and f.effective_at>=b.starts and f.effective_at<b.ends)reopened$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$select payload->>'epoch'from public.vulnerability_finding_lifecycle_facts$anchor$;replacement:=$replacement$select extensions.uuid_generate_v5('0a92fd91-cf0d-4e48-b97a-df0e93a1c963'::uuid,payload->>'epoch')::text from public.vulnerability_finding_lifecycle_facts$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 bounded projection anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 execute changed;
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);changed:=definition;
 anchor:=$anchor$select payload->>'epoch'from public.vulnerability_finding_lifecycle_facts$anchor$;replacement:=$replacement$select extensions.uuid_generate_v5('0a92fd91-cf0d-4e48-b97a-df0e93a1c963'::uuid,payload->>'epoch')::text from public.vulnerability_finding_lifecycle_facts$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>1 then raise exception 'M14-02 bounded projection anchor count %, expected 1',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 execute changed;
end $migration$;
-- Local to this function and restored on return; no global database setting.
-- Quiet 1m history measured p95 559ms with JIT versus 463ms without it.
alter function public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)set jit=off;
notify pgrst,'reload schema';
do $migration$
declare
 definition text;
 changed text;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 changed:=replace(definition,
$anchor$event_totals as(select date_trunc(bucket,e.at at time zone zone)bucket_key,count(*)filter(where kind='opened')opened,count(*)filter(where kind='closed')closed,count(*)filter(where kind='reopened')reopened from events e where metric='activity'and e.at>=greatest(from_date::timestamp at time zone zone,baseline)and e.at<now_at group by 1),
 duration_totals as(select date_trunc(bucket,d.at at time zone zone)bucket_key,avg(value)filter(where value>=0 and d.at>=baseline)duration_mean,count(*)filter(where value>=0 and d.at>=baseline)sample_count,count(*)filter(where value<0 and d.at>=baseline)excluded_count from durations d where metric in('triage','remediation')and d.at>=from_date::timestamp at time zone zone and d.at<now_at group by 1),$anchor$,
$replacement$event_totals as(select b.starts,count(*)filter(where e.kind='opened')opened,count(*)filter(where e.kind='closed')closed,count(*)filter(where e.kind='reopened')reopened from boundaries b left join events e on metric='activity'and e.at>=b.starts and e.at<b.ends group by b.starts),
 duration_totals as(select b.starts,avg(d.value)filter(where d.value>=0 and d.at>=baseline)duration_mean,count(*)filter(where d.value>=0 and d.at>=baseline)sample_count,count(*)filter(where d.value<0 and d.at>=baseline)excluded_count from boundaries b left join durations d on metric in('triage','remediation')and d.at>=b.starts and d.at<b.ends group by b.starts),$replacement$);
 changed:=replace(changed,
$anchor$coverage_totals as(select date_trunc(bucket,effective_at at time zone zone)bucket_key,sum(eligible_delta)eligible_delta,sum(covered_delta)covered_delta from coverage_deltas group by 1),$anchor$,
$replacement$coverage_totals as(select effective_at,sum(eligible_delta)eligible_delta,sum(covered_delta)covered_delta from coverage_deltas group by 1),$replacement$);
 changed:=replace(changed,
$anchor$dt.duration_mean,coalesce(dt.sample_count,0)sample_count,coalesce(dt.excluded_count,0)excluded_count,
 coalesce((select sum(covered_delta)from coverage_totals ct where ct.bucket_key<=date_trunc(bucket,b.starts at time zone zone)),0)covered,
 coalesce((select sum(eligible_delta)from coverage_totals ct where ct.bucket_key<=date_trunc(bucket,b.starts at time zone zone)),0)eligible,$anchor$,
$replacement$dt.duration_mean,coalesce(dt.sample_count,0)sample_count,coalesce(dt.excluded_count,0)excluded_count,
 (select count(*)from coverage_deltas cd where cd.effective_at>=greatest(b.starts,baseline)and cd.effective_at<b.ends)coverage_source_count,
 coalesce((select sum(covered_delta)from coverage_totals ct where ct.effective_at<b.ends),0)covered,
 coalesce((select sum(eligible_delta)from coverage_totals ct where ct.effective_at<b.ends),0)eligible,$replacement$);
 changed:=replace(changed,
$anchor$from boundaries b left join event_totals et on et.bucket_key=date_trunc(bucket,b.starts at time zone zone)left join duration_totals dt on dt.bucket_key=date_trunc(bucket,b.starts at time zone zone)),$anchor$,
$replacement$from boundaries b left join event_totals et on et.starts=b.starts left join duration_totals dt on dt.starts=b.starts),$replacement$);
 changed:=replace(changed,
$anchor$when metric='sbomCoverage'and starts>=baseline then eligible when metric='readiness'then snapshot_count else 0 end)order by starts),'[]')into points from readiness_values;$anchor$,
$replacement$when metric='sbomCoverage'and starts>=baseline then coverage_source_count when metric='readiness'then snapshot_count else 0 end)order by starts),'[]')into points from readiness_values;$replacement$);
 if changed=definition then
  raise exception 'M14-02 bounded projection trend anchors missing';
 end if;
 execute changed;

 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 changed:=replace(definition,
$anchor$and f.sequence<=(pin->>'maxCoverageSequence')::bigint and pg_visible_in_snapshot(f.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)and f.effective_at<to_at$anchor$,
$replacement$and f.sequence<=(pin->>'maxCoverageSequence')::bigint and pg_visible_in_snapshot(f.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)and f.effective_at>=greatest(from_at,(dataset#>>'{result,baselineAt}')::timestamptz)and f.effective_at<to_at$replacement$);
 if changed=definition then
  raise exception 'M14-02 bounded projection source anchors missing';
 end if;
 execute changed;
end $migration$;
