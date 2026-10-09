-- M9-01: tenant-local supplier registry and release-specific responsibility
-- links. Supplier identity is deliberately local to an organization: matching
-- names/emails are candidates for human review, never a merge instruction.

create table public.supplier_organizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 255),
  legal_name text check (legal_name is null or (legal_name = btrim(legal_name) and char_length(legal_name) between 1 and 255)),
  website text check (website is null or (website = btrim(website) and char_length(website) between 1 and 2048 and website !~ '[[:cntrl:]]')),
  criticality text not null default 'unknown' check (criticality in ('unknown','low','medium','high','critical')),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete restrict,
  archive_reason text check (archive_reason is null or (archive_reason = btrim(archive_reason) and char_length(archive_reason) between 1 and 2000 and archive_reason !~ '[[:cntrl:]]')),
  unique (organization_id, id),
  check ((archived_at is null and archived_by is null and archive_reason is null)
    or (archived_at is not null and archived_by is not null and archive_reason is not null))
);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  email text check (email is null or (email = btrim(email) and char_length(email) between 3 and 320 and email !~ '[[:cntrl:] ]+' and position('@' in email) > 1)),
  role text check (role is null or (role = btrim(role) and char_length(role) between 1 and 160 and role !~ '[[:cntrl:]]')),
  phone text check (phone is null or (phone = btrim(phone) and char_length(phone) between 1 and 80 and phone !~ '[[:cntrl:]]')),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete restrict,
  archive_reason text check (archive_reason is null or (archive_reason = btrim(archive_reason) and char_length(archive_reason) between 1 and 2000 and archive_reason !~ '[[:cntrl:]]')),
  unique (organization_id, id),
  foreign key (organization_id, supplier_id)
    references public.supplier_organizations(organization_id, id) on delete restrict,
  check ((archived_at is null and archived_by is null and archive_reason is null)
    or (archived_at is not null and archived_by is not null and archive_reason is not null))
);

create table public.supplier_component_responsibilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  product_id uuid not null,
  release_id uuid not null,
  component_occurrence_id uuid not null,
  component_id uuid not null,
  document_id uuid not null,
  component_identity text not null check (component_identity = btrim(component_identity) and char_length(component_identity) between 1 and 4096),
  component_version text check (component_version is null or (component_version = btrim(component_version) and char_length(component_version) between 1 and 1024)),
  canonical_purl text check (canonical_purl is null or (canonical_purl = btrim(canonical_purl) and char_length(canonical_purl) between 1 and 4096)),
  identity_kind text not null check (identity_kind in ('purl','cpe')),
  provenance text not null default 'manual' check (provenance in ('manual','supplier_sbom_request')),
  supplier_request_id uuid,
  state text not null default 'active' check (state in ('active','ended','superseded')),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.users(id) on delete restrict,
  ended_at timestamptz,
  ended_by uuid references public.users(id) on delete restrict,
  end_reason text check (end_reason is null or (end_reason = btrim(end_reason) and char_length(end_reason) between 1 and 2000 and end_reason !~ '[[:cntrl:]]')),
  superseded_by_responsibility_id uuid,
  unique (organization_id, id),
  foreign key (organization_id, supplier_id)
    references public.supplier_organizations(organization_id, id) on delete restrict,
  foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, component_occurrence_id)
    references public.vulnerability_component_occurrences(organization_id, id) on delete restrict,
  foreign key (organization_id, component_id)
    references public.sbom_components(organization_id, id) on delete restrict,
  foreign key (organization_id, document_id)
    references public.sbom_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, supplier_request_id)
    references public.sbom_supplier_requests(organization_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_responsibility_id)
    references public.supplier_component_responsibilities(organization_id, id) on delete restrict,
  check ((state = 'active' and ended_at is null and ended_by is null and end_reason is null and superseded_by_responsibility_id is null)
    or (state = 'ended' and ended_at is not null and ended_by is not null and end_reason is not null and superseded_by_responsibility_id is null)
    or (state = 'superseded' and ended_at is not null and ended_by is not null and end_reason is not null and superseded_by_responsibility_id is not null)),
  check (superseded_by_responsibility_id is null or superseded_by_responsibility_id <> id),
  check ((provenance = 'manual' and supplier_request_id is null)
    or (provenance = 'supplier_sbom_request' and supplier_request_id is not null))
);

-- This association is additive and intentionally has no name-based backfill.
alter table public.sbom_supplier_requests add column supplier_id uuid;
alter table public.sbom_supplier_requests
  add constraint sbom_supplier_requests_supplier_organization_fk
  foreign key (organization_id, supplier_id)
  references public.supplier_organizations(organization_id, id) on delete restrict;

