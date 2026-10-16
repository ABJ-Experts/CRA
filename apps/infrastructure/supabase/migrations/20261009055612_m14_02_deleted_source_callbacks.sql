-- Existing organization deletion authority and archival gates remain unchanged.
-- A deferred OLD source callback after an authorized parent cascade cannot
-- recreate its already-deleted organization or immutable baseline markers.
do $migration$
declare definition text;changed text;
begin
 definition:=pg_get_functiondef('public.m14_02_capture_trigger()'::regprocedure);
 if position($anchor$begin
 insert into public.vulnerability_finding_lifecycle_facts$anchor$in definition)=0 then raise exception 'M14-02 source callback parent anchor missing';end if;
 changed:=replace(definition,$anchor$begin
 insert into public.vulnerability_finding_lifecycle_facts$anchor$,$replacement$begin
 if not exists(select 1 from public.organizations where id=org)then return null;end if;
 insert into public.vulnerability_finding_lifecycle_facts$replacement$);
 execute changed;
end $migration$;
-- Support existing composite source-deletion protections and correction lineage.
create index m5_trend_previous_reference on public.vulnerability_finding_lifecycle_facts(organization_id,previous_sequence)where previous_sequence is not null;
create index m3_trend_previous_reference on public.sbom_release_coverage_facts(organization_id,previous_sequence)where previous_sequence is not null;
create index m5_trend_release_reference on public.vulnerability_finding_lifecycle_facts(organization_id,release_id)where release_id is not null;
create index m3_trend_release_reference on public.sbom_release_coverage_facts(organization_id,release_id)where release_id is not null;
