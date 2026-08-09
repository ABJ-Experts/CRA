-- Atomic password-reset token consumption and session revocation.
-- Run through tests/run-sql-tests.sh so every assertion is a CI gate.
\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
  returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'atomic password-reset RPC exists',
  to_regprocedure('public.consume_password_reset(text)') is not null
);

select pg_temp.check(
  'atomic password-reset RPC is service-role only',
  has_function_privilege(
    'service_role', 'public.consume_password_reset(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.consume_password_reset(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.consume_password_reset(text)', 'EXECUTE'
  )
);

begin;
do $$
declare
  v_auth_user uuid;
  v_success_user uuid;
  v_expired_user uuid;
  v_missing_profile_user uuid;
  v_consumed_user uuid;
  v_before_epoch timestamptz;
  v_expired_epoch timestamptz;
  v_after_epoch timestamptz;
  v_consumed_epoch timestamptz;
  v_result record;
begin
  select auth_user_id into v_auth_user
    from public.users
   where email = 'member@cra.test';

  insert into public.users (auth_user_id, email, session_epoch_at)
  values (
    v_auth_user, 'reset-success@cra.test', now() - interval '1 day'
  ) returning id, session_epoch_at into v_success_user, v_before_epoch;
  insert into public.users (email, session_epoch_at)
  values ('reset-expired@cra.test', now() - interval '1 day')
  returning id, session_epoch_at into v_expired_user, v_expired_epoch;
  insert into public.users (email, session_epoch_at)
  values ('reset-profile-missing@cra.test', now() - interval '1 day')
  returning id into v_missing_profile_user;
  insert into public.users (auth_user_id, email, session_epoch_at)
  values (
    v_auth_user, 'reset-consumed@cra.test', now() - interval '1 day'
  ) returning id, session_epoch_at into v_consumed_user, v_consumed_epoch;

  insert into public.auth_recovery_tokens (
    user_id, token_hash, expires_at
  ) values (
    v_success_user, repeat('1', 64), now() + interval '10 minutes'
  );
  insert into public.auth_recovery_tokens (
    user_id, token_hash, expires_at
  ) values (
    v_expired_user, repeat('2', 64), now() - interval '1 second'
  );
  insert into public.auth_recovery_tokens (
    user_id, token_hash, expires_at
  ) values (
    v_missing_profile_user, repeat('3', 64), now() + interval '10 minutes'
  );
  insert into public.auth_recovery_tokens (
    user_id, token_hash, expires_at, consumed_at
  ) values (
    v_consumed_user, repeat('4', 64), now() + interval '10 minutes', now()
  );

  select * into v_result
    from public.consume_password_reset('raw-token');
  perform pg_temp.check(
    'malformed password-reset token is invalid',
    v_result.outcome = 'invalid'
    and v_result.user_id is null
    and v_result.auth_user_id is null
  );

  select * into v_result
    from public.consume_password_reset(repeat('f', 64));
  perform pg_temp.check(
    'unknown password-reset token is invalid',
    v_result.outcome = 'invalid'
    and v_result.user_id is null
    and v_result.auth_user_id is null
  );

  select * into v_result
    from public.consume_password_reset(repeat('4', 64));
  perform pg_temp.check(
    'consumed password-reset token is invalid and inert',
    v_result.outcome = 'invalid'
    and v_result.user_id is null
    and v_result.auth_user_id is null
    and (select session_epoch_at = v_consumed_epoch from public.users
          where id = v_consumed_user)
  );

  select * into v_result
    from public.consume_password_reset(repeat('2', 64));
  perform pg_temp.check(
    'expired password-reset token remains unconsumed and inert',
    v_result.outcome = 'expired'
    and v_result.user_id is null
    and v_result.auth_user_id is null
    and (select consumed_at is null from public.auth_recovery_tokens
          where token_hash = repeat('2', 64))
    and (select session_epoch_at = v_expired_epoch from public.users
          where id = v_expired_user)
  );

  select * into v_result
    from public.consume_password_reset(repeat('3', 64));
  perform pg_temp.check(
    'password-reset token without auth profile fails closed',
    v_result.outcome = 'profile_missing'
    and v_result.user_id is null
    and v_result.auth_user_id is null
    and (select consumed_at is null from public.auth_recovery_tokens
          where token_hash = repeat('3', 64))
  );

  select * into v_result
    from public.consume_password_reset(repeat('1', 64));
  select session_epoch_at into v_after_epoch
    from public.users where id = v_success_user;
  perform pg_temp.check(
    'password-reset token consumes and revokes sessions atomically',
    v_result.outcome = 'consumed'
    and v_result.user_id = v_success_user
    and v_result.auth_user_id = v_auth_user
    and (select consumed_at is not null from public.auth_recovery_tokens
          where token_hash = repeat('1', 64))
    and v_after_epoch > v_before_epoch
  );

  select * into v_result
    from public.consume_password_reset(repeat('1', 64));
  perform pg_temp.check(
    'password-reset token cannot be replayed',
    v_result.outcome = 'invalid'
    and v_result.user_id is null
    and v_result.auth_user_id is null
    and (select session_epoch_at = v_after_epoch from public.users
          where id = v_success_user)
  );
end
$$;
rollback;

select 'Password reset atomicity: ALL CHECKS PASSED' as result;
