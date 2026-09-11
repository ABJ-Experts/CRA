-- M3-07 composite SBOM reviews and supplier-provenance intake.  This is an
-- additive, private service-role surface: supplier portal credentials are
-- opaque hashes and sources continue through the normal SBOM worker.

create table public.sbom_supplier_requests (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid not null,
  supplier_display_name text not null check (char_length(btrim(supplier_display_name)) between 1 and 255 and supplier_display_name = btrim(supplier_display_name)),
  allowed_component_ref text not null check (char_length(btrim(allowed_component_ref)) between 1 and 1024 and allowed_component_ref = btrim(allowed_component_ref)),
  status text not null default 'open' check (status in ('open', 'closed', 'revoked')),
  expires_at timestamptz not null,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, created_by, idempotency_key),
  foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  check (expires_at > created_at),
  check ((status = 'open' and closed_at is null and closed_by is null) or (status in ('closed', 'revoked') and closed_at is not null and closed_by is not null))
);

create table public.sbom_supplier_invitations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  token_prefix text not null check (token_prefix ~ '^cra_sup_[a-z0-9]{8}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  session_token_hash text check (session_token_hash is null or session_token_hash ~ '^[a-f0-9]{64}$'),
  session_expires_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, request_id, created_by, idempotency_key),
  unique (token_hash),
  unique (token_prefix),
  unique (session_token_hash),
  foreign key (organization_id, request_id)
    references public.sbom_supplier_requests(organization_id, id) on delete restrict,
  check (expires_at > created_at),
  check (
    (status = 'active' and consumed_at is null and revoked_at is null and session_token_hash is null and session_expires_at is null)
    or (status = 'used' and consumed_at is not null and revoked_at is null and session_token_hash is not null and session_expires_at is not null)
    or (status = 'expired' and consumed_at is null and revoked_at is null and session_token_hash is null and session_expires_at is null)
    or (status = 'revoked' and consumed_at is null and revoked_at is not null and session_token_hash is null and session_expires_at is null)
  )
);

create table public.sbom_supplier_submissions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  invitation_id uuid not null,
  source_id uuid not null,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'validation_failed', 'awaiting_review', 'accepted', 'rejected', 'superseded')),
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 1 and 2000 and decision_reason = btrim(decision_reason)),
  reviewed_by uuid references public.users(id) on delete restrict,
  reviewed_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_id),
  unique (organization_id, request_id, idempotency_key),
  foreign key (organization_id, request_id)
    references public.sbom_supplier_requests(organization_id, id) on delete restrict,
  foreign key (organization_id, invitation_id)
    references public.sbom_supplier_invitations(organization_id, id) on delete restrict,
  foreign key (organization_id, source_id)
    references public.sbom_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_id)
    references public.sbom_supplier_submissions(organization_id, id) on delete restrict,
  check (superseded_by_id is null or superseded_by_id <> id),
  check ((status in ('accepted', 'rejected') and reviewed_by is not null and reviewed_at is not null and decision_reason is not null) or (status not in ('accepted', 'rejected') and reviewed_by is null and reviewed_at is null and decision_reason is null))
);

create table public.sbom_composite_reviews (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid not null,
  merge_rules_version text not null check (char_length(btrim(merge_rules_version)) between 1 and 80 and merge_rules_version = btrim(merge_rules_version)),
  input_set_digest text not null check (input_set_digest ~ '^[a-f0-9]{64}$'),
  resolution_digest text check (resolution_digest is null or resolution_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'awaiting_review', 'generating', 'processing', 'completed', 'failed')),
  generated_source_id uuid,
  generated_document_id uuid,
  provenance_manifest_sha256 text check (provenance_manifest_sha256 is null or provenance_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  failure_code text check (failure_code is null or char_length(btrim(failure_code)) between 1 and 120),
  failure_message text check (failure_message is null or char_length(btrim(failure_message)) between 1 and 1000),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  completed_at timestamptz,
  lease_owner uuid references public.users(id) on delete restrict,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, release_id, input_set_digest, merge_rules_version),
  foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, generated_source_id)
    references public.sbom_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, generated_document_id)
    references public.sbom_documents(organization_id, id) on delete restrict,
  check ((generated_source_id is null and generated_document_id is null) or generated_source_id is not null),
  check ((status = 'failed') = (failure_code is not null)),
  check ((failure_code is null) = (failure_message is null))
);

create index sbom_composite_reviews_claim_idx on public.sbom_composite_reviews(organization_id, lease_expires_at, created_at, id) where status='processing';

create table public.sbom_composite_review_inputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null,
  source_id uuid not null,
  document_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  release_id uuid not null,
  supplier_submission_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, review_id, source_id),
  foreign key (organization_id, review_id) references public.sbom_composite_reviews(organization_id, id) on delete restrict,
  foreign key (organization_id, source_id) references public.sbom_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, document_id, source_id) references public.sbom_document_sources(organization_id, document_id, source_id) on delete restrict,
  foreign key (organization_id, supplier_submission_id) references public.sbom_supplier_submissions(organization_id, id) on delete restrict
);

create table public.sbom_composite_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null,
  identity_key text not null check (char_length(btrim(identity_key)) between 1 and 4096),
  conflict_type text not null check (conflict_type in ('incompatible_version', 'field_conflict', 'unresolved_identity')),
  field_name text check (field_name is null or char_length(btrim(field_name)) between 1 and 120),
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) between 1 and 1000 and octet_length(candidates::text) <= 524288),
  selected_source_component_id uuid,
  resolution_reason text check (resolution_reason is null or char_length(btrim(resolution_reason)) between 1 and 2000 and resolution_reason = btrim(resolution_reason)),
  resolved_by uuid references public.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, review_id, identity_key, conflict_type, field_name),
  foreign key (organization_id, review_id) references public.sbom_composite_reviews(organization_id, id) on delete restrict,
  foreign key (organization_id, selected_source_component_id) references public.sbom_components(organization_id, id) on delete restrict,
  check ((selected_source_component_id is null and resolution_reason is null and resolved_by is null and resolved_at is null) or (selected_source_component_id is not null and resolution_reason is not null and resolved_by is not null and resolved_at is not null))
);

create table public.sbom_composite_unresolved_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null,
  relationship_key text not null check (char_length(btrim(relationship_key)) between 1 and 4096),
  source_dependency_id uuid,
  detail jsonb not null check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 131072),
  disposition text check (disposition is null or disposition in ('include', 'omit')),
  resolution_reason text check (resolution_reason is null or char_length(btrim(resolution_reason)) between 1 and 2000 and resolution_reason = btrim(resolution_reason)),
  resolved_by uuid references public.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, review_id, relationship_key),
  foreign key (organization_id, review_id) references public.sbom_composite_reviews(organization_id, id) on delete restrict,
  foreign key (organization_id, source_dependency_id) references public.sbom_component_dependencies(organization_id, id) on delete restrict,
  check ((disposition is null and resolution_reason is null and resolved_by is null and resolved_at is null) or (disposition is not null and resolution_reason is not null and resolved_by is not null and resolved_at is not null))
);