create table public.supplier_registry_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('create_supplier','update_supplier','archive_supplier','create_contact','update_contact','archive_contact','create_responsibility','end_responsibility','associate_request')),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, actor_user_id, idempotency_key)
);

create index supplier_organizations_list_idx on public.supplier_organizations(organization_id, archived_at, name, id);
create index supplier_contacts_supplier_idx on public.supplier_contacts(organization_id, supplier_id, archived_at, name, id);
create unique index supplier_responsibilities_active_once_idx
  on public.supplier_component_responsibilities(organization_id, supplier_id, component_occurrence_id)
  where state = 'active';
create index supplier_responsibilities_finding_idx
  on public.supplier_component_responsibilities(organization_id, component_occurrence_id, state, supplier_id)
  where state = 'active';
create index supplier_responsibilities_supplier_idx
  on public.supplier_component_responsibilities(organization_id, supplier_id, state, created_at desc, id);
create index sbom_supplier_requests_supplier_idx
  on public.sbom_supplier_requests(organization_id, supplier_id, created_at desc, id)
  where supplier_id is not null;

alter table public.supplier_organizations enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.supplier_component_responsibilities enable row level security;
alter table public.supplier_registry_commands enable row level security;
revoke all on table public.supplier_organizations, public.supplier_contacts,
  public.supplier_component_responsibilities, public.supplier_registry_commands
  from public, anon, authenticated;
grant select, insert, update on table public.supplier_organizations, public.supplier_contacts,
  public.supplier_component_responsibilities, public.supplier_registry_commands to service_role;

create or replace function public.m9_supplier_actor_can(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role
    from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_view_suppliers' then role in ('owner','admin')
      when 'can_manage_suppliers' then role in ('owner','admin')
      when 'can_view_products' then true
      else false end as granted from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments assignment
      on assignment.organization_id=p_organization_id and assignment.user_id=p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id=p_organization_id and custom_role.id=assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key)='boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key)='boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id=p_organization_id and permission_override.base_role=base_permission.role
  ) select coalesce((select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted,false) or coalesce(custom_permissions.granted,false)
      from base_permissions cross join custom_permissions), false)
$$;

create or replace function public.m9_supplier_json(p_organization_id uuid, p_supplier_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id',s.id,'organizationId',s.organization_id,'name',s.name,'legalName',s.legal_name,
    'website',s.website,'criticality',s.criticality,'state',case when s.archived_at is null then 'active' else 'archived' end,
    'version',s.version,'componentCount',(select count(*)::integer from public.supplier_component_responsibilities r where r.organization_id=s.organization_id and r.supplier_id=s.id and r.state='active'),
    'requestCount',(select count(*)::integer from public.sbom_supplier_requests q where q.organization_id=s.organization_id and q.supplier_id=s.id),
    'createdAt',s.created_at,'updatedAt',s.updated_at,'archivedAt',s.archived_at)
  from public.supplier_organizations s where s.organization_id=p_organization_id and s.id=p_supplier_id
$$;

create or replace function public.m9_supplier_contact_json(p_organization_id uuid, p_contact_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',c.id,'supplierId',c.supplier_id,'name',c.name,'email',c.email,'role',c.role,'phone',c.phone,
    'state',case when c.archived_at is null then 'active' else 'archived' end,'version',c.version,'createdAt',c.created_at,'updatedAt',c.updated_at,'archivedAt',c.archived_at)
  from public.supplier_contacts c where c.organization_id=p_organization_id and c.id=p_contact_id
$$;

create or replace function public.m9_supplier_responsibility_json(p_organization_id uuid, p_responsibility_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',r.id,'organizationId',r.organization_id,'supplierId',r.supplier_id,'productId',r.product_id,'releaseId',r.release_id,
    'occurrenceId',r.component_occurrence_id,'componentId',r.component_id,'documentId',r.document_id,'componentIdentity',r.component_identity,
    'componentVersion',r.component_version,'canonicalPurl',r.canonical_purl,'identityKind',r.identity_kind,'provenance',r.provenance,
    'state',r.state,'version',r.version,'createdAt',r.created_at,'createdBy',r.created_by,'endedAt',r.ended_at,'endedBy',r.ended_by,
    'endReason',r.end_reason,'supersededByResponsibilityId',r.superseded_by_responsibility_id)
  from public.supplier_component_responsibilities r where r.organization_id=p_organization_id and r.id=p_responsibility_id
