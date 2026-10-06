-- M13-01: invitation creation and its redacted event commit together.
-- Mail and onboarding-delivery evidence remain later, explicit effects.
create or replace function public.m13_01_create_invitation_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_role text,
  p_first_name text,
  p_last_name text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_correlation_id uuid,
  p_source_ip inet
) returns table(outcome text, invitation_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
  v_actor_email text;
  v_role text;
  v_custom_grant boolean := false;
  v_override boolean;
  v_invitation_id uuid;
  v_audit_outcome text;
begin
  if p_organization_id is null or p_actor_user_id is null
    or p_email is null or p_email <> v_email or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_role not in ('owner','admin','member','viewer')
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= now()
    or p_correlation_id is null
  then
    return query select 'forbidden'::text,null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.organizations o
    where o.id=p_organization_id and o.is_active
  ) then
    return query select 'organization_not_found'::text,null::uuid;
    return;
  end if;

  select u.email,m.role into v_actor_email,v_role
  from public.organization_members m
  join public.users u on u.id=m.user_id and u.is_active
  where m.organization_id=p_organization_id and m.user_id=p_actor_user_id;
  if not found then
    return query select 'forbidden'::text,null::uuid;
    return;
  end if;

  select coalesce(bool_or((r.permissions->>'can_create_invitations')::boolean),false)
    into v_custom_grant
  from public.user_role_assignments a
  join public.custom_roles r on r.id=a.role_id and r.organization_id=p_organization_id
  where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and r.is_active and not r.is_deleted
    and jsonb_typeof(r.permissions->'can_create_invitations')='boolean'
    and (r.permissions->>'can_create_invitations')::boolean;

  select case when jsonb_typeof(o.permissions->'can_create_invitations')='boolean'
      then (o.permissions->>'can_create_invitations')::boolean else null end
    into v_override
  from public.base_role_permission_overrides o
  where o.organization_id=p_organization_id and o.base_role=v_role;

  if not coalesce(v_override,v_role in ('owner','admin') or v_custom_grant,false) then
    return query select 'forbidden'::text,null::uuid;
    return;
  end if;
  if v_email=lower(btrim(v_actor_email)) then
    return query select 'cannot_invite_self'::text,null::uuid;
    return;
  end if;

  -- Serialize same-recipient creation so a concurrent retry gets a semantic
  -- pending outcome rather than an unhelpful unique-index error.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_email,0));
  if exists (
    select 1 from public.users u
    join public.organization_members m on m.user_id=u.id
    where u.email=v_email and m.organization_id=p_organization_id
  ) then
    return query select 'already_member'::text,null::uuid;
    return;
  end if;
  if exists (
    select 1 from public.invitations i
    where i.organization_id=p_organization_id and i.email=v_email and i.status='pending'
  ) then
    return query select 'invitation_pending'::text,null::uuid;
    return;
  end if;

  begin
    insert into public.invitations(
      organization_id,invited_by,email,role,first_name,last_name,token_hash,expires_at
    ) values (
      p_organization_id,p_actor_user_id,v_email,p_role,p_first_name,p_last_name,
      p_token_hash,p_expires_at
    ) returning id into v_invitation_id;
  exception when unique_violation then
    if exists (
      select 1 from public.invitations i
      where i.organization_id=p_organization_id and i.email=v_email and i.status='pending'
    ) then
      return query select 'invitation_pending'::text,null::uuid;
      return;
    end if;
    raise;
  end;

  select a.outcome into v_audit_outcome
  from public.m13_01_append_audit_event(
    p_organization_id,'organization','invitation.create:'||v_invitation_id::text,
    'user',p_actor_user_id::text,'invitation.created','invitation',
    v_invitation_id::text,'completed',p_correlation_id,null,
    jsonb_build_object('role',p_role,'status','pending'),null,
    p_source_ip,null,p_actor_user_id
  ) a;
  if v_audit_outcome <> 'inserted' then
    raise exception 'invitation audit conflict' using errcode='23505';
  end if;

  return query select 'created'::text,v_invitation_id;
end $$;

alter function public.m13_01_create_invitation_atomic(uuid,uuid,text,text,text,text,text,timestamptz,uuid,inet) owner to postgres;
revoke all on function public.m13_01_create_invitation_atomic(uuid,uuid,text,text,text,text,text,timestamptz,uuid,inet) from public,anon,authenticated;
grant execute on function public.m13_01_create_invitation_atomic(uuid,uuid,text,text,text,text,text,timestamptz,uuid,inet) to service_role;
