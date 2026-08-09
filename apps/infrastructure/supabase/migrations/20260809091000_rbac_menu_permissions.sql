-- =============================================================================
-- public.menu_permissions — per-organization sidebar visibility.
-- =============================================================================
-- Distinct from action permissions: `can_view_orders` decides whether the API
-- will serve orders, while the `ecommerce.orders` menu row decides whether the
-- nav item renders. An organization that does not use a module wants it hidden
-- without stripping permissions other surfaces depend on.
--
-- `menu_key` values come from MENU_KEYS in @repo/contracts/menu, which
-- `menu-nav-parity.spec.ts` keeps identical to nav-config.tsx in both
-- directions.
--
-- The reference supports four target types; CRA drops `group` because it has no
-- user groups, leaving user / role / base_role.
-- =============================================================================

create table if not exists public.menu_permissions (
  id               uuid         primary key default gen_random_uuid(),
  organization_id  uuid         not null references public.organizations (id) on delete cascade,
  menu_key         varchar(100) not null,
  target_type      varchar(20)  not null,

  user_id          uuid references public.users (id)        on delete cascade,
  role_id          uuid references public.custom_roles (id) on delete cascade,
  base_role        varchar(20),

  can_view         boolean     not null default true,
  created_at       timestamptz not null default now(),

  constraint menu_permissions_target_type_check
    check (target_type in ('user', 'role', 'base_role')),

  constraint menu_permissions_base_role_check
    check (base_role is null or base_role in ('owner', 'admin', 'member', 'viewer')),

  -- Exclusive arc: exactly one target column is populated, and it is the one
  -- target_type names. Without this a row can claim target_type='user' while
  -- carrying only a role_id, and the resolver silently matches nobody — a
  -- permission that appears configured in the UI and does nothing at runtime.
  constraint menu_permissions_exactly_one_target check (
    (target_type = 'user'      and user_id   is not null and role_id is null and base_role is null) or
    (target_type = 'role'      and role_id   is not null and user_id is null and base_role is null) or
    (target_type = 'base_role' and base_role is not null and user_id is null and role_id   is null)
  )
);

-- One rule per (org, menu, target). Three partial uniques rather than one over
-- all four columns, because NULLs are distinct in a unique index: a single
-- index would happily accept two identical base_role rules.
create unique index if not exists menu_permissions_user_key
  on public.menu_permissions (organization_id, menu_key, user_id)
  where target_type = 'user';

create unique index if not exists menu_permissions_role_key
  on public.menu_permissions (organization_id, menu_key, role_id)
  where target_type = 'role';

create unique index if not exists menu_permissions_base_role_key
  on public.menu_permissions (organization_id, menu_key, base_role)
  where target_type = 'base_role';

create index if not exists idx_menu_permissions_org
  on public.menu_permissions (organization_id);

alter table public.menu_permissions enable row level security;
grant all on table public.menu_permissions to service_role;
revoke all on table public.menu_permissions from public, anon, authenticated;
