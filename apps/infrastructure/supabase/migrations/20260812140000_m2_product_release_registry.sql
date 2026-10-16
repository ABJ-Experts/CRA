-- M2 authoritative tenant-scoped product and release registry.
-- Additive by design: rolling back callers leaves retained registry/audit facts intact.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_entity_id uuid not null,
  legal_entity_version integer not null check (legal_entity_version >= 0),
  legal_entity_snapshot jsonb not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  internal_code text not null check (char_length(btrim(internal_code)) between 1 and 128),
  internal_code_normalized text generated always as (lower(regexp_replace(normalize(internal_code, NFKC), '\\s+', '', 'g'))) stored,
  product_type text not null check (product_type in ('hardware_with_software', 'standalone_software', 'component', 'remote_data_processing')),
  description text check (description is null or char_length(btrim(description)) between 1 and 4000),
  responsible_owner_id uuid not null references public.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete set null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, internal_code_normalized),
  foreign key (organization_id, legal_entity_id) references public.organization_legal_entities(organization_id, id) on delete restrict
);

create table if not exists public.product_legal_entity_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  legal_entity_id uuid not null,
  legal_entity_version integer not null check (legal_entity_version >= 0),
  legal_entity_snapshot jsonb not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references public.users(id) on delete restrict,
  reason text,
  unique (organization_id, product_id, assigned_at),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade,
  foreign key (organization_id, legal_entity_id) references public.organization_legal_entities(organization_id, id) on delete restrict
);

create table if not exists public.product_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  legal_entity_id uuid not null,
  legal_entity_version integer not null check (legal_entity_version >= 0),
  legal_entity_snapshot jsonb not null,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  release_version text not null check (char_length(btrim(release_version)) between 1 and 200),
  release_version_normalized text generated always as (lower(regexp_replace(normalize(release_version, NFKC), '\\s+', '', 'g'))) stored,
  description text check (description is null or char_length(btrim(description)) between 1 and 4000),
  lifecycle text not null default 'draft' check (lifecycle in ('draft', 'released', 'retired')),
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete set null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, product_id, release_version_normalized),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, legal_entity_id) references public.organization_legal_entities(organization_id, id) on delete restrict
);

create table if not exists public.product_create_idempotencies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete cascade,
  idempotency_key uuid not null,
  payload_digest text not null,
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete restrict
);

create table if not exists public.product_release_create_idempotencies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete cascade,
  idempotency_key uuid not null,
  payload_digest text not null,
  release_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, release_id) references public.product_releases(organization_id, id) on delete restrict
);

-- Installed feature owners can project archive blockers without querying product tables.
create table if not exists public.product_lifecycle_dependency_facts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid,
  authority_kind text not null check (authority_kind in ('sbom', 'finding', 'report', 'evidence', 'retention', 'legal_hold')),
  record_id uuid not null,
  active boolean not null default true,
  reconciled_at timestamptz not null default now(),
  reconciled_by uuid not null references public.users(id) on delete restrict,
  primary key (organization_id, authority_kind, record_id),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade,
  foreign key (organization_id, release_id) references public.product_releases(organization_id, id) on delete cascade
);

create index if not exists products_list_idx on public.products (organization_id, archived_at, updated_at desc, id desc);
create index if not exists products_owner_idx on public.products (organization_id, responsible_owner_id, archived_at, updated_at desc);
create index if not exists releases_list_idx on public.product_releases (organization_id, product_id, archived_at, created_at desc, id desc);
create index if not exists product_assignments_product_idx on public.product_legal_entity_assignments (organization_id, product_id, assigned_at desc);
create index if not exists product_dependencies_product_idx on public.product_lifecycle_dependency_facts (organization_id, product_id, active);
create index if not exists product_dependencies_release_idx on public.product_lifecycle_dependency_facts (organization_id, release_id, active) where release_id is not null;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists set_product_releases_updated_at on public.product_releases;
create trigger set_product_releases_updated_at before update on public.product_releases for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.product_legal_entity_assignments enable row level security;
alter table public.product_releases enable row level security;
alter table public.product_create_idempotencies enable row level security;
alter table public.product_release_create_idempotencies enable row level security;
alter table public.product_lifecycle_dependency_facts enable row level security;
grant all on public.products, public.product_legal_entity_assignments, public.product_releases, public.product_create_idempotencies, public.product_release_create_idempotencies, public.product_lifecycle_dependency_facts to service_role;
revoke all on public.products, public.product_legal_entity_assignments, public.product_releases, public.product_create_idempotencies, public.product_release_create_idempotencies, public.product_lifecycle_dependency_facts from public, anon, authenticated;

