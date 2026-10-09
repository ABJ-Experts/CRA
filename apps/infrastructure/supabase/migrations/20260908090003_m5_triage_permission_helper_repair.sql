-- Repair the private helper surface for databases that ran the original M5-04
-- migration before its helper definitions were finalized.
create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_key text
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role
    from public.organization_members member
    join public.users user_record
      on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization
      on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role,
      case p_permission_key
        when 'can_edit_findings' then role in ('owner', 'admin')
        when 'can_edit_organization' then role = 'owner'
        else false
      end as granted
    from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership
    join public.user_role_assignments assignment
      on assignment.organization_id = p_organization_id
      and assignment.user_id = p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id = p_organization_id
      and custom_role.id = assignment.role_id
    where custom_role.is_active
      and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key) = 'boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case
      when jsonb_typeof(permission_override.permissions -> p_permission_key) = 'boolean'
        then (permission_override.permissions ->> p_permission_key)::boolean
    end as granted
    from base_permissions base_permission
    left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id = p_organization_id
      and permission_override.base_role = base_permission.role
  )
  select coalesce(
    (select granted from override_permissions where granted is not null limit 1),
    (
      select coalesce(base_permissions.granted, false)
        or coalesce(custom_permissions.granted, false)
      from base_permissions cross join custom_permissions
    ),
    false
  )
$$;

create or replace function public.m5_triage_actor_can_edit_findings(
  p_organization_id uuid,
  p_actor_user_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.m5_triage_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'can_edit_findings'
  )
$$;

alter function public.m5_triage_actor_has_permission(uuid, uuid, text)
  owner to postgres;
alter function public.m5_triage_actor_can_edit_findings(uuid, uuid)
  owner to postgres;
revoke all on function public.m5_triage_actor_has_permission(uuid, uuid, text),
  public.m5_triage_actor_can_edit_findings(uuid, uuid)
  from public, anon, authenticated;
