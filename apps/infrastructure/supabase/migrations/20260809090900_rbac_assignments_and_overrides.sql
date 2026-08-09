-- =============================================================================
-- Role assignment and organization-level base-role overrides.
-- =============================================================================

create table if not exists public.user_role_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.users (id)         on delete cascade,
  role_id          uuid not null references public.custom_roles (id)  on delete cascade,
  created_at       timestamptz not null default now()
);

create unique index if not exists user_role_assignments_unique
  on public.user_role_assignments (organization_id, user_id, role_id);

create index if not exists idx_ura_user on public.user_role_assignments (organization_id, user_id);

-- The reference has no index on role_id, so "how many people hold this role?"
-- and the delete-cascade check both sequential-scan. The roles admin screen
-- asks exactly that question once per row.
create index if not exists idx_ura_role on public.user_role_assignments (role_id);

alter table public.user_role_assignments enable row level security;
grant all on table public.user_role_assignments to service_role;
revoke all on table public.user_role_assignments from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- base_role_permission_overrides
--
-- Lets one organization decide that, for them, `admin` does not get
-- `can_delete_users` — without editing the shared presets that every other
-- organization relies on.
--
-- These are applied LAST in `resolveEffectivePermissions` and merged hard, so a
-- revocation here cannot be undone by assigning the user a custom role. That
-- ordering is a deliberate deviation from the reference, which applies
-- overrides before custom roles and therefore lets any custom role restore what
-- the organization took away.
-- ---------------------------------------------------------------------------
create table if not exists public.base_role_permission_overrides (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  base_role        varchar(20) not null,
  permissions      jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint brpo_base_role_check
    check (base_role in ('owner', 'admin', 'member', 'viewer')),
  constraint brpo_permissions_is_object
    check (jsonb_typeof(permissions) = 'object'),
  -- The constraint that makes `upsert ... onConflict` legal from the API.
  constraint brpo_org_role_unique unique (organization_id, base_role)
);

drop trigger if exists set_brpo_updated_at on public.base_role_permission_overrides;
create trigger set_brpo_updated_at
  before update on public.base_role_permission_overrides
  for each row execute function public.set_updated_at();

alter table public.base_role_permission_overrides enable row level security;
grant all on table public.base_role_permission_overrides to service_role;
revoke all on table public.base_role_permission_overrides from public, anon, authenticated;
