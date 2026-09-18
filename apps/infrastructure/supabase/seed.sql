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
  v_org_id  uuid := '00000000-0000-4000-8000-0000000000ca';
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

  -- The default legal entity normally appears when the owner submits the
  -- organization's legal profile through onboarding (the
  -- ensure_default_legal_entity_for_profile trigger). The seed inserts the
  -- organization directly, so it must create the same row itself: the
  -- product registry and the integration suites expect every established
  -- organization to carry one active default entity.
  insert into public.organization_legal_entities (
    organization_id, identifier, display_name, legal_name,
    registered_address_line_1, registered_address_locality,
    registered_address_postal_code, registered_address_country,
    main_establishment_country, manufacturer_contact_name,
    manufacturer_contact_email, completion_status, status,
    is_default, created_by, updated_by
  )
  select
    v_org_id, 'default', 'CRA', 'CRA Seed Legal Entity',
    'Seed Plaza 1', 'Berlin', '10115', 'DE',
    'DE', 'CRA Owner', 'owner@cra.test',
    'complete', 'active',
    true, members.user_id, members.user_id
  from public.organization_members members
  where members.organization_id = v_org_id and members.role = 'owner'
  on conflict (organization_id) where is_default do nothing;

  -- Onboarding stages are normally initialized by the organization-creation
  -- RPC. The seed org never runs that flow, and the onboarding contract is a
  -- five-stage tuple, so a missing row set turns the read into a 500. Use
  -- the same pending-details backfill shape the migration applied to
  -- organizations that predate onboarding.
  insert into public.organization_onboarding (organization_id)
  values (v_org_id)
  on conflict (organization_id) do nothing;

  insert into public.organization_onboarding_stages (
    organization_id, stage, stage_order, status, block_reason
  )
  select
    v_org_id, stage_data.stage, stage_data.stage_order,
    stage_data.status, stage_data.block_reason
  from (
    values
      ('organization_details'::text, 1::smallint, 'pending'::text, null::text),
      ('first_product', 2, 'blocked', 'awaiting_prior_stage'),
      ('first_sbom', 3, 'blocked', 'awaiting_prior_stage'),
      ('invite_team', 4, 'blocked', 'awaiting_prior_stage'),
      ('completed', 5, 'blocked', 'awaiting_prior_stage')
  ) as stage_data(stage, stage_order, status, block_reason)
  on conflict (organization_id, stage) do nothing;

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
