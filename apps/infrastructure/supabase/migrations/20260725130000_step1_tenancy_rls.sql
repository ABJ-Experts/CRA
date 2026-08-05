-- Step 1 — Schema, forced RLS, tenant context. Build order step 1.
-- ADR-005: shared schema, RLS ENABLED + FORCED, every tenant table has a
--          non-null organisation_id, isolation keyed on a tx-local setting.
-- ADR-003: plain SQL migration applied via the Supabase CLI.
-- SEC-014 is enforced at app boot (see apps/api/src/db/sec014.ts); this file
--         creates the restricted role that boot assertion depends on.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid() default; app passes uuidv7 explicitly

-- ---------------------------------------------------------------------------
-- Restricted application role (ADR-005 / SEC-014).
-- NOT service_role, NOT superuser, NO BYPASSRLS. If this role could bypass RLS
-- the entire isolation layer would vanish silently. The app connects as this.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cras_app') then
    create role cras_app login noinherit password 'cras_app_local_dev';
  end if;
end$$;

-- ===========================================================================
-- GLOBAL / non-tenant tables
-- ===========================================================================

-- The tenant boundary itself. organisation is NOT tenant-scoped (it *is* the tenant).
create table organisation (
  id                          uuid primary key default gen_random_uuid(),
  legal_name                  text not null,
  registered_address          text,
  country_main_establishment  text not null,                 -- FR-ORG-001: decides coordinating CSIRT
  coordinating_csirt          text,                          -- derived from country_main_establishment
  manufacturer_contact        jsonb not null default '{}'::jsonb,
  onboarding_state            jsonb not null default '{}'::jsonb,  -- FR-ORG-002: resumable wizard progress
  parent_organisation_id      uuid references organisation(id), -- unused until V2 (ADR/6.1)
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,
  updated_by                  uuid,
  deleted_at                  timestamptz
);

-- A person. Global: one user may belong to several organisations (FR-IAM-003).
create table user_account (
  id                uuid primary key default gen_random_uuid(),
  supabase_user_id  uuid not null unique,          -- GoTrue subject (ADR-004 handshake)
  email             text not null,
  display_name      text,
  status            text not null default 'active'
                      check (status in ('active','deactivated')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz
);

-- Role templates + permission catalog. Global reference (seeded in Step 3).
-- Roles are org-agnostic templates in MVP; custom per-org roles are V2 (FR-IAM-008).
create table role (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,                   -- e.g. 'owner','psm','sec_eng'
  display_name text not null,
  is_template  boolean not null default true
);

create table role_permission (
  role_id    uuid not null references role(id) on delete cascade,
  permission text not null,                            -- 'resource:action' (FR-IAM / §7.2)
  primary key (role_id, permission)
);

-- ===========================================================================
-- TENANT-SCOPED tables (mandatory organisation_id + RLS)
-- ===========================================================================

create table org_member (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisation(id),
  user_account_id  uuid not null references user_account(id),
  role_id          uuid not null references role(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique (organisation_id, user_account_id)
);
create index org_member_user_idx on org_member (user_account_id);

-- First tenant-scoped domain table (Step 4 expands it). Present now so the
-- isolation suite (FR-TEN-001/003) has a clean domain target from day one.
create table product (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisation(id),
  name             text not null,
  internal_code    text not null,                      -- unique within the org; CI matches on it
  product_type     text not null default 'standalone_software'
                     check (product_type in ('hardware_with_software','standalone_software','component','remote_data_processing')),
  lifecycle_state  text not null default 'development'
                     check (lifecycle_state in ('development','placed_on_market','in_support','end_of_support','withdrawn')),
  placed_on_market_at timestamptz,
  version          integer not null default 1,         -- optimistic lock
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  unique (organisation_id, internal_code)
);
create index product_org_idx on product (organisation_id);

-- ---------------------------------------------------------------------------
-- Row Level Security. ENABLE + FORCE on every tenant-scoped table (ADR-005).
-- FORCE makes the policy apply even to the table owner, so a mistaken owner
-- connection cannot read across tenants either.
-- Policies read tx-local settings set by withTenant(): app.organisation_id and
-- app.user_id. The trailing `true` in current_setting means "missing -> null",
-- so with NO context every predicate is null -> false -> zero rows (SEC-014 / FR-TEN-003).
-- ---------------------------------------------------------------------------

-- organisation: a caller sees the active org, and any org they are a member of
-- (for the org switcher, FR-IAM-003). No organisation_id column -> keyed on id.
alter table organisation enable row level security;
alter table organisation force  row level security;
create policy tenant_isolation on organisation
  using (
    id = nullif(current_setting('app.organisation_id', true), '')::uuid
    or exists (
      select 1 from org_member m
      where m.organisation_id = organisation.id
        and m.user_account_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );

-- user_account: visible if it is the caller, or shares the active org.
alter table user_account enable row level security;
alter table user_account force  row level security;
create policy tenant_isolation on user_account
  using (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    or exists (
      select 1 from org_member m
      where m.user_account_id = user_account.id
        and m.organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    )
  );

-- org_member: rows for the active org, plus the caller's own memberships
-- (needed at login to resolve which org to activate — before org context exists).
alter table org_member enable row level security;
alter table org_member force  row level security;
create policy tenant_isolation on org_member
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    or user_account_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

-- product: the canonical org-scoped policy (the pattern every future domain table copies).
alter table product enable row level security;
alter table product force  row level security;
create policy tenant_isolation on product
  using      (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Grants. cras_app gets DML on domain tables; global reference tables are
-- read-only to it (writes reserved for elevated feed/seed jobs — none yet).
-- ---------------------------------------------------------------------------
grant usage on schema public to cras_app;
grant select, insert, update, delete on organisation, user_account, org_member, product to cras_app;
grant select on role, role_permission to cras_app;
-- role/role_permission are reference data; the app never writes them.
revoke insert, update, delete on role, role_permission from cras_app;