create or replace function public.m2_product_json(p_organization_id uuid, p_product_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'organizationId', p.organization_id, 'name', p.name,
    'internalCode', p.internal_code, 'productType', p.product_type, 'description', p.description,
    'responsibleOwnerId', p.responsible_owner_id,
    'legalEntity', jsonb_build_object('id', p.legal_entity_id, 'identifier', p.legal_entity_snapshot->>'identifier', 'legalName', p.legal_entity_snapshot->>'legalName', 'mainEstablishmentCountry', p.legal_entity_snapshot->>'mainEstablishmentCountry', 'version', p.legal_entity_version),
    'archivedAt', p.archived_at, 'version', p.version,
    'releaseCount', (select count(*) from public.product_releases r where r.organization_id=p.organization_id and r.product_id=p.id),
    'createdAt', p.created_at, 'updatedAt', p.updated_at, 'createdBy', p.created_by, 'updatedBy', p.updated_by
  ) from public.products p where p.organization_id=p_organization_id and p.id=p_product_id;
$$;

create or replace function public.m2_release_json(p_organization_id uuid, p_release_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'organizationId', r.organization_id, 'productId', r.product_id,
    'label', r.label, 'version', r.release_version, 'description', r.description, 'lifecycle', r.lifecycle,
    'legalEntity', jsonb_build_object('id', r.legal_entity_id, 'identifier', r.legal_entity_snapshot->>'identifier', 'legalName', r.legal_entity_snapshot->>'legalName', 'mainEstablishmentCountry', r.legal_entity_snapshot->>'mainEstablishmentCountry', 'version', r.legal_entity_version),
    'archivedAt', r.archived_at, 'versionNumber', r.version,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'createdBy', r.created_by, 'updatedBy', r.updated_by
  ) from public.product_releases r where r.organization_id=p_organization_id and r.id=p_release_id;
$$;

-- Shared guard: membership is deliberately rechecked by every service-role RPC.
create or replace function public.m2_active_member(p_organization_id uuid, p_actor_user_id uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
 select public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id)
$$;

