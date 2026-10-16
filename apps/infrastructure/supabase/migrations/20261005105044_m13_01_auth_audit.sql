-- Capture auth-owned state changes in the same transaction that changes them.
-- Source credentials, emails, code hashes and provider tokens never enter audit.
alter table public.auth_login_attempts
  add column audit_ref uuid not null default gen_random_uuid();
create unique index auth_login_attempts_audit_ref_key
  on public.auth_login_attempts(audit_ref);

create or replace function public.m13_01_audit_auth_state_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_ref text;
  v_event uuid := gen_random_uuid();
  v_before jsonb := null;
  v_after jsonb := null;
  v_status text;
begin
  v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old := case when tg_op='INSERT' then null else to_jsonb(old) end;
  v_ref := case when tg_table_name='auth_login_attempts'
    then v_row->>'audit_ref' else v_row->>'id' end;
  if v_ref is null then
    raise exception 'auth audit source reference missing' using errcode='23514';
  end if;

  if tg_table_name='auth_login_attempts' then
    if v_old is not null then
      v_before := jsonb_build_object('count',(v_old->>'failed_count')::integer,
        'status',case when v_old->>'locked_until' is null then 'unlocked' else 'locked' end);
    end if;
    if tg_op<>'DELETE' then
      v_after := jsonb_build_object('count',(v_row->>'failed_count')::integer,
        'status',case when v_row->>'locked_until' is null then 'unlocked' else 'locked' end);
    end if;
  else
    v_status := case when tg_op='INSERT' then 'issued'
      when tg_op='DELETE' then 'removed'
      when v_row->>'consumed_at' is not null then 'consumed'
      else 'updated' end;
    if tg_op<>'INSERT' then v_before:=jsonb_build_object('status','active'); end if;
    if tg_op<>'DELETE' then v_after:=jsonb_build_object('status',v_status); end if;
  end if;

  perform 1 from public.m13_01_append_audit_event(
    null,'security',
    'auth.state:'||tg_table_name||':'||v_ref||':'||v_event::text,
    'system','auth_repository',
    'auth.state_'||lower(tg_op),tg_table_name,v_ref,
    'completed',v_event,v_before,v_after,null,null,null,null
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
alter function public.m13_01_audit_auth_state_change() owner to postgres;
revoke all on function public.m13_01_audit_auth_state_change() from public,anon,authenticated,service_role;

create trigger m13_01_audit_login_attempts
  after insert or update or delete on public.auth_login_attempts
  for each row execute function public.m13_01_audit_auth_state_change();
create trigger m13_01_audit_email_verifications
  after insert or update or delete on public.auth_email_verifications
  for each row execute function public.m13_01_audit_auth_state_change();
create trigger m13_01_audit_recovery_tokens
  after insert or update or delete on public.auth_recovery_tokens
  for each row execute function public.m13_01_audit_auth_state_change();
create trigger m13_01_audit_mfa_recovery_codes
  after insert or update or delete on public.auth_mfa_recovery_codes
  for each row execute function public.m13_01_audit_auth_state_change();

-- Session revocation and email verification update public.users from several
-- paths. The row trigger covers every caller, including recovery and member
-- lifecycle RPCs, without changing their public signatures.
create or replace function public.m13_01_audit_auth_user_security_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid;
begin
  if old.session_epoch_at is distinct from new.session_epoch_at then
    v_event:=gen_random_uuid();
    perform 1 from public.m13_01_append_audit_event(
      null,'security','auth.session_epoch:'||new.id::text||':'||v_event::text,
      'system','auth_repository','auth.session_revoked','user',new.id::text,
      'completed',v_event,
      jsonb_build_object('status','active'),
      jsonb_build_object('status','revoked'),null,null,null,null
    );
  end if;
  if old.email_verified_at is distinct from new.email_verified_at then
    v_event:=gen_random_uuid();
    perform 1 from public.m13_01_append_audit_event(
      null,'security','auth.email_verified:'||new.id::text||':'||v_event::text,
      'system','auth_repository','auth.email_verification_changed','user',new.id::text,
      'completed',v_event,
      jsonb_build_object('verified',old.email_verified_at is not null),
      jsonb_build_object('verified',new.email_verified_at is not null),null,null,null,null
    );
  end if;
  return new;
end $$;
alter function public.m13_01_audit_auth_user_security_change() owner to postgres;
revoke all on function public.m13_01_audit_auth_user_security_change() from public,anon,authenticated,service_role;
create trigger m13_01_audit_auth_user_security_change
  after update of session_epoch_at,email_verified_at on public.users
  for each row when (
    old.session_epoch_at is distinct from new.session_epoch_at
    or old.email_verified_at is distinct from new.email_verified_at
  ) execute function public.m13_01_audit_auth_user_security_change();
