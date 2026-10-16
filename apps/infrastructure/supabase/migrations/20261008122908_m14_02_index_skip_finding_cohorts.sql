-- Enumerate source identities through ordered index seeks rather than repeatedly
-- visiting every retained revision. Pinned latest revision visibility is unchanged.
create index m5_trend_product_cohort_revision on public.vulnerability_finding_lifecycle_facts(organization_id,product_id,finding_id,sequence desc)include(recorded_transaction_id)where finding_id is not null;
do $migration$
declare definition text;changed text;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 if position($anchor$identities as materialized(select distinct finding_id from public.vulnerability_finding_lifecycle_facts where metric in('activity','triage','remediation')and organization_id=org and finding_id is not null and(product is null or product_id=product)and sequence<=fm),
 $anchor$in definition)=0 then raise exception 'M14-02 cohort identity anchor missing for get_dashboard_trends';end if;
 changed:=replace(definition,$anchor$identities as materialized(select distinct finding_id from public.vulnerability_finding_lifecycle_facts where metric in('activity','triage','remediation')and organization_id=org and finding_id is not null and(product is null or product_id=product)and sequence<=fm),
 $anchor$,$replacement$identities as materialized((select f.finding_id from public.vulnerability_finding_lifecycle_facts f where metric in('activity','triage','remediation')and f.organization_id=org and f.finding_id is not null and(product is null or f.product_id=product)and f.sequence<=fm order by f.finding_id limit 1)
 union all select next_id.finding_id from identities prior cross join lateral(select f.finding_id from public.vulnerability_finding_lifecycle_facts f where f.organization_id=org and f.finding_id>prior.finding_id and(product is null or f.product_id=product)and f.sequence<=fm order by f.finding_id limit 1)next_id),
 $replacement$);
 changed:=replace(changed,'with calendar_boundaries as','with recursive calendar_boundaries as');
 execute changed;
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 if position($anchor$finding_identities as materialized(select distinct finding_id from public.vulnerability_finding_lifecycle_facts where metric in('activity','triage','remediation')and organization_id=p_organization_id and finding_id is not null and(product is null or product_id=product)and sequence<=(pin->>'maxFindingSequence')::bigint),
 $anchor$in definition)=0 then raise exception 'M14-02 cohort identity anchor missing for get_dashboard_trend_sources';end if;
 changed:=replace(definition,$anchor$finding_identities as materialized(select distinct finding_id from public.vulnerability_finding_lifecycle_facts where metric in('activity','triage','remediation')and organization_id=p_organization_id and finding_id is not null and(product is null or product_id=product)and sequence<=(pin->>'maxFindingSequence')::bigint),
 $anchor$,$replacement$finding_identities as materialized((select f.finding_id from public.vulnerability_finding_lifecycle_facts f where metric in('activity','triage','remediation')and f.organization_id=p_organization_id and f.finding_id is not null and(product is null or f.product_id=product)and f.sequence<=(pin->>'maxFindingSequence')::bigint order by f.finding_id limit 1)
 union all select next_id.finding_id from finding_identities prior cross join lateral(select f.finding_id from public.vulnerability_finding_lifecycle_facts f where f.organization_id=p_organization_id and f.finding_id>prior.finding_id and(product is null or f.product_id=product)and f.sequence<=(pin->>'maxFindingSequence')::bigint order by f.finding_id limit 1)next_id),
 $replacement$);
 changed:=replace(changed,'with opening_facts as','with recursive opening_facts as');
 execute changed;
end $migration$;
