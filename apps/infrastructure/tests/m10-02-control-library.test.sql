begin;
create extension if not exists pgtap;
select no_plan();

select ok(to_regclass('public.framework_controls') is not null, 'control heads exist');
select ok(to_regclass('public.framework_control_revisions') is not null, 'immutable control revisions exist');
select ok(to_regclass('public.framework_control_evidence_links') is not null, 'exact evidence-version links exist');
select ok(to_regclass('public.framework_control_requirement_mappings') is not null, 'version-pinned mappings exist');
select ok(to_regclass('public.framework_control_mapping_products') is not null, 'mapping product set exists');
select ok(to_regclass('public.framework_control_commands') is not null, 'durable deduplication exists');
select ok(to_regprocedure('public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)') is not null,
  'atomic control command exists');
select ok(not has_schema_privilege('authenticated','public','create'), 'browser roles cannot create schema objects');
select ok((select count(*) from public.framework_requirements where pack_key='cra-annex-i')=25,
  'existing immutable framework text remains intact');
select ok((select count(*) from public.evidence_document_versions)>=0,
  'existing evidence versions remain available');
select ok((select count(*) from public.technical_file_risk_revisions)>=0,
  'existing M7 snapshots remain available');
select ok((select count(*) from public.audit_logs)>=0,
  'existing audit store remains available');
select ok((select count(*) from public.organization_framework_selections)>=0,
  'existing selection store remains available');
select ok((select count(*) from public.products)>=0,
  'existing product store remains available');
select ok((select count(*) from public.organization_members)>=0,
  'existing member store remains available');

select ok((select relrowsecurity and not relforcerowsecurity from pg_class
  where oid='public.framework_controls'::regclass), 'control RLS is enabled and non-forced');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class
  where oid='public.framework_control_requirement_mappings'::regclass),
  'mapping RLS is enabled and non-forced');
select ok((select confdeltype='c' from pg_constraint
  where conname='m10_control_mapping_product_product_fkey'),
  'tenant purge cascades explicit control product applicability');
select ok((select confdeltype='c' from pg_constraint
  where conname='m10_control_evidence_version_product_fkey'),
  'tenant purge cascades exact evidence-version links');
select ok(exists(select 1 from pg_trigger t
  where t.tgrelid='public.framework_controls'::regclass
    and t.tgname='set_framework_controls_updated_at'
    and t.tgfoid='public.set_updated_at()'::regprocedure and not t.tgisinternal),
  'mutable control head uses the standard updated_at trigger');
select ok(not has_table_privilege('authenticated','public.framework_controls','select'),
  'browser role cannot read controls directly');
select ok(not has_table_privilege('service_role','public.framework_controls','insert'),
  'service role cannot bypass command for control writes');
select ok(has_function_privilege('service_role',
  'public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)','execute'),
  'service role can invoke scoped command');
select ok(not has_function_privilege('authenticated',
  'public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)','execute'),
  'browser role cannot invoke scoped command');
select ok(not has_function_privilege('service_role',
  'public.m10_control_command_impl(uuid,uuid,text,jsonb,integer,uuid)','execute'),
  'private implementation cannot be called by runtime service role');
select is((select count(*)::integer from public.organization_export_source_tables
  where source_id='framework_controls'),5,
  'five durable control tables are included in tenant export');
