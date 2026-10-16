-- Fix an ambiguous PL/pgSQL alias in the M8-05 access-revocation override.
-- This changes no evidence data or retention state.
create or replace function public.redeem_evidence_document_access_atomic(p_organization_id uuid,p_actor_user_id uuid,p_token_sha256 text,p_request_correlation_id uuid,p_range_start bigint default null,p_range_end bigint default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.evidence_document_access_grants%rowtype; v_version public.evidence_document_versions%rowtype;
begin
 if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' or p_request_correlation_id is null or ((p_range_start is null)<>(p_range_end is null)) or (p_range_start is not null and (p_range_start<0 or p_range_end<p_range_start)) or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 select * into g from public.evidence_document_access_grants where organization_id=p_organization_id and token_sha256=p_token_sha256 for update;
 if not found or g.actor_user_id<>p_actor_user_id or g.terminal_outcome='revoked' then return query select 'forbidden',null::jsonb; return; end if;
 if g.expires_at<clock_timestamp() then update public.evidence_document_access_grants set terminal_outcome='expired' where id=g.id; return query select 'expired',null::jsonb; return; end if;
 select ev.* into v_version from public.evidence_document_versions ev join public.evidence_documents d on d.organization_id=ev.organization_id and d.id=ev.document_id and d.lifecycle_state='active' where ev.organization_id=p_organization_id and ev.id=g.version_id and ev.document_id=g.document_id;
 if not found or v_version.processing_state<>'clean' or (v_version.validity_ends_on is not null and v_version.validity_ends_on<current_date) or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=g.product_id and p.archived_at is null) or not exists(select 1 from public.evidence_document_version_products vp where vp.organization_id=p_organization_id and vp.version_id=v_version.id and vp.product_id=g.product_id) then return query select 'unavailable',null::jsonb; return; end if;
 if p_range_start is not null and p_range_end>=v_version.actual_size_bytes then return query select 'invalid_range',null::jsonb; return; end if;
 update public.evidence_document_access_grants set first_redeemed_at=coalesce(first_redeemed_at,clock_timestamp()),last_redeemed_at=clock_timestamp(),redemption_count=redemption_count+1,first_range_start=coalesce(first_range_start,p_range_start),first_range_end=coalesce(first_range_end,p_range_end),last_range_start=p_range_start,last_range_end=p_range_end,terminal_outcome='delivered' where id=g.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.byte_delivery_started','evidence_document_version',v_version.id::text,jsonb_build_object('grantId',g.id,'documentId',g.document_id,'mode',g.access_mode,'purpose',g.purpose,'correlationId',p_request_correlation_id,'rangeStart',p_range_start,'rangeEnd',p_range_end));
 return query select 'redeemed',jsonb_build_object('grantId',g.id,'documentId',g.document_id,'versionId',v_version.id,'objectBucket',v_version.object_bucket,'objectKey',v_version.object_key,'filename',v_version.original_filename,'mediaType',v_version.detected_media_type,'byteSize',v_version.actual_size_bytes,'sha256',v_version.original_sha256,'mode',g.access_mode,'expiresAt',g.expires_at);
end $$;

revoke all on function public.redeem_evidence_document_access_atomic(uuid,uuid,text,uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.redeem_evidence_document_access_atomic(uuid,uuid,text,uuid,bigint,bigint) to service_role;
notify pgrst,'reload schema';
