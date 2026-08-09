-- Accepting an invitation changes membership, invitation lifecycle, and audit
-- state. Keep those effects behind one row lock and one database transaction so
-- a retry cannot observe or create a partially accepted invitation.
create or replace function public.accept_invitation_atomic(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
returns table (
  outcome text,
  invitation_id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_invitation public.invitations%rowtype;
  v_org public.organizations%rowtype;
  v_user public.users%rowtype;
  v_email text := lower(btrim(p_email));
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query
      select 'not_found'::text, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;

  select invitations.*
    into v_invitation
    from public.invitations invitations
   where invitations.token_hash = p_token_hash
   for update;

  if not found then
    return query
      select 'not_found'::text, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;

  select organizations.*
    into v_org
    from public.organizations organizations
   where organizations.id = v_invitation.organization_id;

  if not found then
    return query
      select 'organization_not_found'::text, v_invitation.id,
        v_invitation.organization_id, null::text, null::text;
    return;
  end if;

  select users.*
    into v_user
    from public.users users
   where users.id = p_user_id;

  if not found then
    return query
      select 'user_not_found'::text, v_invitation.id,
        v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  if v_email is null
     or v_email = ''
     or v_email is distinct from lower(btrim(v_user.email))
     or v_email is distinct from lower(btrim(v_invitation.email)) then
    return query
      select 'email_mismatch'::text, v_invitation.id,
        v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  if v_invitation.status = 'accepted' then
    if exists (
      select 1
        from public.organization_members members
       where members.organization_id = v_invitation.organization_id
         and members.user_id = p_user_id
    ) then
      return query
        select 'already_accepted'::text, v_invitation.id,
          v_org.id, v_org.name, v_org.slug;
    else
      -- An accepted row without its membership is corrupted. Do not recreate
      -- effects or claim idempotent success because the original audit trail
      -- and role assignment can no longer be trusted.
      return query
        select 'not_pending'::text, v_invitation.id,
          v_org.id, v_org.name, v_org.slug;
    end if;
    return;
  end if;

  if v_invitation.status <> 'pending' then
    return query
      select 'not_pending'::text, v_invitation.id,
        v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  if v_invitation.expires_at < now() then
    update public.invitations invitations
       set status = 'expired'
     where invitations.id = v_invitation.id;
    return query
      select 'expired'::text, v_invitation.id,
        v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invitation.organization_id, p_user_id, v_invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.invitations invitations
     set status = 'accepted', accepted_at = now()
   where invitations.id = v_invitation.id;

  insert into public.audit_logs (
    organization_id, user_id, actor_email, action, entity_type, entity_id
  ) values (
    v_invitation.organization_id, p_user_id, v_email,
    'invitation.accepted', 'invitation', v_invitation.id::text
  );

  return query
    select 'accepted'::text, v_invitation.id,
      v_org.id, v_org.name, v_org.slug;
end;
$$;

alter function public.accept_invitation_atomic(text, uuid, text)
  owner to postgres;
revoke all on function public.accept_invitation_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_invitation_atomic(text, uuid, text)
  to service_role;

-- Revocation must take the same row lock as acceptance. An unlocked
-- read-then-update can observe `pending`, wait for acceptance to commit, and
-- then overwrite the invitation to `revoked` while leaving its membership and
-- acceptance audit behind.
create or replace function public.revoke_invitation_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_actor_email text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.invitations%rowtype;
  v_actor public.users%rowtype;
  v_actor_email text := lower(btrim(p_actor_email));
begin
  select invitations.*
    into v_invitation
    from public.invitations invitations
   where invitations.id = p_invitation_id
   for update;

  if not found then
    return 'not_found';
  end if;

  if v_invitation.organization_id is distinct from p_organization_id then
    return 'wrong_organization';
  end if;

  select users.*
    into v_actor
    from public.users users
   where users.id = p_actor_user_id;

  if not found then
    return 'actor_not_found';
  end if;

  if v_actor_email is null
     or v_actor_email = ''
     or v_actor_email is distinct from lower(btrim(v_actor.email)) then
    return 'actor_email_mismatch';
  end if;

  if v_invitation.status = 'accepted' then
    return 'already_accepted';
  end if;

  if v_invitation.status <> 'pending' then
    return 'not_pending';
  end if;

  update public.invitations invitations
     set status = 'revoked', revoked_at = now()
   where invitations.id = v_invitation.id;

  insert into public.audit_logs (
    organization_id, user_id, actor_email, action, entity_type, entity_id
  ) values (
    v_invitation.organization_id, p_actor_user_id, v_actor_email,
    'invitation.revoked', 'invitation', v_invitation.id::text
  );

  return 'revoked';
end;
$$;

alter function public.revoke_invitation_atomic(uuid, uuid, uuid, text)
  owner to postgres;
revoke all on function public.revoke_invitation_atomic(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_invitation_atomic(uuid, uuid, uuid, text)
  to service_role;
