-- Keep the private legacy helper outside the generated public RPC prefix. The
-- checked-in type normalizer identifies the public accept function by the next
-- alphabetic function marker and must not see a second return shape.
alter function public.accept_invitation_atomic_legacy_unchecked(text, uuid, text)
  rename to m1_accept_invitation_atomic_legacy_unchecked;

create or replace function public.accept_invitation_atomic(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
  returns table (
    outcome text, invitation_id uuid, organization_id uuid,
    organization_name text, organization_slug text
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_organization_id uuid;
begin
  select i.organization_id into v_organization_id
    from public.invitations i where i.token_hash = p_token_hash for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;
  perform 1 from public.organization_lifecycles l
   where l.organization_id = v_organization_id and l.status = 'active' for share;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;
  return query select * from public.m1_accept_invitation_atomic_legacy_unchecked(
    p_token_hash, p_user_id, p_email
  );
end;
$$;

alter function public.accept_invitation_atomic(text, uuid, text) owner to postgres;
revoke all on function public.accept_invitation_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_invitation_atomic(text, uuid, text) to service_role;