$$;

create or replace function public.m9_supplier_command_replay(
  p_organization_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_operation text,p_digest text
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select case when command.request_digest=p_digest and command.operation=p_operation then command.result
    else jsonb_build_object('outcome','idempotency_conflict') end
  from public.supplier_registry_commands command
  where command.organization_id=p_organization_id and command.actor_user_id=p_actor_user_id and command.idempotency_key=p_idempotency_key
$$;

create or replace function public.list_supplier_organizations_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_search text,p_include_archived boolean,p_limit integer,p_cursor text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cursor uuid; v_items jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_suppliers') or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_limit not between 1 and 100 or p_search is not null and (p_search<>btrim(p_search) or char_length(p_search)>255 or p_search~'[[:cntrl:]]') then return query select 'invalid_request',null::jsonb; return; end if;
  begin v_cursor:=nullif(p_cursor,'')::uuid; exception when invalid_text_representation then return query select 'invalid_request',null::jsonb; return; end;
  -- The opaque UUID cursor must use the same total ordering as its predicate.
  select coalesce(jsonb_agg(public.m9_supplier_json(p_organization_id,x.id) order by x.id),'[]'::jsonb) into v_items
  from (select s.id from public.supplier_organizations s where s.organization_id=p_organization_id
    and (p_include_archived or s.archived_at is null) and (v_cursor is null or s.id>v_cursor)
    and (nullif(p_search,'') is null or s.name ilike '%'||p_search||'%' or s.legal_name ilike '%'||p_search||'%')
    order by s.id limit p_limit) x;
  return query select 'found',jsonb_build_object('items',v_items,'nextCursor',case when jsonb_array_length(v_items)=p_limit then v_items->(p_limit-1)->>'id' else null end);
end $$;

create or replace function public.get_supplier_organization_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_supplier jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_suppliers') or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  v_supplier:=public.m9_supplier_json(p_organization_id,p_supplier_id);
  if v_supplier is null then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found',public.m9_supplier_detail_json(p_organization_id,p_supplier_id);
end $$;

create or replace function public.m9_supplier_detail_json(p_organization_id uuid,p_supplier_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select public.m9_supplier_json(p_organization_id,p_supplier_id) || jsonb_build_object(
    'contacts',coalesce((select jsonb_agg(public.m9_supplier_contact_json(p_organization_id,c.id) order by c.archived_at nulls first,c.name,c.id) from public.supplier_contacts c where c.organization_id=p_organization_id and c.supplier_id=p_supplier_id),'[]'::jsonb),
    'responsibilities',coalesce((select jsonb_agg(public.m9_supplier_responsibility_json(p_organization_id,r.id) order by r.created_at desc,r.id) from public.supplier_component_responsibilities r where r.organization_id=p_organization_id and r.supplier_id=p_supplier_id),'[]'::jsonb),
    'requestHistory',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'supplierDisplayName',q.supplier_display_name,'productId',q.product_id,'releaseId',q.release_id,'state',q.status,'createdAt',q.created_at,'expiresAt',q.expires_at) order by q.created_at desc,q.id) from public.sbom_supplier_requests q where q.organization_id=p_organization_id and q.supplier_id=p_supplier_id),'[]'::jsonb)
  )
$$;

