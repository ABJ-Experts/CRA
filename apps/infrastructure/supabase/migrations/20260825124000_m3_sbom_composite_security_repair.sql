-- Forward-only M3-07 repair.  Earlier M3-07 projections were applied before
-- review decisions and could both lose decisions on refresh and choose a UUID
-- aggregate that PostgreSQL does not support.  This migration keeps source
-- evidence immutable and derives the composite projection only from review
-- inputs plus explicit decisions.

create table public.sbom_composite_dependency_provenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null,
  composite_parent_ref text not null check (char_length(btrim(composite_parent_ref)) between 1 and 1024),
  composite_child_ref text not null check (char_length(btrim(composite_child_ref)) between 1 and 1024),
  source_dependency_id uuid not null,
  source_id uuid not null,
  source_document_id uuid not null,
  supplier_submission_id uuid,
  merge_timestamp timestamptz not null default now(),
  review_relationship_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, review_id, source_dependency_id),
  foreign key (organization_id, review_id) references public.sbom_composite_reviews(organization_id, id) on delete restrict,
  foreign key (organization_id, source_dependency_id) references public.sbom_component_dependencies(organization_id, id) on delete restrict,
  foreign key (organization_id, source_id) references public.sbom_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_id) references public.sbom_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, supplier_submission_id) references public.sbom_supplier_submissions(organization_id, id) on delete restrict,
  foreign key (organization_id, review_relationship_id) references public.sbom_composite_unresolved_relationships(organization_id, id) on delete restrict,
  check (composite_parent_ref <> composite_child_ref)
);

create index sbom_composite_dependency_provenance_review_idx
  on public.sbom_composite_dependency_provenance(organization_id, review_id, composite_parent_ref, composite_child_ref);

alter table public.sbom_composite_dependency_provenance enable row level security;
revoke all on public.sbom_composite_dependency_provenance from public, anon, authenticated;
grant select, insert, update, delete on public.sbom_composite_dependency_provenance to service_role;

-- A strong normalized hash is only used if a versionless PURL package identity
-- and exact CPE are both absent.  Weak/unknown hashes deliberately do not join
-- two documents; they remain separate unresolved candidates.
create or replace function public.sbom_composite_identity_key(
  p_canonical_purl text, p_cpe text, p_hashes jsonb, p_document_id uuid, p_component_ref text
) returns text language sql immutable set search_path=public,pg_temp as $$
  select coalesce(
    public.sbom_purl_package_identity(p_canonical_purl),
    case when nullif(btrim(coalesce(p_cpe,'')),'') is not null then 'cpe:' || btrim(p_cpe) end,
    (
      select 'hash:' || lower(hash.value->>'algorithm') || ':' || lower(hash.value->>'value')
      from jsonb_array_elements(coalesce(p_hashes,'[]'::jsonb)) hash(value)
      where (upper(regexp_replace(coalesce(hash.value->>'algorithm',''),'[^A-Z0-9]','','g'))='SHA256' and hash.value->>'value' ~ '^[A-Fa-f0-9]{64}$')
         or (upper(regexp_replace(coalesce(hash.value->>'algorithm',''),'[^A-Z0-9]','','g'))='SHA384' and hash.value->>'value' ~ '^[A-Fa-f0-9]{96}$')
         or (upper(regexp_replace(coalesce(hash.value->>'algorithm',''),'[^A-Z0-9]','','g'))='SHA512' and hash.value->>'value' ~ '^[A-Fa-f0-9]{128}$')
      order by lower(hash.value->>'algorithm'), lower(hash.value->>'value')
      limit 1
    ),
    'unresolved:' || p_document_id::text || ':' || p_component_ref
  );
$$;

-- Exclusion is a reviewed decision too.  The original check made a null
-- selected component indistinguishable from an unresolved conflict.
do $$
declare v_constraint text;
begin
  for v_constraint in
    select con.conname
    from pg_constraint con
    where con.conrelid='public.sbom_composite_conflicts'::regclass
      and con.contype='c'
      and pg_get_constraintdef(con.oid) like '%selected_source_component_id%'
  loop
    execute format('alter table public.sbom_composite_conflicts drop constraint %I',v_constraint);
  end loop;
