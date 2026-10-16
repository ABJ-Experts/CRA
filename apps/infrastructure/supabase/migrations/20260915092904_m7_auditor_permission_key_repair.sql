-- The contracts permission matrix derives this key from
-- technical_files: ["share"]. Keep database authorization identical to the
-- Nest permission boundary; the earlier spelling was not a valid key.
create or replace function public.preview_technical_file_auditor_snapshot_grant(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.technical_file_snapshots%rowtype; v_export public.technical_file_snapshot_exports%rowtype;
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select * into v_snapshot from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 select * into v_export from public.technical_file_snapshot_exports where organization_id=p_organization_id and snapshot_id=p_snapshot_id and id=p_export_id and status='ready' for share;
 if not found or v_snapshot.id is null then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('snapshotId',v_snapshot.id,'snapshotSourceDate',public.m7_snapshot_timestamp_utc(v_snapshot.created_at),'snapshotRevision',v_snapshot.technical_file_version,'snapshotStatus',v_snapshot.status,'snapshotSha256',v_snapshot.payload_sha256,'export',public.m7_snapshot_export_json(p_organization_id,v_export.id),'maxExpiresAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval '30 days'));
end $$;

create or replace function public.create_technical_file_auditor_snapshot_grant_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_grant_id uuid,p_recipient_email text,p_recipient_reference text,p_purpose text,p_expires_at timestamptz,p_token_hash text,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.technical_file_snapshots%rowtype; v_grant public.technical_file_auditor_snapshot_grants%rowtype; v_email text:=lower(btrim(p_recipient_email));
begin
 if p_grant_id is null or p_idempotency_key is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_request_digest !~ '^[a-f0-9]{64}$' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email) not between 3 and 254 or (p_recipient_reference is not null and char_length(btrim(p_recipient_reference)) not between 1 and 300) or char_length(btrim(coalesce(p_purpose,''))) not between 3 and 2000 or p_expires_at<=clock_timestamp()+interval '15 minutes' or p_expires_at>clock_timestamp()+interval '30 days' or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_files') then return query select 'invalid_request',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then if v_grant.request_digest=p_request_digest then return query select 'replayed',public.m7_auditor_grant_json(p_organization_id,v_grant.id); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select * into v_snapshot from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 perform 1 from public.technical_file_snapshot_exports where organization_id=p_organization_id and snapshot_id=p_snapshot_id and id=p_export_id and status='ready' for share;
 if not found or v_snapshot.id is null then return query select 'not_found',null::jsonb; return; end if;
 insert into public.technical_file_auditor_snapshot_grants(id,organization_id,product_id,snapshot_id,export_id,recipient_email,recipient_reference,purpose,token_hash,request_digest,idempotency_key,expires_at,created_by) values(p_grant_id,p_organization_id,p_product_id,p_snapshot_id,p_export_id,v_email,case when p_recipient_reference is null then null else btrim(p_recipient_reference) end,btrim(p_purpose),p_token_hash,p_request_digest,p_idempotency_key,p_expires_at,p_actor_user_id) returning * into v_grant;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,action) values(p_organization_id,v_grant.id,'grant_created');
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.auditor_grant_created','technical_file_auditor_snapshot_grant',v_grant.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',p_export_id,'idempotencyKey',p_idempotency_key));
 return query select 'created',public.m7_auditor_grant_json(p_organization_id,v_grant.id);
exception when unique_violation then return query select 'conflict',null::jsonb;
end $$;

create or replace function public.revoke_technical_file_auditor_snapshot_grant_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_grant_id uuid,p_expected_version integer,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_grant public.technical_file_auditor_snapshot_grants%rowtype; v_replay public.audit_logs%rowtype;
begin
 if p_expected_version<1 or p_idempotency_key is null or (p_reason is not null and char_length(btrim(p_reason)) not between 1 and 1000) or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select * into v_replay from public.audit_logs where organization_id=p_organization_id and user_id=p_actor_user_id and action='technical_file.auditor_grant_revoked' and changes->>'idempotencyKey'=p_idempotency_key::text order by created_at desc,id desc limit 1;
 if found then return query select 'replayed',public.m7_auditor_grant_json(p_organization_id,(v_replay.changes->>'grantId')::uuid); return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where organization_id=p_organization_id and product_id=p_product_id and snapshot_id=p_snapshot_id and id=p_grant_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if v_grant.version<>p_expected_version then return query select 'conflict',jsonb_build_object('currentVersion',v_grant.version); return; end if;
 if v_grant.status='revoked' then return query select 'revoked',public.m7_auditor_grant_json(p_organization_id,v_grant.id); return; end if;
 update public.technical_file_auditor_snapshot_grants set status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,revocation_reason=case when p_reason is null then null else btrim(p_reason) end,version=version+1 where id=v_grant.id;
 update public.technical_file_auditor_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where grant_id=v_grant.id;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,action) values(p_organization_id,v_grant.id,'grant_revoked');
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.auditor_grant_revoked','technical_file_auditor_snapshot_grant',v_grant.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'grantId',v_grant.id,'idempotencyKey',p_idempotency_key));
 return query select 'revoked',public.m7_auditor_grant_json(p_organization_id,v_grant.id);
end $$;

revoke all on function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid),public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text),public.revoke_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid),public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text),public.revoke_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid) to service_role;
alter function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text) owner to postgres;
alter function public.revoke_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid) owner to postgres;
notify pgrst, 'reload schema';
