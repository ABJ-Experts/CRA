-- Forward-only alignment for M8-06.  The initial migration was applied to a
-- developer stack while API/contract integration refined the wire contract;
-- this migration never deletes evidence or resets local data.

alter table public.evidence_document_watermark_export_access_grants
  add column if not exists access_mode text not null default 'preview';
alter table public.evidence_document_watermark_export_access_grants
  add constraint evidence_document_watermark_export_access_mode_check check (access_mode in ('preview','delivery'));

create or replace function public.m8_06_watermark_export_json(p_organization_id uuid,p_export_id uuid,p_include_confidential boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',e.id,'organizationId',e.organization_id,'productId',e.product_id,'documentId',e.document_id,'sourceVersionId',e.version_id,'sourceSha256',e.original_sha256,'requestedByUserId',e.requested_by_user_id,'requestedAt',to_char(e.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'recipient',case when p_include_confidential then e.recipient else null end,'purpose',case when p_include_confidential then e.purpose else null end,'status',e.status,'failureCode',e.failure_code,'derivative',case when e.status='ready' then jsonb_build_object('fileName','watermarked-'||e.id::text||case when e.derivative_media_type='application/pdf' then '.pdf' when e.derivative_media_type='image/jpeg' then '.jpg' when e.derivative_media_type='image/png' then '.png' else '.webp' end,'mediaType',e.derivative_media_type,'byteSize',e.derivative_byte_size,'sha256',e.derivative_sha256,'createdAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) else null end,'previewedAt',(select to_char(min(g.previewed_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.evidence_document_watermark_export_access_grants g where g.organization_id=e.organization_id and g.export_id=e.id and g.previewed_at is not null),'deliveredAt',(select to_char(min(g.delivered_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.evidence_document_watermark_export_access_grants g where g.organization_id=e.organization_id and g.export_id=e.id and g.delivered_at is not null)) from public.evidence_document_watermark_exports e where e.organization_id=p_organization_id and e.id=p_export_id
$$;

create or replace function public.claim_evidence_document_watermark_export(p_worker_id uuid,p_lease_seconds integer default 120)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; v public.evidence_document_versions%rowtype; d public.evidence_documents%rowtype;
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'empty',null::jsonb; return; end if;
 select * into e from public.evidence_document_watermark_exports where status='queued' order by created_at,id for update skip locked limit 1;
 if not found then return query select 'empty',null::jsonb; return; end if;
 select * into d from public.evidence_documents where organization_id=e.organization_id and id=e.document_id for update;
 select * into v from public.evidence_document_versions where organization_id=e.organization_id and id=e.version_id for share;
 if not found or d.lifecycle_state<>'active' or v.processing_state<>'clean' or v.original_sha256<>e.original_sha256 or v.actual_size_bytes<>e.original_byte_size then update public.evidence_document_watermark_exports set status='failed',failure_code=case when d.lifecycle_state<>'active' then 'source_unavailable' else 'source_integrity_failed' end,lease_owner=null,lease_expires_at=null where id=e.id; return query select 'empty',null::jsonb; return; end if;
 update public.evidence_document_watermark_exports set status='claimed',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,started_at=coalesce(started_at,clock_timestamp()),failure_code=null where id=e.id returning * into e;
 return query select 'claimed',jsonb_build_object('export',public.m8_06_watermark_export_json(e.organization_id,e.id,true),'organizationId',e.organization_id,'objectKey',v.object_key,'sourceByteSize',v.actual_size_bytes,'sourceMediaType',v.detected_media_type);
end $$;

create or replace function public.preview_evidence_document_watermark_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_export_id uuid,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; g public.evidence_document_watermark_export_access_grants%rowtype; v_token text; v_digest text;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('exportId',p_export_id,'mode','preview')::text,'sha256'),'hex');
 select * into g from public.evidence_document_watermark_export_access_grants where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then return query select case when g.request_digest=p_request_digest and g.request_digest=v_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('expiresAt',g.expires_at); return; end if;
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
 if found then return query select case when g.request_digest=p_request_digest and g.request_digest=v_digest and g.access_mode='delivery' then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('expiresAt',g.expires_at); return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status<>'ready' then return query select 'not_ready',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 if p_request_digest<>v_digest or not exists(select 1 from public.evidence_document_watermark_export_access_grants p where p.organization_id=p_organization_id and p.export_id=e.id and p.actor_user_id=p_actor_user_id and p.access_mode='preview' and p.previewed_at is not null and p.terminal_outcome<>'revoked') then return query select 'forbidden',null::jsonb; return; end if;
 v_token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
 insert into public.evidence_document_watermark_export_access_grants(organization_id,export_id,actor_user_id,idempotency_key,request_digest,access_mode,token_sha256,expires_at) values(p_organization_id,e.id,p_actor_user_id,p_idempotency_key,v_digest,'delivery',encode(extensions.digest(v_token,'sha256'),'hex'),clock_timestamp()+interval '5 minutes') returning * into g;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.watermark_export_delivery_authorized','evidence_document_watermark_export',e.id::text,jsonb_build_object('grantId',g.id,'exportId',e.id));
 return query select 'ready',jsonb_build_object('token',v_token,'expiresAt',g.expires_at,'fileName','watermarked-'||e.id::text||case when e.derivative_media_type='application/pdf' then '.pdf' when e.derivative_media_type='image/jpeg' then '.jpg' when e.derivative_media_type='image/png' then '.png' else '.webp' end,'mediaType',e.derivative_media_type);
end $$;

create or replace function public.redeem_evidence_document_watermark_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_export_id uuid,p_token_sha256 text,p_delivery boolean,p_correlation_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.evidence_document_watermark_export_access_grants%rowtype; e public.evidence_document_watermark_exports%rowtype; d public.evidence_documents%rowtype;
begin
 if p_token_sha256 !~ '^[a-f0-9]{64}$' or p_correlation_id is null or not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 select * into g from public.evidence_document_watermark_export_access_grants where organization_id=p_organization_id and export_id=p_export_id and token_sha256=p_token_sha256 for update;
 if not found or g.actor_user_id<>p_actor_user_id or g.terminal_outcome='revoked' or (p_delivery and g.access_mode<>'delivery') or (not p_delivery and g.access_mode<>'preview') then return query select 'forbidden',null::jsonb; return; end if;
 if g.expires_at<clock_timestamp() then update public.evidence_document_watermark_export_access_grants set terminal_outcome='expired' where id=g.id; return query select 'expired',null::jsonb; return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id and status='ready'; select * into d from public.evidence_documents where organization_id=p_organization_id and id=e.document_id and lifecycle_state='active';
 if not found then return query select 'unavailable',null::jsonb; return; end if;
 update public.evidence_document_watermark_export_access_grants set previewed_at=case when p_delivery then previewed_at else coalesce(previewed_at,clock_timestamp()) end,delivered_at=case when p_delivery then coalesce(delivered_at,clock_timestamp()) else delivered_at end,terminal_outcome=case when p_delivery then 'delivered' else 'previewed' end where id=g.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,case when p_delivery then 'evidence.watermark_export_delivered' else 'evidence.watermark_export_previewed' end,'evidence_document_watermark_export',e.id::text,jsonb_build_object('grantId',g.id,'correlationId',p_correlation_id));
 return query select 'redeemed',jsonb_build_object('objectBucket','evidence-watermark-exports','objectKey',e.derivative_object_key,'sha256',e.derivative_sha256,'byteSize',e.derivative_byte_size,'mediaType',e.derivative_media_type,'fileName','watermarked-'||e.id::text);
end $$;

create or replace function public.m8_06_enqueue_watermark_cleanup_after_deletion_intent() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.evidence_document_watermark_export_access_grants g set terminal_outcome='revoked',expires_at=least(g.expires_at,clock_timestamp()) from public.evidence_document_watermark_exports e where e.organization_id=new.organization_id and e.document_id=new.document_id and e.id=g.export_id and g.terminal_outcome is null;
 insert into public.evidence_document_deletion_cleanup_items(organization_id,intent_id,version_id,object_bucket,object_key) select new.organization_id,new.id,e.version_id,'evidence-watermark-exports',e.derivative_object_key from public.evidence_document_watermark_exports e where e.organization_id=new.organization_id and e.document_id=new.document_id and e.status='ready' and e.derivative_object_key is not null on conflict (organization_id,intent_id,object_bucket,object_key) do nothing;
 update public.evidence_document_watermark_exports set status='cancelled',failure_code='cancelled',lease_owner=null,lease_expires_at=null where organization_id=new.organization_id and document_id=new.document_id and status in ('queued','failed','claimed');
 return new;
end $$;

revoke all on function public.create_evidence_document_watermark_export_delivery_atomic(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_evidence_document_watermark_export_delivery_atomic(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
