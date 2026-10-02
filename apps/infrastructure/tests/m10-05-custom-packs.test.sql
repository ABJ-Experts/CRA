begin;
create extension if not exists pgtap;
select plan(57);
select ok(to_regclass('public.framework_custom_pack_drafts') is not null,'tenant draft table exists');
select ok((select count(*) from information_schema.columns where table_schema='public'
  and table_name='framework_pack_versions' and column_name='owner_org_id')=1,
  'immutable pack versions carry owner');
select ok((select count(*) from information_schema.columns where table_schema='public'
  and table_name='framework_requirements' and column_name='owner_org_id')=1,
  'immutable requirements carry owner');
select ok(to_regprocedure('public.m10_custom_pack_command(uuid,uuid,text,jsonb,integer,uuid)') is not null,
  'scoped command RPC exists');
select ok(to_regprocedure('public.m10_custom_pack_page(uuid,uuid,integer,integer)') is not null,
  'scoped page RPC exists');
select ok(to_regprocedure('public.m10_custom_pack_detail(uuid,uuid,uuid)') is not null,
  'scoped detail RPC exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class
  where oid=to_regclass('public.framework_custom_pack_drafts')),
  'draft RLS enabled without force');
select ok(not has_table_privilege('service_role',to_regclass('public.framework_custom_pack_drafts'),'insert'),
  'service role cannot bypass scoped command');
select ok(has_function_privilege('service_role',to_regprocedure('public.m10_custom_pack_command(uuid,uuid,text,jsonb,integer,uuid)'),'execute'),
  'service role may execute scoped command');
select ok(exists(select 1 from public.organization_export_source_tables where
  table_name='framework_custom_pack_drafts' and tenant_key_column='organization_id'),
  'drafts are included in tenant export');
select ok(exists(select 1 from public.organization_export_source_tables where
  table_name='framework_pack_versions' and tenant_key_column='owner_org_id'),
  'tenant-owned immutable versions are included in tenant export');
create temp table m10_custom_ctx on commit drop as select m.organization_id,u.id actor_id,
  gen_random_uuid() create_key from public.users u join public.organization_members m on m.user_id=u.id
  where u.email='owner@cra.test' limit 1;
create function pg_temp.document(p_title text) returns jsonb language sql as $$
  select jsonb_build_object('title',p_title,'editionDate','2025-01-01','language','en',
    'attribution','Tenant fixture','requirements',jsonb_build_array(jsonb_build_object(
      'requirementKey','r1','identifier','R1','parentKey',null,'position',1,
      'heading','Fixture','text','Tenant owned requirement','sourceReference','Fixture')))
$$;
select ok(to_regprocedure('public.m10_custom_pack_validate(uuid,uuid,jsonb)') is not null,
  'scoped dry-run validation RPC exists');
select ok(has_function_privilege('service_role',
  to_regprocedure('public.m10_custom_pack_validate(uuid,uuid,jsonb)'),'execute'),
  'service role may call scoped validation');
create temp table m10_validation_before on commit drop as select
  (select count(*) from public.framework_pack_versions) versions,
  (select count(*) from public.framework_custom_pack_drafts) drafts,
  (select count(*) from public.audit_logs) audits;
select is((select x.outcome from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,c.actor_id,
    pg_temp.document('Validate only')) x),
  'validated','dry-run accepts a valid document through SQL');
select is((select x.outcome from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,c.actor_id,
    pg_temp.document('<script>unsafe</script>')) x),
  'invalid_request','dry-run rejects content disallowed by publication');
select is((select x.result#>>'{errors,0,path}' from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,c.actor_id,
    pg_temp.document('<script>unsafe</script>')) x),
  'content.title','SQL dry-run identifies invalid metadata field');
select is((select x.result#>>'{errors,0,path}' from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,c.actor_id,
    jsonb_set(pg_temp.document('Invalid parent'),'{requirements,0,parentKey}',
      '"missing"'::jsonb)) x),
  'content.requirements.0.parentKey','SQL dry-run identifies invalid hierarchy field');
