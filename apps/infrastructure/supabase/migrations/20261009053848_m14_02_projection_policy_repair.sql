-- Normalize the already-recorded projection variants, then retain in-range
-- observation counts plus explicitly labelled carried coverage source context.
create index m3_trend_observation_product on public.sbom_release_coverage_facts(organization_id,product_id,effective_at,sequence)include(recorded_transaction_id)where release_id is not null;
create index m3_trend_observation_org on public.sbom_release_coverage_facts(organization_id,effective_at,sequence)include(product_id,recorded_transaction_id)where release_id is not null;
create index m3_trend_release_revision on public.sbom_release_coverage_facts(organization_id,product_id,release_id,sequence desc)include(recorded_transaction_id,effective_at)where release_id is not null;
do $migration$
declare definition text;changed text;anchor text;replacement text;occurrences integer;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);changed:=definition;
 anchor:=$anchor$coverage_totals as(select effective_at,sum(eligible_delta)eligible_delta,sum(covered_delta)covered_delta from coverage_deltas group by 1)$anchor$;replacement:=$replacement$coverage_totals as(select date_trunc(bucket,effective_at at time zone zone)bucket_key,sum(eligible_delta)eligible_delta,sum(covered_delta)covered_delta from coverage_deltas group by 1)$replacement$;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$from boundaries b left join event_totals et on et.starts=b.starts left join duration_totals dt on dt.starts=b.starts)$anchor$;replacement:=$replacement$from boundaries b left join event_totals et on et.bucket_key=date_trunc(bucket,b.starts at time zone zone)left join duration_totals dt on dt.bucket_key=date_trunc(bucket,b.starts at time zone zone))$replacement$;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$ (select count(*)from coverage_deltas cd where cd.effective_at>=greatest(b.starts,baseline)and cd.effective_at<b.ends)coverage_source_count,
$anchor$;replacement:=$replacement$$replacement$;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$ct.effective_at<b.ends$anchor$;replacement:=$replacement$ct.bucket_key<=date_trunc(bucket,b.starts at time zone zone)$replacement$;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$dt.duration_mean,coalesce(dt.sample_count,0)sample_count,coalesce(dt.excluded_count,0)excluded_count,$anchor$;replacement:=$replacement$dt.duration_mean,coalesce(dt.sample_count,0)sample_count,coalesce(dt.excluded_count,0)excluded_count,
 (select count(*)from public.sbom_release_coverage_facts f where metric='sbomCoverage'and f.organization_id=org and f.release_id is not null and f.sequence<=cm and pg_visible_in_snapshot(f.recorded_transaction_id,snap)and f.effective_at>=greatest(b.starts,baseline)and f.effective_at<b.ends)coverage_source_count,$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>2 then raise exception 'M14-02 projection repair anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 -- The second occurrence belongs to the selected-product statement.
 anchor:=$anchor$and f.organization_id=org and f.release_id is not null and f.sequence<=cm and pg_visible_in_snapshot(f.recorded_transaction_id,snap)and f.effective_at>=greatest(b.starts,baseline)$anchor$;occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>2 then raise exception 'M14-02 observation scope anchor count %',occurrences;end if;
 changed:=overlay(changed placing '__M14_ORGANIZATION_OBSERVATION_COUNT__'from position(anchor in changed)for length(anchor));
 changed:=replace(changed,anchor,$replacement$and f.organization_id=org and(f.product_id=product)and f.release_id is not null and f.sequence<=cm and pg_visible_in_snapshot(f.recorded_transaction_id,snap)and f.effective_at>=greatest(b.starts,baseline)$replacement$);
 changed:=replace(changed,'__M14_ORGANIZATION_OBSERVATION_COUNT__',anchor);
 anchor:=$anchor$when metric='sbomCoverage'and starts>=baseline then eligible when metric='readiness'then snapshot_count else 0 end)$anchor$;replacement:=$replacement$when metric='sbomCoverage'and starts>=baseline then coverage_source_count when metric='readiness'then snapshot_count else 0 end)$replacement$;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$0a92fd91-cf0d-4e48-b97a-df0e93a1c963$anchor$;replacement:=$replacement$4d15a924-d2b2-4cd1-a1b1-ff4c3d81e392$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>2 then raise exception 'M14-02 projection repair anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 execute changed;
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);changed:=definition;
 anchor:=$anchor$if product is null then  with recursive opening_facts as materialized(select$anchor$;replacement:=$replacement$if product is null then  with recursive coverage_identities as materialized(select distinct release_id from public.sbom_release_coverage_facts f where metric='sbomCoverage'and from_at>(dataset#>>'{result,baselineAt}')::timestamptz and f.organization_id=p_organization_id and f.release_id is not null and f.sequence<=(pin->>'maxCoverageSequence')::bigint),
 coverage_carried as materialized(select revision.*from coverage_identities i cross join lateral(select f.*from public.sbom_release_coverage_facts f where f.organization_id=p_organization_id and f.release_id=i.release_id and f.sequence<=(pin->>'maxCoverageSequence')::bigint and pg_visible_in_snapshot(f.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)and f.effective_at<from_at order by f.sequence desc limit 1)revision),
 opening_facts as materialized(select$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>1 then raise exception 'M14-02 projection repair anchor count %, expected 1',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$else  with recursive opening_facts as materialized(select$anchor$;replacement:=$replacement$else  with recursive coverage_identities as materialized(select distinct release_id from public.sbom_release_coverage_facts f where metric='sbomCoverage'and from_at>(dataset#>>'{result,baselineAt}')::timestamptz and f.organization_id=p_organization_id and f.release_id is not null and(f.product_id=product)and f.sequence<=(pin->>'maxCoverageSequence')::bigint),
 coverage_carried as materialized(select revision.*from coverage_identities i cross join lateral(select f.*from public.sbom_release_coverage_facts f where f.organization_id=p_organization_id and f.release_id=i.release_id and(f.product_id=product)and f.sequence<=(pin->>'maxCoverageSequence')::bigint and pg_visible_in_snapshot(f.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)and f.effective_at<from_at order by f.sequence desc limit 1)revision),
 opening_facts as materialized(select$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>1 then raise exception 'M14-02 projection repair anchor count %, expected 1',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$ union all select 'coverage-'||f.sequence$anchor$;replacement:=$replacement$ union all select 'coverage-carried-'||f.sequence,f.product_id,f.release_id::text,'release','carried_coverage_context',f.effective_at,f.recorded_at,f.provenance,'/products/'||f.product_id from coverage_carried f
 union all select 'coverage-'||f.sequence$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>2 then raise exception 'M14-02 projection repair anchor count %, expected 2',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 anchor:=$anchor$0a92fd91-cf0d-4e48-b97a-df0e93a1c963$anchor$;replacement:=$replacement$4d15a924-d2b2-4cd1-a1b1-ff4c3d81e392$replacement$;
 occurrences:=(length(changed)-length(replace(changed,anchor,'')))/length(anchor);if occurrences<>1 then raise exception 'M14-02 projection repair anchor count %, expected 1',occurrences;end if;
 changed:=replace(changed,anchor,replacement);
 execute changed;
end $migration$;
notify pgrst,'reload schema';