end;
$$;
alter table public.sbom_composite_conflicts
  add constraint sbom_composite_conflicts_resolution_check check (
    (selected_source_component_id is null and resolution_reason is null and resolved_by is null and resolved_at is null)
    or (resolution_reason is not null and resolved_by is not null and resolved_at is not null)
  );

-- Build conflicts and relationship review rows only before anyone has made a
-- decision.  It is therefore safe to rerun for a brand-new/replayed review,
-- but can never erase a reviewer choice or its provenance.
create or replace function public.materialize_sbom_composite_projection(p_organization_id uuid,p_review_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
  select r.status into v_status from public.sbom_composite_reviews r
  where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if v_status is null or v_status not in ('draft','awaiting_review')
     or exists (select 1 from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id and c.resolved_at is not null)
     or exists (select 1 from public.sbom_composite_unresolved_relationships u where u.organization_id=p_organization_id and u.review_id=p_review_id and u.resolved_at is not null) then
    return;
  end if;

  delete from public.sbom_composite_dependency_provenance p where p.organization_id=p_organization_id and p.review_id=p_review_id;
  delete from public.sbom_composite_component_provenance p where p.organization_id=p_organization_id and p.review_id=p_review_id;
  delete from public.sbom_composite_unresolved_relationships u where u.organization_id=p_organization_id and u.review_id=p_review_id;
  delete from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id;

  with base as (
    select i.source_id,i.document_id,i.source_sha256,i.supplier_submission_id,c.id component_id,c.document_local_ref,c.source_offset,c.normalized_name,c.normalized_version,c.canonical_purl,c.cpe,c.hashes,
      public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) identity_key
    from public.sbom_composite_review_inputs i
    join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
    where i.organization_id=p_organization_id and i.review_id=p_review_id
  ), fields as (
    select b.*, f.field_name, f.field_value from base b
    cross join lateral (values ('name',to_jsonb(b.normalized_name)),('canonicalPurl',to_jsonb(b.canonical_purl)),('canonicalCpe',to_jsonb(b.cpe)),('hashes',b.hashes)) f(field_name,field_value)
  )
  insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,f.identity_key,'field_conflict',f.field_name,
    jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',f.component_id,'sourceId',f.source_id,'documentId',f.document_id,'documentSha256',f.source_sha256,'sourceComponentRef',f.document_local_ref,'name',f.normalized_name,'version',f.normalized_version,'canonicalPurl',f.canonical_purl,'canonicalCpe',f.cpe,'supplierSubmissionId',f.supplier_submission_id),'value',case when f.field_value='null'::jsonb then null else f.field_value end) order by f.source_id,f.source_offset,f.component_id)
  from fields f
  where f.identity_key not like 'unresolved:%'
  group by f.identity_key,f.field_name
  having count(distinct coalesce(f.normalized_version,''))<=1 and count(distinct coalesce(f.field_value::text,'null'))>1;

  with base as (
    select i.source_id,i.document_id,i.source_sha256,i.supplier_submission_id,c.id component_id,c.document_local_ref,c.source_offset,c.normalized_name,c.normalized_version,c.canonical_purl,c.cpe,
      public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) identity_key
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
    where i.organization_id=p_organization_id and i.review_id=p_review_id
  )
  insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,b.identity_key,'incompatible_version','version',
    jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',b.component_id,'sourceId',b.source_id,'documentId',b.document_id,'documentSha256',b.source_sha256,'sourceComponentRef',b.document_local_ref,'name',b.normalized_name,'version',b.normalized_version,'canonicalPurl',b.canonical_purl,'canonicalCpe',b.cpe,'supplierSubmissionId',b.supplier_submission_id),'value',b.normalized_version) order by b.source_id,b.source_offset,b.component_id)
  from base b where b.identity_key not like 'unresolved:%'
  group by b.identity_key having count(distinct coalesce(b.normalized_version,''))>1;

  -- Any source graph edge that cannot become a valid composite edge must be
  -- explicitly reviewed.  Retained edges with viable endpoints are recorded
  -- later as relational provenance by the claim path.
  insert into public.sbom_composite_unresolved_relationships(organization_id,review_id,relationship_key,source_dependency_id,detail)
  select p_organization_id,p_review_id,'dep:'||d.id::text,d.id,
    jsonb_build_object('kind',case when d.edge_state='omitted' then 'omitted_dependency' when d.parent_component_id is null or d.child_component_id is null then 'unresolved_endpoint' else 'unresolved_endpoint' end,
      'sourceId',i.source_id,'documentId',i.document_id,'parentComponentId',d.parent_component_id,'childComponentId',d.child_component_id,'sourceParentRef',d.parent_reference,'sourceChildRef',d.child_reference,'edgeState',d.edge_state,'omissionCode',d.omission_code)
  from public.sbom_composite_review_inputs i
  join public.sbom_component_dependencies d on d.organization_id=i.organization_id and d.document_id=i.document_id
  where i.organization_id=p_organization_id and i.review_id=p_review_id and d.edge_state<>'retained';

  insert into public.sbom_composite_unresolved_relationships(organization_id,review_id,relationship_key,source_dependency_id,detail)
  select p_organization_id,p_review_id,'dep:'||d.id::text,d.id,
    jsonb_build_object('kind','dependency_cycle','sourceId',i.source_id,'documentId',i.document_id,'parentComponentId',d.parent_component_id,'childComponentId',d.child_component_id,'sourceParentRef',d.parent_reference,'sourceChildRef',d.child_reference,'edgeState',d.edge_state)
  from public.sbom_composite_review_inputs i
  join public.sbom_component_dependencies d on d.organization_id=i.organization_id and d.document_id=i.document_id and d.edge_state='retained'
  join public.sbom_components parent on parent.organization_id=d.organization_id and parent.id=d.parent_component_id
  join public.sbom_components child on child.organization_id=d.organization_id and child.id=d.child_component_id
  where i.organization_id=p_organization_id and i.review_id=p_review_id
    and public.sbom_composite_identity_key(parent.canonical_purl,parent.cpe,parent.hashes,i.document_id,parent.document_local_ref)
      = public.sbom_composite_identity_key(child.canonical_purl,child.cpe,child.hashes,i.document_id,child.document_local_ref);
