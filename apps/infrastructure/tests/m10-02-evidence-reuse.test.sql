begin;
create extension if not exists pgtap;
select no_plan();

select ok(to_regprocedure('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)') is not null, 'reuse RPC remains callable');
select ok(has_function_privilege('service_role','public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)','execute') and not has_function_privilege('authenticated','public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)','execute'), 'reuse RPC is service-role mediated');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure), 'reuse function has a pinned search path');
select ok(position('can_view_evidence' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'evidence permission gates the base response');
select ok(position('can_view_frameworks' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'framework permission gates control links');
select ok(position('can_view_products' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'product permission gates control links');
select ok(position('evidence_version_id=p_version_id' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'reverse links pin the exact evidence version');
select ok(position('product_id=p_product_id' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'reverse links do not reveal other products');
select ok(position('ended_at is null' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0 and position('archived_at is null' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'current projection excludes ended and archived controls');
select is((select outcome from public.get_evidence_document_reuse_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())), 'forbidden', 'unverified caller fails closed');

create temp table m10_reuse_context on commit drop as
select m.organization_id,u.id actor_user_id,ev.id evidence_version_id,
  ev.document_id,vp.product_id
from public.users u
join public.organization_members m on m.user_id=u.id and m.role='owner'
join public.evidence_document_versions ev on ev.organization_id=m.organization_id
  and ev.processing_state='clean'
join public.evidence_document_version_products vp
  on vp.organization_id=ev.organization_id and vp.version_id=ev.id
join public.products p on p.organization_id=vp.organization_id
  and p.id=vp.product_id and p.archived_at is null
where u.email='owner@cra.test' and u.is_active
  and (ev.validity_starts_on is null or ev.validity_starts_on<=current_date)
  and (ev.validity_ends_on is null or ev.validity_ends_on>=current_date)
limit 1;
select is((select count(*)::integer from m10_reuse_context),1,
  'run-scoped fixture has an owner, active product, and clean evidence version');

select ok((select outcome in ('selected','unchanged') from m10_reuse_context c
  cross join lateral public.m10_select_framework_version(c.organization_id,
    c.actor_user_id,'cra-annex-i','oj-2024-11-20-en',true,null,gen_random_uuid())),
  'reviewed framework version is selected for the fixture');

create temp table m10_reuse_control on commit drop as
select c.*,r.outcome,r.result from m10_reuse_context c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'create_control',
    jsonb_build_object('title','M10 reverse projection fixture',
      'description','Rollback-only test control','ownerUserId',c.actor_user_id,
      'implementationStatus','not_started'),null,gen_random_uuid()) r;
select is((select outcome from m10_reuse_control),'created',
  'fixture control is created transactionally');

select is((select r.outcome from m10_reuse_control c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'link_evidence',
    jsonb_build_object('controlId',c.result->>'controlId',
      'evidenceVersionId',c.evidence_version_id,'productId',c.product_id),
    1,gen_random_uuid()) r),'linked','fixture pins exact version and product');
select is((select r.outcome from m10_reuse_control c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'upsert_mapping',
    jsonb_build_object('controlId',c.result->>'controlId',
      'packKey','cra-annex-i','versionKey','oj-2024-11-20-en',
      'requirementKey',(select requirement_key from public.framework_requirements
        where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en'
        order by tree_order limit 1),
      'rationale','Scoped reverse projection test',
      'productIds',jsonb_build_array(c.product_id)),
    2,gen_random_uuid()) r),'mapped','fixture maps one requirement for the product');

create temp table m10_reuse_result on commit drop as
select r.outcome,r.result from m10_reuse_control c cross join lateral
  public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
    c.product_id,c.document_id,c.evidence_version_id) r;
select is((select outcome from m10_reuse_result),'found',
  'authorized exact reuse read succeeds');
select is((select jsonb_array_length(result->'frameworkControls') from m10_reuse_result),1,
  'one current control link is projected');
select ok((select (result->'frameworkControls'->0->>'evidenceVersionId')::uuid =
  evidence_version_id from m10_reuse_result cross join m10_reuse_context),
  'reverse link keeps exact evidence version');
select is((select jsonb_array_length(result->'frameworkControls'->0->'requirements')
  from m10_reuse_result),1,'only the applicable requirement is projected');
select ok((select result->>'frameworkControlsHasMore'='false' and
  result->'frameworkControls'->0->>'requirementsHasMore'='false'
  from m10_reuse_result),'bounded projection reports whether more rows exist');
select ok((select not ((result->'frameworkControls'->0) ? 'productId')
  from m10_reuse_result),'framework reverse link omits product identifier');
select is((select outcome from m10_reuse_context c cross join lateral
  public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
    gen_random_uuid(),c.document_id,c.evidence_version_id)),
  'not_found','foreign product substitution fails closed');
select is((select outcome from m10_reuse_context c cross join lateral
  public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
    c.product_id,c.document_id,gen_random_uuid())),
  'not_found','different evidence version cannot inherit a reverse link');

