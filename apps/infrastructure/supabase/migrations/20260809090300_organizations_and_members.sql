-- =============================================================================
-- Organizations and membership.
-- =============================================================================
-- CRA is multi-organization: a user may belong to several and switch between
-- them. `organization_members.role` is the BASE role that seeds permission
-- resolution in @repo/contracts.
--
-- No `default_space_id` column (the reference has one, pointing at a table that
-- points back), so there is no foreign-key cycle anywhere in this schema and
-- migrations can be applied in one linear pass.
-- =============================================================================

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null,
  size        text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint organizations_name_not_blank check (length(btrim(name)) > 0),
  -- Slugs appear in URLs. Constrain the shape here rather than trusting every
  -- future caller to have validated it.
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);

create unique index if not exists organizations_slug_key
  on public.organizations (lower(slug));

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------

create table if not exists public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.users (id)         on delete cascade,
  role             text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint organization_members_role_check
    check (role in ('owner', 'admin', 'member', 'viewer'))
);

-- The reference omits this, and without it one user can hold two roles in the
-- same organization. Permission resolution then depends on which row the query
-- happens to return first, which is a non-deterministic authorization decision.
create unique index if not exists organization_members_org_user_key
  on public.organization_members (organization_id, user_id);

create index if not exists idx_org_members_user on public.organization_members (user_id);
create index if not exists idx_org_members_org  on public.organization_members (organization_id);

-- Partial index for the last-owner check, which runs on every membership write.
create index if not exists idx_org_members_owners
  on public.organization_members (organization_id)
  where role = 'owner';

drop trigger if exists set_organization_members_updated_at on public.organization_members;
create trigger set_organization_members_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The last-owner invariant, enforced in the database.
--
-- Service-layer checks are necessary but not sufficient: the API uses the
-- service_role client, so a bug, a script, or a direct psql session can strip
-- the final owner and leave an organization that nobody can administer. There
-- is no UI to recover from that state, so the guarantee belongs here.
--
-- Covers all three ways to lose an owner: DELETE the row, UPDATE the role away
-- from 'owner', and re-pointing the row at a different organization.
--
-- Deliberately does NOT fire when the organization itself is being deleted —
-- the cascade removes members legitimately, and the check would otherwise make
-- organizations undeletable.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_last_owner()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_org_id     uuid := old.organization_id;
  v_owner_left integer;
begin
  -- Organization gone (cascade) -> nothing to protect.
  if not exists (select 1 from public.organizations where id = v_org_id) then
    return null;
  end if;

  -- An UPDATE that leaves the row an owner of the same org changes nothing.
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.organization_id = v_org_id then
    return null;
  end if;

  select count(*) into v_owner_left
    from public.organization_members
   where organization_id = v_org_id
     and role = 'owner';

  if v_owner_left = 0 then
    raise exception
      'organization % must retain at least one owner', v_org_id
      using errcode = 'check_violation',
            hint    = 'Promote another member to owner before removing or demoting the last one.';
  end if;

  return null;
end;
$$;

alter function public.enforce_last_owner() owner to postgres;
revoke all on function public.enforce_last_owner() from public, anon, authenticated;

-- A CONSTRAINT trigger so the check can be deferred inside a transaction that
-- legitimately swaps ownership (demote A and promote B in either order).
drop trigger if exists enforce_last_owner_on_delete on public.organization_members;
create constraint trigger enforce_last_owner_on_delete
  after delete on public.organization_members
  deferrable initially deferred
  for each row execute function public.enforce_last_owner();

drop trigger if exists enforce_last_owner_on_update on public.organization_members;
create constraint trigger enforce_last_owner_on_update
  after update on public.organization_members
  deferrable initially deferred
  for each row execute function public.enforce_last_owner();

-- ---------------------------------------------------------------------------
-- Bump the session epoch whenever a user's membership or role changes, so an
-- access token minted under the old role stops being accepted.
--
-- Without this, a demotion from admin to viewer takes up to jwt_expiry (1h) to
-- take effect for a user who is already signed in.
-- ---------------------------------------------------------------------------
create or replace function public.bump_session_epoch_for_member()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
begin
  update public.users set session_epoch_at = now() where id = v_user_id;
  return null;
end;
$$;

alter function public.bump_session_epoch_for_member() owner to postgres;
revoke all on function public.bump_session_epoch_for_member() from public, anon, authenticated;

drop trigger if exists bump_epoch_on_membership_change on public.organization_members;
create trigger bump_epoch_on_membership_change
  after insert or delete on public.organization_members
  for each row execute function public.bump_session_epoch_for_member();

drop trigger if exists bump_epoch_on_role_change on public.organization_members;
create trigger bump_epoch_on_role_change
  after update of role on public.organization_members
  for each row
  when (old.role is distinct from new.role)
  execute function public.bump_session_epoch_for_member();

-- ---------------------------------------------------------------------------

alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;

grant all on table public.organizations        to service_role;
grant all on table public.organization_members to service_role;
revoke all on table public.organizations        from public, anon, authenticated;
revoke all on table public.organization_members from public, anon, authenticated;