create or replace function public.create_product_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid,
  p_name text, p_internal_code text, p_product_type text, p_description text,
  p_responsible_owner_id uuid, p_legal_entity_id uuid
) returns table(outcome text, product jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_context jsonb; v_digest text; v_existing public.product_create_idempotencies%rowtype;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=p_organization_id and m.user_id=p_responsible_owner_id and u.is_active) then return query select 'not_found'::text,null::jsonb; return; end if;
 select context into v_context from public.resolve_active_organization_legal_entity_context(p_organization_id,p_legal_entity_id) where outcome='found';
 if v_context is null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest := encode(digest(jsonb_build_object('name',p_name,'internalCode',p_internal_code,'productType',p_product_type,'description',p_description,'responsibleOwnerId',p_responsible_owner_id,'legalEntityId',p_legal_entity_id)::text,'sha256'),'hex');
 select * into v_existing from public.product_create_idempotencies where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then
   if v_existing.payload_digest <> v_digest then return query select 'idempotency_mismatch'::text,null::jsonb; else return query select 'replayed'::text,public.m2_product_json(p_organization_id,v_existing.product_id); end if; return;
 end if;
 insert into public.products(organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,description,responsible_owner_id,created_by,updated_by)
 values(p_organization_id,p_legal_entity_id,(v_context->>'legalEntityVersion')::integer,v_context->'legalEntitySnapshot',btrim(p_name),btrim(p_internal_code),p_product_type,nullif(btrim(p_description),''),p_responsible_owner_id,p_actor_user_id,p_actor_user_id) returning * into v_product;
 insert into public.product_legal_entity_assignments(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,assigned_by,reason) values(p_organization_id,v_product.id,p_legal_entity_id,v_product.legal_entity_version,v_product.legal_entity_snapshot,p_actor_user_id,'initial_assignment');
 insert into public.product_create_idempotencies(organization_id,actor_user_id,idempotency_key,payload_digest,product_id) values(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,v_product.id);
 perform public.record_organization_onboarding_evidence_atomic(p_organization_id,'first_product',v_product.id,p_actor_user_id,true);
 perform public.reconcile_organization_legal_entity_dependencies_atomic(p_organization_id,p_legal_entity_id,p_actor_user_id,'product',true,jsonb_build_array(jsonb_build_object('recordId',v_product.id,'count',1)));
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.created','product',v_product.id::text,jsonb_build_object('after',public.m2_product_json(p_organization_id,v_product.id)));
 return query select 'created'::text,public.m2_product_json(p_organization_id,v_product.id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end;
$$;

create or replace function public.get_product(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; else return query select 'found'::text,public.m2_product_json(p_organization_id,p_product_id); end if; end; $$;

create or replace function public.list_products(p_organization_id uuid,p_actor_user_id uuid,p_q text,p_archived boolean,p_product_type text,p_responsible_owner_id uuid,p_page integer,p_page_size integer)
returns table(outcome text, products jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select count(*) into v_total from public.products p where p.organization_id=p_organization_id and (p_archived is null or (p.archived_at is not null)=p_archived) and (p_product_type is null or p.product_type=p_product_type) and (p_responsible_owner_id is null or p.responsible_owner_id=p_responsible_owner_id) and (p_q is null or p.name ilike '%'||p_q||'%' or p.internal_code ilike '%'||p_q||'%');
 select coalesce(jsonb_agg(public.m2_product_json(p_organization_id,p.id) order by p.updated_at desc,p.id desc),'[]'::jsonb) into v_rows from (select id,updated_at from public.products p where p.organization_id=p_organization_id and (p_archived is null or (p.archived_at is not null)=p_archived) and (p_product_type is null or p.product_type=p_product_type) and (p_responsible_owner_id is null or p.responsible_owner_id=p_responsible_owner_id) and (p_q is null or p.name ilike '%'||p_q||'%' or p.internal_code ilike '%'||p_q||'%') order by updated_at desc,id desc limit p_page_size offset ((p_page-1)*p_page_size)) p;
 return query select 'found'::text,jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'pageCount',case when v_total=0 then 0 else ceil(v_total::numeric/p_page_size)::integer end);
end; $$;

create or replace function public.update_product_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_name text,p_internal_code text,p_product_type text,p_description text,p_responsible_owner_id uuid)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
 if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
 if p_responsible_owner_id is not null and not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=p_organization_id and m.user_id=p_responsible_owner_id and u.is_active) then return query select 'not_found'::text,null::jsonb; return; end if;
 update public.products set name=coalesce(btrim(p_name),name),internal_code=coalesce(btrim(p_internal_code),internal_code),product_type=coalesce(p_product_type,product_type),description=case when p_description is null then description else nullif(btrim(p_description),'') end,responsible_owner_id=coalesce(p_responsible_owner_id,responsible_owner_id),version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.updated','product',p_product_id::text,jsonb_build_object('before',public.m2_product_json(p_organization_id,p_product_id),'after',public.m2_product_json(p_organization_id,p_product_id)));
 return query select 'updated'::text,public.m2_product_json(p_organization_id,p_product_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;

create or replace function public.assign_product_legal_entity_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_legal_entity_id uuid,p_reason text)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_context jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
 select context into v_context from public.resolve_active_organization_legal_entity_context(p_organization_id,p_legal_entity_id) where outcome='found'; if v_context is null then return query select 'not_found'::text,null::jsonb; return; end if;
 update public.products set legal_entity_id=p_legal_entity_id,legal_entity_version=(v_context->>'legalEntityVersion')::integer,legal_entity_snapshot=v_context->'legalEntitySnapshot',version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 insert into public.product_legal_entity_assignments(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,assigned_by,reason) values(p_organization_id,p_product_id,p_legal_entity_id,(v_context->>'legalEntityVersion')::integer,v_context->'legalEntitySnapshot',p_actor_user_id,btrim(p_reason));
 perform public.reconcile_organization_legal_entity_dependencies_atomic(p_organization_id,p_legal_entity_id,p_actor_user_id,'product',true,jsonb_build_array(jsonb_build_object('recordId',p_product_id,'count',1)));
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.legal_entity_assigned','product',p_product_id::text,jsonb_build_object('reason',p_reason));
 return query select 'updated'::text,public.m2_product_json(p_organization_id,p_product_id); end; $$;

