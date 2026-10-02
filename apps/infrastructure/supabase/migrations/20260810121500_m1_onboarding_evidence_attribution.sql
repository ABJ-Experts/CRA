-- Preserve the actor and time of the authoritative event that makes evidence
-- available again. The M1 base migration is amended for clean installations;
-- this replacement brings already-migrated databases to the same behavior.

create or replace function public.record_organization_onboarding_evidence_atomic(
  p_organization_id uuid,
  p_stage text,
  p_resource_id uuid,
  p_actor_user_id uuid,
  p_available boolean default true
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_stage not in ('first_product', 'first_sbom', 'invite_team') or p_resource_id is null then
    return query select 'invalid_evidence'::text;
    return;
  end if;

  if not exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id
    where members.organization_id = p_organization_id
      and members.user_id = p_actor_user_id
      and users.is_active
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  perform 1 from public.organization_onboarding onboarding
   where onboarding.organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  insert into public.organization_onboarding_evidence (
    organization_id, stage, resource_id, recorded_by, is_available, unavailable_at
  ) values (
    p_organization_id, p_stage, p_resource_id, p_actor_user_id, p_available,
    case when p_available then null else now() end
  )
  on conflict (organization_id, stage, resource_id) do update
    set recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at,
        is_available = excluded.is_available,
        unavailable_at = excluded.unavailable_at;

  perform public.reconcile_organization_onboarding(p_organization_id, p_actor_user_id);
  return query select 'recorded'::text;
end;
$$;

alter function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  owner to postgres;
revoke all on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  to service_role;

create or replace function public.record_invitation_delivery_onboarding_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_was_confirmed boolean := false;
begin
  if not exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id
    where members.organization_id = p_organization_id
      and members.user_id = p_actor_user_id
      and users.is_active
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  perform 1 from public.organization_onboarding onboarding
   where onboarding.organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  select delivery_confirmed_at is not null into v_was_confirmed
    from public.invitations invitations
   where invitations.id = p_invitation_id
     and invitations.organization_id = p_organization_id
   for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  update public.invitations
     set delivery_confirmed_at = now(),
         last_delivery_attempt_at = now(),
         delivery_attempts = greatest(delivery_attempts, 1)
   where id = p_invitation_id;

  insert into public.organization_onboarding_evidence (
    organization_id, stage, resource_id, recorded_by, is_available, unavailable_at
  ) values (
    p_organization_id, 'invite_team', p_invitation_id, p_actor_user_id, true, null
  )
  on conflict (organization_id, stage, resource_id) do update
    set recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at,
        is_available = true,
        unavailable_at = null;

  if not v_was_confirmed then
    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, changes
    ) values (
      p_organization_id, p_actor_user_id, 'invitation.delivery_confirmed',
      'invitation', p_invitation_id::text,
      jsonb_build_object('delivery', 'confirmed')
    );
  end if;
  perform public.reconcile_organization_onboarding(p_organization_id, p_actor_user_id);
  return query select 'recorded'::text;
end;
$$;

alter function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  to service_role;
