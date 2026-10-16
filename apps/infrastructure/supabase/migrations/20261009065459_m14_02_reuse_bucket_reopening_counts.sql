-- A scalar reopening count was inlined twice when serialized as both reopened
-- and sourceCount. Evaluate it once per authorized pinned calendar bucket.
-- Materialize at most 366 small (timestamp,bigint) rows, never finding payloads
-- or history, then reuse the result. Metric policy and dataset epoch are stable.
do $migration$
declare definition text;changed text;anchor text;replacement text;occurrences integer;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);changed:=definition;
 anchor:=$anchor$bucket_values as(select b.*,$anchor$;
 replacement:=$replacement$reopening_totals as materialized(select b.starts,(select count(*)from facts f where metric='activity'and f.fact_kind='observation'and f.is_reopening and f.effective_at>=b.starts and f.effective_at<b.ends)reopened from boundaries b where metric='activity'),
 bucket_values as(select b.*,$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 reopening bucket anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$coalesce(et.opened,0)opened,coalesce(et.closed,0)closed,(select count(*)from facts f where metric='activity'and f.fact_kind='observation'and f.is_reopening and f.effective_at>=b.starts and f.effective_at<b.ends)reopened,$anchor$;
 replacement:=$replacement$coalesce(et.opened,0)opened,coalesce(et.closed,0)closed,coalesce(rt.reopened,0)reopened,$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 duplicate reopening count anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$from boundaries b left join event_totals et$anchor$;
 replacement:=$replacement$from boundaries b left join reopening_totals rt on rt.starts=b.starts left join event_totals et$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);
 if occurrences<>2 then raise exception 'M14-02 reopening join anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 execute changed;
end $migration$;
