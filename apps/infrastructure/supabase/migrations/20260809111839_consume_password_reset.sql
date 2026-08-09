-- Consume the credential and revoke existing access-token epochs before the
-- API calls the external identity provider. A provider failure can require a
-- new reset request, but the credential can never be replayed.
create or replace function public.consume_password_reset(p_token_hash text)
returns table (
  outcome text,
  user_id uuid,
  auth_user_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_token public.auth_recovery_tokens%rowtype;
  v_user public.users%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  select tokens.*
    into v_token
    from public.auth_recovery_tokens tokens
   where tokens.token_hash = p_token_hash
   for update;

  if not found or v_token.consumed_at is not null then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_token.expires_at < now() then
    return query select 'expired'::text, null::uuid, null::uuid;
    return;
  end if;

  select users.*
    into v_user
    from public.users users
   where users.id = v_token.user_id
   for update;

  if not found or v_user.auth_user_id is null then
    return query select 'profile_missing'::text, null::uuid, null::uuid;
    return;
  end if;

  update public.auth_recovery_tokens tokens
     set consumed_at = now()
   where tokens.id = v_token.id;

  update public.users users
     set session_epoch_at = now(), updated_at = now()
   where users.id = v_user.id;

  return query
    select 'consumed'::text, v_user.id, v_user.auth_user_id;
end;
$$;

alter function public.consume_password_reset(text) owner to postgres;
revoke all on function public.consume_password_reset(text)
  from public, anon, authenticated;
grant execute on function public.consume_password_reset(text)
  to service_role;
