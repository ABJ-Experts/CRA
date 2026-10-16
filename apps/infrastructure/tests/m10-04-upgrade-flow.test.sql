begin;
create extension if not exists pgtap;
select plan(24);
create function pg_temp.pack(p_version text,p_requirement text) returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion',1,'packKey','m10-04-test','versionKey',p_version,
    'title','Upgrade fixture','editionDate','2024-01-01','language','en',
    'sourceUrl','https://example.org/fixture','sourcePublicationDate','2024-01-01',
    'attribution','Approved fixture','reviewEvidence','Test review','sourceKind','approved_fixture',
    'requirements',jsonb_build_array(jsonb_build_object('requirementKey',p_requirement,
      'identifier',upper(p_requirement),'parentKey',null,'position',1,'heading',upper(p_requirement),
      'text','Test fixture only','sourceReference','Fixture')))
$$;
select is(public.m10_import_framework_pack(pg_temp.pack('v1','old')),'imported',
  'approved fixture imports without invented EU identifiers');
select is(public.m10_import_framework_pack(pg_temp.pack('v2','new')),'imported',
  'new immutable fixture edition imports');
create temp table m10_04_ctx on commit drop as select m.organization_id,u.id actor_id,
  (select p.id from public.products p where p.organization_id=m.organization_id limit 1) product_id,
  gen_random_uuid() control_id,gen_random_uuid() mapping_id
  from public.users u join public.organization_members m on m.user_id=u.id
  where u.email='owner@cra.test' limit 1;
select ok((select count(*) from m10_04_ctx where product_id is not null)=1,
  'seeded owner has a product for scoped mapping test');
select is((select x.outcome from m10_04_ctx c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_id,'m10-04-test','v1',true,null,gen_random_uuid()) x),
  'selected','owner selects source edition');
select is((select x.outcome from m10_04_ctx c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_id,'m10-04-test','v2',true,1,gen_random_uuid()) x),
  'upgrade_required','ordinary selection rejects silent edition switch');
insert into public.framework_controls(id,organization_id,title,description,owner_user_id,created_by,updated_by)
select control_id,organization_id,'Upgrade control','Test fixture control',actor_id,actor_id,actor_id from m10_04_ctx;
insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,
  owner_user_id,implementation_status,actor_user_id)
select organization_id,control_id,1,'Upgrade control','Test fixture control',actor_id,'not_started',actor_id from m10_04_ctx;
insert into public.framework_control_requirement_mappings(id,organization_id,control_id,pack_key,
  version_key,requirement_key,rationale,source_control_revision,created_by)
select mapping_id,organization_id,control_id,'m10-04-test','v1','old','Reviewed fixture',1,actor_id from m10_04_ctx;
insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
select organization_id,mapping_id,product_id from m10_04_ctx;
insert into public.framework_curated_crosswalks(source_pack_key,source_version_key,source_requirement_key,
  target_pack_key,target_version_key,target_requirement_key,strength,direction,rationale,provenance,
  reviewer,reviewed_at) values('m10-04-test','v1','old','m10-04-test','v2','new',
    'partial','one_way','Reviewer compared fixture requirements','Fixture source','Test reviewer',clock_timestamp());
select is((select x.result->'impacts'->0->'suggestedTargetKeys'->>0 from m10_04_ctx c
  cross join lateral public.m10_upgrade_preview(c.organization_id,c.actor_id,
    'm10-04-test','v2',20,null) x),'new','curated edge appears only as a suggestion');
select is((select x.result->'diff'->'removed'->>0 from m10_04_ctx c
  cross join lateral public.m10_upgrade_preview(c.organization_id,c.actor_id,
    'm10-04-test','v2',20,null) x),'old','diff identifies removed source key');
create temp table m10_04_review on commit drop as select (x.result->>'reviewId')::uuid id,
  gen_random_uuid() commit_key from m10_04_ctx c cross join lateral
  public.m10_create_upgrade_review(c.organization_id,c.actor_id,'m10-04-test','v2',1,gen_random_uuid()) x;
select ok((select count(*) from m10_04_review)=1,'review is created');
select is((select x.outcome from m10_04_ctx c cross join m10_04_review r cross join lateral
  public.m10_commit_upgrade(c.organization_id,c.actor_id,r.id,1,r.commit_key) x),
  'blocked','commit requires every mapping decision');
select is((select version_key from public.organization_framework_selections s
  join m10_04_ctx c using(organization_id) where s.pack_key='m10-04-test'),
  'v1','failed review leaves old selection usable');
