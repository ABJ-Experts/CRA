-- An explicit owner revocation permanently fences this connector identity,
-- including an enrollment that was revoked before its token was redeemed.
-- Automatic expiry leaves revocation_idempotency_key null and remains reissuable.
create or replace function public.m1106_issue_agent_enrollment(
 p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_permission_version bigint,
 p_idempotency_key uuid,p_token_hash text,p_token_envelope jsonb
) returns table(outcome text,agent jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,true) then
  return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or not public.m1106_valid_envelope(p_token_envelope) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for update;
 if not found or v_connector.connector_type<>'on_prem_agent' or v_connector.archived_at is not null then
  return query select 'not_found'::text,null::jsonb; return; end if;
 if exists(select 1 from public.connector_agents where organization_id=p_organization_id
  and connector_id=p_connector_id and revocation_idempotency_key is not null) then
  return query select 'replacement_requires_new_connector'::text,null::jsonb; return; end if;
 select * into v_agent from public.connector_agents
 where organization_id=p_organization_id and connector_id=p_connector_id and enrollment_idempotency_key=p_idempotency_key for update;
 if found then
  return query select 'replayed'::text,to_jsonb(v_agent); return; end if;
 if exists(select 1 from public.connector_agents where organization_id=p_organization_id
  and connector_id=p_connector_id and enrolled_at is not null) then
  return query select 'replacement_requires_new_connector'::text,null::jsonb; return; end if;
 update public.connector_agents set status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,updated_at=clock_timestamp()
 where organization_id=p_organization_id and connector_id=p_connector_id and status='pending' and enrollment_expires_at<=clock_timestamp();
 if exists(select 1 from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and status in ('pending','active')) then
  return query select 'conflict'::text,null::jsonb; return; end if;
 insert into public.connector_agents(id,organization_id,connector_id,enrollment_token_hash,enrollment_token_envelope,
  enrollment_idempotency_key,enrollment_expires_at,enrollment_issued_by)
 values(p_idempotency_key,p_organization_id,p_connector_id,p_token_hash,p_token_envelope,p_idempotency_key,clock_timestamp()+interval '15 minutes',p_actor_user_id)
 returning * into v_agent;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'connector_agent.enrollment_issued','connector_agent',v_agent.id::text,
  jsonb_build_object('connectorId',p_connector_id,'expiresAt',v_agent.enrollment_expires_at));
 return query select 'issued'::text,to_jsonb(v_agent);
end $$;

revoke all on function public.m1106_issue_agent_enrollment(uuid,uuid,uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.m1106_issue_agent_enrollment(uuid,uuid,uuid,bigint,uuid,text,jsonb) to service_role;

-- Agents report the bounded credential-overlap state without collapsing it
-- into an unknown error. Keep the row constraint and RPC validation aligned.
alter table public.connector_agents drop constraint connector_agents_last_error_code_check;
alter table public.connector_agents add constraint connector_agents_last_error_code_check
 check(last_error_code is null or last_error_code in ('source_unavailable','source_changed','source_invalid',
  'queue_full','backpressure','rotation_in_progress','network_unavailable','proxy_failed','tls_failed','clock_skew','credential_expired','unknown'));
do $$
declare v_definition text; v_anchor text:='''backpressure'',''network_unavailable''';
begin
 select pg_get_functiondef('public.m1106_record_agent_health(uuid,uuid,uuid,text,jsonb,bigint,bigint,text)'::regprocedure) into v_definition;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
  raise exception 'M11-06 rotation health-code patch anchor changed'; end if;
 execute replace(v_definition,v_anchor,'''backpressure'',''rotation_in_progress'',''network_unavailable''');
end $$;