select ok(position('public.framework_control_mapping_products' in pg_get_functiondef(
  'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0,
  'tenant export snapshots control tables under SHARE lock');

create temp table m10_purge_org on commit drop as
with inserted as (
  insert into public.organizations(name,slug)
  values('M10-02 rollback-only tenant','m10-02-'||substr(gen_random_uuid()::text,1,12))
  returning id
) select * from inserted;
insert into public.organization_members(organization_id,user_id,role)
select o.id,u.id,'owner' from m10_purge_org o
cross join public.users u where u.email='owner@cra.test';
create temp table m10_purge_control on commit drop as
with inserted as (
  insert into public.framework_controls(organization_id,title,description,
    owner_user_id,created_by,updated_by)
  select o.id,'Purge fixture','Rollback-only tenant removal fixture',
    u.id,u.id,u.id from m10_purge_org o
  cross join public.users u where u.email='owner@cra.test'
  returning organization_id,id,title,description,owner_user_id,implementation_status,revision,created_by
) select * from inserted;
insert into public.framework_control_revisions(organization_id,control_id,revision,
  title,description,owner_user_id,implementation_status,actor_user_id)
select organization_id,id,revision,title,description,owner_user_id,
  implementation_status,created_by from m10_purge_control;
select is((select r.outcome from public.organization_members m
  join public.users u on u.id=m.user_id
  cross join lateral public.m10_control_command(
    m.organization_id,u.id,'update_control',
    jsonb_build_object('controlId',(select id from m10_purge_control),
      'title','Unauthorized tenant substitution'),1,gen_random_uuid()) r
  where u.email='owner@cra.test' and m.organization_id<>(select id from m10_purge_org)
  limit 1),'not_found',
  'valid control ID from another tenant is invisible under selected organization');
select lives_ok($$delete from public.organizations where id=(select id from m10_purge_org)$$,
  'authorized tenant deletion can cascade control history after M1 retention gate');
select is((select count(*)::integer from public.framework_controls
  where organization_id=(select id from m10_purge_org)),0,
  'tenant purge leaves no orphan control records');

create temp table m10_control_context on commit drop as
select m.organization_id,u.id actor_user_id,null::uuid evidence_version_id,
  p.id product_id,gen_random_uuid() create_key
from public.users u
join public.organization_members m on m.user_id=u.id and m.role='owner'
join public.products p on p.organization_id=m.organization_id and p.archived_at is null
where u.email='owner@cra.test' and u.is_active
limit 1;
select is((select count(*)::integer from m10_control_context),1,
  'owner and active product fixture are available');

create temp table m10_test_document on commit drop as
with inserted as (
  insert into public.evidence_documents(organization_id,created_by)
  select organization_id,actor_user_id from m10_control_context
  returning organization_id,id
) select * from inserted;
create temp table m10_test_version on commit drop as
with inserted as (
  insert into public.evidence_document_versions(
    organization_id,document_id,version_number,title,document_class,
    retention_evidence_class,owner_user_id,uploader_user_id,object_key,
    original_filename,declared_size_bytes,upload_expires_at,
    initialize_idempotency_key,initialize_request_digest)
  select c.organization_id,d.id,1,'M10-02 test evidence','test_report',
    'evidence_document',c.actor_user_id,c.actor_user_id,
    'm10-02-test/'||gen_random_uuid()::text,'m10-02-test.txt',4,
    clock_timestamp()+interval '5 minutes',gen_random_uuid(),repeat('a',64)
  from m10_control_context c join m10_test_document d
    on d.organization_id=c.organization_id
  returning organization_id,id,document_id
) select * from inserted;
insert into public.evidence_document_version_products(organization_id,version_id,product_id)
select c.organization_id,v.id,c.product_id
from m10_control_context c join m10_test_version v
  on v.organization_id=c.organization_id;
update public.evidence_document_versions set processing_state='clean',
  actual_size_bytes=4,detected_media_type='text/plain',
  original_sha256=repeat('a',64),finalized_at=clock_timestamp()
where id=(select id from m10_test_version);
update public.evidence_documents set current_version_id=(select id from m10_test_version)
where id=(select id from m10_test_document);
update m10_control_context set evidence_version_id=(select id from m10_test_version);
select is((select count(*)::integer from public.evidence_document_versions
  where id=(select evidence_version_id from m10_control_context)
    and processing_state='clean'),1,'rollback-only clean evidence version is ready');

create function pg_temp.m10_control_test_command(
  p_operation text,p_payload jsonb,p_expected integer,p_key uuid
) returns table(outcome text,result jsonb)
language sql as $$
  select r.outcome,r.result from m10_control_context c cross join lateral
    public.m10_control_command(c.organization_id,c.actor_user_id,
      p_operation,p_payload,p_expected,p_key) r
$$;

select is((select outcome from m10_control_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,
    'cra-annex-i','oj-2024-11-20-en',true,null,gen_random_uuid())),
  'selected','owner can select the tested pack in rollback-only fixture');

select is((select outcome from public.m10_control_command(
  gen_random_uuid(),(select actor_user_id from m10_control_context),
  'create_control','{"title":"Cross tenant","description":"Denied",
    "implementationStatus":"not_started"}'::jsonb,null,gen_random_uuid())),
  'forbidden','cross-tenant command is denied');
select is((select outcome from pg_temp.m10_control_test_command(
  'create_control','{"title":"<script>x</script>","description":"Unsafe",
    "implementationStatus":"not_started"}'::jsonb,null,gen_random_uuid())),
  'invalid_request','hostile title is rejected before insert');

create temp table m10_created on commit drop as
select r.outcome,r.result from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'create_control',
    jsonb_build_object('title','Secure update review',
      'description','A documented control process',
      'ownerUserId',c.actor_user_id,'implementationStatus','not_started'),
    null,c.create_key) r;
select is((select outcome from m10_created),'created','control is created');
select is((select (result->>'revision')::integer from m10_created),1,
  'created control starts at revision one');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'create_control',
    jsonb_build_object('title','Secure update review',
      'description','A documented control process',
      'ownerUserId',c.actor_user_id,'implementationStatus','not_started'),
    null,c.create_key)),
  'created','retry of same idempotency key returns stored outcome');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'create_control',
    jsonb_build_object('title','Changed command','description','A documented control process',
      'ownerUserId',c.actor_user_id,'implementationStatus','not_started'),
    null,c.create_key)),
  'invalid_request','idempotency key cannot be reused for changed content');