create table public.sbom_composite_component_provenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null,
  composite_component_ref text not null check (char_length(btrim(composite_component_ref)) between 1 and 1024),
  field_name text check (field_name is null or char_length(btrim(field_name)) between 1 and 120),
  source_id uuid not null,
  source_document_id uuid not null,
  source_component_id uuid,
  source_component_ref text check (source_component_ref is null or char_length(btrim(source_component_ref)) between 1 and 1024),
  supplier_submission_id uuid,
  merge_timestamp timestamptz not null default now(),
  review_conflict_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique nulls not distinct (organization_id, review_id, composite_component_ref, field_name, source_component_id),
  foreign key (organization_id, review_id) references public.sbom_composite_reviews(organization_id, id) on delete restrict,
  foreign key (organization_id, source_id) references public.sbom_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_id) references public.sbom_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, source_component_id) references public.sbom_components(organization_id, id) on delete restrict,
  foreign key (organization_id, supplier_submission_id) references public.sbom_supplier_submissions(organization_id, id) on delete restrict,
  foreign key (organization_id, review_conflict_id) references public.sbom_composite_conflicts(organization_id, id) on delete restrict
);

create index sbom_supplier_requests_org_release_idx on public.sbom_supplier_requests(organization_id, release_id, created_at desc);
create index sbom_supplier_invitations_expiry_idx on public.sbom_supplier_invitations(expires_at) where status = 'active';
create index sbom_supplier_submissions_org_request_idx on public.sbom_supplier_submissions(organization_id, request_id, created_at desc);
create index sbom_supplier_submissions_review_idx on public.sbom_supplier_submissions(organization_id, status, created_at) where status in ('awaiting_review', 'processing');
create index sbom_composite_reviews_org_release_idx on public.sbom_composite_reviews(organization_id, release_id, created_at desc);
create index sbom_composite_review_inputs_document_idx on public.sbom_composite_review_inputs(organization_id, document_id, source_id);
create index sbom_composite_conflicts_review_idx on public.sbom_composite_conflicts(organization_id, review_id, resolved_at, id);
create index sbom_composite_relationships_review_idx on public.sbom_composite_unresolved_relationships(organization_id, review_id, resolved_at, id);
create index sbom_composite_provenance_component_idx on public.sbom_composite_component_provenance(organization_id, review_id, composite_component_ref, field_name);

alter table public.sbom_supplier_requests enable row level security;
alter table public.sbom_supplier_invitations enable row level security;
alter table public.sbom_supplier_submissions enable row level security;
alter table public.sbom_composite_reviews enable row level security;
alter table public.sbom_composite_review_inputs enable row level security;
alter table public.sbom_composite_conflicts enable row level security;
alter table public.sbom_composite_unresolved_relationships enable row level security;
alter table public.sbom_composite_component_provenance enable row level security;
revoke all on public.sbom_supplier_requests, public.sbom_supplier_invitations, public.sbom_supplier_submissions,
  public.sbom_composite_reviews, public.sbom_composite_review_inputs, public.sbom_composite_conflicts,
  public.sbom_composite_unresolved_relationships, public.sbom_composite_component_provenance from public, anon, authenticated;
grant select, insert, update, delete on public.sbom_supplier_requests, public.sbom_supplier_invitations, public.sbom_supplier_submissions,
  public.sbom_composite_reviews, public.sbom_composite_review_inputs, public.sbom_composite_conflicts,
  public.sbom_composite_unresolved_relationships, public.sbom_composite_component_provenance to service_role;

create trigger set_sbom_supplier_requests_updated_at before update on public.sbom_supplier_requests for each row execute function public.set_updated_at();
create trigger set_sbom_supplier_submissions_updated_at before update on public.sbom_supplier_submissions for each row execute function public.set_updated_at();
create trigger set_sbom_composite_reviews_updated_at before update on public.sbom_composite_reviews for each row execute function public.set_updated_at();
create trigger set_sbom_composite_conflicts_updated_at before update on public.sbom_composite_conflicts for each row execute function public.set_updated_at();
create trigger set_sbom_composite_relationships_updated_at before update on public.sbom_composite_unresolved_relationships for each row execute function public.set_updated_at();

create or replace function public.sbom_supplier_submission_json(p_organization_id uuid, p_submission_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', s.id, 'requestId', s.request_id, 'sourceId', s.source_id,
    'state', s.status, 'fileName', source.original_filename, 'mediaType', source.declared_media_type,
    'byteSize', source.declared_byte_size, 'sha256', source.declared_sha256,
    'validationMessage', case when s.status = 'validation_failed' then coalesce(document.error_message, 'Supplier SBOM validation failed.') else null end,
    'reviewReason', s.decision_reason, 'reviewedAt', s.reviewed_at, 'reviewedBy', s.reviewed_by,
    'supersededBySubmissionId', s.superseded_by_id, 'createdAt', s.created_at, 'updatedAt', s.updated_at)
  from public.sbom_supplier_submissions s
  join public.sbom_sources source on source.organization_id=s.organization_id and source.id=s.source_id
  left join lateral (select d.error_message from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id where ds.organization_id=s.organization_id and ds.source_id=s.source_id order by d.created_at desc limit 1) document on true
  where s.organization_id = p_organization_id and s.id = p_submission_id;
$$;

create or replace function public.sbom_supplier_request_json(p_organization_id uuid, p_request_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id',r.id,'organizationId',r.organization_id,'productId',r.product_id,'releaseId',r.release_id,
    'supplierDisplayName',r.supplier_display_name,'allowedComponentRef',r.allowed_component_ref,'state',r.status,
    'expiresAt',r.expires_at,'createdAt',r.created_at,'createdBy',r.created_by,'closedAt',r.closed_at)
  from public.sbom_supplier_requests r where r.organization_id=p_organization_id and r.id=p_request_id;
$$;

create or replace function public.sbom_supplier_invitation_json(p_organization_id uuid, p_invitation_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id',i.id,'requestId',i.request_id,'tokenPrefix',i.token_prefix,'state',i.status,
    'expiresAt',i.expires_at,'createdAt',i.created_at,'usedAt',i.consumed_at,'revokedAt',i.revoked_at)
  from public.sbom_supplier_invitations i where i.organization_id=p_organization_id and i.id=p_invitation_id;
$$;

