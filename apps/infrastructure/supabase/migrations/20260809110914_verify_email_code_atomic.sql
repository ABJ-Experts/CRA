-- Verification has a strict per-code guessing budget. Lock the live signup
-- code so concurrent guesses cannot reuse the same attempt number, and commit
-- profile verification and credential consumption together.
create or replace function public.verify_email_code_atomic(
  p_user_id uuid,
  p_code_hash text,
  p_max_attempts integer default 5
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.auth_email_verifications%rowtype;
  v_user public.users%rowtype;
  v_max_attempts integer;
begin
  if p_max_attempts is null
     or p_max_attempts < 1
     or p_code_hash is null
     or p_code_hash !~ '^[0-9a-f]{64}$' then
    return 'missing';
  end if;
  v_max_attempts := least(p_max_attempts, 5);

  select verifications.*
    into v_code
    from public.auth_email_verifications verifications
   where verifications.user_id = p_user_id
     and verifications.purpose = 'signup'
     and verifications.consumed_at is null
   for update;

  if not found then
    return 'missing';
  end if;

  select users.*
    into v_user
    from public.users users
   where users.id = p_user_id
   for update;

  if not found
     or lower(btrim(v_user.email)) is distinct from lower(btrim(v_code.email)) then
    return 'missing';
  end if;

  if v_code.expires_at < now() then
    return 'expired';
  end if;

  if v_code.attempts >= v_max_attempts then
    return 'attempts_exhausted';
  end if;

  if v_code.code_hash <> p_code_hash then
    update public.auth_email_verifications verifications
       set attempts = verifications.attempts + 1
     where verifications.id = v_code.id;
    return 'invalid';
  end if;

  update public.users users
     set email_verified_at = now(), updated_at = now()
   where users.id = v_user.id;

  update public.auth_email_verifications verifications
     set consumed_at = now()
   where verifications.id = v_code.id;

  return 'verified';
end;
$$;

alter function public.verify_email_code_atomic(uuid, text, integer)
  owner to postgres;
revoke all on function public.verify_email_code_atomic(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.verify_email_code_atomic(uuid, text, integer)
  to service_role;
