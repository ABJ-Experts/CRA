-- =============================================================================
-- RLS and schema-invariant test suite.
-- =============================================================================
-- Run with:  pnpm --filter infrastructure run test
--
-- Every check raises an exception on failure, so the script exits non-zero and
-- the whole thing is usable as a CI gate. Read-only apart from clearly marked
-- transactions that roll back.
--
-- This suite is deliberately written BEFORE the API exists. Both reference
-- projects accumulated DB-level holes (an RLS layer that silently evaluated to
-- NULL, tables reachable by anon, unpinned SECURITY DEFINER search_paths) that
-- a sweep like this would have caught the day they were introduced.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
  returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Lockdown invariants
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.check('no table privileges leak to anon/authenticated/PUBLIC', n = 0);

  select count(*) into n from pg_tables
   where schemaname = 'public' and not rowsecurity;
  perform pg_temp.check('every public table has RLS enabled', n = 0);

  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and table_name = 'users'
     and column_name = 'email_verified_at';
  perform pg_temp.check('users has a server-side email verification state', n = 1);

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proconfig is null;
  perform pg_temp.check('every public function pins search_path', n = 0);

  -- FORCE would apply RLS to the owner too and break every SECURITY DEFINER
  -- helper, which would fail open in the worst possible way: silently.
  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity;
  perform pg_temp.check('no table uses FORCE row level security', n = 0);

  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and a.attnum > 0
   where ns.nspname = 'public' and c.relkind = 'r'
     and not exists (
       select 1 from pg_trigger t
        where t.tgrelid = c.oid and not t.tgisinternal
          and t.tgfoid = 'public.set_updated_at'::regproc);
  perform pg_temp.check('every updated_at column has its trigger', n = 0);
end
$$;

do $$
declare n integer;
begin
  select count(*) into n from public.users
   where email in (
     'owner@cra.test', 'admin@cra.test', 'member@cra.test', 'viewer@cra.test'
   )
   and email_verified_at is null;
  perform pg_temp.check('seeded users are marked email-verified', n = 0);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The credential tables must be unreadable by ANY non-superuser role.
--    RLS enabled with zero policies is the mechanism. auth_login_attempts in
--    particular would be a user-enumeration oracle if readable.
-- ---------------------------------------------------------------------------
do $$
declare t text; n integer;
begin
  foreach t in array array[
    'auth_login_attempts', 'auth_email_verifications',
    'auth_recovery_tokens', 'auth_mfa_recovery_codes'
  ] loop
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t;
    perform pg_temp.check(format('%s has no policy at all', t), n = 0);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. RECURSION CANARY.
--
--    The policy on organization_members asks "is the caller a member of this
--    organization?", which without a SECURITY DEFINER helper re-enters the same
--    policy and raises 42P17. `authenticated` holds no table privileges today,
--    so the grants below are made purely to exercise the policy expressions.
--
--    THE EXPLICIT TRANSACTION IS LOAD-BEARING. psql runs each statement in
--    autocommit, so a GRANT inside a bare DO block persists — the first version
--    of this file permanently granted `authenticated` SELECT on four tables and
--    `supabase db diff` reported it as schema drift. A test that quietly
--    weakens the database it is verifying is worse than no test.
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_auth_id uuid;
  n integer;
begin
  select auth_user_id into v_auth_id from public.users where email = 'admin@cra.test';
  if v_auth_id is null then
    raise exception 'FAIL seed missing: admin@cra.test';
  end if;

  grant select on public.users, public.organizations, public.organization_members,
                  public.custom_roles to authenticated;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_auth_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.organization_members;
  perform pg_temp.check('organization_members selectable without 42P17', n = 4);

  select count(*) into n from public.users;
  perform pg_temp.check('users visible through shared-org policy', n = 4);

  select count(*) into n from public.organizations;
  perform pg_temp.check('own organization visible', n = 1);

  select count(*) into n from public.custom_roles;
  perform pg_temp.check('custom roles visible to a member', n = 1);

  reset role;
