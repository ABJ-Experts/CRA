-- =============================================================================
-- Row Level Security policies.
-- =============================================================================
-- READ THIS BEFORE RELYING ON ANYTHING HERE.
--
-- apps/api uses the Supabase service_role client, which BYPASSES RLS entirely.
-- These policies are therefore NOT the authorization boundary for the product —
-- the boundary is the mandatory `organization_id` argument in the API's
-- repository layer. A missing `.eq('organization_id', ...)` is a cross-tenant
-- leak that no policy below will catch.
--
-- What these policies are for:
--   1. Defence in depth if anyone reaches PostgREST on :54321 directly.
--   2. Being already correct on the day a browser-side Supabase client is
--      introduced, rather than being written in a hurry at that point.
--
-- Note that `authenticated` currently holds NO table privileges (see the
-- baseline migration), so today these policies grant nothing at all — a table
-- privilege and a passing policy are both required. That is intentional
-- belt-and-braces: a mistake in a policy below cannot leak data on its own.
--
-- The tables with NO policy whatsoever are deliberate. auth_login_attempts,
-- auth_email_verifications, auth_recovery_tokens and auth_mfa_recovery_codes
-- have RLS enabled and zero policies, which means no non-superuser role can
-- read them under any circumstance. auth_login_attempts especially: a readable
-- lockout table is a user-enumeration oracle.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
drop policy if exists users_select_self      on public.users;
drop policy if exists users_select_same_org  on public.users;
drop policy if exists users_update_self      on public.users;

create policy users_select_self on public.users
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy users_select_same_org on public.users
  for select to authenticated
  using (public.user_shares_org_with(id));

-- WITH CHECK repeats the USING predicate on purpose: without it a user could
-- pass the row-visibility test and then rewrite auth_user_id to point the
-- profile at somebody else's identity.
create policy users_update_self on public.users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- No INSERT policy: profiles are created by handle_new_user (SECURITY DEFINER)
-- or by the invitation service. No DELETE policy: deletion happens via the
-- auth.users cascade.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
drop policy if exists organizations_select_member on public.organizations;
drop policy if exists organizations_update_admin  on public.organizations;

create policy organizations_select_member on public.organizations
  for select to authenticated
  using (public.user_is_member_of(id));

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (public.user_is_org_admin(id))
  with check (public.user_is_org_admin(id));

-- ---------------------------------------------------------------------------
-- organization_members
--
-- The recursion hazard. `user_is_member_of` is SECURITY DEFINER precisely so
-- this policy does not re-enter itself.
-- ---------------------------------------------------------------------------
drop policy if exists org_members_select_same_org on public.organization_members;
drop policy if exists org_members_write_admin     on public.organization_members;

create policy org_members_select_same_org on public.organization_members
  for select to authenticated
  using (public.user_is_member_of(organization_id));

create policy org_members_write_admin on public.organization_members
  for all to authenticated
  using (public.user_is_org_admin(organization_id))
  with check (public.user_is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- custom_roles / assignments / overrides / menu_permissions
--
-- Everyone in the organization may READ the role catalogue — the UI shows role
-- names against members — but only admins may change it.
-- ---------------------------------------------------------------------------
drop policy if exists custom_roles_select_member on public.custom_roles;
drop policy if exists custom_roles_write_admin   on public.custom_roles;

create policy custom_roles_select_member on public.custom_roles
  for select to authenticated
  using (public.user_is_member_of(organization_id) and is_deleted = false);

create policy custom_roles_write_admin on public.custom_roles
  for all to authenticated
  using (public.user_is_org_admin(organization_id))
  with check (public.user_is_org_admin(organization_id));

drop policy if exists ura_select_member on public.user_role_assignments;
drop policy if exists ura_write_admin   on public.user_role_assignments;

create policy ura_select_member on public.user_role_assignments
  for select to authenticated
  using (public.user_is_member_of(organization_id));

create policy ura_write_admin on public.user_role_assignments
  for all to authenticated
  using (public.user_is_org_admin(organization_id))
  with check (public.user_is_org_admin(organization_id));

drop policy if exists brpo_select_member on public.base_role_permission_overrides;
drop policy if exists brpo_write_admin   on public.base_role_permission_overrides;

create policy brpo_select_member on public.base_role_permission_overrides
  for select to authenticated
  using (public.user_is_member_of(organization_id));

create policy brpo_write_admin on public.base_role_permission_overrides
  for all to authenticated
  using (public.user_is_org_admin(organization_id))
  with check (public.user_is_org_admin(organization_id));

drop policy if exists menu_perms_select_member on public.menu_permissions;
drop policy if exists menu_perms_write_admin   on public.menu_permissions;

create policy menu_perms_select_member on public.menu_permissions
  for select to authenticated
  using (public.user_is_member_of(organization_id));

create policy menu_perms_write_admin on public.menu_permissions
  for all to authenticated
  using (public.user_is_org_admin(organization_id))
  with check (public.user_is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- organization_permissions_version — read-only to members, written by triggers.
-- ---------------------------------------------------------------------------
drop policy if exists opv_select_member on public.organization_permissions_version;

create policy opv_select_member on public.organization_permissions_version
  for select to authenticated
  using (public.user_is_member_of(organization_id));

-- ---------------------------------------------------------------------------
-- invitations — admins only, in BOTH directions.
--
-- No member-level select: the pending-invitation list is a list of email
-- addresses the organization is courting, which is not everyone's business.
-- Acceptance is by token through the API, not by reading this table.
-- ---------------------------------------------------------------------------
drop policy if exists invitations_admin_all on public.invitations;

create policy invitations_admin_all on public.invitations
  for all to authenticated
  using (public.user_is_org_admin(organization_id))
  with check (public.user_is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- audit_logs — admins read; nobody writes through this path.
--
-- No INSERT/UPDATE/DELETE policy at all. An audit log that its own subjects can
-- edit is not an audit log; writes come from the service_role backend only.
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_select_admin on public.audit_logs;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (organization_id is not null and public.user_is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- user_table_preferences — strictly your own.
-- ---------------------------------------------------------------------------
drop policy if exists utp_own_all on public.user_table_preferences;

create policy utp_own_all on public.user_table_preferences
  for all to authenticated
  using (user_id = public.get_current_user_id())
  with check (user_id = public.get_current_user_id());
