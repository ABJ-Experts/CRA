begin;
create extension if not exists pgtap;
select plan(9);
create function pg_temp.pack(p_key text) returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion',1,'packKey',p_key,'versionKey','v1',
    'title','Evidence fixture','editionDate','2024-01-01','language','en',
    'sourceUrl','https://example.org/fixture','sourcePublicationDate','2024-01-01',
    'attribution','Approved fixture','reviewEvidence','Test review','sourceKind','approved_fixture',
    'requirements',jsonb_build_array(jsonb_build_object('requirementKey','req',
      'identifier','REQ','parentKey',null,'position',1,'heading','REQ',
      'text','Test fixture only','sourceReference','Fixture')))
$$;
select is(public.m10_import_framework_pack(pg_temp.pack('m10-04-source')),'imported','source fixture imports');
select is(public.m10_import_framework_pack(pg_temp.pack('m10-04-target')),'imported','target fixture imports');
select public.m10_import_framework_pack(jsonb_set(pg_temp.pack('m10-04-source'),
  '{versionKey}','"v2"'));
create temp table m10_04_ctx on commit drop as select m.organization_id,u.id actor_id,
  vp.product_id,v.id evidence_version_id,
  (select p2.id from public.products p2 where p2.organization_id=m.organization_id
    and p2.id<>vp.product_id order by p2.id limit 1) other_product_id,
  gen_random_uuid() other_control_id,gen_random_uuid() other_mapping_id,
  gen_random_uuid() control_id,
  gen_random_uuid() mapping_id
  from public.users u join public.organization_members m on m.user_id=u.id
  join public.evidence_document_version_products vp on vp.organization_id=m.organization_id
  join public.evidence_document_versions v on v.organization_id=vp.organization_id
    and v.id=vp.version_id and v.processing_state='clean'
    and (v.validity_starts_on is null or v.validity_starts_on<=current_date)
    and (v.validity_ends_on is null or v.validity_ends_on>=current_date)
  join public.evidence_documents d on d.organization_id=v.organization_id
    and d.id=v.document_id and d.lifecycle_state='active'
  join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id
    and p.archived_at is null
  where u.email='owner@cra.test' limit 1;
select ok((select count(*) from m10_04_ctx)=1,'clean scoped evidence fixture exists');
select is((select x.outcome from m10_04_ctx c cross join lateral public.m10_select_framework_version(
  c.organization_id,c.actor_id,'m10-04-source','v1',true,null,gen_random_uuid()) x),
  'selected','source selected');
select is((select x.outcome from m10_04_ctx c cross join lateral public.m10_select_framework_version(
  c.organization_id,c.actor_id,'m10-04-target','v1',true,null,gen_random_uuid()) x),
  'selected','target selected');
insert into public.framework_controls(id,organization_id,title,description,owner_user_id,created_by,updated_by)
select control_id,organization_id,'Evidence control','Test control',actor_id,actor_id,actor_id from m10_04_ctx;
insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,
  owner_user_id,implementation_status,actor_user_id)
select organization_id,control_id,1,'Evidence control','Test control',actor_id,'not_started',actor_id from m10_04_ctx;
insert into public.framework_control_requirement_mappings(id,organization_id,control_id,pack_key,
  version_key,requirement_key,rationale,source_control_revision,created_by)
select mapping_id,organization_id,control_id,'m10-04-source','v1','req','Fixture rationale',1,actor_id from m10_04_ctx;
insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
select organization_id,mapping_id,product_id from m10_04_ctx;
insert into public.framework_control_evidence_links(organization_id,control_id,evidence_version_id,
  product_id,source_control_revision,created_by)
select organization_id,control_id,evidence_version_id,product_id,1,actor_id from m10_04_ctx;
insert into public.framework_curated_crosswalks(source_pack_key,source_version_key,source_requirement_key,
  target_pack_key,target_version_key,target_requirement_key,strength,direction,rationale,provenance,
  reviewer,reviewed_at) values('m10-04-source','v1','req','m10-04-target','v1','req',
  'partial','one_way','Possible reuse only','Fixture source','Test reviewer',clock_timestamp());
select is((select x.result->'relations'->0->>'relationship' from m10_04_ctx c
  cross join lateral public.m10_crosswalk_evidence_reuse(c.organization_id,c.actor_id,
    c.evidence_version_id,c.product_id,20,0) x),'partial',
  'valid evidence exposes advisory relation without certifying target');
insert into public.framework_requirement_applicability(organization_id,product_id,pack_key,
  version_key,requirement_key,approved_non_applicable,reason,revision,updated_by)
select organization_id,product_id,'m10-04-target','v1','req',true,
  'Not applicable to fixture product',1,actor_id from m10_04_ctx;
select is((select jsonb_array_length(x.result->'relations') from m10_04_ctx c
  cross join lateral public.m10_crosswalk_evidence_reuse(c.organization_id,c.actor_id,
    c.evidence_version_id,c.product_id,20,0) x),0,
  'target product non-applicability independently suppresses reuse');
update public.framework_requirement_applicability a
set approved_non_applicable=false,reason=null,revision=2
from m10_04_ctx c where a.organization_id=c.organization_id and a.product_id=c.product_id
  and a.pack_key='m10-04-target';
insert into public.framework_requirement_applicability(organization_id,product_id,pack_key,
  version_key,requirement_key,approved_non_applicable,reason,revision,updated_by)
select organization_id,product_id,'m10-04-source','v1','req',true,
  'Source requirement is not applicable',1,actor_id from m10_04_ctx;
select is((select jsonb_array_length(x.result->'relations') from m10_04_ctx c
  cross join lateral public.m10_crosswalk_evidence_reuse(c.organization_id,c.actor_id,
    c.evidence_version_id,c.product_id,20,0) x),0,
  'source product non-applicability independently suppresses reuse');
insert into public.framework_controls(id,organization_id,title,description,owner_user_id,created_by,updated_by)
select other_control_id,organization_id,'Other product control','Test control',actor_id,actor_id,actor_id from m10_04_ctx;
insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,
  owner_user_id,implementation_status,actor_user_id)
select organization_id,other_control_id,1,'Other product control','Test control',actor_id,'not_started',actor_id from m10_04_ctx;
insert into public.framework_control_requirement_mappings(id,organization_id,control_id,pack_key,
  version_key,requirement_key,rationale,source_control_revision,created_by)
select other_mapping_id,organization_id,other_control_id,'m10-04-source','v1','req',
  'Other product rationale',1,actor_id from m10_04_ctx;
insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
select organization_id,other_mapping_id,other_product_id from m10_04_ctx;
insert into public.framework_control_evidence_links(organization_id,control_id,evidence_version_id,
  product_id,source_control_revision,created_by)
select organization_id,other_control_id,evidence_version_id,product_id,1,actor_id from m10_04_ctx;
select is((select jsonb_array_length(impact->'evidenceVersionIds')
  from m10_04_ctx c cross join lateral public.m10_upgrade_preview(c.organization_id,c.actor_id,
    'm10-04-source','v2',20,null) x
  cross join lateral jsonb_array_elements(x.result->'impacts') impact
  where impact->>'mappingId'=c.other_mapping_id::text),0,
  'preview evidence IDs exclude links outside mapping product scope');
select * from finish();
rollback;
