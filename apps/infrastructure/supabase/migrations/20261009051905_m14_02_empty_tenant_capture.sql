-- An empty tenant needs a capture epoch before its first product exists.
-- Install both source markers in the organization creation transaction.
create function public.m14_02_capture_new_organization()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare epoch uuid:=gen_random_uuid();
begin
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,fact_kind,payload,provenance)values(new.id,'baseline',jsonb_build_object('epoch',epoch),'organization_created')on conflict(organization_id)where finding_id is null do nothing;
 insert into public.sbom_release_coverage_facts(organization_id,fact_kind,payload,provenance)values(new.id,'baseline',jsonb_build_object('epoch',epoch),'organization_created')on conflict(organization_id)where release_id is null do nothing;
 return null;
end$$;
revoke all on function public.m14_02_capture_new_organization()from public,anon,authenticated,service_role;
grant execute on function public.m14_02_capture_new_organization()to postgres;
create trigger m14_02_capture_organization after insert on public.organizations for each row execute function public.m14_02_capture_new_organization();
-- Repair only markers missing since the original deployment. Current source
-- state is observed now; created_at and earlier history are never reconstructed.
do $migration$
declare org uuid;epoch uuid;entity uuid;
begin
 for org in select o.id from public.organizations o where not exists(select 1 from public.vulnerability_finding_lifecycle_facts f where f.organization_id=o.id and f.finding_id is null)or not exists(select 1 from public.sbom_release_coverage_facts f where f.organization_id=o.id and f.release_id is null)order by o.id loop
  epoch:=coalesce((select(payload->>'epoch')::uuid from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null),gen_random_uuid());
  insert into public.vulnerability_finding_lifecycle_facts(organization_id,fact_kind,payload,provenance)values(org,'baseline',jsonb_build_object('epoch',epoch),'missing_marker_deployment_baseline')on conflict(organization_id)where finding_id is null do nothing;
  insert into public.sbom_release_coverage_facts(organization_id,fact_kind,payload,provenance)values(org,'baseline',jsonb_build_object('epoch',epoch),'missing_marker_deployment_baseline')on conflict(organization_id)where release_id is null do nothing;
  for entity in select id from public.vulnerability_findings where organization_id=org order by id loop perform public.m14_02_capture_finding(org,entity,true);end loop;
  for entity in select id from public.product_releases where organization_id=org order by id loop perform public.m14_02_capture_release(org,entity,true);end loop;
 end loop;
end $migration$;
