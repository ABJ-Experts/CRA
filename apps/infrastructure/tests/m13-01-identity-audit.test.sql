begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end $$;

select pg_temp.check('identity mutation RPCs are service-role only',
  to_regprocedure('public.m13_01_mutate_member_atomic(uuid,uuid,uuid,text,jsonb,text,text,uuid,inet)') is not null
  and to_regprocedure('public.m13_01_mutate_role_atomic(uuid,uuid,text,uuid,jsonb,integer,text,uuid,inet)') is not null
  and to_regprocedure('public.m13_01_update_profile_atomic(uuid,uuid,jsonb,text,uuid,inet)') is not null
  and not has_function_privilege('authenticated',
    'public.m13_01_mutate_member_atomic(uuid,uuid,uuid,text,jsonb,text,text,uuid,inet)','execute')
  and has_function_privilege('service_role',
    'public.m13_01_mutate_member_atomic(uuid,uuid,uuid,text,jsonb,text,text,uuid,inet)','execute'));

select pg_temp.check('audit JSON projector retains stable volatility',
  (select provolatile = 's' from pg_proc
    where oid = 'public.m13_01_project_v2_audit_json(jsonb)'::regprocedure));

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_member uuid;
  v_viewer uuid;
  v_admin uuid;
  v_other_org uuid;
  v_key uuid := gen_random_uuid();
  v_result jsonb;
  v_created jsonb;
  v_role uuid;
  v_role_version integer;
  v_create_key uuid := gen_random_uuid();
  v_update_key uuid := gen_random_uuid();
  v_override_key uuid := gen_random_uuid();
  v_delete_key uuid := gen_random_uuid();
  v_profile_key uuid := gen_random_uuid();
  v_create_payload jsonb;
  v_denied boolean := false;