create or replace function public.sbom_composite_review_json(p_organization_id uuid, p_review_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id',r.id,'organizationId',r.organization_id,'productId',r.product_id,'releaseId',r.release_id,'state',r.status,
    'mergeRulesVersion',r.merge_rules_version,'inputSetDigest',r.input_set_digest,'resolutionDigest',r.resolution_digest,
    'coverage',jsonb_build_object('sourceCount',(select count(*) from public.sbom_composite_review_inputs i where i.organization_id=r.organization_id and i.review_id=r.id),
      'componentCandidateCount',(select count(*) from public.sbom_composite_component_provenance p where p.organization_id=r.organization_id and p.review_id=r.id),
      'duplicateIdentityCount',0,'conflictCount',(select count(*) from public.sbom_composite_conflicts c where c.organization_id=r.organization_id and c.review_id=r.id),
      'unresolvedRelationshipCount',(select count(*) from public.sbom_composite_unresolved_relationships u where u.organization_id=r.organization_id and u.review_id=r.id and u.disposition is null)),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256,'releaseId',i.release_id,'source',s.source_kind,'supplierSubmissionId',i.supplier_submission_id,'acceptedForComposite',i.supplier_submission_id is null or ss.status='accepted','retentionWarning',null) order by i.source_id) from public.sbom_composite_review_inputs i join public.sbom_sources s on s.organization_id=i.organization_id and s.id=i.source_id left join public.sbom_supplier_submissions ss on ss.organization_id=i.organization_id and ss.id=i.supplier_submission_id where i.organization_id=r.organization_id and i.review_id=r.id),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'reviewId',c.review_id,'identity',nullif(c.identity_key,''),'kind',c.conflict_type,'field',c.field_name,'state',case when c.selected_source_component_id is not null then 'resolved' when c.resolution_reason is not null then 'excluded' else 'unresolved' end,'candidates',c.candidates,'selectedComponentId',c.selected_source_component_id,'resolutionReason',c.resolution_reason,'resolvedAt',c.resolved_at) order by c.created_at,c.id) from public.sbom_composite_conflicts c where c.organization_id=r.organization_id and c.review_id=r.id),'[]'::jsonb),
    'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'reviewId',u.review_id,'kind',coalesce(u.detail->>'kind','unresolved_endpoint'),'state',case u.disposition when 'include' then 'included' when 'omit' then 'excluded' else 'unresolved' end,'parentComponentId',u.detail->>'parentComponentId','childComponentId',u.detail->>'childComponentId','sourceId',u.detail->>'sourceId','documentId',u.detail->>'documentId','sourceParentRef',u.detail->>'sourceParentRef','sourceChildRef',u.detail->>'sourceChildRef','reason',u.resolution_reason,'resolvedAt',u.resolved_at) order by u.created_at,u.id) from public.sbom_composite_unresolved_relationships u where u.organization_id=r.organization_id and u.review_id=r.id),'[]'::jsonb),
    'retentionWarnings','[]'::jsonb,'generatedSourceId',r.generated_source_id,'generatedDocumentId',r.generated_document_id,
    'provenanceManifest',case when r.status='completed' then jsonb_build_object('reviewId',r.id,'sourceHashes',(select jsonb_agg(i.source_sha256 order by i.source_sha256) from public.sbom_composite_review_inputs i where i.organization_id=r.organization_id and i.review_id=r.id),'mergeRulesVersion',r.merge_rules_version,'generatedAt',r.completed_at,'components',coalesce((select jsonb_agg(jsonb_build_object('compositeComponentRef',p.composite_component_ref,'field',p.field_name,'sourceId',p.source_id,'documentId',p.source_document_id,'documentSha256',i.source_sha256,'sourceComponentId',p.source_component_id,'sourceComponentRef',p.source_component_ref,'supplierSubmissionId',p.supplier_submission_id,'mergedAt',p.merge_timestamp,'reviewDecisionId',p.review_conflict_id) order by p.composite_component_ref,p.field_name) from public.sbom_composite_component_provenance p join public.sbom_composite_review_inputs i on i.organization_id=p.organization_id and i.review_id=p.review_id and i.source_id=p.source_id where p.organization_id=r.organization_id and p.review_id=r.id),'[]'::jsonb)) else null end,
    'error',r.failure_message,'createdAt',r.created_at,'updatedAt',r.updated_at,'completedAt',r.completed_at)
  from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id;
$$;