create or replace function public.create_supplier_organization_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_name text,p_legal_name text,p_website text,p_criticality text,
  p_duplicate_candidate_ids uuid[],p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_digest text; v_replay jsonb; v_supplier public.supplier_organizations%rowtype; v_candidates uuid[];
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_name is null or p_name<>btrim(p_name) or char_length(p_name) not between 1 and 255 or p_name~'[[:cntrl:]]'
    or p_legal_name is not null and (p_legal_name<>btrim(p_legal_name) or char_length(p_legal_name) not between 1 and 255 or p_legal_name~'[[:cntrl:]]')
    or p_website is not null and (p_website<>btrim(p_website) or char_length(p_website) not between 1 and 2048 or p_website~'[[:cntrl:]]')
    or p_criticality not in ('unknown','low','medium','high','critical') then return query select 'invalid_request',null::jsonb; return; end if;
  -- Same names remain valid, but competing creates must both see the same
  -- candidate set before either can proceed without an explicit confirmation.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || lower(p_name), 0));
  v_digest:=encode(extensions.digest(jsonb_build_object('name',p_name,'legalName',p_legal_name,'website',p_website,'criticality',p_criticality,'duplicateCandidateIds',coalesce(to_jsonb(p_duplicate_candidate_ids),'[]'::jsonb))::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'create_supplier',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select coalesce(array_agg(s.id order by s.id),'{}'::uuid[]) into v_candidates from public.supplier_organizations s
    where s.organization_id=p_organization_id and s.archived_at is null and lower(s.name)=lower(p_name);
  if v_candidates <> coalesce((select array_agg(x order by x) from unnest(coalesce(p_duplicate_candidate_ids,'{}'::uuid[])) x),'{}'::uuid[]) then
    return query select 'duplicate_confirmation_required',jsonb_build_object('duplicateCandidates',coalesce((select jsonb_agg(public.m9_supplier_json(p_organization_id,x) order by x) from unnest(v_candidates) x),'[]'::jsonb)); return;
  end if;
  insert into public.supplier_organizations(organization_id,name,legal_name,website,criticality,created_by,updated_by)
  values(p_organization_id,p_name,p_legal_name,p_website,p_criticality,p_actor_user_id,p_actor_user_id) returning * into v_supplier;
  v_replay:=public.m9_supplier_detail_json(p_organization_id,v_supplier.id);
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
    values(p_organization_id,p_actor_user_id,p_idempotency_key,'create_supplier',v_digest,jsonb_build_object('outcome','created','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'supplier.created','supplier_organization',v_supplier.id::text,jsonb_build_object('name',v_supplier.name,'criticality',v_supplier.criticality));
  return query select 'created',v_replay;
end $$;

create or replace function public.update_supplier_organization_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_patch jsonb,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_supplier public.supplier_organizations%rowtype; v_digest text; v_replay jsonb; v_name text; v_legal_name text; v_website text; v_criticality text;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_version < 0 or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb or exists(select 1 from jsonb_object_keys(p_patch) key where key not in ('name','legalName','website','criticality')) then return query select 'invalid_request',null::jsonb; return; end if;
  select * into v_supplier from public.supplier_organizations where organization_id=p_organization_id and id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  v_name:=case when p_patch ? 'name' then p_patch->>'name' else v_supplier.name end;
  v_legal_name:=case when p_patch ? 'legalName' then p_patch->>'legalName' else v_supplier.legal_name end;
  v_website:=case when p_patch ? 'website' then p_patch->>'website' else v_supplier.website end;
  v_criticality:=case when p_patch ? 'criticality' then p_patch->>'criticality' else v_supplier.criticality end;
  if v_name is null or v_name<>btrim(v_name) or char_length(v_name) not between 1 and 255 or v_name~'[[:cntrl:]]'
    or v_legal_name is not null and (v_legal_name<>btrim(v_legal_name) or char_length(v_legal_name) not between 1 and 255 or v_legal_name~'[[:cntrl:]]')
    or v_website is not null and (v_website<>btrim(v_website) or char_length(v_website) not between 1 and 2048 or v_website~'[[:cntrl:]]')
    or v_criticality not in ('unknown','low','medium','high','critical') then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'patch',p_patch,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'update_supplier',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  if v_supplier.archived_at is not null or v_supplier.version<>p_expected_version then return query select 'conflict',public.m9_supplier_detail_json(p_organization_id,p_supplier_id); return; end if;
  update public.supplier_organizations set name=v_name,legal_name=v_legal_name,website=v_website,criticality=v_criticality,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_supplier_id;
  v_replay:=public.m9_supplier_detail_json(p_organization_id,p_supplier_id);
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'update_supplier',v_digest,jsonb_build_object('outcome','updated','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.updated','supplier_organization',p_supplier_id::text,jsonb_build_object('expectedVersion',p_expected_version));
  return query select 'updated',v_replay;
end $$;

create or replace function public.archive_supplier_organization_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_expected_version integer,p_reason text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_supplier public.supplier_organizations%rowtype; v_digest text; v_replay jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_version<0 or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'expectedVersion',p_expected_version,'reason',p_reason)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'archive_supplier',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select * into v_supplier from public.supplier_organizations where organization_id=p_organization_id and id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_supplier.archived_at is not null or v_supplier.version<>p_expected_version then return query select 'conflict',public.m9_supplier_detail_json(p_organization_id,p_supplier_id); return; end if;
  update public.supplier_organizations set archived_at=clock_timestamp(),archived_by=p_actor_user_id,archive_reason=p_reason,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_supplier_id;
  v_replay:=public.m9_supplier_detail_json(p_organization_id,p_supplier_id);
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'archive_supplier',v_digest,jsonb_build_object('outcome','archived','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.archived','supplier_organization',p_supplier_id::text,jsonb_build_object('reason',p_reason));
  return query select 'archived',v_replay;
end $$;

create or replace function public.create_supplier_contact_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_name text,p_email text,p_role text,p_phone text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_supplier public.supplier_organizations%rowtype; v_contact public.supplier_contacts%rowtype; v_digest text; v_replay jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_name is null or p_name<>btrim(p_name) or char_length(p_name) not between 1 and 200 or p_name~'[[:cntrl:]]' or p_email is not null and (p_email<>btrim(p_email) or char_length(p_email) not between 3 and 320 or p_email~'[[:cntrl:] ]+' or position('@' in p_email)<=1) or p_role is not null and (p_role<>btrim(p_role) or char_length(p_role) not between 1 and 160 or p_role~'[[:cntrl:]]') or p_phone is not null and (p_phone<>btrim(p_phone) or char_length(p_phone) not between 1 and 80 or p_phone~'[[:cntrl:]]') then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'name',p_name,'email',p_email,'role',p_role,'phone',p_phone)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'create_contact',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select * into v_supplier from public.supplier_organizations where organization_id=p_organization_id and id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_supplier.archived_at is not null then return query select 'conflict',public.m9_supplier_detail_json(p_organization_id,p_supplier_id); return; end if;
  insert into public.supplier_contacts(organization_id,supplier_id,name,email,role,phone,created_by,updated_by) values(p_organization_id,p_supplier_id,p_name,p_email,p_role,p_phone,p_actor_user_id,p_actor_user_id) returning * into v_contact;
  v_replay:=jsonb_build_object('contact',public.m9_supplier_contact_json(p_organization_id,v_contact.id));
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'create_contact',v_digest,jsonb_build_object('outcome','created','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.contact_created','supplier_contact',v_contact.id::text,jsonb_build_object('supplierId',p_supplier_id));
  return query select 'created',v_replay;
end $$;

create or replace function public.update_supplier_contact_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_contact_id uuid,p_patch jsonb,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_contact public.supplier_contacts%rowtype; v_digest text; v_replay jsonb; v_name text; v_email text; v_role text; v_phone text;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_version<0 or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb or exists(select 1 from jsonb_object_keys(p_patch) key where key not in ('name','email','role','phone')) then return query select 'invalid_request',null::jsonb; return; end if;
  select * into v_contact from public.supplier_contacts where organization_id=p_organization_id and id=p_contact_id and supplier_id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  v_name:=case when p_patch ? 'name' then p_patch->>'name' else v_contact.name end;
  v_email:=case when p_patch ? 'email' then p_patch->>'email' else v_contact.email end;
  v_role:=case when p_patch ? 'role' then p_patch->>'role' else v_contact.role end;
  v_phone:=case when p_patch ? 'phone' then p_patch->>'phone' else v_contact.phone end;
  if v_name is null or v_name<>btrim(v_name) or char_length(v_name) not between 1 and 200 or v_name~'[[:cntrl:]]' or v_email is not null and (v_email<>btrim(v_email) or char_length(v_email) not between 3 and 320 or v_email~'[[:cntrl:] ]+' or position('@' in v_email)<=1) or v_role is not null and (v_role<>btrim(v_role) or char_length(v_role) not between 1 and 160 or v_role~'[[:cntrl:]]') or v_phone is not null and (v_phone<>btrim(v_phone) or char_length(v_phone) not between 1 and 80 or v_phone~'[[:cntrl:]]') then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'contactId',p_contact_id,'patch',p_patch,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'update_contact',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  if v_contact.archived_at is not null or v_contact.version<>p_expected_version or exists(select 1 from public.supplier_organizations s where s.organization_id=p_organization_id and s.id=p_supplier_id and s.archived_at is not null) then return query select 'conflict',jsonb_build_object('contact',public.m9_supplier_contact_json(p_organization_id,p_contact_id)); return; end if;
  update public.supplier_contacts set name=v_name,email=v_email,role=v_role,phone=v_phone,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_contact_id;
  v_replay:=jsonb_build_object('contact',public.m9_supplier_contact_json(p_organization_id,p_contact_id));
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'update_contact',v_digest,jsonb_build_object('outcome','updated','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.contact_updated','supplier_contact',p_contact_id::text,jsonb_build_object('expectedVersion',p_expected_version));
  return query select 'updated',v_replay;
end $$;

create or replace function public.archive_supplier_contact_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_contact_id uuid,p_expected_version integer,p_reason text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_contact public.supplier_contacts%rowtype; v_digest text; v_replay jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_version<0 or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'contactId',p_contact_id,'expectedVersion',p_expected_version,'reason',p_reason)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'archive_contact',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select * into v_contact from public.supplier_contacts where organization_id=p_organization_id and id=p_contact_id and supplier_id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_contact.archived_at is not null or v_contact.version<>p_expected_version then return query select 'conflict',jsonb_build_object('contact',public.m9_supplier_contact_json(p_organization_id,p_contact_id)); return; end if;
  update public.supplier_contacts set archived_at=clock_timestamp(),archived_by=p_actor_user_id,archive_reason=p_reason,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_contact_id;
  v_replay:=jsonb_build_object('contact',public.m9_supplier_contact_json(p_organization_id,p_contact_id));
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'archive_contact',v_digest,jsonb_build_object('outcome','archived','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.contact_archived','supplier_contact',p_contact_id::text,jsonb_build_object('reason',p_reason));
  return query select 'archived',v_replay;
end $$;

create or replace function public.create_supplier_component_responsibility_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_product_id uuid,p_release_id uuid,
  p_occurrence_id uuid,p_provenance text,p_supplier_request_id uuid,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_supplier public.supplier_organizations%rowtype; v_occurrence public.vulnerability_component_occurrences%rowtype;
  v_responsibility public.supplier_component_responsibilities%rowtype; v_digest text; v_replay jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_provenance not in ('manual','supplier_sbom_request') or (p_provenance='manual' and p_supplier_request_id is not null) or (p_provenance='supplier_sbom_request' and p_supplier_request_id is null) then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'productId',p_product_id,'releaseId',p_release_id,'occurrenceId',p_occurrence_id,'provenance',p_provenance,'supplierRequestId',p_supplier_request_id)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'create_responsibility',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select * into v_supplier from public.supplier_organizations where organization_id=p_organization_id and id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_supplier.archived_at is not null then return query select 'conflict',public.m9_supplier_detail_json(p_organization_id,p_supplier_id); return; end if;
  if not exists(select 1 from public.product_releases release_record where release_record.organization_id=p_organization_id and release_record.product_id=p_product_id and release_record.id=p_release_id) then return query select 'not_found',null::jsonb; return; end if;
  select * into v_occurrence from public.vulnerability_component_occurrences occurrence_record where occurrence_record.organization_id=p_organization_id and occurrence_record.id=p_occurrence_id for update;
  if not found or v_occurrence.release_id<>p_release_id or v_occurrence.identity_kind not in ('purl','cpe')
    or not exists(select 1 from public.sbom_document_sources source_record where source_record.organization_id=p_organization_id and source_record.document_id=v_occurrence.document_id and source_record.release_id=p_release_id)
    or not exists(select 1 from public.sbom_components component_record where component_record.organization_id=p_organization_id and component_record.id=v_occurrence.component_id and component_record.document_id=v_occurrence.document_id)
    or p_provenance='supplier_sbom_request' and not exists(select 1 from public.sbom_supplier_requests request_record where request_record.organization_id=p_organization_id and request_record.id=p_supplier_request_id and request_record.product_id=p_product_id and request_record.release_id=p_release_id and request_record.supplier_id=p_supplier_id) then return query select 'invalid_reference',null::jsonb; return; end if;
  if exists(select 1 from public.supplier_component_responsibilities responsibility_record where responsibility_record.organization_id=p_organization_id and responsibility_record.supplier_id=p_supplier_id and responsibility_record.component_occurrence_id=p_occurrence_id and responsibility_record.state='active') then return query select 'conflict',null::jsonb; return; end if;
  insert into public.supplier_component_responsibilities(organization_id,supplier_id,product_id,release_id,component_occurrence_id,component_id,document_id,component_identity,component_version,canonical_purl,identity_kind,provenance,supplier_request_id,created_by)
  values(p_organization_id,p_supplier_id,p_product_id,p_release_id,v_occurrence.id,v_occurrence.component_id,v_occurrence.document_id,v_occurrence.component_identity,v_occurrence.component_version,v_occurrence.canonical_purl,v_occurrence.identity_kind,p_provenance,p_supplier_request_id,p_actor_user_id) returning * into v_responsibility;
  v_replay:=jsonb_build_object('responsibility',public.m9_supplier_responsibility_json(p_organization_id,v_responsibility.id));
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'create_responsibility',v_digest,jsonb_build_object('outcome','created','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.responsibility_created','supplier_component_responsibility',v_responsibility.id::text,jsonb_build_object('supplierId',p_supplier_id,'productId',p_product_id,'releaseId',p_release_id,'occurrenceId',p_occurrence_id,'provenance',p_provenance));
  return query select 'created',v_replay;
