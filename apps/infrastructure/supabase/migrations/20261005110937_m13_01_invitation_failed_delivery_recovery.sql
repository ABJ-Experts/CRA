-- Cancel an unsent invitation only while its original token remains current.
-- If another resend or acceptance won the row lock, never revoke that work.
create or replace function public.m13_01_cancel_failed_invitation_delivery_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_token_hash text
) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_invitation public.invitations%rowtype;
  v_correlation_id uuid;
  v_audit_outcome text;
begin
  if p_organization_id is null or p_invitation_id is null
    or p_actor_user_id is null or p_token_hash !~ '^[0-9a-f]{64}$'
  then return 'not_found'; end if;

  select * into v_invitation from public.invitations i
  where i.organization_id=p_organization_id and i.id=p_invitation_id
  for update;
  if not found or v_invitation.invited_by is distinct from p_actor_user_id then
    return 'not_found';
  end if;
  if v_invitation.status<>'pending' or v_invitation.token_hash<>p_token_hash then
    return 'changed';
  end if;

  update public.invitations i set status='revoked',revoked_at=now()
  where i.organization_id=p_organization_id and i.id=p_invitation_id;

  select a.correlation_id into v_correlation_id from public.audit_logs a
  where a.organization_id=p_organization_id
    and a.event_key='invitation.create:'||p_invitation_id::text
    and a.schema_version=2;
  if v_correlation_id is null then
    raise exception 'missing invitation creation event' using errcode='23514';
  end if;
  select a.outcome into v_audit_outcome from public.m13_01_append_audit_event(
    p_organization_id,'organization',
    'invitation.delivery_cancelled:'||p_invitation_id::text,
    'user',p_actor_user_id::text,'invitation.delivery_cancelled','invitation',
    p_invitation_id::text,'cancelled',v_correlation_id,
    jsonb_build_object('status','pending'),jsonb_build_object('status','revoked'),
    'notification_failed',null,null,p_actor_user_id
  ) a;
  if v_audit_outcome not in ('inserted','replayed') then
    raise exception 'invitation cancellation audit conflict' using errcode='23505';
  end if;
  return 'cancelled';
end $$;

alter function public.m13_01_cancel_failed_invitation_delivery_atomic(uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.m13_01_cancel_failed_invitation_delivery_atomic(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.m13_01_cancel_failed_invitation_delivery_atomic(uuid,uuid,uuid,text) to service_role;