end;
$$;

create or replace function public.refresh_sbom_composite_review_projection_atomic(p_organization_id uuid,p_review_id uuid)
returns table(outcome text,review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text; v_digest text;
begin
  select r.status into v_status from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if v_status is null then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_status not in ('draft','awaiting_review')
     or exists (select 1 from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id and c.resolved_at is not null)
     or exists (select 1 from public.sbom_composite_unresolved_relationships u where u.organization_id=p_organization_id and u.review_id=p_review_id and u.resolved_at is not null) then
    return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,p_review_id); return;
  end if;
  perform public.materialize_sbom_composite_projection(p_organization_id,p_review_id);
  select encode(extensions.digest(jsonb_build_object('mergeRulesVersion',r.merge_rules_version,'inputs',(select jsonb_agg(jsonb_build_object('sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256) order by i.source_sha256,i.source_id) from public.sbom_composite_review_inputs i where i.organization_id=r.organization_id and i.review_id=r.id))::text,'sha256'),'hex') into v_digest
  from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id;
  update public.sbom_composite_reviews r set input_set_digest=v_digest where r.organization_id=p_organization_id and r.id=p_review_id;
  return query select 'refreshed'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

-- A completed review may use an explicit exclusion.  Only a genuinely
-- unresolved row (no selection and no rationale) prevents generation.
create or replace function public.generate_sbom_composite_atomic(p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text,review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_resolution_digest text;
begin
  if p_idempotency_key is null or p_correlation_id is null or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select encode(extensions.digest(jsonb_build_object('conflicts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'selectedComponentId',c.selected_source_component_id,'reason',c.resolution_reason) order by c.id) from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id),'[]'::jsonb),'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'disposition',u.disposition,'reason',u.resolution_reason) order by u.id) from public.sbom_composite_unresolved_relationships u where u.organization_id=p_organization_id and u.review_id=p_review_id),'[]'::jsonb))::text,'sha256'),'hex') into v_resolution_digest;
  if v_review.status in ('generating','processing','completed') and v_review.resolution_digest=v_resolution_digest then return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,p_review_id); return; end if;
  if v_review.status not in ('awaiting_review','failed')
     or exists(select 1 from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id and c.selected_source_component_id is null and c.resolution_reason is null)
     or exists(select 1 from public.sbom_composite_unresolved_relationships u where u.organization_id=p_organization_id and u.review_id=p_review_id and u.disposition is null) then
    return query select 'invalid_state'::text,public.sbom_composite_review_json(p_organization_id,p_review_id); return;
  end if;
  update public.sbom_composite_reviews r set status='processing',resolution_digest=v_resolution_digest,failure_code=null,failure_message=null,generated_at=now(),lease_owner=null,lease_expires_at=null where r.organization_id=p_organization_id and r.id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.composite_generation_claimed','sbom_composite_review',p_review_id::text,jsonb_build_object('correlationId',p_correlation_id,'resolutionDigest',v_resolution_digest));
  return query select 'queued'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

-- Persist the field and dependency mappings used by a claimed generation.
-- It deliberately changes only generated projections; review inputs, choices,
-- and conflict history stay immutable once a reviewer has acted.
create or replace function public.sync_sbom_composite_selected_provenance(p_organization_id uuid,p_review_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.sbom_composite_dependency_provenance p where p.organization_id=p_organization_id and p.review_id=p_review_id;
  delete from public.sbom_composite_component_provenance p where p.organization_id=p_organization_id and p.review_id=p_review_id;

  with candidates as (
    select i.source_id,i.document_id,i.supplier_submission_id,c.id component_id,c.document_local_ref,c.source_offset,c.normalized_version,c.canonical_purl,c.cpe,c.hashes,
      public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) identity_key,
      row_number() over(partition by public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) order by i.source_id,c.source_offset,c.id) rn
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
    where i.organization_id=p_organization_id and i.review_id=p_review_id
  ), decisions as (
    select c.identity_key,(array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter(where c.conflict_type='incompatible_version' and c.selected_source_component_id is not null))[1] vc,(array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter(where c.conflict_type='field_conflict' and c.selected_source_component_id is not null))[1] fc,bool_or(c.selected_source_component_id is null and c.resolution_reason is not null) excluded,bool_or(c.selected_source_component_id is null and c.resolution_reason is null) unresolved,count(*) conflict_count from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id group by c.identity_key
  ), selected as (
    select c.*,case when c.identity_key like 'unresolved:%' then 'component:'||c.document_id::text||':'||c.document_local_ref else 'component:'||encode(extensions.digest(c.identity_key||'@'||coalesce(c.normalized_version,''),'sha256'),'hex') end composite_ref from candidates c left join decisions d on d.identity_key=c.identity_key where not coalesce(d.excluded,false) and not coalesce(d.unresolved,false) and ((d.vc is not null and c.component_id=d.vc) or (d.vc is null and d.fc is not null and c.component_id=d.fc) or (d.conflict_count is null and c.rn=1) or c.identity_key like 'unresolved:%')
  )
  insert into public.sbom_composite_component_provenance(organization_id,review_id,composite_component_ref,field_name,source_id,source_document_id,source_component_id,source_component_ref,supplier_submission_id,review_conflict_id)
  select p_organization_id,p_review_id,s.composite_ref,f.field_name,chosen.source_id,chosen.document_id,chosen.component_id,chosen.document_local_ref,chosen.supplier_submission_id,
    (select c.id from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id and c.identity_key=s.identity_key and (c.conflict_type='incompatible_version' or c.field_name=f.field_name) and c.selected_source_component_id=chosen.component_id order by c.id limit 1)
  from selected s
  cross join lateral (values ('name'),('version'),('canonicalPurl'),('canonicalCpe'),('hashes')) f(field_name)
  cross join lateral (select coalesce((select c.selected_source_component_id from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id and c.identity_key=s.identity_key and c.conflict_type='field_conflict' and c.field_name=f.field_name and c.selected_source_component_id is not null order by c.id limit 1),s.component_id) component_id) choice
  join candidates chosen on chosen.component_id=choice.component_id;

  with candidates as (
    select i.source_id,i.document_id,i.supplier_submission_id,c.id component_id,c.document_local_ref,c.source_offset,c.normalized_version,c.canonical_purl,c.cpe,c.hashes,public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) identity_key,row_number() over(partition by public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) order by i.source_id,c.source_offset,c.id) rn from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id
  ), decisions as (
    select c.identity_key,(array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter(where c.conflict_type='incompatible_version' and c.selected_source_component_id is not null))[1] vc,(array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter(where c.conflict_type='field_conflict' and c.selected_source_component_id is not null))[1] fc,bool_or(c.selected_source_component_id is null and c.resolution_reason is not null) excluded,bool_or(c.selected_source_component_id is null and c.resolution_reason is null) unresolved,count(*) conflict_count from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id group by c.identity_key
  ), selected as (
    select c.component_id,case when c.identity_key like 'unresolved:%' then 'component:'||c.document_id::text||':'||c.document_local_ref else 'component:'||encode(extensions.digest(c.identity_key||'@'||coalesce(c.normalized_version,''),'sha256'),'hex') end component_ref from candidates c left join decisions d on d.identity_key=c.identity_key where not coalesce(d.excluded,false) and not coalesce(d.unresolved,false) and ((d.vc is not null and c.component_id=d.vc) or (d.vc is null and d.fc is not null and c.component_id=d.fc) or (d.conflict_count is null and c.rn=1) or c.identity_key like 'unresolved:%')
  )
  insert into public.sbom_composite_dependency_provenance(organization_id,review_id,composite_parent_ref,composite_child_ref,source_dependency_id,source_id,source_document_id,supplier_submission_id)
  select p_organization_id,p_review_id,parent.component_ref,child.component_ref,d.id,i.source_id,i.document_id,i.supplier_submission_id
  from public.sbom_component_dependencies d
  join selected parent on parent.component_id=d.parent_component_id
  join selected child on child.component_id=d.child_component_id
  join public.sbom_composite_review_inputs i on i.organization_id=d.organization_id and i.review_id=p_review_id and i.document_id=d.document_id
  where d.organization_id=p_organization_id and d.edge_state='retained' and parent.component_ref<>child.component_ref
  on conflict (organization_id,review_id,source_dependency_id) do nothing;