end $$;

create or replace function public.end_supplier_component_responsibility_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_responsibility_id uuid,p_expected_version integer,
  p_reason text,p_superseded_by_responsibility_id uuid,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_responsibility public.supplier_component_responsibilities%rowtype; v_successor public.supplier_component_responsibilities%rowtype; v_digest text; v_replay jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_version<0 or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'responsibilityId',p_responsibility_id,'expectedVersion',p_expected_version,'reason',p_reason,'supersededByResponsibilityId',p_superseded_by_responsibility_id)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'end_responsibility',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select * into v_responsibility from public.supplier_component_responsibilities where organization_id=p_organization_id and id=p_responsibility_id and supplier_id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_responsibility.state<>'active' or v_responsibility.version<>p_expected_version then return query select 'conflict',jsonb_build_object('responsibility',public.m9_supplier_responsibility_json(p_organization_id,p_responsibility_id)); return; end if;
  if p_superseded_by_responsibility_id is not null then
    select * into v_successor from public.supplier_component_responsibilities where organization_id=p_organization_id and id=p_superseded_by_responsibility_id for update;
    -- A successor may move to a newer release-specific occurrence, but never
    -- to an unrelated component, product, or another supplier's link.
    if not found or v_successor.state<>'active' or v_successor.supplier_id<>p_supplier_id or v_successor.id=v_responsibility.id
      or v_successor.product_id<>v_responsibility.product_id or v_successor.identity_kind<>v_responsibility.identity_kind
      or v_successor.component_identity<>v_responsibility.component_identity then return query select 'invalid_reference',null::jsonb; return; end if;
  end if;
  update public.supplier_component_responsibilities set state=case when p_superseded_by_responsibility_id is null then 'ended' else 'superseded' end,ended_at=clock_timestamp(),ended_by=p_actor_user_id,end_reason=p_reason,superseded_by_responsibility_id=p_superseded_by_responsibility_id,version=version+1 where organization_id=p_organization_id and id=p_responsibility_id;
  v_replay:=jsonb_build_object('responsibility',public.m9_supplier_responsibility_json(p_organization_id,p_responsibility_id));
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'end_responsibility',v_digest,jsonb_build_object('outcome','ended','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.responsibility_ended','supplier_component_responsibility',p_responsibility_id::text,jsonb_build_object('reason',p_reason,'supersededByResponsibilityId',p_superseded_by_responsibility_id));
  return query select 'ended',v_replay;