select is((select x.outcome from m10_04_ctx c cross join m10_04_review r cross join lateral
  public.m10_set_upgrade_decision(c.organization_id,c.actor_id,r.id,c.mapping_id,
    array['new'],1,gen_random_uuid()) x),'recorded','reviewer records explicit successor');
select is((select x.result->'decisions'->0->>'action' from m10_04_ctx c cross join m10_04_review r
  cross join lateral public.m10_upgrade_review_page(c.organization_id,c.actor_id,r.id,20,0) x),
  'map','review page returns durable decision');
select is((select x.outcome from m10_04_ctx c cross join m10_04_review r cross join lateral
  public.m10_commit_upgrade(c.organization_id,c.actor_id,r.id,2,r.commit_key) x),
  'upgraded','reviewed upgrade commits atomically');
select is((select version_key from public.organization_framework_selections s
  join m10_04_ctx c using(organization_id) where s.pack_key='m10-04-test'),
  'v2','selection changes only after reviewed commit');
select ok((select count(*) from public.framework_control_requirement_mappings m
  join m10_04_ctx c using(organization_id) where m.pack_key='m10-04-test'
    and m.version_key='v1' and m.ended_at is not null)=1,
  'old mapping remains historical');
select ok((select count(*) from public.framework_control_requirement_mappings m
  join m10_04_ctx c using(organization_id) where m.pack_key='m10-04-test'
    and m.version_key='v2' and m.requirement_key='new' and m.ended_at is null)=1,
  'new mapping is active');
select ok((select count(*) from public.framework_control_mapping_products mp
  join public.framework_control_requirement_mappings m on m.organization_id=mp.organization_id
    and m.id=mp.mapping_id join m10_04_ctx c on c.organization_id=mp.organization_id
    and c.product_id=mp.product_id where m.pack_key='m10-04-test' and m.version_key='v2')=1,
  'product scope is copied without duplicating evidence bytes');
select is((select x.result->'relations'->0->>'relationship' from m10_04_ctx c
  cross join lateral public.m10_crosswalk_page(c.organization_id,c.actor_id,'m10-04-test','v1',20,0) x),
  'partial','crosswalk read preserves partial strength');
select is((select x.outcome from m10_04_ctx c cross join lateral
  public.m10_crosswalk_evidence_reuse(c.organization_id,c.actor_id,gen_random_uuid(),c.product_id,20,0) x),
  'not_found','evidence reuse rejects an unrelated version');
select is((select x.outcome from m10_04_ctx c cross join m10_04_review r cross join lateral
  public.m10_commit_upgrade(c.organization_id,c.actor_id,r.id,2,r.commit_key) x),
  'upgraded','commit retry replays durable result');
select ok((select count(*) from public.audit_logs a join m10_04_ctx c using(organization_id)
  where a.action='framework.upgrade_committed' and a.entity_id=(select id::text from m10_04_review))=1,
  'idempotent retry does not duplicate audit');
create temp table m10_04_reverse_review on commit drop as select (x.result->>'reviewId')::uuid id
  from m10_04_ctx c cross join lateral public.m10_create_upgrade_review(
    c.organization_id,c.actor_id,'m10-04-test','v1',2,gen_random_uuid()) x;
select is((select x.outcome from m10_04_ctx c cross join m10_04_reverse_review r
  cross join public.framework_control_requirement_mappings m
  cross join lateral public.m10_set_upgrade_decision(c.organization_id,c.actor_id,r.id,m.id,
    array['old'],1,gen_random_uuid()) x where m.organization_id=c.organization_id
    and m.pack_key='m10-04-test' and m.version_key='v2' and m.ended_at is null),
  'recorded','reverse upgrade decision is recorded');
update public.framework_controls c set revision=revision+1,description='Changed during review'
  from m10_04_ctx x where c.organization_id=x.organization_id and c.id=x.control_id;
select is((select x.outcome from m10_04_ctx c cross join m10_04_reverse_review r cross join lateral
  public.m10_commit_upgrade(c.organization_id,c.actor_id,r.id,2,gen_random_uuid()) x),
  'conflict','concurrent control edit invalidates review fingerprint');
select is((select version_key from public.organization_framework_selections s
  join m10_04_ctx c using(organization_id) where s.pack_key='m10-04-test'),
  'v2','conflicted reverse upgrade leaves current version usable');
select * from finish();
rollback;
