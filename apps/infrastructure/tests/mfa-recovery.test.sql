-- Retryable MFA recovery saga invariants.
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
  'MFA recovery operation table exists',
  to_regclass('public.mfa_recovery_operations') is not null
);

select pg_temp.check(
  'MFA recovery RPCs exist',
  to_regprocedure('public.claim_mfa_recovery(uuid,text)') is not null
  and to_regprocedure(
    'public.mark_mfa_factors_removed(uuid,uuid)'
  ) is not null
  and to_regprocedure('public.complete_mfa_recovery(uuid,uuid)') is not null
  and to_regprocedure('public.fail_mfa_recovery(uuid,uuid,text)') is not null
  and to_regprocedure('public.get_mfa_recovery_status(uuid,uuid)') is not null
);

select pg_temp.check(
  'MFA recovery table has RLS and no public policies',
  (
    select relrowsecurity
      from pg_class
     where oid = 'public.mfa_recovery_operations'::regclass
  )
  and not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'mfa_recovery_operations'
  )
);

select pg_temp.check(
  'MFA recovery table is service-role only',
  has_table_privilege(
    'service_role', 'public.mfa_recovery_operations', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'anon', 'public.mfa_recovery_operations', 'SELECT'
  )
  and not has_table_privilege(
    'authenticated', 'public.mfa_recovery_operations', 'SELECT'
  )
);

select pg_temp.check(
  'MFA recovery RPCs are service-role only',
  has_function_privilege(
    'service_role', 'public.claim_mfa_recovery(uuid,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.mark_mfa_factors_removed(uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.complete_mfa_recovery(uuid,uuid)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.fail_mfa_recovery(uuid,uuid,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.get_mfa_recovery_status(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.claim_mfa_recovery(uuid,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.claim_mfa_recovery(uuid,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.mark_mfa_factors_removed(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.mark_mfa_factors_removed(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.complete_mfa_recovery(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.complete_mfa_recovery(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.fail_mfa_recovery(uuid,uuid,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.fail_mfa_recovery(uuid,uuid,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.get_mfa_recovery_status(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.get_mfa_recovery_status(uuid,uuid)', 'EXECUTE'
  )
);

select pg_temp.check(
  'MFA recovery operations cannot store raw code material',
  not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'mfa_recovery_operations'
       and column_name in ('code', 'raw_code', 'code_hash')
  )
);

begin;
do $$
declare
  v_auth_user uuid;
  v_other_auth_user uuid;
  v_user uuid;
  v_other_user uuid;
  v_missing_profile_user uuid;
  v_operation uuid;
  v_result record;
  v_transition text;