insert into public.base_role_permission_overrides(organization_id,base_role,permissions)
select organization_id,'owner','{"can_view_products":false}'::jsonb
from m10_reuse_context
on conflict (organization_id,base_role) do update
set permissions=base_role_permission_overrides.permissions || '{"can_view_products":false}'::jsonb;
select ok((select public.m5_triage_actor_has_permission(organization_id,
    actor_user_id,'can_view_evidence')
    and public.m10_actor_has_framework_permission(organization_id,
      actor_user_id,'can_view_frameworks')
    and not public.m9_supplier_actor_can(organization_id,
      actor_user_id,'can_view_products')
  from m10_reuse_context),
  'fixture actor retains evidence and frameworks but loses product view');
select ok((select r.outcome='found'
    and jsonb_array_length(r.result->'frameworkControls')=0
    and r.result->>'frameworkControlsHasMore'='false'
  from m10_reuse_context c cross join lateral
    public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
      c.product_id,c.document_id,c.evidence_version_id) r),
  'M8 reuse hides control links and continuation when product view is denied');
update public.base_role_permission_overrides
set permissions=permissions-'can_view_products'
where organization_id=(select organization_id from m10_reuse_context)
  and base_role='owner';

insert into public.base_role_permission_overrides(organization_id,base_role,permissions)
select organization_id,'owner','{"can_view_frameworks":false}'::jsonb
from m10_reuse_context
on conflict (organization_id,base_role) do update
set permissions=base_role_permission_overrides.permissions || '{"can_view_frameworks":false}'::jsonb;
select is((select jsonb_array_length(r.result->'frameworkControls')
  from m10_reuse_context c cross join lateral
    public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
      c.product_id,c.document_id,c.evidence_version_id) r),0,
  'framework permission denial hides control links while evidence remains readable');

update public.base_role_permission_overrides
set permissions=permissions-'can_view_frameworks'
where organization_id=(select organization_id from m10_reuse_context)
  and base_role='owner';
select is((select r.outcome from m10_reuse_control c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'unlink_evidence',
    jsonb_build_object('controlId',c.result->>'controlId',
      'linkId',(select result->'frameworkControls'->0->>'evidenceLinkId'
        from m10_reuse_result)),3,gen_random_uuid()) r),
  'unlinked','evidence unlink is revisioned');
select is((select jsonb_array_length(r.result->'frameworkControls')
  from m10_reuse_context c cross join lateral
    public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
      c.product_id,c.document_id,c.evidence_version_id) r),0,
  'ended evidence link is absent from current reverse projection');
select is((select r.outcome from m10_reuse_control c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'link_evidence',
    jsonb_build_object('controlId',c.result->>'controlId',
      'evidenceVersionId',c.evidence_version_id,'productId',c.product_id),
    4,gen_random_uuid()) r),'linked','new exact link can be added after unlink');
select is((select r.outcome from m10_reuse_control c cross join lateral
  public.m10_control_command(c.organization_id,c.actor_user_id,'archive_control',
    jsonb_build_object('controlId',c.result->>'controlId'),5,gen_random_uuid()) r),
  'archived','control archive is revisioned');
select is((select jsonb_array_length(r.result->'frameworkControls')
  from m10_reuse_context c cross join lateral
    public.get_evidence_document_reuse_atomic(c.organization_id,c.actor_user_id,
      c.product_id,c.document_id,c.evidence_version_id) r),0,
  'archived control is absent from current reverse projection');

select * from finish();
rollback;
