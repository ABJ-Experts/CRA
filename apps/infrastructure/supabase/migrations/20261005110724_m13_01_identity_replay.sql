-- Freeze a source-row version with each role event so a retry can be checked
-- against current authorized state without persisting or hashing arbitrary
-- role names/descriptions. Later independent edits force an explicit conflict.
alter table public.base_role_permission_overrides
  add column if not exists version integer not null default 1;
alter table public.base_role_permission_overrides
  add constraint brpo_version_positive check (version > 0);

create or replace function public.m13_01_bump_override_version()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.version := old.version + 1;
  return new;
end $$;
create trigger m13_01_bump_override_version
  before update on public.base_role_permission_overrides
  for each row execute function public.m13_01_bump_override_version();
revoke all on function public.m13_01_bump_override_version()
  from public, anon, authenticated;

create or replace function public.m13_01_mutate_role_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation text,
  p_role_id uuid, p_payload jsonb, p_expected_version integer, p_event_key text,
  p_correlation_id uuid, p_source_ip inet
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_role public.custom_roles%rowtype;
  v_role_id uuid;
  v_base_role text;
  v_permissions jsonb;
  v_action text;
  v_entity_type text := 'custom_role';
  v_entity_id text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_audit_outcome text;
  v_prior public.audit_logs%rowtype;
  v_override public.base_role_permission_overrides%rowtype;
  v_new_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_event_key, 0));
  perform 1 from public.organization_permissions_version
  where organization_id = p_organization_id for update;
  if not found then raise exception 'organization_not_found' using errcode = '42501'; end if;
  if not public.m13_01_identity_actor_has_permission(
    p_organization_id, p_actor_user_id,
    case p_operation when 'create' then 'can_create_roles'
      when 'update' then 'can_edit_roles'
      when 'delete' then 'can_delete_roles'
      when 'override' then 'can_edit_organization' else '' end
  ) then
    raise exception 'actor_not_authorized' using errcode = '42501';
  end if;
  select * into v_prior from public.audit_logs
    where event_scope = 'organization' and organization_id = p_organization_id
      and event_key = p_event_key;
  if found then
    if v_prior.actor_id <> p_actor_user_id::text
       or coalesce(v_prior.after_redacted->>'newVersion','') !~ '^[0-9]{1,10}$' then
      return jsonb_build_object('status', 'conflict');
    end if;
    if p_operation = 'override'
       and v_prior.action = 'permissions.override_updated'
       and v_prior.entity_type = 'base_role'
       and v_prior.entity_id = p_payload->>'baseRole' then
      select * into v_override from public.base_role_permission_overrides
      where organization_id = p_organization_id and base_role = p_payload->>'baseRole';
      if found and v_override.version = (v_prior.after_redacted->>'newVersion')::integer
         and v_override.permissions = p_payload->'permissions' then
        return jsonb_build_object('status', 'replayed');
      end if;
    elsif p_operation in ('create','update','delete')
       and v_prior.action = ('role.' || (case p_operation when 'delete' then 'deleted'
         when 'create' then 'created' else 'updated' end))
       and v_prior.entity_type = 'custom_role'
       and v_prior.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and (p_operation = 'create' or v_prior.entity_id = p_role_id::text) then
      select * into v_role from public.custom_roles
      where organization_id = p_organization_id and id = v_prior.entity_id::uuid;
      if found and v_role.version = (v_prior.after_redacted->>'newVersion')::integer
         and ((p_operation = 'create' and not v_role.is_deleted
           and v_role.name = p_payload->>'name'
           and v_role.description is not distinct from p_payload->>'description'
           and v_role.color = p_payload->>'color'
           and v_role.base_role = p_payload->>'baseRole'
           and v_role.permissions = p_payload->'permissions')
         or (p_operation = 'update' and not v_role.is_deleted
           and (not p_payload ? 'name' or v_role.name = p_payload->>'name')
           and (not p_payload ? 'description' or v_role.description = p_payload->>'description')
           and (not p_payload ? 'color' or v_role.color = p_payload->>'color')
           and (not p_payload ? 'baseRole' or v_role.base_role = p_payload->>'baseRole')
           and (not p_payload ? 'permissions' or v_role.permissions = p_payload->'permissions')
           and (not p_payload ? 'isActive' or v_role.is_active = (p_payload->>'isActive')::boolean))
         or (p_operation = 'delete' and v_role.is_deleted)) then
        return jsonb_build_object('status', 'replayed', 'id', v_role.id);
      end if;
    end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_operation = 'create' then
    insert into public.custom_roles(
      organization_id, name, description, color, base_role, permissions
    ) values (
      p_organization_id, p_payload->>'name', p_payload->>'description',
      p_payload->>'color', p_payload->>'baseRole', p_payload->'permissions'
    ) returning id,version into v_role_id,v_new_version;
    v_action := 'role.created';
    v_after := jsonb_build_object('baseRole', p_payload->>'baseRole',
      'newVersion', v_new_version,
      'permissionKeys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
        from jsonb_object_keys(p_payload->'permissions') as key));
  elsif p_operation in ('update', 'delete') then
    select * into v_role from public.custom_roles
    where organization_id = p_organization_id and id = p_role_id
      and not is_deleted for update nowait;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if v_role.is_system then return jsonb_build_object('status', 'system'); end if;
    if p_expected_version is null or v_role.version <> p_expected_version then
      return jsonb_build_object('status', 'conflict');
    end if;
    v_role_id := v_role.id;
    v_before := jsonb_build_object('baseRole', v_role.base_role,
      'oldVersion', v_role.version,
      'isActive', v_role.is_active, 'permissions', v_role.permissions);
    if p_operation = 'update' then
      if p_payload = '{}'::jsonb then
        return jsonb_build_object('status', 'unchanged');
      end if;
      update public.custom_roles set
        name = coalesce(p_payload->>'name', name),
        description = coalesce(p_payload->>'description', description),
        color = coalesce(p_payload->>'color', color),
        base_role = coalesce(p_payload->>'baseRole', base_role),
        permissions = coalesce(p_payload->'permissions', permissions),
        is_active = coalesce((p_payload->>'isActive')::boolean, is_active)
      where id = v_role_id;
      select * into v_role from public.custom_roles where id = v_role_id;
      v_action := 'role.updated';
      v_after := jsonb_build_object('baseRole', v_role.base_role,
        'newVersion', v_role.version,
        'isActive', v_role.is_active, 'permissions', v_role.permissions,
        'changedFields', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
          from jsonb_object_keys(p_payload) as key));
    else
      update public.custom_roles set is_deleted = true,
        deleted_at = now(), deleted_by = p_actor_user_id, is_active = false
      where id = v_role_id;
      v_action := 'role.deleted';
      select version into v_new_version from public.custom_roles where id = v_role_id;
      v_after := jsonb_build_object('isDeleted', true, 'isActive', false,
        'newVersion', v_new_version);
    end if;
  elsif p_operation = 'override' then
    v_base_role := p_payload->>'baseRole';
    v_permissions := p_payload->'permissions';
    if v_base_role not in ('owner', 'admin', 'member', 'viewer')
       or jsonb_typeof(v_permissions) <> 'object' then
      raise exception 'invalid_role_override' using errcode = '22023';
    end if;
    select * into v_override from public.base_role_permission_overrides
    where organization_id = p_organization_id and base_role = v_base_role
    for update nowait;
    v_before := jsonb_build_object('oldVersion', coalesce(v_override.version, 0),
      'permissions', coalesce(v_override.permissions, '{}'::jsonb));
    if v_override.permissions = v_permissions then
      return jsonb_build_object('status', 'unchanged');
    end if;
    insert into public.base_role_permission_overrides(
      organization_id, base_role, permissions
    ) values (p_organization_id, v_base_role, v_permissions)
    on conflict (organization_id, base_role) do update
      set permissions = excluded.permissions;
    v_action := 'permissions.override_updated';
    v_entity_type := 'base_role';
    v_entity_id := v_base_role;
    select version into v_new_version from public.base_role_permission_overrides
      where organization_id = p_organization_id and base_role = v_base_role;
    v_after := jsonb_build_object('baseRole', v_base_role,
      'permissions', v_permissions, 'newVersion', v_new_version);
  else
    raise exception 'invalid_role_operation' using errcode = '22023';
  end if;

  v_entity_id := coalesce(v_entity_id, v_role_id::text);
  select outcome into v_audit_outcome from public.m13_01_append_audit_event(
    p_organization_id, 'organization', p_event_key, 'user', p_actor_user_id::text,
    v_action, v_entity_type, v_entity_id, 'completed', p_correlation_id,
    v_before, v_after, null, p_source_ip, null, p_actor_user_id
  );
  if v_audit_outcome <> 'inserted' then
    raise exception 'audit_event_conflict' using errcode = '23505';
  end if;
  return jsonb_build_object('status', 'updated', 'id', v_role_id);
