-- A preview bearer token must never be usable through the delivery path.
-- This is forward-only and preserves existing grants and audit history.
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

revoke all on function public.redeem_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.redeem_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text,boolean,uuid) to service_role;
notify pgrst,'reload schema';
