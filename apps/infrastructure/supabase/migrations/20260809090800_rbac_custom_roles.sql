-- =============================================================================
-- public.custom_roles — named, org-scoped bundles of extra permissions.
-- =============================================================================
-- A custom role may only ADD permissions on top of a member's base role. It can
-- never revoke; see `resolveEffectivePermissions` in @repo/contracts.
--
-- `base_role` here is a UI grouping/label ONLY. The reference merges
-- DEFAULT_PERMISSIONS_BY_ROLE[base_role] into the user when the role is
-- assigned, which means a role called "Report Reader" carrying one harmless
-- permission but declaring base_role 'owner' silently grants full ownership.
-- CRA does not do that, and `permissions.spec.ts` has a regression pinning it.
-- The column is kept because the admin UI groups and colour-codes by it.
-- =============================================================================

create table if not exists public.custom_roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  name             varchar(100) not null,
  description      text,
  color            varchar(7)  not null default '#6B7280',
  icon             varchar(50),

  -- Label, not a grant. See above.
  base_role        varchar(20) not null default 'member',

  -- Sanitized against the live key set on read, so a permission key deleted
  -- from the code cannot keep granting access from stale jsonb.
  permissions      jsonb       not null default '{}'::jsonb,

  is_system        boolean     not null default false,
  is_active        boolean     not null default true,

  is_deleted       boolean     not null default false,
  deleted_at       timestamptz,
  deleted_by       uuid references public.users (id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint custom_roles_base_role_check
    check (base_role in ('owner', 'admin', 'member', 'viewer')),
  constraint custom_roles_color_format
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint custom_roles_name_not_blank
    check (length(btrim(name)) > 0),
  -- permissions must be a JSON object, never an array or scalar: the resolver
  -- iterates its entries and an array would silently contribute nothing.
  constraint custom_roles_permissions_is_object
    check (jsonb_typeof(permissions) = 'object'),
  constraint custom_roles_deleted_consistent
    check ((is_deleted = false and deleted_at is null) or (is_deleted = true and deleted_at is not null))
);

-- PARTIAL unique index. The reference uses a plain unique constraint, which
-- counts soft-deleted rows — so a role that was moved to the bin permanently
-- squats its own name and the admin UI reports a duplicate for a role nobody
-- can see. Excluding deleted rows lets the name be reused.
create unique index if not exists custom_roles_org_name_key
  on public.custom_roles (organization_id, lower(name))
  where is_deleted = false;

create index if not exists idx_custom_roles_org
  on public.custom_roles (organization_id)
  where is_deleted = false;

drop trigger if exists set_custom_roles_updated_at on public.custom_roles;
create trigger set_custom_roles_updated_at
  before update on public.custom_roles
  for each row execute function public.set_updated_at();

alter table public.custom_roles enable row level security;

grant all on table public.custom_roles to service_role;
revoke all on table public.custom_roles from public, anon, authenticated;
