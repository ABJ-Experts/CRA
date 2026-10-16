-- Member, custom-role, permission-override and profile changes share the
-- transaction with their authoritative v2 audit event. These service-role RPCs
-- always take verified organization scope first and are never browser grants.

alter table public.custom_roles
  add column if not exists version integer not null default 1;
alter table public.custom_roles
  add constraint custom_roles_version_positive check (version > 0);

create or replace function public.m13_01_bump_custom_role_version()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.version := old.version + 1;
  return new;
end $$;
create trigger m13_01_bump_custom_role_version
  before update on public.custom_roles
  for each row execute function public.m13_01_bump_custom_role_version();
revoke all on function public.m13_01_bump_custom_role_version()
  from public, anon, authenticated;

-- This subset mirrors the shared TS resolver for identity administration:
-- base-role grant, additive active custom roles, then a hard org override.
-- No action implication applies to these write keys. The version row lock in
-- each writer serializes this check with permission mutations and revocation.
create or replace function public.m13_01_identity_actor_has_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  with actor as (
    select m.role from public.organization_members m
    join public.users u on u.id = m.user_id and u.is_active
    join public.organizations o on o.id = m.organization_id and o.is_active
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
  ), grants as (
    select a.role,
      case when p_permission_key = 'can_edit_organization' then a.role = 'owner'
        when p_permission_key in ('can_edit_users','can_delete_users',
          'can_create_roles','can_edit_roles','can_delete_roles')
          then a.role in ('owner','admin') else false end as base_grant,
      exists (
        select 1 from public.user_role_assignments ura
        join public.custom_roles cr on cr.id = ura.role_id
          and cr.organization_id = p_organization_id
        where ura.organization_id = p_organization_id
          and ura.user_id = p_actor_user_id and cr.is_active and not cr.is_deleted
          and jsonb_typeof(cr.permissions->p_permission_key) = 'boolean'
          and (cr.permissions->>p_permission_key)::boolean
      ) as custom_grant
    from actor a
  )
  select coalesce((
    select case when jsonb_typeof(ov.permissions->p_permission_key) = 'boolean'
      then (ov.permissions->>p_permission_key)::boolean
      else g.base_grant or g.custom_grant end
    from grants g left join public.base_role_permission_overrides ov
      on ov.organization_id = p_organization_id and ov.base_role = g.role
  ), false)
$$;

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
    if p_operation = 'delete' and v_prior.actor_id = p_actor_user_id::text
       and v_prior.action = 'role.deleted' and v_prior.entity_id = p_role_id::text then
      return jsonb_build_object('status', 'replayed', 'id', p_role_id);
    end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_operation = 'create' then
    insert into public.custom_roles(
      organization_id, name, description, color, base_role, permissions
    ) values (
      p_organization_id, p_payload->>'name', p_payload->>'description',
      p_payload->>'color', p_payload->>'baseRole', p_payload->'permissions'
    ) returning id into v_role_id;
    v_action := 'role.created';
    v_after := jsonb_build_object('baseRole', p_payload->>'baseRole',
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
        'isActive', v_role.is_active, 'permissions', v_role.permissions,
        'changedFields', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
          from jsonb_object_keys(p_payload) as key));
    else
      update public.custom_roles set is_deleted = true,
        deleted_at = now(), deleted_by = p_actor_user_id, is_active = false
      where id = v_role_id;
      v_action := 'role.deleted';
      v_after := jsonb_build_object('isDeleted', true, 'isActive', false);
    end if;
  elsif p_operation = 'override' then
    v_base_role := p_payload->>'baseRole';
    v_permissions := p_payload->'permissions';
    if v_base_role not in ('owner', 'admin', 'member', 'viewer')
       or jsonb_typeof(v_permissions) <> 'object' then
      raise exception 'invalid_role_override' using errcode = '22023';
    end if;
    select permissions into v_before from public.base_role_permission_overrides
    where organization_id = p_organization_id and base_role = v_base_role
    for update nowait;
    v_before := coalesce(v_before, '{}'::jsonb);
    if v_before = v_permissions then
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
    v_after := v_permissions;
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

create or replace function public.m13_01_update_profile_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_patch jsonb,
  p_event_key text, p_correlation_id uuid, p_source_ip inet
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_fields jsonb;
  v_outcome text;
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_organization_id::text, 'security') || ':' || p_event_key, 0));
  if p_organization_id is not null then
    perform 1 from public.organization_permissions_version
    where organization_id = p_organization_id for update;
    if not found then raise exception 'organization_not_found' using errcode = '42501'; end if;
  end if;
  if exists (
    select 1 from public.audit_logs
    where event_scope = case when p_organization_id is null then 'security' else 'organization' end
      and organization_id is not distinct from p_organization_id
      and event_key = p_event_key
  ) then
    return jsonb_build_object('status', 'conflict');
  end if;
  if p_organization_id is not null and not exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.is_active
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
  ) then
    raise exception 'actor_not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['first_name','last_name','job_title','language'] <> '{}'::jsonb then
    raise exception 'invalid_profile_patch' using errcode = '22023';
  end if;
  if p_patch = '{}'::jsonb then
    return jsonb_build_object('status', 'unchanged');
  end if;
  if not exists (select 1 from public.users where id = p_actor_user_id and is_active for update nowait) then
    return jsonb_build_object('status', 'not_found');
  end if;
  update public.users set
    first_name = coalesce(p_patch->>'first_name', first_name),
    last_name = coalesce(p_patch->>'last_name', last_name),
    job_title = coalesce(p_patch->>'job_title', job_title),
    language = coalesce(p_patch->>'language', language)
  where id = p_actor_user_id;
  v_fields := (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
    from jsonb_object_keys(p_patch) as key);
  select outcome into v_outcome from public.m13_01_append_audit_event(
    p_organization_id,
    case when p_organization_id is null then 'security' else 'organization' end,
    p_event_key, 'user', p_actor_user_id::text, 'user.profile_updated',
    'user', p_actor_user_id::text, 'completed', p_correlation_id,
    jsonb_build_object('fields', v_fields), jsonb_build_object('fields', v_fields),
    null, p_source_ip, null, p_actor_user_id
  );
  if v_outcome <> 'inserted' then
    raise exception 'audit_event_conflict' using errcode = '23505';
  end if;
  return jsonb_build_object('status', 'updated');
end;
$$;

revoke all on function public.m13_01_identity_actor_has_permission(uuid,uuid,text),
  public.m13_01_mutate_member_atomic(uuid,uuid,uuid,text,jsonb,text,text,uuid,inet),
  public.m13_01_mutate_role_atomic(uuid,uuid,text,uuid,jsonb,integer,text,uuid,inet),
  public.m13_01_update_profile_atomic(uuid,uuid,jsonb,text,uuid,inet)
  from public, anon, authenticated;
grant execute on function public.m13_01_mutate_member_atomic(uuid,uuid,uuid,text,jsonb,text,text,uuid,inet),
  public.m13_01_mutate_role_atomic(uuid,uuid,text,uuid,jsonb,integer,text,uuid,inet),
  public.m13_01_update_profile_atomic(uuid,uuid,jsonb,text,uuid,inet)
  to service_role;
