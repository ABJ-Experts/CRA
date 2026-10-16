begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

do $$
declare
  v_login text := 'm13-auth-'||substr(gen_random_uuid()::text,1,8)||'@cra.test';
  v_ref uuid;
  v_user uuid;
  v_code uuid;
begin
  insert into public.auth_login_attempts(email,failed_count,first_failed_at)
  values (v_login,1,now()) returning audit_ref into v_ref;
  perform pg_temp.check('lockout insert has one source audit event',
    (select count(*)=1 from public.audit_logs
     where schema_version=2 and entity_type='auth_login_attempts'
       and entity_id=v_ref::text and action='auth.state_insert'));
  update public.auth_login_attempts set failed_count=2 where audit_ref=v_ref;
  perform pg_temp.check('lockout update is separately audited',
    (select count(*)=1 from public.audit_logs
     where schema_version=2 and entity_type='auth_login_attempts'
       and entity_id=v_ref::text and action='auth.state_update'
       and after_redacted->>'count'='2'));
  perform pg_temp.check('login identifier stays outside audit row',
    (select count(*)=0 from public.audit_logs
     where entity_id=v_ref::text and row_to_json(audit_logs)::text like '%'||v_login||'%'));

  select id into v_user from public.users where email='owner@cra.test';
  perform pg_temp.check('seed owner exists',v_user is not null);
  insert into public.auth_mfa_recovery_codes(user_id,code_hash)
  values (v_user,repeat('a',64)) returning id into v_code;
  perform pg_temp.check('MFA recovery code issuance is audited without hash',
    (select count(*)=1 from public.audit_logs
     where schema_version=2 and entity_type='auth_mfa_recovery_codes'
       and entity_id=v_code::text
       and position(repeat('a',64) in row_to_json(audit_logs)::text)=0));
end $$;

-- Force an audit-store rejection and prove the originating auth mutation
-- rolls back in the same transaction.
create or replace function pg_temp.reject_auth_audit()
returns trigger language plpgsql as $$
begin
  if new.action='auth.state_insert' then
    raise exception 'simulated audit outage' using errcode='55000';
  end if;
  return new;
end $$;
create trigger m13_test_reject_auth_audit
  before insert on public.audit_logs
  for each row execute function pg_temp.reject_auth_audit();

do $$
declare v_login text := 'm13-fail-'||substr(gen_random_uuid()::text,1,8)||'@cra.test';
begin
  begin
    insert into public.auth_login_attempts(email,failed_count,first_failed_at)
    values(v_login,1,now());
    raise exception 'auth mutation succeeded without audit';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform pg_temp.check('audit rejection rolls back auth state',
    not exists(select 1 from public.auth_login_attempts where email=v_login));
end $$;

rollback;
