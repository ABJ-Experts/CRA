-- =============================================================================
-- public.organization_permissions_version — cache invalidation for RBAC.
-- =============================================================================
-- Resolving a user's effective permissions touches organization_members,
-- user_role_assignments, custom_roles, base_role_permission_overrides and
-- menu_permissions. Doing that on every request is five round trips per call.
--
-- The API caches the resolved set keyed by (organization_id, user_id, version).
-- Any write to any of those five tables bumps the org's version, so the next
-- request misses the cache and re-resolves. One cheap read replaces five, and a
-- permission change takes effect on the very next request rather than whenever
-- a TTL happens to expire.
--
-- Deliberately org-scoped, not user-scoped: a change to a shared role or an
-- override affects an unknown set of users, and computing that set to do
-- targeted invalidation is both slower and easy to get subtly wrong. Bumping
-- the whole organization over-invalidates, which is the safe direction.
-- =============================================================================

create table if not exists public.organization_permissions_version (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  version         bigint      not null default 1,
  updated_at      timestamptz not null default now()
);

drop trigger if exists set_opv_updated_at on public.organization_permissions_version;
create trigger set_opv_updated_at
  before update on public.organization_permissions_version
  for each row execute function public.set_updated_at();

alter table public.organization_permissions_version enable row level security;
grant all on table public.organization_permissions_version to service_role;
revoke all on table public.organization_permissions_version from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- bump_permissions_version(): shared by every trigger below.
--
-- Reads organization_id from NEW or OLD so it works for INSERT, UPDATE and
-- DELETE without three variants. A DELETE that cascades from the organization
-- itself finds no row to upsert into and is a harmless no-op, because the
-- version row cascades away too.
-- ---------------------------------------------------------------------------
create or replace function public.bump_permissions_version()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  if tg_op = 'DELETE' then
    v_org_id := old.organization_id;
  else
    v_org_id := new.organization_id;
  end if;

  if v_org_id is null then
    return null;
  end if;

  -- Skip when the organization is on its way out; the FK cascade removes the
  -- version row anyway and re-inserting it here would resurrect a dangling row.
  if not exists (select 1 from public.organizations where id = v_org_id) then
    return null;
  end if;

  insert into public.organization_permissions_version (organization_id, version, updated_at)
  values (v_org_id, 1, now())
  on conflict (organization_id) do update
    set version    = public.organization_permissions_version.version + 1,
        updated_at = now();

  return null;
end;
$$;

alter function public.bump_permissions_version() owner to postgres;
revoke all on function public.bump_permissions_version() from public, anon, authenticated;

-- Seed a version row with each organization so the first read never misses.
create or replace function public.init_permissions_version()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  insert into public.organization_permissions_version (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return null;
end;
$$;

alter function public.init_permissions_version() owner to postgres;
revoke all on function public.init_permissions_version() from public, anon, authenticated;

drop trigger if exists init_permissions_version_on_org on public.organizations;
create trigger init_permissions_version_on_org
  after insert on public.organizations
  for each row execute function public.init_permissions_version();

-- The five tables whose contents change a resolved permission set.
drop trigger if exists bump_perms_on_members on public.organization_members;
create trigger bump_perms_on_members
  after insert or update or delete on public.organization_members
  for each row execute function public.bump_permissions_version();

drop trigger if exists bump_perms_on_custom_roles on public.custom_roles;
create trigger bump_perms_on_custom_roles
  after insert or update or delete on public.custom_roles
  for each row execute function public.bump_permissions_version();

drop trigger if exists bump_perms_on_assignments on public.user_role_assignments;
create trigger bump_perms_on_assignments
  after insert or update or delete on public.user_role_assignments
  for each row execute function public.bump_permissions_version();

drop trigger if exists bump_perms_on_overrides on public.base_role_permission_overrides;
create trigger bump_perms_on_overrides
  after insert or update or delete on public.base_role_permission_overrides
  for each row execute function public.bump_permissions_version();

drop trigger if exists bump_perms_on_menu on public.menu_permissions;
create trigger bump_perms_on_menu
  after insert or update or delete on public.menu_permissions
  for each row execute function public.bump_permissions_version();