end $$;

create or replace function public.associate_supplier_sbom_request_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_request_id uuid,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request public.sbom_supplier_requests%rowtype; v_supplier public.supplier_organizations%rowtype; v_digest text; v_replay jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers') or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('supplierId',p_supplier_id,'requestId',p_request_id)::text,'sha256'),'hex');
  v_replay:=public.m9_supplier_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'associate_request',v_digest);
  if v_replay is not null then return query select coalesce(v_replay->>'outcome','replayed'),coalesce(v_replay->'result',v_replay); return; end if;
  select * into v_supplier from public.supplier_organizations where organization_id=p_organization_id and id=p_supplier_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_supplier.archived_at is not null then return query select 'conflict',public.m9_supplier_detail_json(p_organization_id,p_supplier_id); return; end if;
  select * into v_request from public.sbom_supplier_requests where organization_id=p_organization_id and id=p_request_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_request.supplier_id is not null and v_request.supplier_id<>p_supplier_id then return query select 'conflict',null::jsonb; return; end if;
  update public.sbom_supplier_requests set supplier_id=p_supplier_id,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_request_id;
  v_replay:=public.m9_supplier_detail_json(p_organization_id,p_supplier_id);
  insert into public.supplier_registry_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'associate_request',v_digest,jsonb_build_object('outcome','associated','result',v_replay));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.request_associated','sbom_supplier_request',p_request_id::text,jsonb_build_object('supplierId',p_supplier_id));
  return query select 'associated',v_replay;