exception
  when others then
    reset role;
    raise;
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 4. CROSS-ORGANIZATION ISOLATION.
--    A member of org A must see nothing belonging to org B.
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_auth_id  uuid;
  v_other_org uuid;
  v_stranger  uuid;
  n integer;
begin
  select auth_user_id into v_auth_id from public.users where email = 'admin@cra.test';

  insert into public.organizations (name, slug) values ('Rival', 'rival') returning id into v_other_org;
  insert into public.users (email) values ('stranger@rival.test') returning id into v_stranger;
  insert into public.organization_members (organization_id, user_id, role)
    values (v_other_org, v_stranger, 'owner');

  grant select on public.users, public.organizations, public.organization_members to authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_auth_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.organizations where id = v_other_org;
  perform pg_temp.check('cannot see another organization', n = 0);

  select count(*) into n from public.organization_members where organization_id = v_other_org;
  perform pg_temp.check('cannot see another organization''s members', n = 0);

  select count(*) into n from public.users where id = v_stranger;
  perform pg_temp.check('cannot see a user from another organization', n = 0);

  reset role;
exception
  when others then
    reset role;
    raise;
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 5. Trigger behaviour (see also the handle_new_user cases exercised by the
--    seed itself, which creates all four accounts through the trigger).
--
--    Everything below is wrapped and rolled back too, so the suite leaves no
--    residue and can be run repeatedly against the same seeded database.
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_org uuid;
  v_user uuid;
  v_before bigint;
  v_after bigint;
  v_epoch timestamptz;
begin
  select id into v_org from public.organizations where slug = 'cra';

  -- permissions version bumps on an RBAC write
  select version into v_before from public.organization_permissions_version where organization_id = v_org;
  insert into public.base_role_permission_overrides (organization_id, base_role, permissions)
    values (v_org, 'member', '{"can_view_users": true}'::jsonb);
  select version into v_after from public.organization_permissions_version where organization_id = v_org;
  perform pg_temp.check('permissions version bumps on an RBAC write', v_after = v_before + 1);

  -- A role change must NOT end the user's sessions: the guard resolves the role
  -- from the database on every request, so the change is already effective, and
  -- signing someone out because an admin edited their role is gratuitous.
  select id into v_user from public.users where email = 'viewer@cra.test';
  select session_epoch_at into v_epoch from public.users where id = v_user;
  perform pg_sleep(0.01);
  update public.organization_members set role = 'member' where user_id = v_user;
  perform pg_temp.check(
    'a role change does NOT end existing sessions',
    (select session_epoch_at from public.users where id = v_user) = v_epoch);

  -- ...but deactivation does, immediately.
  update public.users set is_active = false where id = v_user;
  perform pg_temp.check(
    'deactivation ends every session at once',
    (select session_epoch_at from public.users where id = v_user) > v_epoch);
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 6. Last-owner invariant, checked immediately rather than at commit.
-- ---------------------------------------------------------------------------
begin;
do $$
declare v_org uuid; v_owner uuid; v_raised boolean := false;
begin
  select id into v_org from public.organizations where slug = 'cra';
  select user_id into v_owner from public.organization_members
   where organization_id = v_org and role = 'owner';

  set constraints all immediate;
  begin
    update public.organization_members set role = 'viewer'
     where organization_id = v_org and user_id = v_owner;
  exception when others then
    v_raised := true;
  end;
  perform pg_temp.check('demoting the last owner is rejected', v_raised);
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 7. Invitation constraints.
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_org uuid;
  v_raised boolean := false;
