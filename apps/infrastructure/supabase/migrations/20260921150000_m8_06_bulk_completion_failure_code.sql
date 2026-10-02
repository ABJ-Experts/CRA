-- Persist only bounded, user-safe bulk completion failures. Provider detail is
-- deliberately mapped rather than copied into durable evidence metadata.
create or replace function public.complete_evidence_bulk_intake_item_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid,p_version_id uuid,p_actual_size_bytes bigint,p_detected_media_type text,p_original_sha256 text,p_failure_code text,p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.evidence_bulk_intake_items%rowtype; r record; v_safe_failure text;
begin
  if p_failure_code is not null and p_failure_code not in ('source_missing','storage_unavailable','size_exceeded','unsupported_or_disguised_content') then return query select 'invalid_request',null::jsonb; return; end if;
  select bi.* into i from public.evidence_bulk_intake_items bi join public.evidence_bulk_intake_batches b on b.organization_id=bi.organization_id and b.id=bi.batch_id and b.product_id=p_product_id and b.created_by_user_id=p_actor_user_id where bi.organization_id=p_organization_id and bi.id=p_item_id and bi.batch_id=p_batch_id for update;
  if not found or i.current_version_id<>p_version_id then return query select 'not_found',null::jsonb; return; end if;
  if i.state='cancelled' then return query select 'cancelled',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
  select * into r from public.finalize_evidence_document_upload_atomic(p_organization_id,p_actor_user_id,p_version_id,p_actual_size_bytes,p_detected_media_type,p_original_sha256,p_idempotency_key,p_request_digest);
  v_safe_failure:=case p_failure_code when 'source_missing' then 'storage_failed' when 'storage_unavailable' then 'storage_failed' when 'size_exceeded' then 'invalid_content' when 'unsupported_or_disguised_content' then 'invalid_content' else 'conflict' end;
  update public.evidence_bulk_intake_items set state=case when r.outcome='scan_pending' or (r.outcome='replayed' and r.result->>'state'='scan_pending') then 'scan_pending' when r.outcome='failed' then 'failed' else state end,error_code=case when r.outcome='failed' then v_safe_failure when r.outcome='scan_pending' or (r.outcome='replayed' and r.result->>'state'='scan_pending') then null else error_code end,updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.id;
  return query select r.outcome,coalesce(r.result,'{}'::jsonb)||jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id));
end $$;
revoke all on function public.complete_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,text) to service_role;
notify pgrst,'reload schema';

