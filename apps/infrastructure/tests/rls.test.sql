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

  select count(*) into n
    from public.organizations organizations
    left join public.organization_permissions_version versions
      on versions.organization_id = organizations.id
   where versions.organization_id is null;
  perform pg_temp.check('every organization has a permissions version', n = 0);

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
-- 8. Atomic invitation acceptance.
-- ---------------------------------------------------------------------------
select pg_temp.check(
  'atomic invitation RPC exists',
  to_regprocedure('public.accept_invitation_atomic(text,uuid,text)') is not null
);

select pg_temp.check(
  'atomic invitation RPC is service-role only',
  has_function_privilege(
    'service_role',
    'public.accept_invitation_atomic(text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.accept_invitation_atomic(text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.accept_invitation_atomic(text,uuid,text)',
    'EXECUTE'
  )
);

select pg_temp.check(
  'atomic invitation revoke RPC exists',
  to_regprocedure(
    'public.revoke_invitation_atomic(uuid,uuid,uuid,text)'
  ) is not null
);

select pg_temp.check(
  'atomic invitation revoke RPC is service-role only',
  has_function_privilege(
    'service_role',
    'public.revoke_invitation_atomic(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.revoke_invitation_atomic(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.revoke_invitation_atomic(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
);

begin;
do $$
declare
  v_org uuid;
  v_user uuid;
  v_corrupt_user uuid;
  v_owner uuid;
  v_seeded_member uuid;
  v_invitation uuid;
  v_accepted_invitation uuid;
  v_revoke_invitation uuid;
  v_result record;
  v_outcome text;
begin
  select id into v_org from public.organizations where slug = 'cra';
  select id into v_owner from public.users where email = 'owner@cra.test';
  select id into v_seeded_member from public.users where email = 'member@cra.test';
  insert into public.users (email)
  values ('atomic-invitee@cra.test')
  returning id into v_user;
  insert into public.users (email)
  values ('corrupt-accepted@cra.test')
  returning id into v_corrupt_user;

  insert into public.invitations (
    organization_id, email, role, token_hash, expires_at
  ) values (
    v_org, 'atomic-invitee@cra.test', 'member', repeat('a', 64),
    now() - interval '1 minute'
  );
  select * into v_result
    from public.accept_invitation_atomic(
      repeat('a', 64), v_user, 'atomic-invitee@cra.test'
    );
  perform pg_temp.check('expired invitation is rejected', v_result.outcome = 'expired');
  perform pg_temp.check(
    'expired invitation is durably marked expired',
    (select status = 'expired' from public.invitations where token_hash = repeat('a', 64))
  );

  insert into public.invitations (
    organization_id, email, role, token_hash, status, expires_at, revoked_at
  ) values (
    v_org, 'atomic-invitee@cra.test', 'member', repeat('b', 64), 'revoked',
    now() + interval '1 day', now()
  );
  select * into v_result
    from public.accept_invitation_atomic(
      repeat('b', 64), v_user, 'atomic-invitee@cra.test'
    );
  perform pg_temp.check('revoked invitation is not pending', v_result.outcome = 'not_pending');

  insert into public.invitations (
    organization_id, email, role, token_hash, expires_at
  ) values (
    v_org, 'atomic-invitee@cra.test', 'admin', repeat('c', 64),
    now() + interval '1 day'
  ) returning id into v_invitation;
  v_accepted_invitation := v_invitation;

  select * into v_result
    from public.accept_invitation_atomic(
      repeat('f', 64), v_user, 'atomic-invitee@cra.test'
    );
  perform pg_temp.check('unknown invitation hash is not found', v_result.outcome = 'not_found');

  select * into v_result
    from public.accept_invitation_atomic(
      'not-a-sha256', v_user, 'atomic-invitee@cra.test'
    );
  perform pg_temp.check('malformed invitation hash is not found', v_result.outcome = 'not_found');

  select * into v_result
    from public.accept_invitation_atomic(
      repeat('c', 64), gen_random_uuid(), 'atomic-invitee@cra.test'
    );
  perform pg_temp.check('missing invitation user is rejected', v_result.outcome = 'user_not_found');

  select * into v_result
    from public.accept_invitation_atomic(
      repeat('c', 64), v_user, 'wrong@cra.test'
    );
  perform pg_temp.check('invitation email mismatch is rejected', v_result.outcome = 'email_mismatch');

  select * into v_result
    from public.accept_invitation_atomic(
      repeat('c', 64), v_user, '  Atomic-Invitee@CRA.test  '
    );
  perform pg_temp.check('pending invitation is accepted', v_result.outcome = 'accepted');
  perform pg_temp.check(
    'accepted invitation returns its organization',
    v_result.invitation_id = v_invitation
    and v_result.organization_id = v_org
    and v_result.organization_name = 'CRA'
    and v_result.organization_slug = 'cra'
  );
  perform pg_temp.check(
    'acceptance creates exactly one membership with the invited role',
    (select count(*) = 1 and max(role) = 'admin'
       from public.organization_members
      where organization_id = v_org and user_id = v_user)
  );
  perform pg_temp.check(
    'acceptance records its timestamp',
    (select status = 'accepted' and accepted_at is not null
       from public.invitations where id = v_invitation)
  );
  perform pg_temp.check(
    'acceptance writes exactly one audit row',
    (select count(*) = 1
       from public.audit_logs
      where action = 'invitation.accepted'
        and entity_id = v_invitation::text
        and organization_id = v_org
        and user_id = v_user)
  );

  select * into v_result
    from public.accept_invitation_atomic(
      repeat('c', 64), v_user, 'atomic-invitee@cra.test'
    );
  perform pg_temp.check('second acceptance is idempotent', v_result.outcome = 'already_accepted');
  perform pg_temp.check(
    'idempotent acceptance does not duplicate effects',
    (select count(*) = 1 from public.organization_members
      where organization_id = v_org and user_id = v_user)
    and
    (select count(*) = 1 from public.audit_logs
      where action = 'invitation.accepted' and entity_id = v_invitation::text)
  );

  insert into public.invitations (
    organization_id, email, token_hash, status, expires_at, accepted_at
  ) values (
    v_org, 'corrupt-accepted@cra.test', repeat('d', 64), 'accepted',
    now() + interval '1 day', now()
  );
  select * into v_result
    from public.accept_invitation_atomic(
      repeat('d', 64), v_corrupt_user, 'corrupt-accepted@cra.test'
    );
  perform pg_temp.check(
    'accepted invitation without membership fails closed',
    v_result.outcome = 'not_pending'
  );

  insert into public.invitations (
    organization_id, email, role, token_hash, expires_at
  ) values (
    v_org, 'member@cra.test', 'viewer', repeat('e', 64),
    now() + interval '1 day'
  ) returning id into v_invitation;
  select * into v_result
    from public.accept_invitation_atomic(
      repeat('e', 64), v_seeded_member, 'member@cra.test'
    );
  perform pg_temp.check(
    'accepting as an existing member does not duplicate membership',
    v_result.outcome = 'accepted'
    and (select count(*) = 1 from public.organization_members
          where organization_id = v_org and user_id = v_seeded_member)
    and (select count(*) = 1 from public.audit_logs
          where action = 'invitation.accepted' and entity_id = v_invitation::text)
  );

  insert into public.invitations (
    organization_id, email, role, token_hash, expires_at
  ) values (
    v_org, 'revoke-me@cra.test', 'member', repeat('9', 64),
    now() + interval '1 day'
  ) returning id into v_revoke_invitation;

  select public.revoke_invitation_atomic(
    v_org, gen_random_uuid(), v_owner, 'owner@cra.test'
  ) into v_outcome;
  perform pg_temp.check('missing invitation cannot be revoked', v_outcome = 'not_found');

  select public.revoke_invitation_atomic(
    gen_random_uuid(), v_revoke_invitation, v_owner, 'owner@cra.test'
  ) into v_outcome;
  perform pg_temp.check('cross-organization revoke is rejected', v_outcome = 'wrong_organization');

  select public.revoke_invitation_atomic(
    v_org, v_revoke_invitation, gen_random_uuid(), 'owner@cra.test'
  ) into v_outcome;
  perform pg_temp.check('missing revoke actor is rejected', v_outcome = 'actor_not_found');

  select public.revoke_invitation_atomic(
    v_org, v_revoke_invitation, v_owner, 'not-owner@cra.test'
  ) into v_outcome;
  perform pg_temp.check('revoke actor email mismatch is rejected', v_outcome = 'actor_email_mismatch');

  select public.revoke_invitation_atomic(
    v_org, v_accepted_invitation, v_owner, 'owner@cra.test'
  ) into v_outcome;
  perform pg_temp.check('accepted invitation cannot be revoked', v_outcome = 'already_accepted');

  select public.revoke_invitation_atomic(
    v_org, v_revoke_invitation, v_owner, '  Owner@CRA.test  '
  ) into v_outcome;
  perform pg_temp.check('pending invitation is revoked', v_outcome = 'revoked');
  perform pg_temp.check(
    'revocation records status and one audit row atomically',
    (select status = 'revoked' and revoked_at is not null
       from public.invitations where id = v_revoke_invitation)
    and
    (select count(*) = 1 from public.audit_logs
      where action = 'invitation.revoked'
        and entity_id = v_revoke_invitation::text
        and user_id = v_owner)
  );

  select public.revoke_invitation_atomic(
    v_org, v_revoke_invitation, v_owner, 'owner@cra.test'
  ) into v_outcome;
  perform pg_temp.check('second revocation is not replayed', v_outcome = 'not_pending');
  perform pg_temp.check(
    'second revocation does not duplicate its audit row',
    (select count(*) = 1 from public.audit_logs
      where action = 'invitation.revoked'
        and entity_id = v_revoke_invitation::text)
  );
end
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 9. menu_permissions exclusive arc.
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
-- 10. Login lockout, including the sliding window.
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
-- 11. The suite must leave NOTHING behind. Anything it granted or inserted
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
