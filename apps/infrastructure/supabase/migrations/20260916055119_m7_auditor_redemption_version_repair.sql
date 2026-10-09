-- Redeeming a one-time delivery link records audit evidence and creates a
-- session, but it must not invalidate the grant version the owner just saw.
-- Version is reserved for owner-managed state transitions such as revocation.
create or replace function public.redeem_technical_file_auditor_snapshot_grant_atomic(p_token_hash text,p_session_id uuid,p_session_token_hash text,p_session_expires_at timestamptz,p_client_source_hash text default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_grant public.technical_file_auditor_snapshot_grants%rowtype;
begin
 if p_token_hash !~ '^[a-f0-9]{64}$' or p_session_id is null or p_session_token_hash !~ '^[a-f0-9]{64}$' or (p_client_source_hash is not null and p_client_source_hash !~ '^[a-f0-9]{64}$') or p_session_expires_at<=clock_timestamp() or p_session_expires_at>clock_timestamp()+interval '1 hour' then return query select 'unavailable',null::jsonb; return; end if;
 if (select count(*) from public.technical_file_auditor_access_events where token_hash=p_token_hash and action in ('redemption_denied','redemption_rate_limited') and created_at>clock_timestamp()-interval '15 minutes')>=5 then insert into public.technical_file_auditor_access_events(action,token_hash,client_source_hash) values('redemption_rate_limited',p_token_hash,p_client_source_hash); return query select 'rate_limited',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where token_hash=p_token_hash for update;
 if not found or v_grant.status<>'active' or v_grant.expires_at<=clock_timestamp() or v_grant.redeemed_at is not null then
   if found and v_grant.status='active' and v_grant.expires_at<=clock_timestamp() then update public.technical_file_auditor_snapshot_grants set status='expired',version=version+1 where id=v_grant.id; end if;
   insert into public.technical_file_auditor_access_events(organization_id,grant_id,action,token_hash,client_source_hash) values(case when found then v_grant.organization_id else null end,case when found then v_grant.id else null end,'redemption_denied',p_token_hash,p_client_source_hash);
   return query select 'unavailable',null::jsonb; return;
 end if;
 if p_session_expires_at>v_grant.expires_at then return query select 'unavailable',null::jsonb; return; end if;
 update public.technical_file_auditor_snapshot_grants set redeemed_at=clock_timestamp() where id=v_grant.id;
 insert into public.technical_file_auditor_sessions(id,grant_id,session_token_hash,expires_at) values(p_session_id,v_grant.id,p_session_token_hash,p_session_expires_at);
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,session_id,action) values(v_grant.organization_id,v_grant.id,p_session_id,'redeemed');
 return query select 'redeemed',jsonb_build_object('sessionExpiresAt',to_char(p_session_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
exception when unique_violation then return query select 'unavailable',null::jsonb;
end $$;

revoke all on function public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text) to service_role;
alter function public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text) owner to postgres;
notify pgrst, 'reload schema';
