create or replace function public.create_technical_file_auditor_snapshot_grant_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_grant_id uuid,p_recipient_reference text,p_purpose text,p_expires_at timestamptz,p_token_hash text,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.technical_file_snapshots%rowtype; v_grant public.technical_file_auditor_snapshot_grants%rowtype;
begin
 if p_grant_id is null or p_idempotency_key is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_request_digest !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_recipient_reference,''))) not between 3 and 320 or char_length(btrim(coalesce(p_purpose,''))) not between 3 and 4000 or p_expires_at<=clock_timestamp()+interval '15 minutes' or p_expires_at>clock_timestamp()+interval '30 days' or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_file_snapshots') then return query select 'invalid_request',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then if v_grant.request_digest=p_request_digest then return query select 'replayed',public.m7_auditor_grant_json(p_organization_id,v_grant.id); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select * into v_snapshot from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 perform 1 from public.technical_file_snapshot_exports where organization_id=p_organization_id and snapshot_id=p_snapshot_id and id=p_export_id and status='ready' for share;
 if not found or v_snapshot.id is null then return query select 'not_found',null::jsonb; return; end if;
 insert into public.technical_file_auditor_snapshot_grants(id,organization_id,product_id,snapshot_id,export_id,recipient_reference,purpose,token_hash,request_digest,idempotency_key,expires_at,created_by) values(p_grant_id,p_organization_id,p_product_id,p_snapshot_id,p_export_id,btrim(p_recipient_reference),btrim(p_purpose),p_token_hash,p_request_digest,p_idempotency_key,p_expires_at,p_actor_user_id) returning * into v_grant;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,action) values(p_organization_id,v_grant.id,'grant_created');
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.auditor_grant_created','technical_file_auditor_snapshot_grant',v_grant.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',p_export_id,'idempotencyKey',p_idempotency_key));
 return query select 'created',public.m7_auditor_grant_json(p_organization_id,v_grant.id);
exception when unique_violation then return query select 'conflict',null::jsonb;
end $$;
revoke all on function public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text) from public,anon,authenticated;
grant execute on function public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text) to service_role;
alter function public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text) owner to postgres;
notify pgrst, 'reload schema';