create or replace function public.create_supplier_sbom_request_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid, p_product_id uuid, p_release_id uuid,
  p_supplier_display_name text, p_allowed_component_ref text, p_expires_at timestamptz, p_idempotency_key uuid, p_request_digest text, p_correlation_id uuid
) returns table(outcome text, request jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.sbom_supplier_requests%rowtype;
begin
  if p_request_id is null or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_correlation_id is null or not public.m2_active_member(p_organization_id, p_actor_user_id)
    or char_length(btrim(coalesce(p_supplier_display_name, ''))) not between 1 and 255
    or char_length(btrim(coalesce(p_allowed_component_ref, ''))) not between 1 and 1024 or p_expires_at <= now()
    or not exists (select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_request from public.sbom_supplier_requests where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_request.request_digest=p_request_digest then return query select 'replayed'::text,public.sbom_supplier_request_json(p_organization_id,v_request.id); end if;
    return query select 'idempotency_mismatch'::text,null::jsonb;
  end if;
  insert into public.sbom_supplier_requests(id,organization_id,product_id,release_id,supplier_display_name,allowed_component_ref,expires_at,idempotency_key,request_digest,created_by)
  values(p_request_id,p_organization_id,p_product_id,p_release_id,btrim(p_supplier_display_name),btrim(p_allowed_component_ref),p_expires_at,p_idempotency_key,p_request_digest,p_actor_user_id)
  on conflict (organization_id,id) do nothing returning * into v_request;
  if v_request.id is null then select * into v_request from public.sbom_supplier_requests where organization_id=p_organization_id and id=p_request_id; end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'sbom.supplier_request_created','sbom_supplier_request',v_request.id::text,jsonb_build_object('correlationId',p_correlation_id));
  return query select 'created'::text,public.sbom_supplier_request_json(p_organization_id,v_request.id);
end;
$$;

create or replace function public.create_supplier_sbom_invitation_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid, p_invitation_id uuid,
  p_token_hash text, p_expires_at timestamptz, p_idempotency_key uuid, p_request_digest text, p_correlation_id uuid
) returns table(outcome text, invitation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.sbom_supplier_requests%rowtype; v_invitation public.sbom_supplier_invitations%rowtype;
begin
  if p_invitation_id is null or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_correlation_id is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at<=now()
    or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_request from public.sbom_supplier_requests where organization_id=p_organization_id and id=p_request_id and status='open' and expires_at>now() for share;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_invitation from public.sbom_supplier_invitations where organization_id=p_organization_id and request_id=p_request_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_invitation.request_digest=p_request_digest then return query select 'replayed'::text,public.sbom_supplier_invitation_json(p_organization_id,v_invitation.id); end if;
    return query select 'idempotency_mismatch'::text,null::jsonb;
  end if;
  insert into public.sbom_supplier_invitations(id,organization_id,request_id,token_prefix,token_hash,expires_at,created_by,idempotency_key,request_digest)
  values(p_invitation_id,p_organization_id,p_request_id,'cra_sup_'||substr(p_token_hash,1,8),p_token_hash,least(p_expires_at,v_request.expires_at),p_actor_user_id,p_idempotency_key,p_request_digest) returning * into v_invitation;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.supplier_invitation_created','sbom_supplier_invitation',v_invitation.id::text,jsonb_build_object('requestId',p_request_id,'correlationId',p_correlation_id));
  return query select 'created'::text,public.sbom_supplier_invitation_json(p_organization_id,v_invitation.id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$$;

create or replace function public.consume_supplier_sbom_invitation_atomic(
  p_token_hash text, p_session_token_hash text, p_session_expires_at timestamptz
) returns table(outcome text, session jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invitation public.sbom_supplier_invitations%rowtype; v_request public.sbom_supplier_requests%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_session_token_hash !~ '^[a-f0-9]{64}$' or p_session_expires_at <= now() or p_session_expires_at > now()+interval '30 minutes' then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_invitation from public.sbom_supplier_invitations where token_hash=p_token_hash for update;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_request from public.sbom_supplier_requests where organization_id=v_invitation.organization_id and id=v_invitation.request_id for share;
  if not found or v_request.status<>'open' or v_request.expires_at<=now() then return query select 'not_found'::text,null::jsonb;return;end if;
  if v_invitation.status='active' and v_invitation.expires_at>now() then
    update public.sbom_supplier_invitations set status='used',consumed_at=now(),session_token_hash=p_session_token_hash,session_expires_at=p_session_expires_at where id=v_invitation.id;
  elsif v_invitation.status='used' and v_invitation.session_token_hash=p_session_token_hash and v_invitation.session_expires_at>now() then
    null;
  else
    if v_invitation.status='active' and v_invitation.expires_at<=now() then update public.sbom_supplier_invitations set status='expired' where id=v_invitation.id; end if;
    return query select 'not_found'::text,null::jsonb;return;
  end if;
  return query select 'created'::text,jsonb_build_object('requestReference',v_request.id::text,'allowedComponentRef',v_request.allowed_component_ref,'expiresAt',p_session_expires_at);
end;
$$;

create or replace function public.reserve_supplier_sbom_submission_atomic(
  p_session_token_hash text, p_submission_id uuid, p_source_id uuid, p_idempotency_key uuid, p_request_digest text,
  p_original_filename text, p_declared_media_type text, p_declared_byte_size bigint, p_declared_sha256 text, p_correlation_id uuid,
  p_declared_format text default null, p_declared_spec_version text default null
) returns table(outcome text, submission jsonb, source jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invitation public.sbom_supplier_invitations%rowtype; v_request public.sbom_supplier_requests%rowtype; v_submission public.sbom_supplier_submissions%rowtype;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_submission_id is null or p_source_id is null or p_idempotency_key is null or p_correlation_id is null or p_request_digest !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_original_filename,''))) not between 1 and 255 or p_original_filename<>btrim(p_original_filename) or p_original_filename~'[\\/[:cntrl:]]'
    or not public.sbom_allowed_media_type(p_declared_media_type) or p_declared_byte_size not between 1 and 104857600 or p_declared_sha256 !~ '^[a-f0-9]{64}$' then return query select 'not_found'::text,null::jsonb,null::jsonb;return;end if;
  select * into v_invitation from public.sbom_supplier_invitations where session_token_hash=p_session_token_hash and status='used' and session_expires_at>now() for share;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb;return;end if;
  select * into v_request from public.sbom_supplier_requests where organization_id=v_invitation.organization_id and id=v_invitation.request_id and status='open' and expires_at>now() for share;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb;return;end if;
  select * into v_submission from public.sbom_supplier_submissions where organization_id=v_request.organization_id and request_id=v_request.id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_submission.request_digest=p_request_digest then return query select 'replayed'::text,public.sbom_supplier_submission_json(v_request.organization_id,v_submission.id),public.sbom_source_json(v_request.organization_id,v_submission.source_id);end if;
    return query select 'idempotency_mismatch'::text,null::jsonb,null::jsonb;return;
  end if;
  insert into public.sbom_sources(id,organization_id,product_id,release_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,upload_expires_at,correlation_id,declared_format,declared_spec_version)
  values(p_source_id,v_request.organization_id,v_request.product_id,v_request.release_id,'supplier',p_idempotency_key,p_request_digest,p_original_filename,p_declared_media_type,p_declared_byte_size,p_declared_sha256,v_request.organization_id::text||'/'||p_source_id::text||'/'||p_declared_sha256,least(now()+interval '20 minutes',v_invitation.session_expires_at,v_request.expires_at),p_correlation_id,p_declared_format,p_declared_spec_version);
  insert into public.sbom_supplier_submissions(id,organization_id,request_id,invitation_id,source_id,idempotency_key,request_digest)
  values(p_submission_id,v_request.organization_id,v_request.id,v_invitation.id,p_source_id,p_idempotency_key,p_request_digest) returning * into v_submission;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(v_request.organization_id,'sbom.supplier_submission_reserved','sbom_supplier_submission',v_submission.id::text,jsonb_build_object('sourceId',p_source_id,'correlationId',p_correlation_id));
  return query select 'created'::text,public.sbom_supplier_submission_json(v_request.organization_id,v_submission.id),public.sbom_source_json(v_request.organization_id,p_source_id);
end;
$$;

-- The portal may receive only its own storage reservation.  It cannot supply
-- completion metadata: the API inspects the private object and this function
-- compares that observation with the immutable reservation.
create or replace function public.get_supplier_sbom_submission_upload_atomic(
  p_session_token_hash text, p_source_id uuid
) returns table(outcome text, reservation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invitation public.sbom_supplier_invitations%rowtype; v_source public.sbom_sources%rowtype;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$' then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_invitation from public.sbom_supplier_invitations i where i.session_token_hash=p_session_token_hash and i.status='used' and i.session_expires_at>now() for share;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  select s.* into v_source from public.sbom_sources s join public.sbom_supplier_submissions ss on ss.organization_id=s.organization_id and ss.source_id=s.id join public.sbom_supplier_requests r on r.organization_id=ss.organization_id and r.id=ss.request_id
  where s.organization_id=v_invitation.organization_id and s.id=p_source_id and ss.invitation_id=v_invitation.id and r.status='open' and r.expires_at>now() and s.status='upload_pending' and s.upload_expires_at>now();
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  return query select 'ready'::text,jsonb_build_object('sourceId',v_source.id,'objectKey',v_source.staging_storage_key,'sha256',v_source.declared_sha256,'byteSize',v_source.declared_byte_size,'mediaType',v_source.declared_media_type,'expiresAt',v_source.upload_expires_at);
end;
$$;

-- Contract-facing name used by the service-role adapter. The idempotency key
-- binds this completion read to the same supplier reservation without exposing
-- another tenant's source or raw object.
create or replace function public.get_supplier_sbom_submission_upload(
  p_session_token_hash text, p_source_id uuid, p_idempotency_key uuid
) returns table(outcome text, source jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invitation public.sbom_supplier_invitations%rowtype; v_source public.sbom_sources%rowtype;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_idempotency_key is null then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_invitation from public.sbom_supplier_invitations i where i.session_token_hash=p_session_token_hash and i.status='used' and i.session_expires_at>now() for share;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  select s.* into v_source from public.sbom_sources s join public.sbom_supplier_submissions ss on ss.organization_id=s.organization_id and ss.source_id=s.id join public.sbom_supplier_requests r on r.organization_id=ss.organization_id and r.id=ss.request_id
  where s.organization_id=v_invitation.organization_id and s.id=p_source_id and ss.invitation_id=v_invitation.id and ss.idempotency_key=p_idempotency_key and r.status='open' and r.expires_at>now();
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  if v_source.status='verified' then return query select 'replayed'::text,public.sbom_source_json(v_source.organization_id,v_source.id);return;end if;
  if v_source.status<>'upload_pending' or v_source.upload_expires_at<=now() then return query select 'conflict'::text,null::jsonb;return;end if;
  return query select 'ready'::text,public.sbom_source_json(v_source.organization_id,v_source.id);
end;
$$;

create or replace function public.finalize_supplier_sbom_submission_atomic(
  p_session_token_hash text, p_source_id uuid, p_idempotency_key uuid, p_actual_sha256 text,
  p_actual_byte_size bigint, p_actual_media_type text, p_correlation_id uuid
) returns table(outcome text, submission jsonb, source jsonb, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invitation public.sbom_supplier_invitations%rowtype; v_submission public.sbom_supplier_submissions%rowtype;
  v_source public.sbom_sources%rowtype; v_raw_id uuid; v_canonical_source_id uuid; v_canonical_job_id uuid; v_document_id uuid; v_job_id uuid;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_idempotency_key is null or p_correlation_id is null or p_actual_sha256 !~ '^[a-f0-9]{64}$' or p_actual_byte_size not between 1 and 104857600 or not public.sbom_allowed_media_type(p_actual_media_type) then return query select 'not_found'::text,null::jsonb,null::jsonb,null::jsonb;return;end if;
  select * into v_invitation from public.sbom_supplier_invitations i where i.session_token_hash=p_session_token_hash and i.status='used' and i.session_expires_at>now() for share;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb,null::jsonb;return;end if;
  select ss.* into v_submission from public.sbom_supplier_submissions ss where ss.organization_id=v_invitation.organization_id and ss.source_id=p_source_id and ss.invitation_id=v_invitation.id and ss.idempotency_key=p_idempotency_key for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb,null::jsonb;return;end if;
  select * into v_source from public.sbom_sources s where s.organization_id=v_invitation.organization_id and s.id=p_source_id for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb,null::jsonb;return;end if;
  if v_source.status='verified' then
    select j.id into v_job_id from public.sbom_ingest_jobs j where j.organization_id=v_source.organization_id and j.source_id=coalesce(v_source.deduplicated_from_source_id,v_source.id);
    return query select 'replayed'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),public.sbom_ingest_job_json(v_source.organization_id,v_job_id);return;
  end if;
  if v_source.status<>'upload_pending' then return query select 'invalid_state'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),null::jsonb;return;end if;
  if v_source.upload_expires_at<=now() then
    update public.sbom_sources set status='expired',rejected_at=now(),rejection_code='upload_expired' where organization_id=v_source.organization_id and id=v_source.id;
    return query select 'expired'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),null::jsonb;return;
  end if;
  if p_actual_sha256<>v_source.declared_sha256 or p_actual_byte_size<>v_source.declared_byte_size or p_actual_media_type<>v_source.declared_media_type then
    update public.sbom_sources set status='rejected',rejected_at=now(),rejection_code=case when p_actual_sha256<>v_source.declared_sha256 then 'hash_mismatch' when p_actual_byte_size<>v_source.declared_byte_size then 'byte_size_mismatch' else 'media_type_mismatch' end where organization_id=v_source.organization_id and id=v_source.id;
    update public.sbom_supplier_submissions set status='validation_failed' where organization_id=v_source.organization_id and id=v_submission.id;
    return query select 'integrity_mismatch'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),null::jsonb;return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_source.organization_id::text||':'||v_source.release_id::text||':'||v_source.declared_sha256,0));
  insert into public.sbom_raw_objects(organization_id,sha256,byte_size,media_type,storage_key) values(v_source.organization_id,v_source.declared_sha256,v_source.declared_byte_size,v_source.declared_media_type,v_source.staging_storage_key) on conflict(organization_id,sha256) do nothing;
  select id into v_raw_id from public.sbom_raw_objects where organization_id=v_source.organization_id and sha256=v_source.declared_sha256 for share;
  select canonical.id,canonical_job.id,document.id into v_canonical_source_id,v_canonical_job_id,v_document_id
  from public.sbom_sources canonical join public.sbom_ingest_jobs canonical_job on canonical_job.organization_id=canonical.organization_id and canonical_job.source_id=canonical.id
  left join lateral (select d.id from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id where ds.organization_id=canonical.organization_id and ds.source_id=canonical.id and ds.raw_object_id=canonical.raw_object_id and d.state in ('processing','completed') order by (d.state='completed') desc,d.created_at desc limit 1) document on true
  where canonical.organization_id=v_source.organization_id and canonical.release_id=v_source.release_id and canonical.id<>v_source.id and canonical.deduplicated_from_source_id is null and canonical.status='verified' and canonical.raw_object_id=v_raw_id and canonical_job.input_sha256=v_source.declared_sha256 and (document.id is not null or canonical_job.status in ('queued','processing'))
  order by (document.id is not null) desc,canonical_job.created_at,canonical.id limit 1 for update of canonical,canonical_job;
  if found then
    update public.sbom_sources set status='verified',verified_at=now(),raw_object_id=v_raw_id,deduplicated_from_source_id=v_canonical_source_id where organization_id=v_source.organization_id and id=v_source.id;
    if v_document_id is not null then insert into public.sbom_document_sources(organization_id,document_id,source_id,raw_object_id,release_id) values(v_source.organization_id,v_document_id,v_source.id,v_raw_id,v_source.release_id) on conflict(organization_id,document_id,source_id) do nothing;end if;
    update public.sbom_supplier_submissions set status='processing' where organization_id=v_source.organization_id and id=v_submission.id;
    return query select 'deduplicated'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),public.sbom_ingest_job_json(v_source.organization_id,v_canonical_job_id);return;
  end if;
  update public.sbom_sources set status='verified',verified_at=now(),raw_object_id=v_raw_id where organization_id=v_source.organization_id and id=v_source.id;
  insert into public.sbom_ingest_jobs(organization_id,source_id,release_id,correlation_id,idempotency_key,input_sha256) values(v_source.organization_id,v_source.id,v_source.release_id,v_source.correlation_id,v_source.idempotency_key,v_source.declared_sha256) returning id into v_job_id;
  update public.sbom_supplier_submissions set status='processing' where organization_id=v_source.organization_id and id=v_submission.id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(v_source.organization_id,'sbom.supplier_submission_queued','sbom_supplier_submission',v_submission.id::text,jsonb_build_object('sourceId',v_source.id,'jobId',v_job_id,'correlationId',p_correlation_id));
  return query select 'queued'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),public.sbom_ingest_job_json(v_source.organization_id,v_job_id);
