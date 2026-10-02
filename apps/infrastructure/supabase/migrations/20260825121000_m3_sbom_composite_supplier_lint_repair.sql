-- Forward repair for M3-07 after the first local migration application.
-- Keep this separate: applied migration history is immutable.

create or replace function public.create_sbom_composite_review_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_product_id uuid,p_release_id uuid,p_merge_rules_version text,p_input_set_digest text,p_inputs jsonb,p_correlation_id uuid
) returns table(outcome text, review jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_input jsonb; v_source public.sbom_sources%rowtype; v_document uuid; v_scope text; v_canonical_input_digest text;
begin
  if p_review_id is null or p_correlation_id is null or p_input_set_digest !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_merge_rules_version,''))) not between 1 and 80 or jsonb_typeof(p_inputs)<>'array' or jsonb_array_length(p_inputs)<1 or jsonb_array_length(p_inputs)>1000 or not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  select r.* into v_review from public.sbom_composite_reviews r
  where r.organization_id=p_organization_id and r.release_id=p_release_id and r.merge_rules_version=btrim(p_merge_rules_version)
    and not exists (select existing.source_id from public.sbom_composite_review_inputs existing where existing.organization_id=r.organization_id and existing.review_id=r.id except select (value->>'sourceId')::uuid from jsonb_array_elements(p_inputs))
    and not exists (select (requested.value->>'sourceId')::uuid from jsonb_array_elements(p_inputs) requested except select existing.source_id from public.sbom_composite_review_inputs existing where existing.organization_id=r.organization_id and existing.review_id=r.id)
  for update;
  if found then return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,v_review.id);return;end if;
  select scope_result.outcome into v_scope
  from public.validate_sbom_composite_scope(p_organization_id,p_actor_user_id,p_product_id,p_release_id,(select jsonb_agg(value->>'sourceId') from jsonb_array_elements(p_inputs))) scope_result;
  if v_scope='conflict' then return query select 'conflict'::text,null::jsonb;return;end if;
  if v_scope<>'compatible' then return query select 'not_found'::text,null::jsonb;return;end if;
  insert into public.sbom_composite_reviews(id,organization_id,product_id,release_id,merge_rules_version,input_set_digest,created_by,status) values(p_review_id,p_organization_id,p_product_id,p_release_id,btrim(p_merge_rules_version),p_input_set_digest,p_actor_user_id,'awaiting_review');
  for v_input in select value from jsonb_array_elements(p_inputs) loop
    select * into v_source from public.sbom_sources s where s.organization_id=p_organization_id and s.id=(v_input->>'sourceId')::uuid and s.status='verified' and s.deduplicated_from_source_id is null;
    if not found or (v_source.source_kind='supplier' and not exists(select 1 from public.sbom_supplier_submissions ss where ss.organization_id=p_organization_id and ss.source_id=v_source.id and ss.status='accepted')) then raise exception using errcode='P0002',message='composite input not found';end if;
    select ds.document_id into v_document from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=p_organization_id and ds.source_id=v_source.id order by d.completed_at desc,d.id desc limit 1;
    if v_document is null then raise exception using errcode='P0002',message='composite input not found';end if;
    insert into public.sbom_composite_review_inputs(organization_id,review_id,source_id,document_id,source_sha256,release_id,supplier_submission_id) select p_organization_id,p_review_id,v_source.id,v_document,v_source.declared_sha256,v_source.release_id,ss.id from public.sbom_sources s left join public.sbom_supplier_submissions ss on ss.organization_id=s.organization_id and ss.source_id=s.id where s.organization_id=p_organization_id and s.id=v_source.id;
  end loop;
  select encode(extensions.digest(jsonb_build_object('mergeRulesVersion',btrim(p_merge_rules_version),'inputs',jsonb_agg(jsonb_build_object('sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256) order by i.source_id,i.document_id))::text,'sha256'),'hex') into v_canonical_input_digest
  from public.sbom_composite_review_inputs i where i.organization_id=p_organization_id and i.review_id=p_review_id;
  update public.sbom_composite_reviews set input_set_digest=v_canonical_input_digest where organization_id=p_organization_id and id=p_review_id;
  insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,x.identity,'incompatible_version','version',x.candidates from (
    select coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe) identity,jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',c.id,'sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256,'sourceComponentRef',c.document_local_ref,'name',c.normalized_name,'version',c.normalized_version,'canonicalPurl',c.canonical_purl,'canonicalCpe',c.cpe,'supplierSubmissionId',i.supplier_submission_id),'value',c.normalized_version) order by i.source_id,c.source_offset,c.id) candidates
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id and (c.canonical_purl is not null or c.cpe is not null) group by coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe) having count(distinct coalesce(c.normalized_version,''))>1
  ) x;
  insert into public.sbom_composite_component_provenance(organization_id,review_id,composite_component_ref,field_name,source_id,source_document_id,source_component_id,source_component_ref,supplier_submission_id)
  select p_organization_id,p_review_id,i.document_id::text||':'||c.document_local_ref,null,i.source_id,i.document_id,c.id,c.document_local_ref,i.supplier_submission_id from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.composite_review_created','sbom_composite_review',p_review_id::text,jsonb_build_object('correlationId',p_correlation_id,'inputSetDigest',p_input_set_digest));
  return query select 'created'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$$;

