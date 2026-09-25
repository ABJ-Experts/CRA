begin;
create extension if not exists pgtap;
select plan(44);

select ok(to_regclass('public.framework_pack_versions') is not null, 'versioned pack table exists');
select ok(to_regclass('public.framework_requirements') is not null, 'stable requirement table exists');
select ok(to_regclass('public.organization_framework_selections') is not null, 'organization selection table exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.framework_pack_versions'::regclass), 'pack RLS enabled without force');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.framework_requirements'::regclass), 'requirement RLS enabled without force');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.organization_framework_selections'::regclass), 'selection RLS enabled without force');
select ok(to_regclass('public.organization_framework_selections_updated_by_idx') is not null,
  'selection actor foreign key has a covering index');
select ok(exists(select 1 from pg_trigger t
  where t.tgrelid='public.organization_framework_selections'::regclass
    and t.tgname='set_organization_framework_selections_updated_at'
    and not t.tgisinternal
    and t.tgfoid='public.set_updated_at()'::regprocedure),
  'mutable selection uses standard updated_at trigger');
select ok(not has_table_privilege('authenticated','public.organization_framework_selections','select'), 'authenticated cannot read direct selections');
select ok(has_table_privilege('service_role','public.framework_requirements','select'), 'service can read requirements');
select ok(not has_table_privilege('service_role','public.framework_requirements','insert'), 'service cannot mutate immutable requirements');
select ok(not has_function_privilege('service_role','public.m10_import_framework_pack(jsonb)','execute'), 'runtime service cannot import packs');
select ok(has_function_privilege('service_role','public.m10_select_framework_version(uuid,uuid,text,text,boolean,integer,uuid)','execute'), 'service can execute scoped selection');
select is((select outcome from public.m10_select_framework_version(gen_random_uuid(),gen_random_uuid(),'cra-annex-i','oj-2024-11-20-en',true,null,gen_random_uuid())), 'forbidden', 'unknown tenant and actor denied');
select ok((select count(*) from public.framework_requirements where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en') = 25, 'complete Annex I node count');
select ok((select count(*) from public.framework_requirements where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en' and parent_requirement_key is null) = 2, 'both Annex I parts are roots');
select ok((select count(*) from public.framework_requirements where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en' and tree_order between 1 and 25) = 25, 'preorder numbers are complete');

create function pg_temp.m10_test_pack() returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion',1,'packKey','test-pack','versionKey','v1','title','Test pack',
    'editionDate','2024-11-20','language','en',
    'sourceUrl','https://example.org/source','sourceCelex','test-celex',
    'sourceEli','https://example.org/eli','sourcePublicationDate','2024-11-20',
    'attribution','Test fixture','reviewEvidence','Reviewed fixture',
    'requirements',jsonb_build_array(
      jsonb_build_object('requirementKey','root','identifier','Root','parentKey',null,
        'position',1,'heading','Root','text','Root text','sourceReference','Fixture'),
      jsonb_build_object('requirementKey','child','identifier','Child','parentKey','root',
        'position',1,'heading',null,'text','Child text','sourceReference','Fixture')))
$$;
select is(public.m10_import_framework_pack(pg_temp.m10_test_pack()), 'imported', 'valid pack imports');
select is(public.m10_import_framework_pack(pg_temp.m10_test_pack()), 'unchanged', 'identical reimport is idempotent');
select lives_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),
    '{requirements}',jsonb_build_array(pg_temp.m10_test_pack()->'requirements'->1,
    pg_temp.m10_test_pack()->'requirements'->0)))$$,
  'reordering the same requirement tree is idempotent');
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{requirements,1,text}','"Changed"'))$$,
  '23505',null,'same version with different content is rejected');
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{schemaVersion}','2'))$$,
  '22023',null,'unsupported schema is rejected');
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{requirements}',
    (pg_temp.m10_test_pack()->'requirements')||(pg_temp.m10_test_pack()->'requirements'->0)))$$,
  '23505',null,'duplicate stable requirement keys are rejected');
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{requirements,1,parentKey}','"missing"'))$$,
  '23503',null,'missing parent is rejected');
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{requirements,0,parentKey}','"child"'))$$,
  '22023',null,'cycle is rejected');
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{requirements,1,text}','"<script>alert(1)</script>"'))$$,
  '22023',null,'HTML payload is rejected');
