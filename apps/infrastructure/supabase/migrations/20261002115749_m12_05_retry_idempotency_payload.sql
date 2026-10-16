-- A retry idempotency key identifies the actor and the optimistic version it
-- was submitted with. Reuse with a changed version must conflict.
alter table public.notification_chat_deliveries
  add column last_retry_expected_version integer
  check (last_retry_expected_version is null or last_retry_expected_version>0);

create or replace function public.m12_05_retry_chat_delivery_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_delivery_id uuid,p_expected_version integer,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delivery public.notification_chat_deliveries%rowtype;
  v_channel public.notification_chat_channels%rowtype;
begin
  if not public.m12_05_chat_admin(p_organization_id,p_actor_user_id) then
    return jsonb_build_object('outcome','forbidden','result',null); end if;
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<1 then
    return jsonb_build_object('outcome','invalid_request','result',null); end if;
  select * into v_delivery from public.notification_chat_deliveries
    where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return jsonb_build_object('outcome','not_found','result',null); end if;
  if v_delivery.last_retry_key=p_idempotency_key then
    return jsonb_build_object('outcome',case when v_delivery.last_retry_actor=p_actor_user_id
      and v_delivery.last_retry_expected_version=p_expected_version
      then 'replayed' else 'idempotency_conflict' end,
      'result',jsonb_build_object('delivery',public.m12_05_chat_delivery_public(v_delivery))); end if;
  if v_delivery.version<>p_expected_version then
    return jsonb_build_object('outcome','conflict','result',null); end if;
  if v_delivery.status not in ('failed','exhausted','uncertain') or v_delivery.manual_retry_count>=3 then
    return jsonb_build_object('outcome','invalid_state','result',null); end if;
  select * into v_channel from public.notification_chat_channels
    where organization_id=p_organization_id and id=v_delivery.channel_id for update;
  if public.m12_05_chat_delivery_still_authorized(p_organization_id,v_delivery,v_channel) is null then
    return jsonb_build_object('outcome','invalid_state','result',null); end if;
  update public.notification_chat_deliveries set status='queued',attempt_count=0,
    manual_retry_count=manual_retry_count+1,next_attempt_at=clock_timestamp(),safe_error_code=null,
    lease_owner=null,lease_expires_at=null,provider_message_id_hash=null,provider_accepted_at=null,
    version=version+1,last_retry_key=p_idempotency_key,last_retry_actor=p_actor_user_id,
    last_retry_expected_version=p_expected_version
    where organization_id=p_organization_id and id=p_delivery_id returning * into v_delivery;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'notification.chat_delivery_retried','notification_chat_delivery',
      p_delivery_id::text,jsonb_build_object('version',v_delivery.version,
        'manualRetryCount',v_delivery.manual_retry_count));
  return jsonb_build_object('outcome','updated','result',jsonb_build_object(
    'delivery',public.m12_05_chat_delivery_public(v_delivery)));
end $$;

revoke all on function public.m12_05_retry_chat_delivery_atomic(uuid,uuid,uuid,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.m12_05_retry_chat_delivery_atomic(uuid,uuid,uuid,integer,uuid)
  to service_role;

do $$
declare v_definition text; v_old text:='''last_retry_key'',''last_retry_actor''';
begin
  select pg_get_functiondef(to_regprocedure('public.m1_export_business_record_jsonb(text,jsonb)'))
    into v_definition;
  if v_definition is null or position(v_old in v_definition)=0 then
    raise exception 'M12-05 retry export projection anchor missing'; end if;
  execute replace(v_definition,v_old,
    '''last_retry_key'',''last_retry_actor'',''last_retry_expected_version''');
end $$;