select is((select count(*)::integer from public.framework_controls f
  join m10_control_context c using(organization_id)
  where f.id=(select (result->>'controlId')::uuid from m10_created)),1,
  'replay does not create another control');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'upsert_mapping',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'packKey','cra-annex-i','versionKey','oj-2024-11-20-en',
      'requirementKey','i.1','rationale','Invalid product collection',
      'productIds',jsonb_build_object('unexpected',true)),1,gen_random_uuid())),
  'invalid_request','malformed product collection returns stable error');

create function pg_temp.m10_fail_control_audit()
returns trigger language plpgsql as $$
begin
  if new.action='framework.control_created' then
    raise exception 'simulated audit outage';
  end if;
  return new;
end $$;
create trigger m10_test_fail_audit before insert on public.audit_logs
for each row execute function pg_temp.m10_fail_control_audit();
select throws_ok($m10$
  select r.outcome from m10_control_context c cross join lateral
    public.m10_control_command(c.organization_id,c.actor_user_id,'create_control',
      jsonb_build_object('title','Audit rollback fixture',
        'description','Must never persist without audit',
        'ownerUserId',c.actor_user_id,'implementationStatus','not_started'),
      null,gen_random_uuid()) r
$m10$,'P0001',null,'audit failure rolls back the security-critical command');
drop trigger m10_test_fail_audit on public.audit_logs;
select is((select count(*)::integer from public.framework_controls
  where title='Audit rollback fixture'),0,
  'failed audit leaves no partially created control');

select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'update_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'implementationStatus','in_progress'),2,gen_random_uuid())),
  'conflict','stale revision is rejected');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'update_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'implementationStatus','implemented'),1,gen_random_uuid())),
  'invalid_request','status cannot skip in-progress transition');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'update_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'implementationStatus','in_progress'),1,gen_random_uuid())),
  'updated','status advances to in progress');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'update_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'implementationStatus','implemented'),2,gen_random_uuid())),
  'updated','status advances to implemented');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'update_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'implementationStatus','in_progress'),3,gen_random_uuid())),
  'invalid_request','backward status change needs reason');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'update_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'implementationStatus','in_progress','transitionReason','Evidence review reopened'),
    3,gen_random_uuid())),
  'updated','reasoned backward status change is allowed');
select is((select count(*)::integer from public.framework_control_revisions r
  where r.control_id=(select (result->>'controlId')::uuid from m10_created)),4,
  'every control state change has an immutable revision');

