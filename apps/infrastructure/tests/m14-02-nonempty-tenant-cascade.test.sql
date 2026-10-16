begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();release uuid:=gen_random_uuid();actor uuid;seed_entity uuid;
begin
 select id into actor from public.users where email='owner@cra.test';
 select legal_entity_id into seed_entity from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
 insert into public.organizations(id,name,slug)values(org,'M14 rollback-only nonempty tenant','m14-nonempty-'||org);
 insert into public.organization_members(organization_id,user_id,role)values(org,actor,'owner');
 insert into public.organization_legal_entities select(jsonb_populate_record(null::public.organization_legal_entities,to_jsonb(e)||jsonb_build_object('id',entity,'organization_id',org,'identifier','m14-'||entity))).*from public.organization_legal_entities e where id=seed_entity;
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 select product,org,entity,legal_entity_version,legal_entity_snapshot,'M14 rollback-only cascade product','m14-cascade-'||product,product_type,actor,actor,actor from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'limit 1;
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
 select release,org,product,legal_entity_id,legal_entity_version,legal_entity_snapshot,'M14 cascade release','cascade-'||release,'end_of_support',clock_timestamp(),actor,actor from public.products where id=product;
 set constraints all immediate;
 perform pg_temp.check('nonempty tenant source coverage was captured',(select count(*)=2 from public.sbom_release_coverage_facts where organization_id=org));
 set constraints all deferred;
 begin
  delete from public.organizations where id=org;
  set constraints all immediate;
  raise exception 'Expected current audit archival protection';
 exception when foreign_key_violation then perform pg_temp.check('current audit archival gate blocks nonempty tenant deletion',sqlerrm like '%audit_logs_organization_id_fkey%');end;
 perform pg_temp.check('blocked nonempty deletion preserves source coverage',(select count(*)=2 from public.sbom_release_coverage_facts where organization_id=org));
 perform pg_temp.check('blocked nonempty deletion preserves source release and product',exists(select 1 from public.products where id=product)and exists(select 1 from public.product_releases where id=release));
end$$;
-- Exercise the real deferred callback with a deleted source's OLD row, without
-- bypassing current audit archival gates or deleting any persistent source data.
create temporary table products(organization_id uuid,id uuid);
create constraint trigger m14_deleted_source_stub after delete on products deferrable initially deferred for each row execute function public.m14_02_capture_trigger();
do $$declare org uuid:=gen_random_uuid();begin
 insert into public.organizations(id,name,slug)values(org,'M14 rollback-only callback tenant','m14-callback-'||org);
 insert into products values(org,gen_random_uuid());
 delete from public.organizations where id=org;
 delete from products where organization_id=org;
 set constraints all immediate;
 perform pg_temp.check('deleted source callback completes after authorized parent cascade',not exists(select 1 from public.organizations where id=org));
 perform pg_temp.check('deleted source callback never recreates parent markers',not exists(select 1 from public.vulnerability_finding_lifecycle_facts where organization_id=org)and not exists(select 1 from public.sbom_release_coverage_facts where organization_id=org));
end$$;
rollback;