create or replace function public.archive_product_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_reason text)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
 if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
 if exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and archived_at is null) or exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=p_organization_id and product_id=p_product_id and active) then return query select 'blocked'::text,null::jsonb; return; end if;
 update public.products set archived_at=now(),archived_by=p_actor_user_id,version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 perform public.reconcile_organization_legal_entity_dependencies_atomic(p_organization_id,v_product.legal_entity_id,p_actor_user_id,'product',true,'[]'::jsonb);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.archived','product',p_product_id::text,jsonb_build_object('reason',p_reason));
 return query select 'archived'::text,public.m2_product_json(p_organization_id,p_product_id); end; $$;

create or replace function public.create_product_release_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_label text,p_release_version text,p_description text,p_lifecycle text)
returns table(outcome text, release jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_release public.product_releases%rowtype; v_digest text; v_existing public.product_release_create_idempotencies%rowtype;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found or v_product.archived_at is not null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest:=encode(digest(jsonb_build_object('productId',p_product_id,'label',p_label,'version',p_release_version,'description',p_description,'lifecycle',p_lifecycle)::text,'sha256'),'hex'); select * into v_existing from public.product_release_create_idempotencies where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then if v_existing.payload_digest<>v_digest then return query select 'idempotency_mismatch'::text,null::jsonb; else return query select 'replayed'::text,public.m2_release_json(p_organization_id,v_existing.release_id); end if; return; end if;
 insert into public.product_releases(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,description,lifecycle,created_by,updated_by) values(p_organization_id,p_product_id,v_product.legal_entity_id,v_product.legal_entity_version,v_product.legal_entity_snapshot,btrim(p_label),btrim(p_release_version),nullif(btrim(p_description),''),p_lifecycle,p_actor_user_id,p_actor_user_id) returning * into v_release;
 insert into public.product_release_create_idempotencies(organization_id,actor_user_id,idempotency_key,payload_digest,release_id) values(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,v_release.id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.release_created','product_release',v_release.id::text,jsonb_build_object('productId',p_product_id));
 return query select 'created'::text,public.m2_release_json(p_organization_id,v_release.id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;

create or replace function public.get_product_release(p_organization_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid)
returns table(outcome text, release jsonb) language plpgsql security definer set search_path = public, pg_temp as $$ begin if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id) then return query select 'not_found'::text,null::jsonb; else return query select 'found'::text,public.m2_release_json(p_organization_id,p_release_id); end if; end; $$;

create or replace function public.list_product_releases(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_archived boolean,p_lifecycle text,p_page integer,p_page_size integer)
returns table(outcome text, releases jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
select count(*) into v_total from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and (p_archived is null or (r.archived_at is not null)=p_archived) and (p_lifecycle is null or r.lifecycle=p_lifecycle);
select coalesce(jsonb_agg(public.m2_release_json(p_organization_id,r.id) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows from (select id,created_at from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and (p_archived is null or (r.archived_at is not null)=p_archived) and (p_lifecycle is null or r.lifecycle=p_lifecycle) order by created_at desc,id desc limit p_page_size offset ((p_page-1)*p_page_size)) r;
return query select 'found'::text,jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'pageCount',case when v_total=0 then 0 else ceil(v_total::numeric/p_page_size)::integer end); end; $$;

create or replace function public.update_product_release_atomic(p_organization_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid,p_expected_version integer,p_label text,p_release_version text,p_description text,p_lifecycle text)
returns table(outcome text, release jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_release public.product_releases%rowtype;
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if; select * into v_release from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_release.version<>p_expected_version then return query select 'conflict'::text,public.m2_release_json(p_organization_id,p_release_id); return; end if; if v_release.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
if p_lifecycle is not null and ((v_release.lifecycle='draft' and p_lifecycle not in ('draft','released')) or (v_release.lifecycle='released' and p_lifecycle not in ('released','retired')) or (v_release.lifecycle='retired' and p_lifecycle<>'retired')) then return query select 'invalid_state'::text,null::jsonb; return; end if;
update public.product_releases set label=coalesce(btrim(p_label),label),release_version=coalesce(btrim(p_release_version),release_version),description=case when p_description is null then description else nullif(btrim(p_description),'') end,lifecycle=coalesce(p_lifecycle,lifecycle),version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_release_id;
insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.release_updated','product_release',p_release_id::text,'{}'::jsonb); return query select 'updated'::text,public.m2_release_json(p_organization_id,p_release_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;

create or replace function public.archive_product_release_atomic(p_organization_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid,p_expected_version integer,p_reason text)
returns table(outcome text, release jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_release public.product_releases%rowtype;
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if; select * into v_release from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_release.version<>p_expected_version then return query select 'conflict'::text,public.m2_release_json(p_organization_id,p_release_id); return; end if; if v_release.lifecycle<>'retired' or v_release.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if; if exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=p_organization_id and release_id=p_release_id and active) then return query select 'blocked'::text,null::jsonb; return; end if;
update public.product_releases set archived_at=now(),archived_by=p_actor_user_id,version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_release_id; insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.release_archived','product_release',p_release_id::text,jsonb_build_object('reason',p_reason)); return query select 'archived'::text,public.m2_release_json(p_organization_id,p_release_id); end; $$;

-- Grant only the application service role. Browser roles have table/RPC access revoked.
revoke all on function public.create_product_atomic(uuid,uuid,uuid,text,text,text,text,uuid,uuid), public.get_product(uuid,uuid,uuid), public.list_products(uuid,uuid,text,boolean,text,uuid,integer,integer), public.update_product_atomic(uuid,uuid,uuid,integer,text,text,text,text,uuid), public.assign_product_legal_entity_atomic(uuid,uuid,uuid,integer,uuid,text), public.archive_product_atomic(uuid,uuid,uuid,integer,text), public.create_product_release_atomic(uuid,uuid,uuid,uuid,text,text,text,text), public.get_product_release(uuid,uuid,uuid,uuid), public.list_product_releases(uuid,uuid,uuid,boolean,text,integer,integer), public.update_product_release_atomic(uuid,uuid,uuid,uuid,integer,text,text,text,text), public.archive_product_release_atomic(uuid,uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.create_product_atomic(uuid,uuid,uuid,text,text,text,text,uuid,uuid), public.get_product(uuid,uuid,uuid), public.list_products(uuid,uuid,text,boolean,text,uuid,integer,integer), public.update_product_atomic(uuid,uuid,uuid,integer,text,text,text,text,uuid), public.assign_product_legal_entity_atomic(uuid,uuid,uuid,integer,uuid,text), public.archive_product_atomic(uuid,uuid,uuid,integer,text), public.create_product_release_atomic(uuid,uuid,uuid,uuid,text,text,text,text), public.get_product_release(uuid,uuid,uuid,uuid), public.list_product_releases(uuid,uuid,uuid,boolean,text,integer,integer), public.update_product_release_atomic(uuid,uuid,uuid,uuid,integer,text,text,text,text), public.archive_product_release_atomic(uuid,uuid,uuid,uuid,integer,text) to service_role;