select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'link_evidence',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'evidenceVersionId',c.evidence_version_id,'productId',gen_random_uuid()),
    4,gen_random_uuid())),
  'invalid_request','evidence link cannot substitute a foreign product');
create temp table m10_linked on commit drop as
select r.outcome,r.result from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'link_evidence',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'evidenceVersionId',c.evidence_version_id,'productId',c.product_id),
    4,gen_random_uuid()) r;
select is((select outcome from m10_linked),'linked','clean exact version is linked');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'link_evidence',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'evidenceVersionId',c.evidence_version_id,'productId',c.product_id),
    5,gen_random_uuid())),
  'unchanged','duplicate active evidence link is idempotent');

create temp table m10_mapped on commit drop as
select r.outcome,r.result from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'upsert_mapping',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'packKey','cra-annex-i','versionKey','oj-2024-11-20-en',
      'requirementKey',(select requirement_key from public.framework_requirements
        where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en'
        order by tree_order limit 1),
      'rationale','Documented for selected product',
      'productIds',jsonb_build_array(c.product_id)),5,gen_random_uuid()) r;
select is((select outcome from m10_mapped),'mapped','mapping pins exact requirement version');
select is((select count(*)::integer from public.framework_control_mapping_products mp
  where mp.mapping_id=(select (result->>'mappingId')::uuid from m10_mapped)),1,
  'mapping has exactly the explicit selected product');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'upsert_mapping',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'packKey','cra-annex-i','versionKey','oj-2024-11-20-en',
      'requirementKey',(select requirement_key from public.framework_requirements
        where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en'
        order by tree_order limit 1),
      'rationale','Documented for selected product',
      'productIds',jsonb_build_array(c.product_id)),6,gen_random_uuid())),
  'unchanged','duplicate mapping has stable identity');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'upsert_mapping',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'mappingId',(select result->>'mappingId' from m10_mapped),
      'packKey','cra-annex-i','versionKey','oj-2024-11-20-en',
      'requirementKey',(select requirement_key from public.framework_requirements
        where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en'
        order by tree_order desc limit 1),
      'rationale','Attempt to retarget',
      'productIds',jsonb_build_array(c.product_id)),6,gen_random_uuid())),
  'invalid_request','mapping edit cannot retarget stable requirement identity');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'upsert_mapping',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created),
      'mappingId',(select result->>'mappingId' from m10_mapped),
      'packKey','cra-annex-i','versionKey','oj-2024-11-20-en',
      'requirementKey',(select requirement_key from public.framework_requirements
        where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en'
        order by tree_order limit 1),
      'rationale','Revised documented scope',
      'productIds',jsonb_build_array(c.product_id)),6,gen_random_uuid())),
  'mapped','mapping edit creates new historical row');
select ok((select count(*) from public.framework_control_requirement_mappings m
  where m.control_id=(select (result->>'controlId')::uuid from m10_created)
    and m.ended_at is not null)=1,
  'superseded mapping remains as history');
select is((select outcome from m10_control_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'archive_control',
    jsonb_build_object('controlId',(select result->>'controlId' from m10_created)),
    7,gen_random_uuid())),
  'archived','control archive is revisioned');
select ok(exists(select 1 from public.framework_control_evidence_links l
  where l.control_id=(select (result->>'controlId')::uuid from m10_created)),
  'archive preserves exact evidence link history');
select ok(exists(select 1 from public.framework_control_requirement_mappings m
  where m.control_id=(select (result->>'controlId')::uuid from m10_created)),
  'archive preserves version-pinned mapping history');
select ok((select count(*) from public.audit_logs a
  where a.entity_type='framework_control'
    and a.entity_id=(select result->>'controlId' from m10_created))>=8,
  'every state change has durable audit in the same transaction');

update public.users set is_active=false
where id=(select actor_user_id from m10_control_context);
select ok(exists(select 1 from public.framework_controls f
  join m10_control_context c on c.organization_id=f.organization_id
  left join public.users u on u.id=f.owner_user_id
  where f.id=(select (result->>'controlId')::uuid from m10_created)
    and u.is_active=false), 'inactive owner remains visible as ownership gap');

select * from finish();
rollback;
