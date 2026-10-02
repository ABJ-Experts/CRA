-- Forward-only M3-07 eligibility and deterministic projection repair.

create or replace function public.validate_sbom_composite_scope(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_release_id uuid,p_source_ids jsonb
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cycle boolean; v_requested integer; v_owned integer; v_eligible integer;
begin
  if jsonb_typeof(p_source_ids)<>'array' or jsonb_array_length(p_source_ids)<1 or jsonb_array_length(p_source_ids)>100 or not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text;return;end if;
  select count(*) into v_requested from (select distinct (value#>>'{}')::uuid id from jsonb_array_elements(p_source_ids)) requested;
  select count(*) into v_owned from public.sbom_sources s join (select distinct (value#>>'{}')::uuid id from jsonb_array_elements(p_source_ids)) requested on requested.id=s.id where s.organization_id=p_organization_id;
  if v_owned<>v_requested then return query select 'not_found'::text;return;end if;
  with recursive structure(release_id,path,cycle) as (
    select p_release_id,array[p_release_id],false union all
    select relation.source_release_id,structure.path||relation.source_release_id,relation.source_release_id=any(structure.path)
    from structure join public.product_relationships relation on relation.organization_id=p_organization_id and relation.relationship_type='embedded' and relation.ended_at is null and relation.target_release_id=structure.release_id where not structure.cycle
  ) select coalesce(bool_or(cycle),false) into v_cycle from structure;
  if v_cycle then return query select 'conflict'::text;return;end if;
  with recursive structure(release_id,path,cycle) as (
    select p_release_id,array[p_release_id],false union all
    select relation.source_release_id,structure.path||relation.source_release_id,relation.source_release_id=any(structure.path)
    from structure join public.product_relationships relation on relation.organization_id=p_organization_id and relation.relationship_type='embedded' and relation.ended_at is null and relation.target_release_id=structure.release_id where not structure.cycle
  ) select count(*) into v_eligible from public.sbom_sources s join (select distinct (value#>>'{}')::uuid id from jsonb_array_elements(p_source_ids)) requested on requested.id=s.id join (select distinct release_id from structure where not cycle) scope on scope.release_id=s.release_id where s.organization_id=p_organization_id and s.status='verified' and s.deduplicated_from_source_id is null and exists(select 1 from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=s.organization_id and ds.source_id=s.id) and (s.source_kind<>'supplier' or exists(select 1 from public.sbom_supplier_submissions ss where ss.organization_id=s.organization_id and ss.source_id=s.id and ss.status='accepted'));
  return query select case when v_eligible=v_requested then 'compatible' else 'conflict' end;
end;
$$;

-- Build deterministic component and field provenance after review inputs are
-- persisted. A stable output reference belongs to an identity/version group;
-- unidentifiable inputs remain distinct by their immutable document/local ref.
create or replace function public.materialize_sbom_composite_projection(p_organization_id uuid,p_review_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.sbom_composite_conflicts where organization_id=p_organization_id and review_id=p_review_id;
  delete from public.sbom_composite_component_provenance where organization_id=p_organization_id and review_id=p_review_id;
  with components as (
    select i.source_id,i.document_id,i.source_sha256,i.supplier_submission_id,c.*,coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe,'unresolved:'||i.document_id::text||':'||c.document_local_ref) identity_key
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id
  ), fields as (
    select components.*, field.name field_name, field.value from components cross join lateral (values ('name',to_jsonb(normalized_name)),('canonicalPurl',to_jsonb(canonical_purl)),('canonicalCpe',to_jsonb(cpe)),('hashes',hashes)) field(name,value)
  ) insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,identity_key,'field_conflict',field_name,jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',id,'sourceId',source_id,'documentId',document_id,'documentSha256',source_sha256,'sourceComponentRef',document_local_ref,'name',normalized_name,'version',normalized_version,'canonicalPurl',canonical_purl,'canonicalCpe',cpe,'supplierSubmissionId',supplier_submission_id),'value',case when value='null'::jsonb then null else value#>>'{}' end) order by source_id,source_offset,id)
  from fields where identity_key not like 'unresolved:%' group by identity_key,field_name having count(distinct coalesce(normalized_version,''))<=1 and count(distinct coalesce(value::text,'null'))>1;
  with components as (
    select i.source_id,i.document_id,i.supplier_submission_id,c.*,coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe,'unresolved:'||i.document_id::text||':'||c.document_local_ref) identity_key
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id
  ) insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,identity_key,'incompatible_version','version',jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',id,'sourceId',source_id,'documentId',document_id,'documentSha256',(select source_sha256 from public.sbom_composite_review_inputs i where i.organization_id=p_organization_id and i.review_id=p_review_id and i.source_id=components.source_id),'sourceComponentRef',document_local_ref,'name',normalized_name,'version',normalized_version,'canonicalPurl',canonical_purl,'canonicalCpe',cpe,'supplierSubmissionId',supplier_submission_id),'value',normalized_version) order by source_id,source_offset,id)
  from components where identity_key not like 'unresolved:%' group by identity_key having count(distinct coalesce(normalized_version,''))>1;
  with components as (
    select i.source_id,i.document_id,i.supplier_submission_id,c.*,coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe,'unresolved:'||i.document_id::text||':'||c.document_local_ref) identity_key
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id
  ), field_rows as (
    select components.*,field.name field_name from components cross join lateral (values ('name'),('version'),('canonicalPurl'),('canonicalCpe'),('hashes')) field(name)
  ) insert into public.sbom_composite_component_provenance(organization_id,review_id,composite_component_ref,field_name,source_id,source_document_id,source_component_id,source_component_ref,supplier_submission_id)
  select p_organization_id,p_review_id,case when identity_key like 'unresolved:%' then 'component:'||document_id::text||':'||document_local_ref else 'component:'||encode(extensions.digest(identity_key||'@'||coalesce(normalized_version,''),'sha256'),'hex') end,field_name,source_id,document_id,id,document_local_ref,supplier_submission_id from field_rows;
end;
$$;

-- Apply deterministic input hashes and field projection after the existing
-- creation flow. The wrapper is intentionally called by the API immediately
-- after create; it is service-role-only and idempotent for the review.
create or replace function public.refresh_sbom_composite_review_projection_atomic(p_organization_id uuid,p_review_id uuid)
returns table(outcome text, review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_digest text;
begin
  if not exists(select 1 from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  perform public.materialize_sbom_composite_projection(p_organization_id,p_review_id);
  select encode(extensions.digest(jsonb_build_object('mergeRulesVersion',r.merge_rules_version,'inputs',(select jsonb_agg(jsonb_build_object('sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256) order by i.source_id,i.document_id) from public.sbom_composite_review_inputs i where i.organization_id=r.organization_id and i.review_id=r.id))::text,'sha256'),'hex') into v_digest from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id;
  update public.sbom_composite_reviews set input_set_digest=v_digest where organization_id=p_organization_id and id=p_review_id;
  return query select 'refreshed'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

create or replace function public.claim_sbom_composite_generation(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text, work jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_components jsonb; v_dependencies jsonb; v_selected uuid[];
begin
  if p_worker_id is null or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb;return;end if;
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.status='processing' and (r.lease_expires_at is null or r.lease_expires_at<=now()) and (r.generated_source_id is not null or r.attempt_count<5) order by r.created_at,r.id for update skip locked limit 1;
  if not found then return query select 'empty'::text,null::jsonb;return;end if;
  update public.sbom_composite_reviews set lease_owner=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+case when generated_source_id is null then 1 else 0 end where organization_id=p_organization_id and id=v_review.id returning * into v_review;
  with candidates as (
    select i.source_id,i.document_id,c.*,coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe,'unresolved:'||i.document_id::text||':'||c.document_local_ref) identity_key,row_number() over(partition by coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe,'unresolved:'||i.document_id::text||':'||c.document_local_ref) order by i.source_id,c.source_offset,c.id) rn
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=v_review.id
  ), decisions as (
    select x.identity_key, min(x.selected_source_component_id) filter (where x.conflict_type='incompatible_version') version_component_id,
      min(x.selected_source_component_id) filter (where x.conflict_type='field_conflict') field_component_id,
      bool_or(x.selected_source_component_id is null and x.resolution_reason is not null) excluded
    from public.sbom_composite_conflicts x where x.organization_id=p_organization_id and x.review_id=v_review.id group by x.identity_key
  ), selected as (
    select c.* from candidates c left join decisions d on d.identity_key=c.identity_key
    where coalesce(d.excluded,false)=false and c.id=coalesce(d.version_component_id,d.field_component_id,c.id) and (coalesce(d.version_component_id,d.field_component_id) is not null or c.rn=1)
  ) select coalesce(jsonb_agg(jsonb_build_object('componentRef',case when identity_key like 'unresolved:%' then 'component:'||document_id::text||':'||document_local_ref else 'component:'||encode(extensions.digest(identity_key||'@'||coalesce(normalized_version,''),'sha256'),'hex') end,'name',normalized_name,'version',normalized_version,'canonicalPurl',canonical_purl,'hashes',hashes,'sourceComponentId',id,'sourceId',source_id,'documentId',document_id) order by source_id,source_offset,id),'[]'::jsonb),coalesce(array_agg(id),'{}'::uuid[]) into v_components,v_selected from selected;
  select coalesce(jsonb_agg(jsonb_build_object('fromRef',case when parent.canonical_purl is null and parent.cpe is null then 'component:'||parent.document_id::text||':'||parent.document_local_ref else 'component:'||encode(extensions.digest(coalesce(public.sbom_purl_package_identity(parent.canonical_purl),'cpe:'||parent.cpe)||'@'||coalesce(parent.normalized_version,''),'sha256'),'hex') end,'toRef',case when child.canonical_purl is null and child.cpe is null then 'component:'||child.document_id::text||':'||child.document_local_ref else 'component:'||encode(extensions.digest(coalesce(public.sbom_purl_package_identity(child.canonical_purl),'cpe:'||child.cpe)||'@'||coalesce(child.normalized_version,''),'sha256'),'hex') end) order by d.id),'[]'::jsonb) into v_dependencies from public.sbom_component_dependencies d join public.sbom_components parent on parent.organization_id=d.organization_id and parent.id=d.parent_component_id join public.sbom_components child on child.organization_id=d.organization_id and child.id=d.child_component_id where d.organization_id=p_organization_id and d.edge_state='retained' and parent.id=any(v_selected) and child.id=any(v_selected);
  return query select 'claimed'::text,jsonb_build_object('reviewId',v_review.id,'actorId',v_review.created_by,'productId',v_review.product_id,'releaseId',v_review.release_id,'mergeRulesVersion',v_review.merge_rules_version,'generatedSourceId',v_review.generated_source_id,'components',v_components,'dependencies',v_dependencies);
end;
$$;

revoke all on function public.validate_sbom_composite_scope(uuid,uuid,uuid,uuid,jsonb),public.materialize_sbom_composite_projection(uuid,uuid),public.refresh_sbom_composite_review_projection_atomic(uuid,uuid),public.claim_sbom_composite_generation(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.validate_sbom_composite_scope(uuid,uuid,uuid,uuid,jsonb),public.materialize_sbom_composite_projection(uuid,uuid),public.refresh_sbom_composite_review_projection_atomic(uuid,uuid),public.claim_sbom_composite_generation(uuid,uuid,integer) to service_role;
