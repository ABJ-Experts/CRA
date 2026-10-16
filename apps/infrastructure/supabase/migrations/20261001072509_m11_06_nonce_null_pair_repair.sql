-- An absent previous credential produces SQL NULL; fail closed on that branch.
create or replace function public.m1106_consume_agent_nonce(
 p_organization_id uuid,p_connector_id uuid,p_agent_id uuid,p_cert_fingerprint text,
 p_signing_key_id text,p_nonce text,p_expires_at timestamptz
) returns table(outcome text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_agent public.connector_agents%rowtype; v_inserted integer;
begin
 if p_cert_fingerprint is null or p_cert_fingerprint !~ '^[a-f0-9]{64}$' or p_signing_key_id is null or p_signing_key_id !~ '^[A-Za-z0-9_.-]{1,80}$'
 or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{16,120}$' or p_expires_at is null or p_expires_at<=clock_timestamp()
 or p_expires_at>clock_timestamp()+interval '5 minutes' then
  return query select 'invalid_request'::text; return; end if;
 select * into v_connector from public.connectors where organization_id=p_organization_id and id=p_connector_id for share;
 if not found or v_connector.connector_type<>'on_prem_agent' or not v_connector.enabled or v_connector.archived_at is not null then
  return query select 'invalid_state'::text; return; end if;
 select * into v_agent from public.connector_agents where organization_id=p_organization_id and connector_id=p_connector_id and id=p_agent_id for share;
 if not found or v_agent.status<>'active' or v_agent.revoked_at is not null then
  return query select 'revoked'::text; return; end if;
 if not coalesce((v_agent.current_cert_fingerprint=p_cert_fingerprint and v_agent.current_signing_key_id=p_signing_key_id
   and v_agent.current_expires_at>clock_timestamp() and v_agent.current_key_issued_at>clock_timestamp()-interval '90 days')
  or (v_agent.previous_cert_fingerprint=p_cert_fingerprint and v_agent.previous_signing_key_id=p_signing_key_id
   and v_agent.previous_valid_until>clock_timestamp()
   and v_agent.previous_key_issued_at>clock_timestamp()-interval '90 days'),false) then
  return query select 'key_expired'::text; return; end if;
 with expired as (select agent_id,nonce from public.connector_agent_nonces
  where agent_id=p_agent_id and expires_at<clock_timestamp()-interval '10 minutes'
  order by expires_at limit 500)
 delete from public.connector_agent_nonces n using expired e where n.agent_id=e.agent_id and n.nonce=e.nonce;
 insert into public.connector_agent_nonces(organization_id,connector_id,agent_id,nonce,expires_at)
 values(p_organization_id,p_connector_id,p_agent_id,p_nonce,p_expires_at)
 on conflict(agent_id,nonce) do nothing;
 get diagnostics v_inserted=row_count;
 return query select case when v_inserted=1 then 'accepted' else 'replay' end;
end $$;

revoke all on function public.m1106_consume_agent_nonce(uuid,uuid,uuid,text,text,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.m1106_consume_agent_nonce(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;

-- Distinguish server staging backpressure from host queue exhaustion.
alter table public.connector_agents drop constraint connector_agents_last_error_code_check;
alter table public.connector_agents add constraint connector_agents_last_error_code_check
 check(last_error_code is null or last_error_code in ('source_unavailable','source_changed','source_invalid',
  'queue_full','backpressure','network_unavailable','proxy_failed','tls_failed','clock_skew','credential_expired','unknown'));
do $$
declare v_definition text; v_anchor text:='''queue_full'',''network_unavailable''';
begin
 select pg_get_functiondef('public.m1106_record_agent_health(uuid,uuid,uuid,text,jsonb,bigint,bigint,text)'::regprocedure) into v_definition;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
  raise exception 'M11-06 health error-code patch anchor changed'; end if;
 execute replace(v_definition,v_anchor,'''queue_full'',''backpressure'',''network_unavailable''');
end $$;
