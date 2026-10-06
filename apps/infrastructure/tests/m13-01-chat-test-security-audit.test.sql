-- M13-01: chat test intent and failed confirmations must be auditable.
-- Fixtures and simulated outages are rolled back.
\set ON_ERROR_STOP on
begin;

create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if;
  raise notice 'ok %',p_label;
end $$;

create function pg_temp.reject_chat_audit() returns trigger language plpgsql as $$
begin
  if new.action in ('notification.chat_test_started','notification.chat_confirmation_denied') then
    raise exception 'simulated audit outage' using errcode='55000';
  end if;
  return new;
end $$;

select pg_temp.check('chat command RPCs remain private with pinned search paths',
  not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'm12_05_begin_chat_channel_test_atomic','m12_05_confirm_chat_channel_atomic')
      and (not p.prosecdef or p.proconfig is null
        or not ('search_path=public, pg_temp'=any(p.proconfig))
        or has_function_privilege('anon',p.oid,'execute')
        or has_function_privilege('authenticated',p.oid,'execute')
        or not has_function_privilege('service_role',p.oid,'execute'))));

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_channel uuid:=gen_random_uuid();
  v_begin_key uuid:=gen_random_uuid();
  v_test_id uuid;
  v_begin jsonb;
  v_result jsonb;
  v_credential jsonb:='{"format":"aes-256-gcm-v1","keyId":"test","ciphertext":"YWJj","nonce":"AAAAAAAAAAAAAAAA","authTag":"AAAAAAAAAAAAAAAAAAAAAA=="}'::jsonb;
  v_configuration jsonb:='{"mode":"slack_webhook","displayName":"Audit test route","eventClasses":["approval_prompt"],"productIds":[],"includeOrganizationWide":true,"targetMetadata":{}}'::jsonb;
  v_wrong_key uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  insert into public.users(email) values('m13-chat-auditor-'||gen_random_uuid()||'@cra.test')
    returning id into v_admin;
  insert into public.organization_members(organization_id,user_id,role)
    values(v_org,v_admin,'owner');
  perform pg_temp.check('seeded local organization actors exist',v_owner is not null and v_admin is not null);
  v_result:=public.m12_05_create_chat_channel_atomic(v_org,v_owner,v_channel,v_configuration,
    v_credential,1,repeat('a',64),gen_random_uuid());
  perform pg_temp.check('channel fixture created',v_result->>'outcome'='updated');
  perform pg_temp.check('tenant substitution cannot prepare a test',
    public.m12_05_begin_chat_channel_test_atomic(gen_random_uuid(),v_owner,v_channel,1,
      repeat('b',64),gen_random_uuid())->>'outcome'='forbidden');

  v_begin:=public.m12_05_begin_chat_channel_test_atomic(v_org,v_owner,v_channel,1,
    repeat('b',64),v_begin_key);
  v_test_id:=(v_begin #>> '{result,testId}')::uuid;
  perform pg_temp.check('test initiation records one durable redacted intent',
    v_begin->>'outcome'='found' and v_test_id is not null
    and (select count(*)=1 from public.audit_logs a
      where a.schema_version=2 and a.organization_id=v_org and a.event_scope='organization'
        and a.action='notification.chat_test_started' and a.entity_type='notification_chat_channel'
        and a.entity_id=v_channel::text and a.actor_type='user' and a.actor_id=v_owner::text
        and a.user_id=v_owner and a.outcome='intent' and a.correlation_id=v_begin_key
        and a.event_key='chat-test-start:'||v_test_id::text
        and a.after_redacted->>'sourceId'=v_test_id::text
        and a.after_redacted->>'status'='pending'
        and position(repeat('b',64) in row_to_json(a)::text)=0
        and position('YWJj' in row_to_json(a)::text)=0));
  v_result:=public.m12_05_begin_chat_channel_test_atomic(v_org,v_owner,v_channel,1,
    repeat('c',64),v_begin_key);
  perform pg_temp.check('same begin key conflicts without duplicate intent',
    v_result->>'outcome'='idempotency_conflict'
    and (select count(*)=1 from public.audit_logs a
      where a.schema_version=2 and a.action='notification.chat_test_started'
        and a.entity_id=v_channel::text));

  v_result:=public.m12_05_complete_chat_channel_test_atomic(v_org,v_owner,v_channel,
    v_test_id,'provider_accepted',null,null);
  perform pg_temp.check('provider acceptance remains source-owned',v_result->>'outcome'='updated'
    and (select count(*)=1 from public.audit_logs where organization_id=v_org
      and action='notification.chat_test_accepted' and entity_id=v_channel::text));
  perform pg_temp.check('tenant substitution cannot increment confirmation counter',
    public.m12_05_confirm_chat_channel_atomic(gen_random_uuid(),v_admin,v_channel,1,
      v_test_id,repeat('c',64),gen_random_uuid())->>'outcome'='forbidden'
    and (select test_attempt_count=0 from public.notification_chat_channels where id=v_channel));

  execute 'create trigger m13_chat_audit_outage before insert on public.audit_logs '
    || 'for each row execute function pg_temp.reject_chat_audit()';
  begin
    perform public.m12_05_begin_chat_channel_test_atomic(v_org,v_owner,v_channel,1,
      repeat('d',64),gen_random_uuid());
    raise exception 'begin succeeded despite audit outage';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform pg_temp.check('audit outage rolls back new challenge preparation',
    (select test_id=v_test_id and test_accepted_at is not null
      and test_attempt_count=0 from public.notification_chat_channels where id=v_channel));
  begin
    perform public.m12_05_confirm_chat_channel_atomic(v_org,v_admin,v_channel,1,
      v_test_id,repeat('c',64),gen_random_uuid());
    raise exception 'wrong-code counter committed despite audit outage';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform pg_temp.check('audit outage rolls back wrong-code counter',
    (select test_attempt_count=0 and test_id=v_test_id
      from public.notification_chat_channels where id=v_channel));
  execute 'drop trigger m13_chat_audit_outage on public.audit_logs';

  for i in 1..5 loop
    v_wrong_key:=gen_random_uuid();
    v_result:=public.m12_05_confirm_chat_channel_atomic(v_org,v_admin,v_channel,1,
      v_test_id,repeat('c',64),v_wrong_key);
    perform pg_temp.check('wrong code has a distinct denied event for attempt '||i,
      v_result->>'outcome'='invalid_request'
      and (select count(*)=1 from public.audit_logs a
        where a.schema_version=2 and a.organization_id=v_org and a.event_scope='organization'
          and a.action='notification.chat_confirmation_denied' and a.outcome='denied'
          and a.entity_type='notification_chat_channel' and a.entity_id=v_channel::text
          and a.actor_type='user' and a.actor_id=v_admin::text and a.user_id=v_admin
          and a.correlation_id=v_wrong_key
          and a.event_key='chat-confirm-denied:'||v_test_id::text||':'||i::text
          and a.after_redacted->>'sourceId'=v_test_id::text
          and a.after_redacted->>'attemptCount'=i::text
          and a.after_redacted->>'status'=case when i=5 then 'locked' else 'pending' end
          and position(repeat('c',64) in row_to_json(a)::text)=0));
    if i=1 then
      v_result:=public.m12_05_confirm_chat_channel_atomic(v_org,v_admin,v_channel,1,
        v_test_id,repeat('c',64),v_wrong_key);
      perform pg_temp.check('same denied command key preserves original invalid result and attempt count',
        v_result->>'outcome'='invalid_request'
        and (select test_attempt_count=1 from public.notification_chat_channels where id=v_channel)
        and (select count(*)=1 from public.audit_logs
          where schema_version=2 and action='notification.chat_confirmation_denied'
            and correlation_id=v_wrong_key and entity_id=v_channel::text));
    end if;
  end loop;
  perform pg_temp.check('fifth denied code clears challenge and leaves five events',
    (select test_attempt_count=5 and test_id is null and test_code_hash is null
      from public.notification_chat_channels where id=v_channel)
    and (select count(*)=5 from public.audit_logs where schema_version=2
      and action='notification.chat_confirmation_denied' and entity_id=v_channel::text));
  v_result:=public.m12_05_confirm_chat_channel_atomic(v_org,v_admin,v_channel,1,
    v_test_id,repeat('c',64),v_wrong_key);
  perform pg_temp.check('locked fifth attempt remains stable on retry',
    v_result->>'outcome'='invalid_request'
    and (select test_attempt_count=5 and test_id is null
      from public.notification_chat_channels where id=v_channel)
    and (select count(*)=5 from public.audit_logs where schema_version=2
      and action='notification.chat_confirmation_denied' and entity_id=v_channel::text));
end $$;

rollback;