begin
  select id into v_org from public.organizations where slug = 'cra';

  insert into public.invitations (organization_id, email, token_hash, expires_at)
  values (v_org, 'invitee@cra.test', repeat('a', 64), now() + interval '7 days');

  begin
    insert into public.invitations (organization_id, email, token_hash, expires_at)
    values (v_org, 'invitee@cra.test', repeat('b', 64), now() + interval '7 days');
  exception when unique_violation then
    v_raised := true;
  end;
  perform pg_temp.check('only one pending invitation per (org, email)', v_raised);

  -- ...but re-inviting after a decline is allowed.
  update public.invitations set status = 'declined', declined_at = now()
   where email = 'invitee@cra.test';
  insert into public.invitations (organization_id, email, token_hash, expires_at)
  values (v_org, 'invitee@cra.test', repeat('c', 64), now() + interval '7 days');
  perform pg_temp.check('re-invite after decline is allowed', true);

  v_raised := false;
  begin
    insert into public.invitations (organization_id, email, token_hash, expires_at)
    values (v_org, 'short@cra.test', 'tooshort', now() + interval '7 days');
  exception when check_violation then
    v_raised := true;
  end;
  perform pg_temp.check('token_hash must be a full sha256', v_raised);
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 8. menu_permissions exclusive arc.
-- ---------------------------------------------------------------------------
begin;
do $$
declare v_org uuid; v_raised boolean := false;
begin
  select id into v_org from public.organizations where slug = 'cra';

  begin
    -- Claims to target a user but supplies a base_role: the row would silently
    -- match nobody while appearing configured in the admin UI.
    insert into public.menu_permissions (organization_id, menu_key, target_type, base_role)
    values (v_org, 'ecommerce.orders', 'user', 'admin');
  exception when check_violation then
    v_raised := true;
  end;
  perform pg_temp.check('menu_permissions rejects a mismatched target', v_raised);

  insert into public.menu_permissions (organization_id, menu_key, target_type, base_role, can_view)
  values (v_org, 'ecommerce.orders', 'base_role', 'viewer', false);
  perform pg_temp.check('a well-formed base_role menu rule is accepted', true);
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 9. Login lockout, including the sliding window.
-- ---------------------------------------------------------------------------
begin;
do $$
declare v_locked timestamptz;
begin
  perform public.clear_login_attempts('lockme@cra.test');

  for i in 1 .. 4 loop
    v_locked := public.record_login_failure('lockme@cra.test');
  end loop;
  perform pg_temp.check('not locked before the threshold', v_locked is null);
  perform pg_temp.check('and is_login_locked agrees',
                        public.is_login_locked('lockme@cra.test') is null);

  v_locked := public.record_login_failure('lockme@cra.test');
  perform pg_temp.check('locked on the fifth failure', v_locked is not null);
  perform pg_temp.check('is_login_locked reports the lock',
                        public.is_login_locked('lockme@cra.test') is not null);

  -- Case-insensitive: an attacker must not reset the counter by changing case.
  perform pg_temp.check('lockout is case-insensitive',
                        public.is_login_locked('LockMe@CRA.test') is not null);

  perform public.clear_login_attempts('lockme@cra.test');
  perform pg_temp.check('a successful sign-in clears the lock',
                        public.is_login_locked('lockme@cra.test') is null);

  -- Sliding window: failures older than the window must not accumulate. The
  -- reference counts forever, so an occasional typo eventually locks a user out.
  perform public.record_login_failure('slide@cra.test');
  update public.auth_login_attempts
     set first_failed_at = now() - interval '1 hour'
   where email = 'slide@cra.test';
  v_locked := public.record_login_failure('slide@cra.test');
  perform pg_temp.check(
    'failures outside the window restart the count',
    (select failed_count from public.auth_login_attempts where email = 'slide@cra.test') = 1);
  perform public.clear_login_attempts('slide@cra.test');
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 10. The suite must leave NOTHING behind. Anything it granted or inserted
--     above has been rolled back; re-assert the lockdown invariants to prove it.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.check('suite left no privileges behind', n = 0);

  select count(*) into n from public.organizations;
  perform pg_temp.check('suite left no extra organizations behind', n = 1);

  select count(*) into n from public.invitations;
  perform pg_temp.check('suite left no invitations behind', n = 0);
end
$$;

\echo ''
\echo 'RLS + schema invariants: ALL CHECKS PASSED'
