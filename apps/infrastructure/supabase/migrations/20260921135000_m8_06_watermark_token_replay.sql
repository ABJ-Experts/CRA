-- Rotate an opaque access token after a lost response; only its hash is stored.
create or replace function public.preview_evidence_document_watermark_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_export_id uuid,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; g public.evidence_document_watermark_export_access_grants%rowtype; v_token text; v_digest text;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('exportId',p_export_id,'mode','preview')::text,'sha256'),'hex');
 select * into g from public.evidence_document_watermark_export_access_grants where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then if g.request_digest<>p_request_digest or g.request_digest<>v_digest or g.access_mode<>'preview' then return query select 'idempotency_conflict',null::jsonb; return; end if; v_token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_'); update public.evidence_document_watermark_export_access_grants set token_sha256=encode(extensions.digest(v_token,'sha256'),'hex'),expires_at=clock_timestamp()+interval '5 minutes',terminal_outcome=null where id=g.id returning * into g; return query select 'replayed',jsonb_build_object('token',v_token,'expiresAt',g.expires_at,'fileName','watermarked-'||p_export_id::text,'mediaType',(select derivative_media_type from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id)); return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status<>'ready' then return query select 'not_ready',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 if p_request_digest<>v_digest then return query select 'invalid_request',null::jsonb; return; end if;
 v_token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
 insert into public.evidence_document_watermark_export_access_grants(organization_id,export_id,actor_user_id,idempotency_key,request_digest,access_mode,token_sha256,expires_at) values(p_organization_id,e.id,p_actor_user_id,p_idempotency_key,v_digest,'preview',encode(extensions.digest(v_token,'sha256'),'hex'),clock_timestamp()+interval '5 minutes') returning * into g;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.watermark_export_preview_authorized','evidence_document_watermark_export',e.id::text,jsonb_build_object('grantId',g.id,'exportId',e.id));
 return query select 'ready',jsonb_build_object('token',v_token,'expiresAt',g.expires_at,'fileName','watermarked-'||e.id::text||case when e.derivative_media_type='application/pdf' then '.pdf' when e.derivative_media_type='image/jpeg' then '.jpg' when e.derivative_media_type='image/png' then '.png' else '.webp' end,'mediaType',e.derivative_media_type);
end $$;

create or replace function public.create_evidence_document_watermark_export_delivery_atomic(p_organization_id uuid,p_actor_user_id uuid,p_export_id uuid,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; g public.evidence_document_watermark_export_access_grants%rowtype; v_token text; v_digest text;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('exportId',p_export_id,'mode','delivery')::text,'sha256'),'hex');
 select * into g from public.evidence_document_watermark_export_access_grants where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then if g.request_digest<>p_request_digest or g.request_digest<>v_digest or g.access_mode<>'delivery' then return query select 'idempotency_conflict',null::jsonb; return; end if; v_token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_'); update public.evidence_document_watermark_export_access_grants set token_sha256=encode(extensions.digest(v_token,'sha256'),'hex'),expires_at=clock_timestamp()+interval '5 minutes',terminal_outcome=null where id=g.id returning * into g; return query select 'replayed',jsonb_build_object('token',v_token,'expiresAt',g.expires_at,'fileName','watermarked-'||p_export_id::text,'mediaType',(select derivative_media_type from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id)); return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status<>'ready' then return query select 'not_ready',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 if p_request_digest<>v_digest or not exists(select 1 from public.evidence_document_watermark_export_access_grants p where p.organization_id=p_organization_id and p.export_id=e.id and p.actor_user_id=p_actor_user_id and p.access_mode='preview' and p.previewed_at is not null and p.terminal_outcome<>'revoked') then return query select 'forbidden',null::jsonb; return; end if;
 v_token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
 insert into public.evidence_document_watermark_export_access_grants(organization_id,export_id,actor_user_id,idempotency_key,request_digest,access_mode,token_sha256,expires_at) values(p_organization_id,e.id,p_actor_user_id,p_idempotency_key,v_digest,'delivery',encode(extensions.digest(v_token,'sha256'),'hex'),clock_timestamp()+interval '5 minutes') returning * into g;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.watermark_export_delivery_authorized','evidence_document_watermark_export',e.id::text,jsonb_build_object('grantId',g.id,'exportId',e.id));
 return query select 'ready',jsonb_build_object('token',v_token,'expiresAt',g.expires_at,'fileName','watermarked-'||e.id::text||case when e.derivative_media_type='application/pdf' then '.pdf' when e.derivative_media_type='image/jpeg' then '.jpg' when e.derivative_media_type='image/png' then '.png' else '.webp' end,'mediaType',e.derivative_media_type);
end $$;

notify pgrst,'reload schema';