end $$;

create or replace function public.get_finding_responsible_suppliers_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_suppliers jsonb;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_suppliers') or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if not exists(select 1 from public.vulnerability_findings finding_record where finding_record.organization_id=p_organization_id and finding_record.id=p_finding_id and finding_record.status='active') then return query select 'not_found',null::jsonb; return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('supplier',public.m9_supplier_json(p_organization_id,x.supplier_id),'responsibilityId',x.id,'occurrenceId',x.component_occurrence_id) order by x.supplier_name,x.id),'[]'::jsonb) into v_suppliers
  from (select distinct r.id,r.supplier_id,r.component_occurrence_id,s.name supplier_name from public.vulnerability_finding_component_occurrences link_record
    join public.supplier_component_responsibilities r on r.organization_id=link_record.organization_id and r.component_occurrence_id=link_record.occurrence_id and r.state='active'
    join public.supplier_organizations s on s.organization_id=r.organization_id and s.id=r.supplier_id and s.archived_at is null
    where link_record.organization_id=p_organization_id and link_record.finding_id=p_finding_id and link_record.state='active' and link_record.superseded_at is null) x;
  return query select 'found',jsonb_build_object('findingId',p_finding_id,'responsibility',case when jsonb_array_length(v_suppliers)=0 then 'unknown' else 'known' end,'suppliers',v_suppliers);