end;
$$;

-- Reapply the permission-fenced member writer after the initial local expansion.
create or replace function public.m13_01_mutate_member_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_target_user_id uuid,
  p_operation text, p_payload jsonb, p_expected_role text,
  p_event_key text, p_correlation_id uuid, p_source_ip inet
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_member public.organization_members%rowtype;
  v_active boolean;
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_audit_outcome text;
  v_role text;
  v_prior public.audit_logs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_event_key, 0));
  perform 1 from public.organization_permissions_version
  where organization_id = p_organization_id for update;
  if not found then raise exception 'organization_not_found' using errcode = '42501'; end if;
  if not public.m13_01_identity_actor_has_permission(
    p_organization_id, p_actor_user_id,
    case when p_operation = 'remove' then 'can_delete_users' else 'can_edit_users' end
  ) then
    raise exception 'actor_not_authorized' using errcode = '42501';
  end if;
  select * into v_prior from public.audit_logs
    where event_scope = 'organization' and organization_id = p_organization_id
      and event_key = p_event_key;
  if found then
    if v_prior.actor_id = p_actor_user_id::text
       and v_prior.entity_type = 'user' and v_prior.entity_id = p_target_user_id::text
       and ((p_operation = 'role' and v_prior.action = 'member.role_changed'
             and v_prior.after_redacted->>'role' = p_payload->>'role')
         or (p_operation = 'remove' and v_prior.action = 'member.removed')
         or (p_operation = 'active'
             and v_prior.action = case when p_payload->>'isActive' = 'true'
               then 'member.reactivated' else 'member.deactivated' end
             and v_prior.after_redacted->>'isActive' = p_payload->>'isActive')) then
      return jsonb_build_object('status', 'replayed');
    end if;
    return jsonb_build_object('status', 'conflict');
  end if;
  select * into v_member from public.organization_members
  where organization_id = p_organization_id and user_id = p_target_user_id
  for update nowait;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_actor_user_id = p_target_user_id
     and (p_operation in ('role', 'remove')
          or (p_operation = 'active' and p_payload->>'isActive' = 'false')) then
    return jsonb_build_object('status', 'conflict');
  end if;
  if p_expected_role is not null and v_member.role <> p_expected_role then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_operation = 'role' then
    v_role := p_payload->>'role';
    if v_role not in ('owner', 'admin', 'member', 'viewer') or v_role is null then
      raise exception 'invalid_member_role' using errcode = '22023';
    end if;
    if v_member.role = v_role then
      return jsonb_build_object('status', 'unchanged');
    end if;
    update public.organization_members set role = v_role where id = v_member.id;
    v_action := 'member.role_changed';
    v_before := jsonb_build_object('role', v_member.role);
    v_after := jsonb_build_object('role', v_role);
  elsif p_operation = 'remove' then
    delete from public.organization_members where id = v_member.id;
    v_action := 'member.removed';
    v_before := jsonb_build_object('role', v_member.role, 'member', true);
    v_after := jsonb_build_object('member', false);
  elsif p_operation = 'active' then
    if jsonb_typeof(p_payload->'isActive') <> 'boolean' then
      raise exception 'invalid_member_active' using errcode = '22023';
    end if;
    select is_active into v_active from public.users
    where id = p_target_user_id for update nowait;
    if v_active = (p_payload->>'isActive')::boolean then
      return jsonb_build_object('status', 'unchanged');
    end if;
    update public.users set is_active = (p_payload->>'isActive')::boolean
    where id = p_target_user_id;
    v_action := case when (p_payload->>'isActive')::boolean
      then 'member.reactivated' else 'member.deactivated' end;
    v_before := jsonb_build_object('isActive', v_active);
    v_after := jsonb_build_object('isActive', (p_payload->>'isActive')::boolean);
  else
    raise exception 'invalid_member_operation' using errcode = '22023';
  end if;

  select outcome into v_audit_outcome from public.m13_01_append_audit_event(
    p_organization_id, 'organization', p_event_key, 'user', p_actor_user_id::text,
    v_action, 'user', p_target_user_id::text, 'completed', p_correlation_id,
    v_before, v_after, null, p_source_ip, null, p_actor_user_id
  );
  if v_audit_outcome <> 'inserted' then
    raise exception 'audit_event_conflict' using errcode = '23505';
  end if;
  return jsonb_build_object('status', 'updated');
end;
$$;