exception when unique_violation then
  select j.id into v_job_id from public.sbom_ingest_jobs j where j.organization_id=v_source.organization_id and j.source_id=coalesce(v_source.deduplicated_from_source_id,v_source.id);
  return query select 'replayed'::text,public.sbom_supplier_submission_json(v_source.organization_id,v_submission.id),public.sbom_source_json(v_source.organization_id,v_source.id),public.sbom_ingest_job_json(v_source.organization_id,v_job_id);
end;
$$;

-- Keep supplier state in the same transaction as the terminal validation and
-- normalization facts.  It deliberately never deletes rejected evidence.
create or replace function public.sync_supplier_sbom_submission_from_job()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.validation_status = 'invalid' then
    update public.sbom_supplier_submissions s set status='validation_failed'
    where s.organization_id=new.organization_id and s.source_id=new.source_id and s.status in ('pending','processing');
  end if;
  return new;
end;
$$;
create trigger sync_supplier_sbom_submission_from_job after update of validation_status on public.sbom_ingest_jobs for each row execute function public.sync_supplier_sbom_submission_from_job();

create or replace function public.sync_supplier_sbom_submission_from_document()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state in ('completed','failed') and old.state is distinct from new.state then
    update public.sbom_supplier_submissions s set status=case when new.state='completed' then 'awaiting_review' else 'validation_failed' end
    from public.sbom_document_sources ds where ds.organization_id=new.organization_id and ds.document_id=new.id and ds.source_id=s.source_id and s.organization_id=new.organization_id and s.status='processing';
  end if;
  return new;