select is((select x.result#>>'{errors,0,path}' from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,c.actor_id,
    jsonb_set(pg_temp.document('Invalid position'),'{requirements,0,position}',
      '10001'::jsonb)) x),
  'content.requirements.0.position','SQL dry-run identifies invalid position');
select is((select x.result#>>'{errors,0,path}' from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,c.actor_id,
    jsonb_set(pg_temp.document('Duplicate key'),'{requirements}',
      (pg_temp.document('Duplicate key')->'requirements') ||
      (pg_temp.document('Duplicate key')->'requirements'))) x),
  'content.requirements.1.requirementKey','SQL dry-run identifies duplicate key row');
select is((select x.outcome from m10_custom_ctx c cross join lateral
  public.m10_custom_pack_validate(c.organization_id,gen_random_uuid(),
    pg_temp.document('Validate only')) x),
  'forbidden','dry-run requires an authorized actor');
select ok((select b.versions=(select count(*) from public.framework_pack_versions)
  and b.drafts=(select count(*) from public.framework_custom_pack_drafts)
  and b.audits=(select count(*) from public.audit_logs) from m10_validation_before b),
  'dry-run leaves no pack, draft, or audit writes');
create temp table m10_custom_result on commit drop as
  select c.organization_id,c.actor_id,c.create_key,x.outcome,x.result,
    (x.result->>'draftId')::uuid draft_id from m10_custom_ctx c cross join lateral
    public.m10_custom_pack_command(c.organization_id,c.actor_id,'create_draft',
      jsonb_build_object('document',pg_temp.document('First draft')),null,c.create_key) x;
select is((select outcome from m10_custom_result),'created','tenant creates valid draft');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'create_draft',
    jsonb_build_object('document',pg_temp.document('First draft')),null,c.create_key) x),
  'created','duplicate retry returns stored result');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'create_draft',
    jsonb_build_object('document',pg_temp.document('First draft')),null,gen_random_uuid()) x),
  'unchanged','new request key deduplicates exact tenant document');
select is((select count(*)::integer from public.framework_custom_pack_drafts d
  join m10_custom_result c on d.organization_id=c.organization_id
  where d.document=pg_temp.document('First draft')),1,
  'duplicate import does not allocate another draft');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'publish_version',
    jsonb_build_object('draftId',c.draft_id),1,gen_random_uuid()) x),
  'published','draft publishes immutable v1');
select ok(exists(select 1 from public.framework_pack_versions p join m10_custom_result c
  on p.pack_key=c.result->>'packKey' and p.owner_org_id=c.organization_id
  where p.version_key='v1' and p.source_kind='customer_defined' and p.source_url is null),
  'published content has owner and no fabricated URL');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'save_draft',
    jsonb_build_object('draftId',c.draft_id,'document',pg_temp.document('Second draft')),
    1,gen_random_uuid()) x),'conflict','stale draft revision is rejected');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'save_draft',
    jsonb_build_object('draftId',c.draft_id,'document',pg_temp.document('Second draft')),
    2,gen_random_uuid()) x),'saved','draft can change after publication');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'publish_version',
    jsonb_build_object('draftId',c.draft_id),3,gen_random_uuid()) x),
  'published','revision publishes immutable v2');
select ok((select count(*) from public.framework_pack_versions p join m10_custom_result c
  on p.pack_key=c.result->>'packKey' where p.version_key in ('v1','v2'))=2,
  'prior published version remains readable');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_id,
    c.result->>'packKey','v1',true,null,gen_random_uuid()) x),
  'selected','published custom v1 can be initially selected');
create temp table m10_custom_review on commit drop as select c.organization_id,c.actor_id,
  (x.result->>'reviewId')::uuid review_id from m10_custom_result c cross join lateral
  public.m10_create_upgrade_review(c.organization_id,c.actor_id,c.result->>'packKey',
    'v2',1,gen_random_uuid()) x;