end;
$$;

-- Claim returns one deterministic component for each identity.  An explicit
-- field or version choice takes precedence over source order; source order is
-- used only for an identical, conflict-free candidate group.
create or replace function public.claim_sbom_composite_generation(p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer)
returns table(outcome text,work jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_components jsonb; v_dependencies jsonb;
begin
  if p_worker_id is null or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.status='processing' and (r.lease_expires_at is null or r.lease_expires_at<=now()) and (r.generated_source_id is not null or r.attempt_count<5) order by r.created_at,r.id for update skip locked limit 1;
  if not found then return query select 'empty'::text,null::jsonb; return; end if;
  update public.sbom_composite_reviews r set lease_owner=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),attempt_count=r.attempt_count+case when r.generated_source_id is null then 1 else 0 end where r.organization_id=p_organization_id and r.id=v_review.id returning * into v_review;
  perform public.sync_sbom_composite_selected_provenance(p_organization_id,v_review.id);

  with candidates as (
    select i.source_id,i.document_id,i.supplier_submission_id,c.id component_id,c.document_local_ref,c.source_offset,c.normalized_name,c.normalized_version,c.canonical_purl,c.cpe,c.hashes,
      public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) identity_key,
      row_number() over(partition by public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) order by i.source_id,c.source_offset,c.id) rn
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
    where i.organization_id=p_organization_id and i.review_id=v_review.id
  ), decisions as (
    select c.identity_key,
      (array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter (where c.conflict_type='incompatible_version' and c.selected_source_component_id is not null))[1] version_component_id,
      (array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter (where c.conflict_type='field_conflict' and c.selected_source_component_id is not null))[1] field_component_id,
      bool_or(c.selected_source_component_id is null and c.resolution_reason is not null) excluded,
      bool_or(c.selected_source_component_id is null and c.resolution_reason is null) unresolved,
      count(*) conflict_count
    from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=v_review.id group by c.identity_key
  ), selected as (
    select c.*,case when c.identity_key like 'unresolved:%' then 'component:'||c.document_id::text||':'||c.document_local_ref else 'component:'||encode(extensions.digest(c.identity_key||'@'||coalesce(c.normalized_version,''),'sha256'),'hex') end composite_ref
    from candidates c left join decisions d on d.identity_key=c.identity_key
    where not coalesce(d.excluded,false) and not coalesce(d.unresolved,false)
      and ((d.version_component_id is not null and c.component_id=d.version_component_id)
        or (d.version_component_id is null and d.field_component_id is not null and c.component_id=d.field_component_id)
        or (d.conflict_count is null and c.rn=1)
        or (c.identity_key like 'unresolved:%'))
  )
  select coalesce(jsonb_agg(jsonb_build_object('componentRef',s.composite_ref,'name',s.normalized_name,'version',s.normalized_version,'canonicalPurl',s.canonical_purl,'hashes',s.hashes,'sourceComponentId',s.component_id,'sourceId',s.source_id,'documentId',s.document_id) order by s.composite_ref,s.source_id,s.source_offset,s.component_id),'[]'::jsonb) into v_components from selected s;

  with candidates as (
    select i.source_id,i.document_id,c.id component_id,c.document_local_ref,c.source_offset,c.normalized_version,c.canonical_purl,c.cpe,c.hashes,public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) identity_key,row_number() over(partition by public.sbom_composite_identity_key(c.canonical_purl,c.cpe,c.hashes,i.document_id,c.document_local_ref) order by i.source_id,c.source_offset,c.id) rn from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=v_review.id
  ), decisions as (
    select c.identity_key,(array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter(where c.conflict_type='incompatible_version' and c.selected_source_component_id is not null))[1] vc,(array_agg(c.selected_source_component_id order by c.selected_source_component_id) filter(where c.conflict_type='field_conflict' and c.selected_source_component_id is not null))[1] fc,bool_or(c.selected_source_component_id is null and c.resolution_reason is not null) excluded,bool_or(c.selected_source_component_id is null and c.resolution_reason is null) unresolved,count(*) conflict_count from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=v_review.id group by c.identity_key
  ), selected as (
    select c.component_id,case when c.identity_key like 'unresolved:%' then 'component:'||c.document_id::text||':'||c.document_local_ref else 'component:'||encode(extensions.digest(c.identity_key||'@'||coalesce(c.normalized_version,''),'sha256'),'hex') end component_ref from candidates c left join decisions d on d.identity_key=c.identity_key where not coalesce(d.excluded,false) and not coalesce(d.unresolved,false) and ((d.vc is not null and c.component_id=d.vc) or (d.vc is null and d.fc is not null and c.component_id=d.fc) or (d.conflict_count is null and c.rn=1) or c.identity_key like 'unresolved:%')
  ), edges as (
    select distinct pm.component_ref from_ref,cm.component_ref to_ref from public.sbom_component_dependencies d join selected pm on pm.component_id=d.parent_component_id join selected cm on cm.component_id=d.child_component_id where d.organization_id=p_organization_id and d.edge_state='retained' and pm.component_ref<>cm.component_ref
  ) select coalesce(jsonb_agg(jsonb_build_object('fromRef',e.from_ref,'toRef',e.to_ref) order by e.from_ref,e.to_ref),'[]'::jsonb) into v_dependencies from edges e;
  return query select 'claimed'::text,jsonb_build_object('reviewId',v_review.id,'actorId',v_review.created_by,'productId',v_review.product_id,'releaseId',v_review.release_id,'mergeRulesVersion',v_review.merge_rules_version,'generatedSourceId',v_review.generated_source_id,'components',v_components,'dependencies',v_dependencies);
