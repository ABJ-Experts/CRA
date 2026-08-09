-- =============================================================================
-- RLS helper functions.
-- =============================================================================
-- These exist to break policy RECURSION. The obvious policy for
-- organization_members — "you may read rows for organizations you belong to" —
-- queries organization_members from inside organization_members' own policy.
-- Postgres detects that and raises 42P17 (infinite recursion detected in policy).
--
-- A SECURITY DEFINER function runs as its owner (postgres), which is not
-- subject to RLS, so the membership lookup inside the helper does not re-enter
-- the policy. The rls-policies spec has a canary that asserts 42P17 never
-- appears.
--
-- DELIBERATELY NO ACTIVE-ORGANIZATION GUC.
--   The reference resolves the current organization through a per-transaction
--   setting (`app.active_org_id`) that its NestJS backend never actually sets.
--   Every policy therefore compared against NULL, matched nothing, and the
--   entire RLS layer was decorative while looking thorough. Membership
--   predicates need no session setup and cannot fail blank.
--
-- All are STABLE (they only read) and pin search_path.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The profile id for the caller's JWT. Null for anon or an orphaned auth user.
-- ---------------------------------------------------------------------------
create or replace function public.get_current_user_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select u.id
    from public.users u
   where u.auth_user_id = auth.uid()
     and u.is_active = true
   limit 1;
$$;

alter function public.get_current_user_id() owner to postgres;

-- ---------------------------------------------------------------------------
create or replace function public.user_is_member_of(p_org_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.organization_id = p_org_id
       and u.auth_user_id = auth.uid()
       and u.is_active = true
  );
$$;

alter function public.user_is_member_of(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
create or replace function public.user_org_role(p_org_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select m.role
    from public.organization_members m
    join public.users u on u.id = m.user_id
   where m.organization_id = p_org_id
     and u.auth_user_id = auth.uid()
   limit 1;
$$;

alter function public.user_org_role(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
create or replace function public.user_is_org_admin(p_org_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(public.user_org_role(p_org_id) in ('owner', 'admin'), false);
$$;

alter function public.user_is_org_admin(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- Whether the caller shares any organization with the given profile. This is
-- what scopes "can see this person exists" without exposing the whole users
-- table to every authenticated session.
-- ---------------------------------------------------------------------------
create or replace function public.user_shares_org_with(p_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.organization_members mine
      join public.users me on me.id = mine.user_id
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
     where me.auth_user_id = auth.uid()
       and me.is_active = true
       and theirs.user_id = p_user_id
  );
$$;

alter function public.user_shares_org_with(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- A policy expression is evaluated as the QUERYING role, so `authenticated`
-- needs EXECUTE for the policies in the next migration to be able to run at
-- all. Granting EXECUTE is safe on its own: these functions only ever report
-- facts about the caller's own JWT, and without table privileges the caller
-- still cannot read a single row.
--
-- `anon` gets nothing — an unauthenticated caller has no membership to report.
-- ---------------------------------------------------------------------------
revoke all on function public.get_current_user_id()        from public, anon, authenticated;
revoke all on function public.user_is_member_of(uuid)      from public, anon, authenticated;
revoke all on function public.user_org_role(uuid)          from public, anon, authenticated;
revoke all on function public.user_is_org_admin(uuid)      from public, anon, authenticated;
revoke all on function public.user_shares_org_with(uuid)   from public, anon, authenticated;

grant execute on function public.get_current_user_id()      to authenticated;
grant execute on function public.user_is_member_of(uuid)    to authenticated;
grant execute on function public.user_org_role(uuid)        to authenticated;
grant execute on function public.user_is_org_admin(uuid)    to authenticated;
grant execute on function public.user_shares_org_with(uuid) to authenticated;
