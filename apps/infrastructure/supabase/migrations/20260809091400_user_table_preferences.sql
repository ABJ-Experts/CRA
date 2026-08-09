-- =============================================================================
-- public.user_table_preferences — per-user column config for the data tables.
-- =============================================================================
-- `@repo/ui/data-table` already supports column definitions and selection; this
-- is where a user's chosen columns, widths and order live, scoped per view.
--
-- `view_id` is an opaque screen identifier ('users', 'orders', 'tables.basic'),
-- deliberately not constrained to an enum: adding a table screen should not
-- require a migration.
-- =============================================================================

create table if not exists public.user_table_preferences (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid         not null references public.users (id)         on delete cascade,
  organization_id  uuid         not null references public.organizations (id) on delete cascade,
  view_id          varchar(100) not null,
  column_config    jsonb        not null default '[]'::jsonb,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now(),

  -- An ARRAY here, unlike the permission blobs: column config is ordered, and
  -- the order is the user's chosen column order.
  constraint utp_column_config_is_array check (jsonb_typeof(column_config) = 'array'),
  -- Makes `upsert ... onConflict` legal, and is also the correct grain: the
  -- same user may configure the same screen differently per organization.
  constraint utp_user_org_view_unique unique (user_id, organization_id, view_id)
);

drop trigger if exists set_utp_updated_at on public.user_table_preferences;
create trigger set_utp_updated_at
  before update on public.user_table_preferences
  for each row execute function public.set_updated_at();

alter table public.user_table_preferences enable row level security;
grant all on table public.user_table_preferences to service_role;
revoke all on table public.user_table_preferences from public, anon, authenticated;
