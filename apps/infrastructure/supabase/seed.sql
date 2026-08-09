-- =============================================================================
-- Local development seed.
-- =============================================================================
-- `config.toml` has always pointed [db.seed] at ./seed.sql; until now the file
-- did not exist, so every `supabase db reset` printed
-- "WARN: no files matched pattern: supabase/seed.sql".
--
-- Creates one organization and four real, signable accounts — one per base role
-- — so the RBAC surface can be exercised end to end without clicking through
-- sign-up four times.
--
-- Everything is idempotent (`on conflict do nothing`) so re-running is safe.
--
-- Passwords are bcrypt via pgcrypto, which lives in the `extensions` schema on
-- Supabase, hence the qualified calls. The profile rows are NOT inserted here:
-- the on_auth_user_created trigger creates them, which means this seed also
-- serves as a live test that the trigger works on a clean database.
--
--   owner@cra.test / admin@cra.test / member@cra.test / viewer@cra.test
--   password for all four: Password123
-- =============================================================================

do $$
declare
  v_org_id  uuid := '00000000-0000-0000-0000-0000000000ca';
  v_inst    uuid := '00000000-0000-0000-0000-000000000000';
  v_pw      text := extensions.crypt('Password123', extensions.gen_salt('bf'));
  v_role    text;
  v_email   text;
  v_auth_id uuid;
  v_user_id uuid;
begin
  insert into public.organizations (id, name, slug, size)
  values (v_org_id, 'CRA', 'cra', '1-10')
  on conflict (id) do nothing;

  foreach v_role in array array['owner', 'admin', 'member', 'viewer']
  loop
    v_email := v_role || '@cra.test';

    select id into v_auth_id from auth.users where email = v_email;

    if v_auth_id is null then
      v_auth_id := gen_random_uuid();

      /*
       * THE EMPTY STRINGS BELOW ARE LOAD-BEARING. Do not "tidy" them to NULL.
       *
       * GoTrue scans these columns into a Go `string`, which cannot hold NULL.
       * A seeded row that leaves them at their NULL default makes every sign-in
       * for that account fail with
       *
       *   error finding user: sql: Scan error on column index 3, name
       *   "confirmation_token": converting NULL to string is unsupported
       *
       * ...surfacing to the client as a plain 500, and to the user as "login is
       * broken" — while the row looks perfectly correct in psql. Accounts
       * created through the API never hit this because GoTrue writes '' itself;
       * only direct inserts like this one do.
       */
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change, email_change_token_new, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token,
        created_at, updated_at
      )
      values (
        v_auth_id, v_inst, 'authenticated', 'authenticated', v_email, v_pw,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'first_name', initcap(v_role),
          'last_name',  'Account',
          'username',   v_role
        ),
        '', '',
        '', '', '',
        '', '', '',
        now(), now()
      );
    end if;

    -- Created by the on_auth_user_created trigger.
    select id into v_user_id from public.users where email = v_email;

    insert into public.organization_members (organization_id, user_id, role)
    values (v_org_id, v_user_id, v_role)
    on conflict (organization_id, user_id) do nothing;
  end loop;

  -- Seed accounts represent established team members, not sign-up candidates.
  -- The API's server-side verification gate must therefore treat them as
  -- already verified on both a fresh reset and an idempotent seed rerun.
  update public.users
     set email_verified_at = coalesce(email_verified_at, now())
   where email in (
     'owner@cra.test', 'admin@cra.test', 'member@cra.test', 'viewer@cra.test'
   );

  -- A custom role demonstrating the additive-only rule: it grants an export
  -- capability that `viewer` does not have, and nothing else. Assigning it must
  -- not confer anything beyond that one key.
  insert into public.custom_roles (organization_id, name, description, color, base_role, permissions, is_system)
  values (
    v_org_id,
    'Report Reader',
    'Adds order and invoice export on top of whatever the base role already allows.',
    '#4A50D6',
    'viewer',
    '{"can_export_orders": true, "can_export_invoices": true}'::jsonb,
    false
  )
  on conflict do nothing;
end
$$;