select ok((select count(*) from public.framework_requirements where pack_key='test-pack')=2,
  'failed imports do not append partial requirements');
select throws_ok(
  $$update public.framework_requirements set text='Tampered' where pack_key='test-pack'$$,
  '23514',null,'imported text cannot be modified');
select is(public.m10_import_framework_pack(
  jsonb_set(jsonb_set(pg_temp.m10_test_pack(),'{versionKey}','"v2"'),
    '{requirements,1,identifier}','"Renamed child"')),
  'imported','a new edition may rename a requirement');
select ok((select count(*) from public.framework_requirements
  where pack_key='test-pack' and requirement_key='child')=2,
  'stable requirement key survives a display rename across versions');
create function pg_temp.m10_fail_insert() returns trigger language plpgsql as $$
begin raise exception 'Simulated interrupted import'; end $$;
create trigger m10_test_interrupt before insert on public.framework_requirements
for each row when (new.pack_key='interrupted-pack')
execute function pg_temp.m10_fail_insert();
select throws_ok(
  $$select public.m10_import_framework_pack(jsonb_set(pg_temp.m10_test_pack(),'{packKey}','"interrupted-pack"'))$$,
  'P0001',null,'interrupted import raises an error');
select ok(not exists(select 1 from public.framework_pack_versions where pack_key='interrupted-pack'),
  'interrupted import leaves no selectable pack version');
drop trigger m10_test_interrupt on public.framework_requirements;

create temp table m10_test_context on commit drop as
select m.organization_id,u.id actor_user_id,gen_random_uuid() command_key
from public.users u join public.organization_members m on m.user_id=u.id
where u.email='owner@cra.test' and m.role='owner' limit 1;
select ok((select count(*) from m10_test_context)=1,'seeded owner context exists');
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,'test-pack','v1',true,null,c.command_key)),
  'selected','owner explicitly selects first version');
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,'test-pack','v1',true,null,c.command_key)),
  'selected','same idempotency key replays first result');
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,'test-pack','v1',false,null,c.command_key)),
  'invalid_request','idempotency key cannot change command meaning');
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,'test-pack','v1',false,null,gen_random_uuid())),
  'conflict','stale revision is rejected');
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,'test-pack','v1',false,1,gen_random_uuid())),
  'selected','owner can disable selected pack without deleting it');
select ok((select enabled=false and revision=2 from public.organization_framework_selections s
  join m10_test_context c using(organization_id) where s.pack_key='test-pack'),
  'disabled selection remains explicit and revisioned');
select ok((select count(*) from public.audit_logs a join m10_test_context c using(organization_id)
  where a.entity_type='framework_selection' and a.entity_id='test-pack')=2,
  'both state changes are durably audited');
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(gen_random_uuid(),c.actor_user_id,'test-pack','v1',true,null,gen_random_uuid())),
  'forbidden','actor cannot select in another tenant');
insert into public.base_role_permission_overrides(organization_id,base_role,permissions)
select organization_id,'owner','{"can_view_frameworks":false,"can_manage_frameworks":true}'::jsonb
from m10_test_context
on conflict (organization_id,base_role) do update
set permissions=public.base_role_permission_overrides.permissions||excluded.permissions;
select is((select outcome from m10_test_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,'test-pack','v1',true,2,gen_random_uuid())),
  'forbidden','view denial overrides manage grant in scoped selection');
select ok(exists(select 1 from public.organization_export_source_tables
  where source_id='framework_selections'
    and table_name='organization_framework_selections'
    and tenant_key_column='organization_id'),
  'tenant export registers organization framework choices');
select ok(position('public.reporting_deadline_alert_deliveries, public.organization_framework_selections'
  in pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0,
  'tenant export materializer locks selections during snapshots');

select * from finish();
rollback;