begin
  select id into strict v_owner from public.users where email = 'owner@cra.test';
  select id into strict v_member from public.users where email = 'member@cra.test';
  select id into strict v_viewer from public.users where email = 'viewer@cra.test';
  select id into strict v_admin from public.users where email = 'admin@cra.test';
  select o.id into v_other_org from public.organizations o
    where o.id <> v_org and not exists (
      select 1 from public.organization_members m
      where m.organization_id = o.id and m.user_id = v_owner
    ) limit 1;
  perform pg_temp.check('owner starts with member-edit permission',
    public.m13_01_identity_actor_has_permission(v_org, v_owner, 'can_edit_users'));
  if v_other_org is not null then
    begin
      perform public.m13_01_mutate_member_atomic(
        v_other_org, v_owner, v_member, 'role', '{"role":"viewer"}'::jsonb,
        null, gen_random_uuid()::text, gen_random_uuid(), null);
    exception when insufficient_privilege then v_denied := true;
    end;
    perform pg_temp.check('tenant substitution is denied inside RPC', v_denied);
    v_denied := false;
  end if;

  v_result := public.m13_01_mutate_member_atomic(
    v_org, v_owner, v_member, 'role', '{"role":"viewer"}'::jsonb,
    'member', v_key::text, gen_random_uuid(), '127.0.0.1'::inet);
  perform pg_temp.check('role mutation and one v2 audit event commit together',
    v_result->>'status' = 'updated'
    and (select role = 'viewer' from public.organization_members
      where organization_id = v_org and user_id = v_member)
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and event_key = v_key::text
        and action = 'member.role_changed' and schema_version = 2));

  v_result := public.m13_01_mutate_member_atomic(
    v_org, v_owner, v_member, 'role', '{"role":"viewer"}'::jsonb,
    'member', v_key::text, gen_random_uuid(), null);
  perform pg_temp.check('same key and safe member payload replays without a second event',
    v_result->>'status' = 'replayed'
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and event_key = v_key::text));

  v_result := public.m13_01_mutate_member_atomic(
    v_org, v_owner, v_member, 'role', '{"role":"member"}'::jsonb,
    'viewer', v_key::text, gen_random_uuid(), null);
  perform pg_temp.check('same event key cannot mutate again',
    v_result->>'status' = 'conflict'
    and (select role = 'viewer' from public.organization_members
      where organization_id = v_org and user_id = v_member));

  v_result := public.m13_01_mutate_member_atomic(
    v_org, v_owner, v_member, 'role', '{"role":"admin"}'::jsonb,
    'member', gen_random_uuid()::text, gen_random_uuid(), null);
  perform pg_temp.check('stale expected role does not mutate',
    v_result->>'status' = 'conflict');

  insert into public.base_role_permission_overrides(
    organization_id, base_role, permissions
  ) values (v_org, 'owner', '{"can_edit_users":false}'::jsonb)
  on conflict (organization_id, base_role) do update
    set permissions = excluded.permissions;
  perform pg_temp.check('hard org override revokes owner member-edit grant',
    not public.m13_01_identity_actor_has_permission(v_org, v_owner, 'can_edit_users'));
  begin
    perform public.m13_01_mutate_member_atomic(
      v_org, v_owner, v_member, 'role', '{"role":"member"}'::jsonb,
      'viewer', gen_random_uuid()::text, gen_random_uuid(), null);
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.check('revoked actor cannot commit member change', v_denied);
  delete from public.base_role_permission_overrides
    where organization_id = v_org and base_role = 'owner';

  v_create_payload := jsonb_build_object('name', 'Audit fixture ' || gen_random_uuid()::text,
      'description', 'Do not log my description', 'color', '#4A50D6',
      'baseRole', 'member', 'permissions', '{"can_view_users":true}'::jsonb);
  v_created := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'create', null, v_create_payload, null,
    v_create_key::text, gen_random_uuid(), null);
  v_role := (v_created->>'id')::uuid;
  select version into v_role_version from public.custom_roles where id = v_role;
  perform pg_temp.check('role create writes v2 event without raw description',
    v_created->>'status' = 'updated' and v_role is not null
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and entity_id = v_role::text and action = 'role.created' and schema_version = 2)
    and not exists (select 1 from public.audit_logs where organization_id = v_org
      and entity_id = v_role::text and action = 'role.created'
      and audit_logs::text like '%Do not log my description%'));
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'create', null, v_create_payload, null,
    v_create_key::text, gen_random_uuid(), null);
  perform pg_temp.check('role create retry returns original id once',
    v_result->>'status' = 'replayed' and (v_result->>'id')::uuid = v_role
    and (select count(*) = 1 from public.audit_logs where organization_id = v_org
      and event_key = v_create_key::text));
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'create', null,
    jsonb_set(v_create_payload, '{description}', '"different"'::jsonb), null,
    v_create_key::text, gen_random_uuid(), null);
  perform pg_temp.check('same create key with changed text conflicts',
    v_result->>'status' = 'conflict');

  update public.custom_roles set permissions = '{"can_edit_users":true}'::jsonb
    where id = v_role;
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'create', null, v_create_payload, null,
    v_create_key::text, gen_random_uuid(), null);
  perform pg_temp.check('create replay conflicts after independent source revision',
    v_result->>'status' = 'conflict');
  insert into public.user_role_assignments(organization_id, user_id, role_id)
    values (v_org, v_viewer, v_role)
    on conflict do nothing;
  perform pg_temp.check('active custom role adds an identity grant',
    public.m13_01_identity_actor_has_permission(v_org, v_viewer, 'can_edit_users'));
  select version into v_role_version from public.custom_roles where id = v_role;

  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'update', v_role, '{"isActive":false}'::jsonb,
    v_role_version,
    v_update_key::text, gen_random_uuid(), null);
  perform pg_temp.check('role update is audited',
    v_result->>'status' = 'updated'
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and entity_id = v_role::text and action = 'role.updated'));
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'update', v_role, '{"isActive":false}'::jsonb,
    v_role_version, v_update_key::text, gen_random_uuid(), null);
  perform pg_temp.check('same update key replays once',
    v_result->>'status' = 'replayed'
    and (select count(*) = 1 from public.audit_logs where organization_id = v_org
      and event_key = v_update_key::text));
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'update', v_role, '{"isActive":true}'::jsonb,
    v_role_version, v_update_key::text, gen_random_uuid(), null);
  perform pg_temp.check('changed update body under same key conflicts',
    v_result->>'status' = 'conflict');
  select version into v_role_version from public.custom_roles where id = v_role;
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'update', v_role, '{"name":"Revised independently"}'::jsonb,
    v_role_version, gen_random_uuid()::text, gen_random_uuid(), null);
  perform pg_temp.check('independent role edit succeeds', v_result->>'status' = 'updated');
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'update', v_role, '{"isActive":false}'::jsonb,
    v_role_version, v_update_key::text, gen_random_uuid(), null);
  perform pg_temp.check('old update key conflicts after independent source revision',
    v_result->>'status' = 'conflict');
  perform pg_temp.check('inactive custom role stops granting identity access',
    not public.m13_01_identity_actor_has_permission(v_org, v_viewer, 'can_edit_users'));

  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'update', v_role, '{"isActive":true}'::jsonb,
    v_role_version, gen_random_uuid()::text, gen_random_uuid(), null);
  perform pg_temp.check('stale role version cannot overwrite concurrent edit',
    v_result->>'status' = 'conflict');

  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'override', null,
    '{"baseRole":"viewer","permissions":{"can_view_users":false}}'::jsonb, null,
    v_override_key::text, gen_random_uuid(), null);
  perform pg_temp.check('hard permission override is audited',
    v_result->>'status' = 'updated'
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and entity_type = 'base_role' and entity_id = 'viewer'
      and action = 'permissions.override_updated'));
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'override', null,
    '{"baseRole":"viewer","permissions":{"can_view_users":false}}'::jsonb,
    null, v_override_key::text, gen_random_uuid(), null);
  perform pg_temp.check('same override key replays once',
    v_result->>'status' = 'replayed'
    and (select count(*) = 1 from public.audit_logs where organization_id = v_org
      and event_key = v_override_key::text));
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'override', null,
    '{"baseRole":"viewer","permissions":{"can_view_users":true}}'::jsonb,
    null, v_override_key::text, gen_random_uuid(), null);
  perform pg_temp.check('changed override body under same key conflicts',
    v_result->>'status' = 'conflict');
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'override', null,
    '{"baseRole":"viewer","permissions":{"can_view_users":true}}'::jsonb,
    null, gen_random_uuid()::text, gen_random_uuid(), null);
  perform pg_temp.check('independent override succeeds', v_result->>'status' = 'updated');
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'override', null,
    '{"baseRole":"viewer","permissions":{"can_view_users":false}}'::jsonb,
    null, v_override_key::text, gen_random_uuid(), null);
  perform pg_temp.check('old override key conflicts after independent revision',
    v_result->>'status' = 'conflict');

  select version into v_role_version from public.custom_roles where id = v_role;
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'delete', v_role, '{}'::jsonb,
    v_role_version, v_delete_key::text, gen_random_uuid(), null);
  perform pg_temp.check('role delete commits one event',
    v_result->>'status' = 'updated');
  v_result := public.m13_01_mutate_role_atomic(
    v_org, v_owner, 'delete', v_role, '{}'::jsonb,
    v_role_version, v_delete_key::text, gen_random_uuid(), null);
  perform pg_temp.check('same delete key replays after soft deletion',
    v_result->>'status' = 'replayed'
    and (select count(*) = 1 from public.audit_logs where organization_id = v_org
      and event_key = v_delete_key::text));

  v_result := public.m13_01_update_profile_atomic(
    v_org, v_owner, '{"first_name":"SECRET_CANARY_917"}'::jsonb,
    v_profile_key::text, gen_random_uuid(), null);
  perform pg_temp.check('profile change is audited without raw profile value',
    v_result->>'status' = 'updated'
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and user_id = v_owner and action = 'user.profile_updated'
      and schema_version = 2 and event_key = v_profile_key::text
      and after_redacted->>'fieldMask' = '1'
      and after_redacted->>'newVersion' ~ '^[0-9]+$')
    and not exists (select 1 from public.audit_logs where organization_id = v_org
      and user_id = v_owner and action = 'user.profile_updated'
      and audit_logs::text like '%SECRET_CANARY_917%'));
  v_result := public.m13_01_update_profile_atomic(
    v_org, v_owner, '{"first_name":"SECRET_CANARY_917"}'::jsonb,
    v_profile_key::text, gen_random_uuid(), null);
  perform pg_temp.check('lost profile response retries one completed event',
    v_result->>'status' = 'replayed'
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and event_key = v_profile_key::text));
  v_result := public.m13_01_update_profile_atomic(
    v_org, v_owner, '{"first_name":"CHANGED_CANARY_917"}'::jsonb,
    v_profile_key::text, gen_random_uuid(), null);
  perform pg_temp.check('changed profile body under the same key conflicts',
    v_result->>'status' = 'conflict');
  v_result := public.m13_01_update_profile_atomic(
    v_org, v_owner, '{"first_name":"CHANGED_CANARY_917"}'::jsonb,
    gen_random_uuid()::text, gen_random_uuid(), null);
  perform pg_temp.check('independent profile update succeeds',
    v_result->>'status' = 'updated');
  v_result := public.m13_01_update_profile_atomic(
    v_org, v_owner, '{"first_name":"SECRET_CANARY_917"}'::jsonb,
    v_profile_key::text, gen_random_uuid(), null);
  perform pg_temp.check('old profile key conflicts after another source revision',
    v_result->>'status' = 'conflict');

  v_denied := false;
  begin
    perform public.m13_01_mutate_member_atomic(
      v_org, v_admin, v_owner, 'role', '{"role":"viewer"}'::jsonb,
      'owner', gen_random_uuid()::text, gen_random_uuid(), null);
    set constraints enforce_last_owner_on_update immediate;
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.check('last owner remains protected by database trigger',
    v_denied and (select role = 'owner' from public.organization_members
      where organization_id = v_org and user_id = v_owner));
end $$;

create or replace function pg_temp.reject_m13_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'audit unavailable';
end $$;
create trigger m13_test_reject_audit
  before insert on public.audit_logs
  for each row when (new.schema_version = 2)
  execute function pg_temp.reject_m13_audit();

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_member uuid;
  v_failed boolean := false;
begin
  select id into strict v_owner from public.users where email = 'owner@cra.test';
  select id into strict v_member from public.users where email = 'member@cra.test';
  begin
    perform public.m13_01_mutate_member_atomic(
      v_org, v_owner, v_member, 'role', '{"role":"member"}'::jsonb,
      'viewer', gen_random_uuid()::text, gen_random_uuid(), null);
  exception when raise_exception then v_failed := true;
  end;
  perform pg_temp.check('audit outage rolls back member role update',
    v_failed and (select role = 'viewer' from public.organization_members
      where organization_id = v_org and user_id = v_member));
end $$;

rollback;
