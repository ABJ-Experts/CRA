begin;
create extension if not exists pgtap;
select plan(8);
create function pg_temp.pack(p_version text,p_requirements jsonb) returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion',1,'packKey','m10-04-merge-test',
    'versionKey',p_version,'title','Merge fixture','editionDate','2024-01-01',
    'language','en','sourceUrl','https://example.org/fixture',
    'sourcePublicationDate','2024-01-01','attribution','Approved fixture',
    'reviewEvidence','Test review','sourceKind','approved_fixture','requirements',p_requirements)
$$;
create function pg_temp.req(k text,n integer) returns jsonb language sql as $$
  select jsonb_build_object('requirementKey',k,'identifier',upper(k),'parentKey',null,
    'position',n,'heading',upper(k),'text','Fixture only','sourceReference','Fixture')
$$;
select is(public.m10_import_framework_pack(pg_temp.pack('v1',jsonb_build_array(
  pg_temp.req('old-a',1),pg_temp.req('old-b',2)))),'imported','source pair imports');
select is(public.m10_import_framework_pack(pg_temp.pack('v2',jsonb_build_array(
  pg_temp.req('new',1)))),'imported','merged target imports');
create temp table ctx on commit drop as select m.organization_id,u.id actor_id,
  gen_random_uuid() control_id,gen_random_uuid() mapping_a,gen_random_uuid() mapping_b,
  (select p.id from public.products p where p.organization_id=m.organization_id order by p.id limit 1) product_a,
  (select p.id from public.products p where p.organization_id=m.organization_id order by p.id offset 1 limit 1) product_b
  from public.users u join public.organization_members m on m.user_id=u.id
  where u.email='owner@cra.test' limit 1;
select ok((select product_a is not null and product_b is not null from ctx),
  'two products exist for merged product-scope union');
select is((select x.outcome from ctx c cross join lateral public.m10_select_framework_version(
  c.organization_id,c.actor_id,'m10-04-merge-test','v1',true,null,gen_random_uuid()) x),
  'selected','source selected');
insert into public.framework_controls(id,organization_id,title,description,owner_user_id,created_by,updated_by)
select control_id,organization_id,'Merge control','Fixture control',actor_id,actor_id,actor_id from ctx;
insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,
  owner_user_id,implementation_status,actor_user_id)
select organization_id,control_id,1,'Merge control','Fixture control',actor_id,'not_started',actor_id from ctx;
insert into public.framework_control_requirement_mappings(id,organization_id,control_id,pack_key,
  version_key,requirement_key,rationale,source_control_revision,created_by)
select mapping_a,organization_id,control_id,'m10-04-merge-test','v1','old-a','Fixture A',1,actor_id from ctx
union all select mapping_b,organization_id,control_id,'m10-04-merge-test','v1','old-b','Fixture B',1,actor_id from ctx;
insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
select organization_id,mapping_a,product_a from ctx
union all select organization_id,mapping_b,product_b from ctx;
create temp table review on commit drop as select (x.result->>'reviewId')::uuid id
  from ctx c cross join lateral public.m10_create_upgrade_review(c.organization_id,c.actor_id,
    'm10-04-merge-test','v2',1,gen_random_uuid()) x;
select is((select x.outcome from ctx c cross join review r cross join lateral
  public.m10_set_upgrade_decision(c.organization_id,c.actor_id,r.id,c.mapping_a,
    array['new'],1,gen_random_uuid()) x),'recorded','first source review recorded');
select is((select x.outcome from ctx c cross join review r cross join lateral
  public.m10_set_upgrade_decision(c.organization_id,c.actor_id,r.id,c.mapping_b,
    array['new'],2,gen_random_uuid()) x),'recorded','second source review recorded');
select is((select x.result->>'migratedCount' from ctx c cross join review r cross join lateral
  public.m10_commit_upgrade(c.organization_id,c.actor_id,r.id,3,gen_random_uuid()) x),
  '1','merged decisions create one target mapping');
select ok((select count(*) from public.framework_control_mapping_products mp
  join public.framework_control_requirement_mappings m on m.organization_id=mp.organization_id and m.id=mp.mapping_id
  join ctx c on c.organization_id=mp.organization_id where m.pack_key='m10-04-merge-test'
    and m.version_key='v2' and m.requirement_key='new' and m.ended_at is null)=2,
  'merged mapping carries union of both product scopes');
select * from finish();
rollback;