end $$;

alter function public.m9_supplier_actor_can(uuid,uuid,text) owner to postgres;
alter function public.m9_supplier_json(uuid,uuid) owner to postgres;
alter function public.m9_supplier_contact_json(uuid,uuid) owner to postgres;
alter function public.m9_supplier_responsibility_json(uuid,uuid) owner to postgres;
alter function public.m9_supplier_command_replay(uuid,uuid,uuid,text,text) owner to postgres;
alter function public.m9_supplier_detail_json(uuid,uuid) owner to postgres;
alter function public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text) owner to postgres;
alter function public.get_supplier_organization_atomic(uuid,uuid,uuid) owner to postgres;
alter function public.create_supplier_organization_atomic(uuid,uuid,text,text,text,text,uuid[],uuid) owner to postgres;
alter function public.update_supplier_organization_atomic(uuid,uuid,uuid,jsonb,integer,uuid) owner to postgres;
alter function public.archive_supplier_organization_atomic(uuid,uuid,uuid,integer,text,uuid) owner to postgres;
alter function public.create_supplier_contact_atomic(uuid,uuid,uuid,text,text,text,text,uuid) owner to postgres;
alter function public.update_supplier_contact_atomic(uuid,uuid,uuid,uuid,jsonb,integer,uuid) owner to postgres;
alter function public.archive_supplier_contact_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) owner to postgres;
alter function public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid) owner to postgres;
alter function public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid) owner to postgres;
alter function public.associate_supplier_sbom_request_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.get_finding_responsible_suppliers_atomic(uuid,uuid,uuid) owner to postgres;

revoke all on function public.m9_supplier_actor_can(uuid,uuid,text), public.m9_supplier_json(uuid,uuid),
  public.m9_supplier_contact_json(uuid,uuid), public.m9_supplier_responsibility_json(uuid,uuid),
  public.m9_supplier_command_replay(uuid,uuid,uuid,text,text), public.m9_supplier_detail_json(uuid,uuid),
  public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text), public.get_supplier_organization_atomic(uuid,uuid,uuid),
  public.create_supplier_organization_atomic(uuid,uuid,text,text,text,text,uuid[],uuid),
  public.update_supplier_organization_atomic(uuid,uuid,uuid,jsonb,integer,uuid),
  public.archive_supplier_organization_atomic(uuid,uuid,uuid,integer,text,uuid),
  public.create_supplier_contact_atomic(uuid,uuid,uuid,text,text,text,text,uuid),
  public.update_supplier_contact_atomic(uuid,uuid,uuid,uuid,jsonb,integer,uuid),
  public.archive_supplier_contact_atomic(uuid,uuid,uuid,uuid,integer,text,uuid),
  public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid),
  public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid),
  public.associate_supplier_sbom_request_atomic(uuid,uuid,uuid,uuid,uuid),
  public.get_finding_responsible_suppliers_atomic(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text),
  public.get_supplier_organization_atomic(uuid,uuid,uuid),
  public.create_supplier_organization_atomic(uuid,uuid,text,text,text,text,uuid[],uuid),
  public.update_supplier_organization_atomic(uuid,uuid,uuid,jsonb,integer,uuid),
  public.archive_supplier_organization_atomic(uuid,uuid,uuid,integer,text,uuid),
  public.create_supplier_contact_atomic(uuid,uuid,uuid,text,text,text,text,uuid),
  public.update_supplier_contact_atomic(uuid,uuid,uuid,uuid,jsonb,integer,uuid),
  public.archive_supplier_contact_atomic(uuid,uuid,uuid,uuid,integer,text,uuid),
  public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid),
  public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid),
  public.associate_supplier_sbom_request_atomic(uuid,uuid,uuid,uuid,uuid),
  public.get_finding_responsible_suppliers_atomic(uuid,uuid,uuid)
  to service_role;