select ok((select review_id is not null from m10_custom_review),
  'review may be prepared before archive');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'archive_draft',
    jsonb_build_object('draftId',c.draft_id),4,gen_random_uuid()) x),
  'archived','draft archive keeps immutable versions');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_upgrade_preview(c.organization_id,c.actor_id,c.result->>'packKey','v2',20,null) x),
  'blocked','archived custom pack blocks upgrade preview');
select is((select x.outcome from m10_custom_review r cross join lateral
  public.m10_commit_upgrade(r.organization_id,r.actor_id,r.review_id,1,gen_random_uuid()) x),
  'blocked','commit rechecks archive after an earlier review');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_id,
    c.result->>'packKey','v1',false,1,gen_random_uuid()) x),
  'selected','archived selected version may be toggled');
select is((select x.outcome from m10_custom_result c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_id,
    c.result->>'packKey','v2',true,2,gen_random_uuid()) x),
  'blocked','archived pack blocks a different selected version');
create temp table m10_unselected on commit drop as select c.organization_id,c.actor_id,
  (x.result->>'draftId')::uuid draft_id,x.result->>'packKey' pack_key
  from m10_custom_result c cross join lateral public.m10_custom_pack_command(
    c.organization_id,c.actor_id,'create_draft',
    jsonb_build_object('document',pg_temp.document('Unselected')),null,gen_random_uuid()) x;
select is((select x.outcome from m10_unselected c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'publish_version',
    jsonb_build_object('draftId',c.draft_id),1,gen_random_uuid()) x),
  'published','second custom pack publishes before archive');
select is((select x.outcome from m10_unselected c cross join lateral
  public.m10_custom_pack_command(c.organization_id,c.actor_id,'archive_draft',
    jsonb_build_object('draftId',c.draft_id),2,gen_random_uuid()) x),
  'archived','unselected pack may be archived');
select is((select x.outcome from m10_unselected c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_id,
    c.pack_key,'v1',true,null,gen_random_uuid()) x),
  'blocked','archived custom pack blocks first selection');
create temp table m10_publish_rollback on commit drop as select c.organization_id,c.actor_id,
  (x.result->>'draftId')::uuid draft_id,x.result->>'packKey' pack_key
  from m10_custom_result c cross join lateral public.m10_custom_pack_command(
    c.organization_id,c.actor_id,'create_draft',
    jsonb_build_object('document',pg_temp.document('Rollback fixture')),null,gen_random_uuid()) x;
select ok((select draft_id is not null from m10_publish_rollback),
  'rollback fixture starts as a distinct draft');
create function pg_temp.reject_custom_audit() returns trigger language plpgsql as $$
begin
  if new.action like 'framework.custom_pack_%' then
    raise exception 'Forced custom audit failure' using errcode='P5010';
  end if;
  return new;
end $$;
create trigger m10_test_reject_custom_audit before insert on public.audit_logs
  for each row execute function pg_temp.reject_custom_audit();
select throws_ok((select format('select outcome from public.m10_custom_pack_command('
  ||'%L::uuid,%L::uuid,%L,jsonb_build_object(''draftId'',%L::uuid),1,%L::uuid)',
  c.organization_id,c.actor_id,'publish_version',c.draft_id,gen_random_uuid())
  from m10_publish_rollback c),'P5010','Forced custom audit failure',
  'audit failure aborts custom publication');
drop trigger m10_test_reject_custom_audit on public.audit_logs;
select ok(not exists(select 1 from public.framework_pack_versions p join m10_publish_rollback c
  on p.pack_key=c.pack_key and p.version_key='v1'),
  'failed publication leaves no immutable version');
select ok((select d.revision=1 and d.published_version=0 and d.status='draft'
  from public.framework_custom_pack_drafts d join m10_publish_rollback c on c.draft_id=d.id),
  'failed publication preserves draft revision and status');
select throws_ok((select format('update public.framework_pack_versions set title=%L '
  ||'where pack_key=%L and version_key=%L','Rewritten',c.result->>'packKey','v1')
  from m10_custom_result c),'23514','Framework pack content is immutable',
  'published custom version rejects direct update');