end;
$$;

create or replace function public.sbom_composite_review_json(p_organization_id uuid,p_review_id uuid)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',r.id,'organizationId',r.organization_id,'productId',r.product_id,'releaseId',r.release_id,'state',r.status,'mergeRulesVersion',r.merge_rules_version,'inputSetDigest',r.input_set_digest,'resolutionDigest',r.resolution_digest,
    'coverage',jsonb_build_object('sourceCount',(select count(*) from public.sbom_composite_review_inputs i where i.organization_id=r.organization_id and i.review_id=r.id),'componentCandidateCount',(select count(distinct p.source_component_id) from public.sbom_composite_component_provenance p where p.organization_id=r.organization_id and p.review_id=r.id),'duplicateIdentityCount',0,'conflictCount',(select count(*) from public.sbom_composite_conflicts c where c.organization_id=r.organization_id and c.review_id=r.id),'unresolvedRelationshipCount',(select count(*) from public.sbom_composite_unresolved_relationships u where u.organization_id=r.organization_id and u.review_id=r.id and u.disposition is null)),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256,'releaseId',i.release_id,'source',s.source_kind,'supplierSubmissionId',i.supplier_submission_id,'acceptedForComposite',i.supplier_submission_id is null or ss.status='accepted','retentionWarning',case when p.retention_protection_until is null then null else 'Retention protection applies to this input.' end) order by i.source_id) from public.sbom_composite_review_inputs i join public.sbom_sources s on s.organization_id=i.organization_id and s.id=i.source_id left join public.sbom_supplier_submissions ss on ss.organization_id=i.organization_id and ss.id=i.supplier_submission_id left join public.products p on p.organization_id=s.organization_id and p.id=s.product_id where i.organization_id=r.organization_id and i.review_id=r.id),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'reviewId',c.review_id,'identity',nullif(c.identity_key,''),'kind',c.conflict_type,'field',c.field_name,'state',case when c.resolved_at is null then 'unresolved' when c.selected_source_component_id is null then 'excluded' else 'resolved' end,'candidates',c.candidates,'selectedComponentId',c.selected_source_component_id,'resolutionReason',c.resolution_reason,'resolvedAt',c.resolved_at) order by c.created_at,c.id) from public.sbom_composite_conflicts c where c.organization_id=r.organization_id and c.review_id=r.id),'[]'::jsonb),
    'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'reviewId',u.review_id,'kind',coalesce(u.detail->>'kind','unresolved_endpoint'),'state',case u.disposition when 'include' then 'included' when 'omit' then 'excluded' else 'unresolved' end,'parentComponentId',u.detail->>'parentComponentId','childComponentId',u.detail->>'childComponentId','sourceId',u.detail->>'sourceId','documentId',u.detail->>'documentId','sourceParentRef',u.detail->>'sourceParentRef','sourceChildRef',u.detail->>'sourceChildRef','reason',u.resolution_reason,'resolvedAt',u.resolved_at) order by u.created_at,u.id) from public.sbom_composite_unresolved_relationships u where u.organization_id=r.organization_id and u.review_id=r.id),'[]'::jsonb),
    'retentionWarnings',coalesce((select jsonb_agg(w.warning order by w.warning) from (select distinct case when f.reason_kind='legal_hold' then 'At least one input is subject to an active legal hold.' else 'Input source retention requirements differ.' end warning from public.sbom_composite_review_inputs i join public.sbom_sources s on s.organization_id=i.organization_id and s.id=i.source_id join public.retention_authoritative_facts f on f.organization_id=s.organization_id and f.source_record_id=s.product_id and f.active where i.organization_id=r.organization_id and i.review_id=r.id union all select 'Input source retention protection periods differ.' where (select count(distinct coalesce(p.retention_protection_until,'-infinity'::timestamptz)) from public.sbom_composite_review_inputs i join public.sbom_sources s on s.organization_id=i.organization_id and s.id=i.source_id join public.products p on p.organization_id=s.organization_id and p.id=s.product_id where i.organization_id=r.organization_id and i.review_id=r.id)>1) w),'[]'::jsonb),
    'generatedSourceId',r.generated_source_id,'generatedDocumentId',r.generated_document_id,
    'provenanceManifest',case when r.status='completed' then jsonb_build_object('reviewId',r.id,'sourceHashes',(select jsonb_agg(i.source_sha256 order by i.source_sha256) from public.sbom_composite_review_inputs i where i.organization_id=r.organization_id and i.review_id=r.id),'mergeRulesVersion',r.merge_rules_version,'generatedAt',r.completed_at,'components',coalesce((select jsonb_agg(jsonb_build_object('compositeComponentRef',p.composite_component_ref,'field',p.field_name,'sourceId',p.source_id,'documentId',p.source_document_id,'documentSha256',i.source_sha256,'sourceComponentId',p.source_component_id,'sourceComponentRef',p.source_component_ref,'supplierSubmissionId',p.supplier_submission_id,'mergedAt',p.merge_timestamp,'reviewDecisionId',p.review_conflict_id) order by p.composite_component_ref,p.field_name,p.source_component_id) from public.sbom_composite_component_provenance p join public.sbom_composite_review_inputs i on i.organization_id=p.organization_id and i.review_id=p.review_id and i.source_id=p.source_id where p.organization_id=r.organization_id and p.review_id=r.id),'[]'::jsonb),'dependencies',coalesce((select jsonb_agg(jsonb_build_object('fromRef',d.composite_parent_ref,'toRef',d.composite_child_ref,'sourceId',d.source_id,'documentId',d.source_document_id,'sourceDependencyId',d.source_dependency_id,'supplierSubmissionId',d.supplier_submission_id,'mergedAt',d.merge_timestamp,'reviewDecisionId',d.review_relationship_id) order by d.composite_parent_ref,d.composite_child_ref,d.source_dependency_id) from public.sbom_composite_dependency_provenance d where d.organization_id=r.organization_id and d.review_id=r.id),'[]'::jsonb)) else null end,
    'error',r.failure_message,'createdAt',r.created_at,'updatedAt',r.updated_at,'completedAt',r.completed_at)
  from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id;
$$;

revoke all on function public.sbom_composite_identity_key(text,text,jsonb,uuid,text),public.materialize_sbom_composite_projection(uuid,uuid),public.refresh_sbom_composite_review_projection_atomic(uuid,uuid),public.sync_sbom_composite_selected_provenance(uuid,uuid),public.generate_sbom_composite_atomic(uuid,uuid,uuid,uuid,uuid),public.claim_sbom_composite_generation(uuid,uuid,integer),public.sbom_composite_review_json(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sbom_composite_identity_key(text,text,jsonb,uuid,text),public.materialize_sbom_composite_projection(uuid,uuid),public.refresh_sbom_composite_review_projection_atomic(uuid,uuid),public.sync_sbom_composite_selected_provenance(uuid,uuid),public.generate_sbom_composite_atomic(uuid,uuid,uuid,uuid,uuid),public.claim_sbom_composite_generation(uuid,uuid,integer),public.sbom_composite_review_json(uuid,uuid) to service_role;