end;
$$;
create trigger sync_supplier_sbom_submission_from_document after update of state on public.sbom_documents for each row execute function public.sync_supplier_sbom_submission_from_document();

create or replace function public.review_supplier_sbom_submission_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_submission_id uuid,p_decision text,p_reason text,p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text, submission jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_submission public.sbom_supplier_submissions%rowtype; v_state text;
begin
  v_state:=case p_decision when 'accept' then 'accepted' when 'reject' then 'rejected' else null end;
  if v_state is null or p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or p_correlation_id is null or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb;return;end if;
  select * into v_submission from public.sbom_supplier_submissions where organization_id=p_organization_id and id=p_submission_id for update;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  if v_submission.status in ('accepted','rejected') then
    if v_submission.status=v_state and v_submission.decision_reason=btrim(p_reason) then return query select 'replayed'::text,public.sbom_supplier_submission_json(p_organization_id,p_submission_id);end if;
    return query select 'invalid_state'::text,public.sbom_supplier_submission_json(p_organization_id,p_submission_id);return;
  end if;
  if v_submission.status<>'awaiting_review' then return query select 'invalid_state'::text,public.sbom_supplier_submission_json(p_organization_id,p_submission_id);return;end if;
  update public.sbom_supplier_submissions set status=v_state,decision_reason=btrim(p_reason),reviewed_by=p_actor_user_id,reviewed_at=now() where organization_id=p_organization_id and id=p_submission_id;
  if v_state='accepted' then
    update public.sbom_supplier_submissions
       set status='superseded', superseded_by_id=p_submission_id,
           decision_reason=null, reviewed_by=null, reviewed_at=null
     where organization_id=p_organization_id and request_id=v_submission.request_id
       and id<>p_submission_id and status='accepted';
  end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.supplier_submission_'||v_state,'sbom_supplier_submission',p_submission_id::text,jsonb_build_object('correlationId',p_correlation_id,'reason',btrim(p_reason),'idempotencyKey',p_idempotency_key));
  return query select v_state,public.sbom_supplier_submission_json(p_organization_id,p_submission_id);
end;
$$;

-- The merge target is a release plus its active embedded structure.  The
-- recursive path both proves scope compatibility and makes a corrupt product
-- hierarchy an explicit conflict rather than a partially merged document.
create or replace function public.validate_sbom_composite_scope(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_release_id uuid,p_source_ids jsonb
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cycle boolean; v_count integer; v_source_count integer;
begin
  if jsonb_typeof(p_source_ids)<>'array' or jsonb_array_length(p_source_ids)<1 or jsonb_array_length(p_source_ids)>100 or not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text;return;end if;
  with recursive structure(release_id,path,cycle) as (
    select p_release_id,array[p_release_id],false
    union all
    select relation.source_release_id,structure.path||relation.source_release_id,relation.source_release_id=any(structure.path)
    from structure join public.product_relationships relation on relation.organization_id=p_organization_id and relation.relationship_type='embedded' and relation.ended_at is null and relation.target_release_id=structure.release_id
    where not structure.cycle
  ) select coalesce(bool_or(cycle),false) into v_cycle from structure;
  if v_cycle then return query select 'conflict'::text;return;end if;
  select count(*) into v_source_count from (select distinct (value #>> '{}')::uuid id from jsonb_array_elements(p_source_ids)) ids;
  with recursive structure(release_id,path,cycle) as (
    select p_release_id,array[p_release_id],false
    union all
    select relation.source_release_id,structure.path||relation.source_release_id,relation.source_release_id=any(structure.path)
    from structure join public.product_relationships relation on relation.organization_id=p_organization_id and relation.relationship_type='embedded' and relation.ended_at is null and relation.target_release_id=structure.release_id
    where not structure.cycle
  ) select count(*) into v_count from public.sbom_sources s join (select distinct release_id from structure where not cycle) scope on scope.release_id=s.release_id join (select distinct (value #>> '{}')::uuid id from jsonb_array_elements(p_source_ids)) ids on ids.id=s.id where s.organization_id=p_organization_id and s.status='verified' and s.deduplicated_from_source_id is null;
  if v_count<>v_source_count then return query select 'not_found'::text;return;end if;
  return query select 'compatible'::text;
end;
$$;

create or replace function public.create_sbom_composite_review_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_product_id uuid,p_release_id uuid,p_merge_rules_version text,p_input_set_digest text,p_inputs jsonb,p_correlation_id uuid
) returns table(outcome text, review jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_input jsonb; v_source public.sbom_sources%rowtype; v_document uuid; v_scope text;
begin
  if p_review_id is null or p_correlation_id is null or p_input_set_digest !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_merge_rules_version,''))) not between 1 and 80 or jsonb_typeof(p_inputs)<>'array' or jsonb_array_length(p_inputs)<1 or jsonb_array_length(p_inputs)>1000 or not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  select * into v_review from public.sbom_composite_reviews where organization_id=p_organization_id and release_id=p_release_id and input_set_digest=p_input_set_digest and merge_rules_version=btrim(p_merge_rules_version) for update;
  if found then return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,v_review.id);return;end if;
  select outcome into v_scope from public.validate_sbom_composite_scope(p_organization_id,p_actor_user_id,p_product_id,p_release_id,(select jsonb_agg(value->>'sourceId') from jsonb_array_elements(p_inputs)));
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
  -- Deterministic first-pass review facts: canonical versionless PURL, then
  -- exact CPE; components without either key remain separate and are never
  -- guessed together. The candidates preserve every source reference.
  insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,x.identity,'incompatible_version','version',x.candidates
  from (
    select coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe) identity,
      jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',c.id,'sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256,'sourceComponentRef',c.document_local_ref,'name',c.normalized_name,'version',c.normalized_version,'canonicalPurl',c.canonical_purl,'canonicalCpe',c.cpe,'supplierSubmissionId',i.supplier_submission_id),'value',c.normalized_version) order by i.source_id,c.source_offset,c.id) candidates
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
    where i.organization_id=p_organization_id and i.review_id=p_review_id and (c.canonical_purl is not null or c.cpe is not null)
    group by coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe)
    having count(distinct coalesce(c.normalized_version,''))>1
  ) x;
  insert into public.sbom_composite_component_provenance(organization_id,review_id,composite_component_ref,field_name,source_id,source_document_id,source_component_id,source_component_ref,supplier_submission_id)
  select p_organization_id,p_review_id,i.document_id::text||':'||c.document_local_ref,null,i.source_id,i.document_id,c.id,c.document_local_ref,i.supplier_submission_id
  from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
  where i.organization_id=p_organization_id and i.review_id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.composite_review_created','sbom_composite_review',p_review_id::text,jsonb_build_object('correlationId',p_correlation_id,'inputSetDigest',p_input_set_digest));
  return query select 'created'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$$;