begin
  select auth_user_id into v_auth_user
    from public.users where email = 'member@cra.test';
  select auth_user_id into v_other_auth_user
    from public.users where email = 'admin@cra.test';

  insert into public.users (auth_user_id, email)
  values (v_auth_user, 'mfa-saga-user@cra.test')
  returning id into v_user;
  insert into public.users (auth_user_id, email)
  values (v_other_auth_user, 'mfa-saga-other@cra.test')
  returning id into v_other_user;
  insert into public.users (email)
  values ('mfa-saga-missing-profile@cra.test')
  returning id into v_missing_profile_user;

  insert into public.auth_mfa_recovery_codes (user_id, code_hash)
  values
    (v_user, repeat('1', 64)),
    (v_user, repeat('2', 64)),
    (v_user, repeat('3', 64)),
    (v_other_user, repeat('4', 64)),
    (v_missing_profile_user, repeat('5', 64));
  update public.auth_mfa_recovery_codes
     set consumed_at = now()
   where user_id = v_user and code_hash = repeat('3', 64);

  select * into v_result
    from public.claim_mfa_recovery(v_user, 'raw-code');
  perform pg_temp.check(
    'malformed MFA recovery code hash is invalid',
    v_result.outcome = 'invalid'
    and v_result.operation_id is null
    and v_result.auth_user_id is null
    and v_result.status is null
  );

  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('f', 64));
  perform pg_temp.check(
    'unknown MFA recovery code hash is invalid',
    v_result.outcome = 'invalid'
    and v_result.operation_id is null
  );

  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('3', 64));
  perform pg_temp.check(
    'consumed code without an operation is invalid',
    v_result.outcome = 'invalid'
    and v_result.operation_id is null
  );

  select * into v_result
    from public.claim_mfa_recovery(v_other_user, repeat('1', 64));
  perform pg_temp.check(
    'another user cannot claim an MFA recovery code',
    v_result.outcome = 'invalid'
    and v_result.operation_id is null
  );

  select * into v_result
    from public.claim_mfa_recovery(
      v_missing_profile_user,
      repeat('5', 64)
    );
  perform pg_temp.check(
    'MFA recovery fails closed without an auth profile',
    v_result.outcome = 'invalid'
    and v_result.operation_id is null
    and (
      select consumed_at is null
        from public.auth_mfa_recovery_codes
       where user_id = v_missing_profile_user
    )
  );

  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('1', 64));
  v_operation := v_result.operation_id;
  perform pg_temp.check(
    'matching unused code creates one claimed operation',
    v_result.outcome = 'claimed'
    and v_operation is not null
    and v_result.auth_user_id = v_auth_user
    and v_result.status = 'claimed'
    and (
      select consumed_at is not null
        from public.auth_mfa_recovery_codes
       where user_id = v_user and code_hash = repeat('1', 64)
    )
    and (
      select count(*) = 1
        from public.mfa_recovery_operations
       where user_id = v_user
    )
  );

  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('1', 64));
  perform pg_temp.check(
    'an overlapping retry observes the claimed operation in progress',
    v_result.outcome = 'in_progress'
    and v_result.operation_id = v_operation
    and v_result.auth_user_id = v_auth_user
    and v_result.status = 'claimed'
  );

  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('2', 64));
  perform pg_temp.check(
    'a different valid code observes the one live user operation',
    v_result.outcome = 'in_progress'
    and v_result.operation_id = v_operation
    and v_result.status = 'claimed'
    and (
      select consumed_at is null
        from public.auth_mfa_recovery_codes
       where user_id = v_user and code_hash = repeat('2', 64)
    )
    and (
      select count(*) = 1
        from public.mfa_recovery_operations
       where user_id = v_user and status <> 'completed'
    )
  );

  update public.mfa_recovery_operations
     set lease_expires_at = now() - interval '1 second'
   where id = v_operation;
  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('1', 64));
  perform pg_temp.check(
    'an expired worker lease makes a claimed operation retryable',
    v_result.outcome = 'resumed'
    and v_result.operation_id = v_operation
    and v_result.status = 'claimed'
    and (
      select lease_expires_at > now()
        from public.mfa_recovery_operations where id = v_operation
    )
  );

  v_transition := public.mark_mfa_factors_removed(
    v_operation,
    v_other_user
  );
  perform pg_temp.check(
    'another user cannot transition an MFA recovery operation',
    v_transition = 'not_found'
    and (
      select status = 'claimed'
        from public.mfa_recovery_operations where id = v_operation
    )
  );

  v_transition := public.complete_mfa_recovery(v_operation, v_user);
  perform pg_temp.check(
    'completion rejects the claimed prior state',
    v_transition = 'invalid_state'
  );

  v_transition := public.fail_mfa_recovery(
    v_operation,
    v_user,
    'DELETE FACTOR FAILED / HTTP 500'
  );
  perform pg_temp.check(
    'provider failure persists a sanitized retryable state',
    v_transition = 'failed'
    and (
      select status = 'failed'
         and attempts = 1
         and last_error = 'delete_factor_failed___http_500'
         and lease_expires_at is null
        from public.mfa_recovery_operations where id = v_operation
    )
  );

  select * into v_result
    from public.claim_mfa_recovery(v_user, repeat('1', 64));
  perform pg_temp.check(
    'retry resumes the same failed operation',
    v_result.outcome = 'resumed'
    and v_result.operation_id = v_operation
    and v_result.status = 'claimed'
  );

  v_transition := public.mark_mfa_factors_removed(v_operation, v_user);
  perform pg_temp.check(
    'factor removal advances a claimed or failed operation',
    v_transition = 'factors_removed'
    and (
      select status = 'factors_removed' and last_error is null
         and lease_expires_at is null
        from public.mfa_recovery_operations where id = v_operation
    )
  );

  v_transition := public.mark_mfa_factors_removed(v_operation, v_user);
  perform pg_temp.check(
    'factor removal rejects an already advanced state',
    v_transition = 'invalid_state'
  );
  v_transition := public.fail_mfa_recovery(
    v_operation,
    v_user,
    'late_failure'
  );
  perform pg_temp.check(
    'failure rejects the factors-removed state',
    v_transition = 'invalid_state'
    and (
      select attempts = 1
        from public.mfa_recovery_operations where id = v_operation
    )
  );

  v_transition := public.complete_mfa_recovery(v_operation, v_user);
  perform pg_temp.check(
    'completion deletes codes and records audit atomically',
    v_transition = 'completed'
    and not exists (
      select 1 from public.auth_mfa_recovery_codes where user_id = v_user
    )
    and exists (
      select 1
        from public.auth_mfa_recovery_codes
       where user_id = v_other_user
    )
    and (
      select status = 'completed'
         and completed_at is not null
         and lease_expires_at is null
        from public.mfa_recovery_operations where id = v_operation
    )
    and (
      select count(*) = 1
        from public.audit_logs
       where user_id = v_user
         and action = 'mfa.recovery_code_used'
         and entity_type = 'user'
         and entity_id = v_user::text
         and changes = '{"factorsRemoved": true}'::jsonb
    )
  );

  v_transition := public.complete_mfa_recovery(v_operation, v_user);
  perform pg_temp.check(
    'completion rejects completed replay',
    v_transition = 'invalid_state'
  );
  v_transition := public.mark_mfa_factors_removed(v_operation, v_user);
  perform pg_temp.check(
    'factor transition rejects completed replay',
    v_transition = 'invalid_state'
  );
  v_transition := public.fail_mfa_recovery(v_operation, v_user, 'late');
  perform pg_temp.check(
    'failure transition rejects completed replay',
    v_transition = 'invalid_state'
    and (
      select count(*) = 1
        from public.audit_logs
       where user_id = v_user and action = 'mfa.recovery_code_used'
    )
  );
end
$$;
rollback;

select 'MFA recovery saga: ALL CHECKS PASSED' as result;