create or replace function public.claim_sbom_composite_generation(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text, work jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype;
begin
  if p_worker_id is null or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb;return;end if;
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.status='processing' and (r.lease_expires_at is null or r.lease_expires_at<=now()) and (r.generated_source_id is not null or r.attempt_count<5) order by r.created_at,r.id for update skip locked limit 1;
  if not found then return query select 'empty'::text,null::jsonb;return;end if;
  update public.sbom_composite_reviews set lease_owner=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+case when generated_source_id is null then 1 else 0 end where organization_id=p_organization_id and id=v_review.id returning * into v_review;
  return query select 'claimed'::text,jsonb_build_object(
    'reviewId',v_review.id,'actorId',v_review.created_by,'productId',v_review.product_id,'releaseId',v_review.release_id,'mergeRulesVersion',v_review.merge_rules_version,'generatedSourceId',v_review.generated_source_id,
    'components',coalesce((select jsonb_agg(jsonb_build_object('componentRef',i.document_id::text||':'||c.document_local_ref,'name',c.normalized_name,'version',c.normalized_version,'canonicalPurl',c.canonical_purl,'hashes',c.hashes,'sourceComponentId',c.id,'sourceId',i.source_id,'documentId',i.document_id) order by i.source_id,c.source_offset,c.id) from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=v_review.id and not exists (select 1 from public.sbom_composite_conflicts x cross join lateral jsonb_array_elements(x.candidates) candidate where x.organization_id=i.organization_id and x.review_id=i.review_id and candidate#>>'{component,componentId}'=c.id::text and ((x.selected_source_component_id is not null and x.selected_source_component_id<>c.id) or (x.selected_source_component_id is null and x.resolution_reason is not null)))),'[]'::jsonb),
    'dependencies',coalesce((select jsonb_agg(jsonb_build_object('fromRef',parent.document_id::text||':'||parent.document_local_ref,'toRef',child.document_id::text||':'||child.document_local_ref) order by parent.document_id,parent.document_local_ref,child.document_local_ref) from public.sbom_component_dependencies d join public.sbom_components parent on parent.organization_id=d.organization_id and parent.id=d.parent_component_id join public.sbom_components child on child.organization_id=d.organization_id and child.id=d.child_component_id join public.sbom_composite_review_inputs pi on pi.organization_id=d.organization_id and pi.review_id=v_review.id and pi.document_id=parent.document_id join public.sbom_composite_review_inputs ci on ci.organization_id=d.organization_id and ci.review_id=v_review.id and ci.document_id=child.document_id where d.organization_id=p_organization_id and d.edge_state='retained'),'[]'::jsonb));
end;
$$;

create or replace function public.reconcile_sbom_composite_generation_atomic(
  p_organization_id uuid,p_review_id uuid,p_worker_id uuid
) returns table(outcome text, generated_document_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_document uuid;
begin
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if not found or v_review.status<>'processing' or v_review.lease_owner is distinct from p_worker_id or v_review.lease_expires_at<=now() then return query select 'not_found'::text,null::uuid;return;end if;
  if v_review.generated_source_id is null then return query select 'pending'::text,null::uuid;return;end if;
  select d.id into v_document from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=p_organization_id and ds.source_id=v_review.generated_source_id order by d.completed_at desc,d.id desc limit 1;
  if v_document is not null then
    -- Conflict candidates remain in sbom_composite_conflicts, but the generated
    -- manifest must not claim provenance for a component the reviewer excluded
    -- or lost to another selected source component.
    delete from public.sbom_composite_component_provenance p
    using public.sbom_components c
    where p.organization_id=p_organization_id and p.review_id=p_review_id
      and c.organization_id=p.organization_id and c.id=p.source_component_id
      and exists (
        select 1 from public.sbom_composite_conflicts x cross join lateral jsonb_array_elements(x.candidates) candidate
        where x.organization_id=p.organization_id and x.review_id=p.review_id
          and candidate#>>'{component,componentId}'=c.id::text
          and ((x.selected_source_component_id is not null and x.selected_source_component_id<>c.id)
            or (x.selected_source_component_id is null and x.resolution_reason is not null))
      );
    update public.sbom_composite_reviews set status='completed',generated_document_id=v_document,completed_at=now(),lease_owner=null,lease_expires_at=null,provenance_manifest_sha256=coalesce(provenance_manifest_sha256,encode(extensions.digest(id::text||':manifest','sha256'),'hex')) where organization_id=p_organization_id and id=p_review_id;
    return query select 'completed'::text,v_document;return;
  end if;
  if exists(select 1 from public.sbom_ingest_jobs j where j.organization_id=p_organization_id and j.source_id=v_review.generated_source_id and j.status in ('dead_letter','failed')) then update public.sbom_composite_reviews set status='failed',failure_code='generated_intake_failed',failure_message='The generated SBOM did not complete intake.',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_review_id; return query select 'failed'::text,null::uuid;return; end if;
  update public.sbom_composite_reviews set lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_review_id;
  return query select 'pending'::text,null::uuid;
end;
$$;

revoke all on function public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid),public.claim_sbom_composite_generation(uuid,uuid,integer),public.reconcile_sbom_composite_generation_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid),public.claim_sbom_composite_generation(uuid,uuid,integer),public.reconcile_sbom_composite_generation_atomic(uuid,uuid,uuid) to service_role;
