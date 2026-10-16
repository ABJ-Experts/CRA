-- Forward-only retry and self-scope alignment for an already-applied M8-06
-- development migration.  No existing evidence bytes or rows are removed.

create or replace function public.retry_evidence_bulk_intake_item_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid,p_document_class text,p_classification_decision text,p_original_filename text,p_declared_size_bytes bigint,p_object_key text,p_upload_expires_at timestamptz,p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.evidence_bulk_intake_batches%rowtype; i public.evidence_bulk_intake_items%rowtype; r record; v_attempt integer;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_document_class not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other') or p_classification_decision not in ('accepted','corrected') or p_original_filename is null or p_original_filename<>btrim(p_original_filename) or char_length(p_original_filename) not between 1 and 255 or p_original_filename~'[[:cntrl:]/\\]' or p_declared_size_bytes not between 1 and 52428800 or p_object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$' or p_upload_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '30 minutes' or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 select * into b from public.evidence_bulk_intake_batches where organization_id=p_organization_id and id=p_batch_id and product_id=p_product_id for update;
 select * into i from public.evidence_bulk_intake_items where organization_id=p_organization_id and id=p_item_id and batch_id=p_batch_id for update;
 if not found or b.id is null then return query select 'not_found',null::jsonb; return; end if;
 if b.created_by_user_id<>p_actor_user_id or b.state<>'active' or i.state not in ('cancelled','failed','quarantined') or (case when p_document_class=i.suggested_document_class then 'accepted' else 'corrected' end)<>p_classification_decision then return query select 'conflict',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
 select * into r from public.reserve_evidence_document_replacement_atomic(p_organization_id,p_actor_user_id,i.document_id,i.current_version_id,i.title,p_document_class,i.owner_user_id,i.product_ids,i.valid_from,i.valid_until,p_original_filename,p_declared_size_bytes,p_object_key,p_upload_expires_at,p_idempotency_key,p_request_digest);
 if r.outcome not in ('reserved','replayed') then return query select r.outcome,r.result; return; end if;
 v_attempt:=coalesce((select max(attempt_number) from public.evidence_bulk_intake_attempts where organization_id=p_organization_id and batch_item_id=i.id),0)+1;
 insert into public.evidence_bulk_intake_attempts(organization_id,batch_item_id,attempt_number,document_id,version_id,object_key,initialize_idempotency_key) values(p_organization_id,i.id,v_attempt,(r.result->>'documentId')::uuid,(r.result->>'versionId')::uuid,p_object_key,p_idempotency_key) on conflict (organization_id,version_id) do nothing;
 update public.evidence_bulk_intake_items set original_filename=p_original_filename,declared_size_bytes=p_declared_size_bytes,selected_document_class=p_document_class,classification_decision=p_classification_decision,classification_confirmed_by_user_id=p_actor_user_id,classification_confirmed_at=clock_timestamp(),state='ready',error_code=null,cancelled_at=null,document_id=(r.result->>'documentId')::uuid,current_version_id=(r.result->>'versionId')::uuid,updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.id;
 return query select case when r.outcome='replayed' then 'replayed' else 'reserved' end,r.result||jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id),'declaredByteSize',p_declared_size_bytes);
end $$;

create or replace function public.get_evidence_bulk_intake_item_upload_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('objectKey',a.object_key,'versionId',a.version_id,'declaredByteSize',i.declared_size_bytes) from public.evidence_bulk_intake_items i join public.evidence_bulk_intake_batches b on b.organization_id=i.organization_id and b.id=i.batch_id and b.product_id=p_product_id and b.created_by_user_id=p_actor_user_id join public.evidence_bulk_intake_attempts a on a.organization_id=i.organization_id and a.version_id=i.current_version_id where i.organization_id=p_organization_id and i.batch_id=p_batch_id and i.id=p_item_id and i.state in ('ready','uploading');
 if found then return; end if; return query select 'not_found',null::jsonb;
end $$;

revoke all on function public.retry_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.retry_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,timestamptz,uuid,text) to service_role;
notify pgrst,'reload schema';
