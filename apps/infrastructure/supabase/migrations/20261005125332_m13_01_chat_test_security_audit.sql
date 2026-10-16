-- Preserve M12-05 signatures and result shapes. The pending test is durable
-- evidence before provider egress; the audit intent commits with that state.
create or replace function public.m12_05_begin_chat_channel_test_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_expected_version integer,
  p_test_code_hash text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_test_id uuid:=gen_random_uuid();
  v_audit record;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_idempotency_key is null or p_test_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_channel.version<>p_expected_version or v_channel.enabled then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  if not public.m12_05_chat_configuration_valid(p_organization_id,p_actor_user_id,jsonb_build_object(
      'mode',v_channel.mode,'displayName',v_channel.display_name,'eventClasses',v_channel.event_classes,
      'productIds',v_channel.product_ids,'includeOrganizationWide',v_channel.include_organization_wide,
      'targetMetadata',v_channel.target_metadata)) then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  -- The API creates a fresh code on each call. Reusing the key remains a
  -- conflict rather than silently reusing an older challenge.
  if v_channel.last_command_key=p_idempotency_key then
    return jsonb_build_object('outcome','idempotency_conflict','result',null); end if;
  update public.notification_chat_channels set test_id=v_test_id,test_code_hash=p_test_code_hash,
    test_expires_at=clock_timestamp()+interval '10 minutes',test_accepted_at=null,
    test_attempt_count=0,
    verified_at=null,verified_version=null,updated_by_user_id=p_actor_user_id,
    last_command_key=p_idempotency_key,last_command_digest=public.m12_05_chat_digest('test',
      jsonb_build_object('testId',v_test_id,'codeHash',p_test_code_hash)),last_command_actor=p_actor_user_id
    where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
  select * into v_audit from public.m13_01_append_audit_event(
    p_organization_id,'organization','chat-test-start:'||v_test_id::text,
    'user',p_actor_user_id::text,'notification.chat_test_started',
    'notification_chat_channel',p_channel_id::text,'intent',p_idempotency_key,
    null,jsonb_build_object('sourceId',v_test_id,'status','pending'),
    null,null,null,p_actor_user_id);
  if v_audit.outcome is distinct from 'inserted' then
    raise exception 'chat test audit identity conflict' using errcode='23505'; end if;
  return jsonb_build_object('outcome','found','result',jsonb_build_object(
    'testId',v_channel.test_id,'expiresAt',public.m12_05_chat_utc(v_channel.test_expires_at),
    'mode',v_channel.mode,'displayName',v_channel.display_name,'targetMetadata',v_channel.target_metadata,
    'credentialEnvelope',v_channel.credential_envelope,'credentialRevision',v_channel.credential_revision));
end $$;

-- Failed confirmation is an authorization decision. Count changes and the
-- denied event commit together; never copy the supplied code or its hash.
create or replace function public.m12_05_confirm_chat_channel_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_channel_id uuid,p_expected_version integer,
  p_test_id uuid,p_code_hash text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_channel public.notification_chat_channels%rowtype; v_digest text;
  v_audit record;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_test_id is null or p_idempotency_key is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  v_digest:=public.m12_05_chat_digest('confirm',jsonb_build_object('expectedVersion',p_expected_version,
    'testId',p_test_id,'codeHash',p_code_hash));
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=p_channel_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_channel.last_command_key=p_idempotency_key then
    return jsonb_build_object('outcome',case when v_channel.last_command_digest=v_digest
      and v_channel.last_command_actor=p_actor_user_id then 'replayed' else 'idempotency_conflict' end,
      'result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel))); end if;
  -- A wrong-code response is still invalid_request on retry. Its audit event
  -- now supplies durable command identity, so a repeated key cannot consume
  -- another attempt or manufacture a second denial.
  if exists(select 1 from public.audit_logs a where a.organization_id=p_organization_id
      and a.schema_version=2 and a.action='notification.chat_confirmation_denied'
      and a.entity_type='notification_chat_channel' and a.entity_id=p_channel_id::text
      and a.actor_id=p_actor_user_id::text and a.correlation_id=p_idempotency_key) then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  if v_channel.version<>p_expected_version or v_channel.enabled then
    return jsonb_build_object('outcome','conflict','result',public.m12_05_chat_channel_public(v_channel)); end if;
  if v_channel.test_id is distinct from p_test_id
    or v_channel.test_accepted_at is null or v_channel.test_expires_at<=clock_timestamp()
    or v_channel.test_attempt_count>=5 then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  if v_channel.test_code_hash is distinct from p_code_hash then
    update public.notification_chat_channels set test_attempt_count=test_attempt_count+1,
      test_id=case when test_attempt_count+1>=5 then null else test_id end,
      test_code_hash=case when test_attempt_count+1>=5 then null else test_code_hash end,
      test_expires_at=case when test_attempt_count+1>=5 then null else test_expires_at end,
      test_accepted_at=case when test_attempt_count+1>=5 then null else test_accepted_at end
      where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
    select * into v_audit from public.m13_01_append_audit_event(
      p_organization_id,'organization',
      'chat-confirm-denied:'||p_test_id::text||':'||v_channel.test_attempt_count::text,
      'user',p_actor_user_id::text,'notification.chat_confirmation_denied',
      'notification_chat_channel',p_channel_id::text,'denied',p_idempotency_key,
      null,jsonb_build_object('sourceId',p_test_id,'attemptCount',v_channel.test_attempt_count,
        'status',case when v_channel.test_attempt_count>=5 then 'locked' else 'pending' end),
      null,null,null,p_actor_user_id);
    if v_audit.outcome is distinct from 'inserted' then
      raise exception 'chat confirmation audit identity conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome','invalid_request','result',null);
  end if;
  update public.notification_chat_channels set version=version+1,safe_error_code=null,verified_at=clock_timestamp(),
    verified_version=version+1,test_code_hash=null,test_id=null,test_expires_at=null,test_accepted_at=null,
    updated_by_user_id=p_actor_user_id,last_command_key=p_idempotency_key,
    last_command_digest=v_digest,last_command_actor=p_actor_user_id
    where organization_id=p_organization_id and id=p_channel_id returning * into v_channel;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_channel_confirmed','notification_chat_channel',
      p_channel_id::text,jsonb_build_object('version',v_channel.version));
  return jsonb_build_object('outcome','updated','result',jsonb_build_object('channel',public.m12_05_chat_channel_public(v_channel)));
end $$;

alter function public.m12_05_begin_chat_channel_test_atomic(uuid,uuid,uuid,integer,text,uuid) owner to postgres;
alter function public.m12_05_confirm_chat_channel_atomic(uuid,uuid,uuid,integer,uuid,text,uuid) owner to postgres;
revoke all on function public.m12_05_begin_chat_channel_test_atomic(uuid,uuid,uuid,integer,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.m12_05_begin_chat_channel_test_atomic(uuid,uuid,uuid,integer,text,uuid)
  to service_role;
revoke all on function public.m12_05_confirm_chat_channel_atomic(uuid,uuid,uuid,integer,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.m12_05_confirm_chat_channel_atomic(uuid,uuid,uuid,integer,uuid,text,uuid)
  to service_role;