create or replace function public.get_sbom_composite_review(p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid)
returns table(outcome text, review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.sbom_composite_reviews where organization_id=p_organization_id and id=p_review_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  return query select 'found'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

create or replace function public.list_supplier_sbom_requests(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_release_id uuid,p_state text,p_limit integer,p_cursor text
) returns table(outcome text, requests jsonb, next_cursor text)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_limit not between 1 and 100 or p_state is not null and p_state not in ('open','closed','revoked') or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb,null::text;return;end if;
  return query select 'found'::text,coalesce(jsonb_agg(jsonb_build_object('request',public.sbom_supplier_request_json(p_organization_id,r.id),'invitations',coalesce((select jsonb_agg(public.sbom_supplier_invitation_json(p_organization_id,i.id) order by i.created_at desc) from public.sbom_supplier_invitations i where i.organization_id=r.organization_id and i.request_id=r.id),'[]'::jsonb),'submissions',coalesce((select jsonb_agg(public.sbom_supplier_submission_json(p_organization_id,s.id) order by s.created_at desc) from public.sbom_supplier_submissions s where s.organization_id=r.organization_id and s.request_id=r.id),'[]'::jsonb)) order by r.created_at desc,r.id),'[]'::jsonb),null::text from (select * from public.sbom_supplier_requests r where r.organization_id=p_organization_id and (p_product_id is null or r.product_id=p_product_id) and (p_release_id is null or r.release_id=p_release_id) and (p_state is null or r.status=p_state) order by r.created_at desc,r.id limit p_limit) r;
end;
$$;

create or replace function public.list_supplier_sbom_submissions(
  p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_state text,p_limit integer,p_cursor text
) returns table(outcome text, submissions jsonb, next_cursor text)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_limit not between 1 and 100 or p_state is not null and p_state not in ('pending','processing','validation_failed','awaiting_review','accepted','rejected','superseded') or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb,null::text;return;end if;
  return query select 'found'::text,coalesce(jsonb_agg(public.sbom_supplier_submission_json(p_organization_id,s.id) order by s.created_at desc,s.id),'[]'::jsonb),null::text from (select s.* from public.sbom_supplier_submissions s where s.organization_id=p_organization_id and (p_request_id is null or s.request_id=p_request_id) and (p_state is null or s.status=p_state) order by s.created_at desc,s.id limit p_limit) s;
end;
$$;

create or replace function public.resolve_sbom_composite_conflict_atomic(p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_conflict_id uuid,p_selected_source_component_id uuid,p_decision text,p_reason text,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text, review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_conflict public.sbom_composite_conflicts%rowtype;
begin
  if p_correlation_id is null or p_idempotency_key is null or p_decision not in ('select_source_component','exclude_identity') or (p_decision='select_source_component' and p_selected_source_component_id is null) or (p_decision='exclude_identity' and p_selected_source_component_id is not null) or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb;return;end if;
  select * into v_conflict from public.sbom_composite_conflicts where organization_id=p_organization_id and review_id=p_review_id and id=p_conflict_id for update;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  if p_selected_source_component_id is not null and not exists(select 1 from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id and c.id=p_selected_source_component_id where i.organization_id=p_organization_id and i.review_id=p_review_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  if v_conflict.resolved_at is not null then
    if v_conflict.selected_source_component_id is not distinct from p_selected_source_component_id and v_conflict.resolution_reason=btrim(p_reason) then return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);end if;
    return query select 'conflict'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
  end if;
  update public.sbom_composite_conflicts set selected_source_component_id=p_selected_source_component_id,resolution_reason=btrim(p_reason),resolved_by=p_actor_user_id,resolved_at=now() where organization_id=p_organization_id and id=p_conflict_id;
  return query select 'resolved'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

create or replace function public.resolve_sbom_composite_relationship_atomic(p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_relationship_id uuid,p_disposition text,p_reason text,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text, review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_disposition not in ('include','exclude') or p_idempotency_key is null or p_correlation_id is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb;return;end if;
  update public.sbom_composite_unresolved_relationships set disposition=case p_disposition when 'include' then 'include' else 'omit' end,resolution_reason=btrim(p_reason),resolved_by=p_actor_user_id,resolved_at=now() where organization_id=p_organization_id and review_id=p_review_id and id=p_relationship_id and disposition is null;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  return query select 'resolved'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

create or replace function public.generate_sbom_composite_atomic(p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text, review jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype; v_resolution_digest text;
begin
  if p_idempotency_key is null or p_correlation_id is null or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb;return;end if;
  select encode(extensions.digest(jsonb_build_object(
    'conflicts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'selectedComponentId',c.selected_source_component_id,'reason',c.resolution_reason) order by c.id) from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id),'[]'::jsonb),
    'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'disposition',r.disposition,'reason',r.resolution_reason) order by r.id) from public.sbom_composite_unresolved_relationships r where r.organization_id=p_organization_id and r.review_id=p_review_id),'[]'::jsonb)
  )::text,'sha256'),'hex') into v_resolution_digest;
  select * into v_review from public.sbom_composite_reviews where organization_id=p_organization_id and id=p_review_id for update;
  if not found then return query select 'not_found'::text,null::jsonb;return;end if;
  if v_review.status in ('generating','processing','completed') and v_review.resolution_digest=v_resolution_digest then return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);return;end if;
  if v_review.status not in ('awaiting_review','failed') or exists(select 1 from public.sbom_composite_conflicts c where c.organization_id=p_organization_id and c.review_id=p_review_id and c.selected_source_component_id is null) or exists(select 1 from public.sbom_composite_unresolved_relationships r where r.organization_id=p_organization_id and r.review_id=p_review_id and r.disposition is null) then return query select 'invalid_state'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);return;end if;
  update public.sbom_composite_reviews set status='processing',resolution_digest=v_resolution_digest,failure_code=null,failure_message=null,generated_at=now() where organization_id=p_organization_id and id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.composite_generation_claimed','sbom_composite_review',p_review_id::text,jsonb_build_object('correlationId',p_correlation_id,'resolutionDigest',v_resolution_digest));
  return query select 'queued'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
end;
$$;

create or replace function public.list_due_sbom_composite_generation_organizations(p_limit integer)
returns table(organization_id uuid) language sql security definer set search_path=public,pg_temp as $$
  select r.organization_id from public.sbom_composite_reviews r
  where r.status='processing' and (r.lease_expires_at is null or r.lease_expires_at<=now())
  group by r.organization_id order by min(r.created_at),r.organization_id limit greatest(0,least(p_limit,500));
$$;

create or replace function public.claim_sbom_composite_generation(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text, work jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype;
begin
  if p_worker_id is null or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb;return;end if;
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.status='processing' and (r.lease_expires_at is null or r.lease_expires_at<=now()) and r.attempt_count<5 order by r.created_at,r.id for update skip locked limit 1;
  if not found then return query select 'empty'::text,null::jsonb;return;end if;
  update public.sbom_composite_reviews set lease_owner=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1 where organization_id=p_organization_id and id=v_review.id returning * into v_review;
  return query select 'claimed'::text,jsonb_build_object(
    'reviewId',v_review.id,'actorId',v_review.created_by,'productId',v_review.product_id,'releaseId',v_review.release_id,'mergeRulesVersion',v_review.merge_rules_version,
    'components',coalesce((select jsonb_agg(jsonb_build_object('componentRef',i.document_id::text||':'||c.document_local_ref,'name',c.normalized_name,'version',c.normalized_version,'canonicalPurl',c.canonical_purl,'hashes',c.hashes,'sourceComponentId',c.id,'sourceId',i.source_id,'documentId',i.document_id) order by i.source_id,c.source_offset,c.id)
      from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id
      where i.organization_id=p_organization_id and i.review_id=v_review.id and not exists (
        select 1 from public.sbom_composite_conflicts x cross join lateral jsonb_array_elements(x.candidates) candidate
        where x.organization_id=i.organization_id and x.review_id=i.review_id and candidate#>>'{component,componentId}'=c.id::text
          and ((x.selected_source_component_id is not null and x.selected_source_component_id<>c.id) or (x.selected_source_component_id is null and x.resolution_reason is not null))
      )),'[]'::jsonb),
    'dependencies',coalesce((select jsonb_agg(jsonb_build_object('fromRef',parent.document_id::text||':'||parent.document_local_ref,'toRef',child.document_id::text||':'||child.document_local_ref) order by parent.document_id,parent.document_local_ref,child.document_local_ref)
      from public.sbom_component_dependencies d join public.sbom_components parent on parent.organization_id=d.organization_id and parent.id=d.parent_component_id join public.sbom_components child on child.organization_id=d.organization_id and child.id=d.child_component_id
      join public.sbom_composite_review_inputs pi on pi.organization_id=d.organization_id and pi.review_id=v_review.id and pi.document_id=parent.document_id join public.sbom_composite_review_inputs ci on ci.organization_id=d.organization_id and ci.review_id=v_review.id and ci.document_id=child.document_id
      where d.organization_id=p_organization_id and d.state='resolved'),'[]'::jsonb));
end;
$$;

create or replace function public.attach_sbom_composite_generated_source_atomic(
  p_organization_id uuid,p_review_id uuid,p_worker_id uuid,p_source_id uuid
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.sbom_composite_reviews%rowtype;
begin
  select * into v_review from public.sbom_composite_reviews r where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if not found or v_review.status<>'processing' or v_review.lease_owner is distinct from p_worker_id or v_review.lease_expires_at<=now() then return query select 'not_found'::text;return;end if;
  if v_review.generated_source_id is not null then return query select case when v_review.generated_source_id=p_source_id then 'replayed' else 'not_found' end;return;end if;
  if not exists(select 1 from public.sbom_sources s where s.organization_id=p_organization_id and s.id=p_source_id and s.product_id=v_review.product_id and s.release_id=v_review.release_id and s.source_kind='generated') then return query select 'not_found'::text;return;end if;
  update public.sbom_composite_reviews set generated_source_id=p_source_id where organization_id=p_organization_id and id=p_review_id;
  return query select 'attached'::text;
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
    update public.sbom_composite_reviews set status='completed',generated_document_id=v_document,completed_at=now(),lease_owner=null,lease_expires_at=null,provenance_manifest_sha256=coalesce(provenance_manifest_sha256,encode(extensions.digest(id::text||':manifest','sha256'),'hex')) where organization_id=p_organization_id and id=p_review_id;
    return query select 'completed'::text,v_document;return;
  end if;
  if exists(select 1 from public.sbom_ingest_jobs j where j.organization_id=p_organization_id and j.source_id=v_review.generated_source_id and j.status in ('dead_letter','failed')) then
    update public.sbom_composite_reviews set status='failed',failure_code='generated_intake_failed',failure_message='The generated SBOM did not complete intake.',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_review_id;
    return query select 'failed'::text,null::uuid;return;
  end if;
  return query select 'pending'::text,null::uuid;
end;
$$;

create or replace function public.fail_sbom_composite_generation_atomic(
  p_organization_id uuid,p_review_id uuid,p_worker_id uuid,p_error_code text,p_message text
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if char_length(btrim(coalesce(p_error_code,''))) not between 1 and 120 or char_length(btrim(coalesce(p_message,''))) not between 1 and 1000 then return query select 'invalid_request'::text;return;end if;
  update public.sbom_composite_reviews set status='failed',failure_code=btrim(p_error_code),failure_message=btrim(p_message),lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_review_id and status='processing' and lease_owner=p_worker_id and lease_expires_at>now();
  if not found then return query select 'not_found'::text;return;end if;
  return query select 'failed'::text;
end;
$$;

alter function public.sbom_supplier_submission_json(uuid,uuid) owner to postgres;
alter function public.sbom_composite_review_json(uuid,uuid) owner to postgres;

revoke all on function public.sbom_supplier_submission_json(uuid,uuid),public.sbom_supplier_request_json(uuid,uuid),public.sbom_supplier_invitation_json(uuid,uuid),public.sbom_composite_review_json(uuid,uuid),public.get_supplier_sbom_submission_upload(text,uuid,uuid),public.get_supplier_sbom_submission_upload_atomic(text,uuid),public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid),public.create_supplier_sbom_request_atomic(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,uuid,text,uuid),public.create_supplier_sbom_invitation_atomic(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text,uuid),public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text),public.review_supplier_sbom_submission_atomic(uuid,uuid,uuid,text,text,uuid,uuid),public.validate_sbom_composite_scope(uuid,uuid,uuid,uuid,jsonb),public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid),public.get_sbom_composite_review(uuid,uuid,uuid),public.resolve_sbom_composite_conflict_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid),public.resolve_sbom_composite_relationship_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid),public.generate_sbom_composite_atomic(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sbom_supplier_submission_json(uuid,uuid),public.sbom_supplier_request_json(uuid,uuid),public.sbom_supplier_invitation_json(uuid,uuid),public.sbom_composite_review_json(uuid,uuid),public.get_supplier_sbom_submission_upload(text,uuid,uuid),public.get_supplier_sbom_submission_upload_atomic(text,uuid),public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid),public.create_supplier_sbom_request_atomic(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,uuid,text,uuid),public.create_supplier_sbom_invitation_atomic(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text,uuid),public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text),public.review_supplier_sbom_submission_atomic(uuid,uuid,uuid,text,text,uuid,uuid),public.validate_sbom_composite_scope(uuid,uuid,uuid,uuid,jsonb),public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid),public.get_sbom_composite_review(uuid,uuid,uuid),public.resolve_sbom_composite_conflict_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid),public.resolve_sbom_composite_relationship_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid),public.generate_sbom_composite_atomic(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.list_supplier_sbom_requests(uuid,uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.list_supplier_sbom_requests(uuid,uuid,uuid,uuid,text,integer,text) to service_role;
revoke all on function public.list_supplier_sbom_submissions(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.list_supplier_sbom_submissions(uuid,uuid,uuid,text,integer,text) to service_role;
revoke all on function public.list_due_sbom_composite_generation_organizations(integer),public.claim_sbom_composite_generation(uuid,uuid,integer),public.attach_sbom_composite_generated_source_atomic(uuid,uuid,uuid,uuid),public.reconcile_sbom_composite_generation_atomic(uuid,uuid,uuid),public.fail_sbom_composite_generation_atomic(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.list_due_sbom_composite_generation_organizations(integer),public.claim_sbom_composite_generation(uuid,uuid,integer),public.attach_sbom_composite_generated_source_atomic(uuid,uuid,uuid,uuid),public.reconcile_sbom_composite_generation_atomic(uuid,uuid,uuid),public.fail_sbom_composite_generation_atomic(uuid,uuid,uuid,text,text) to service_role;