select throws_ok((select format('delete from public.framework_pack_versions '
  ||'where pack_key=%L and version_key=%L',c.result->>'packKey','v1')
  from m10_custom_result c),'23514','Framework pack content is immutable',
  'published custom version rejects direct delete');
select throws_ok((select format('update public.framework_requirements set text=%L '
  ||'where pack_key=%L and version_key=%L and requirement_key=%L',
  'Rewritten',c.result->>'packKey','v1','r1') from m10_custom_result c),
  '23514','Framework pack content is immutable',
  'published custom requirement rejects direct update');
select throws_ok((select format('delete from public.framework_requirements '
  ||'where pack_key=%L and version_key=%L and requirement_key=%L',
  c.result->>'packKey','v1','r1') from m10_custom_result c),
  '23514','Framework pack content is immutable',
  'published custom requirement rejects direct delete');
select ok((select public.m10_custom_pack_visible(c.organization_id,c.result->>'packKey','v1')
  from m10_custom_result c),'owner can reference published pack');
select ok((select not public.m10_custom_pack_visible(gen_random_uuid(),c.result->>'packKey','v1')
  from m10_custom_result c),'peer tenant cannot reference published pack');
select throws_ok((select format('insert into public.framework_requirement_applicability '
  ||'(organization_id,product_id,pack_key,version_key,requirement_key,'
  ||'approved_non_applicable,revision,updated_by) values (%L,%L,%L,%L,%L,false,1,%L)',
  gen_random_uuid(),(select id from public.products where organization_id=c.organization_id limit 1),
  c.result->>'packKey','v1','r1',c.actor_id) from m10_custom_result c),
  '42501','Framework pack is not visible to organization',
  'organization-scoped applicability rejects a peer-owned pack before FK checks');
create temp table m10_purge_ctx on commit drop as select gen_random_uuid() id,gen_random_uuid() pack_id;
insert into public.organizations(id,name,slug) select id,'Custom purge test',
  'm10-custom-purge-'||replace(id::text,'-','') from m10_purge_ctx;
insert into public.organization_members(organization_id,user_id,role)
select p.id,c.actor_id,'owner' from m10_purge_ctx p cross join m10_custom_result c;
create temp table m10_portable_result on commit drop as select p.id organization_id,
  x.outcome,x.result from m10_purge_ctx p cross join m10_custom_result c
  cross join lateral public.m10_custom_pack_command(p.id,c.actor_id,'create_draft',
    jsonb_build_object('document',pg_temp.document('First draft')),null,gen_random_uuid()) x;
select is((select outcome from m10_portable_result),'created',
  'same portable JSON creates a private draft in a different tenant');
select ok((select p.result->>'packKey'<>c.result->>'packKey'
  from m10_portable_result p cross join m10_custom_result c),
  'portable import receives a new server-generated pack key');
select ok((select d.organization_id=p.organization_id and d.document=pg_temp.document('First draft')
  from m10_portable_result p join public.framework_custom_pack_drafts d
    on d.id=(p.result->>'draftId')::uuid),
  'portable draft is owned by destination tenant with exact content');
select ok(not exists(select 1 from m10_portable_result p
  join public.framework_pack_versions v on v.pack_key=p.result->>'packKey')
  and not exists(select 1 from m10_portable_result p
  join public.framework_control_requirement_mappings m on m.pack_key=p.result->>'packKey'),
  'portable draft does not copy published versions or control mappings');
select public.m10_import_framework_pack(pg_temp.document('Purge fixture') || jsonb_build_object(
  'schemaVersion',1,'packKey','custom.'||pack_id::text,'versionKey','v1',
  'sourceKind','customer_defined','organizationId',id)) from m10_purge_ctx;
insert into public.organization_framework_selections(organization_id,pack_key,version_key,enabled,revision)
select id,'custom.'||pack_id::text,'v1',true,1 from m10_purge_ctx;
delete from public.organizations where id=(select id from m10_purge_ctx);
select ok(not exists(select 1 from public.framework_pack_versions p join m10_purge_ctx c
  on p.pack_key='custom.'||c.pack_id::text),'tenant purge removes owned immutable content');
select * from finish();
rollback;
