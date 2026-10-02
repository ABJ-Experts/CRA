-- Recompile corrected M8-06 batch RPC bodies on installations that applied
-- the first migration before contract alignment. This is additive only.
create or replace function public.m8_06_bulk_suggested_class(p_filename text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case
    when lower(p_filename) ~ '(^|[^[:alnum:]_])(risk|hazard|threat|assessment)([^[:alnum:]_]|$)' then 'risk_assessment'
    when lower(p_filename) ~ '(^|[^[:alnum:]_])(test|verification|validation|report)([^[:alnum:]_]|$)' then 'test_report'
    when lower(p_filename) ~ 'policy' then 'policy'
    when lower(p_filename) ~ '(^|[^[:alnum:]_])(procedure|process|sop|work[-_ ]?instruction)([^[:alnum:]_]|$)' then 'procedure'
    when lower(p_filename) ~ '(^|[^[:alnum:]_])(supplier|attestation|declaration)([^[:alnum:]_]|$)' then 'supplier_attestation'
    when lower(p_filename) ~ '(^|[^[:alnum:]_])(certificate|certification|cert)([^[:alnum:]_]|$)' then 'certificate'
    when lower(p_filename) ~ '(^|[^[:alnum:]_])(architecture|design|diagram)([^[:alnum:]_]|$)' then 'architecture_document'
    else 'other' end
$$;

create or replace function public.m8_06_bulk_item_json(p_organization_id uuid,p_item_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',i.id,'clientItemId',i.client_item_id,'title',i.title,'ownerUserId',i.owner_user_id,
    'productIds',to_jsonb(i.product_ids),'validFrom',case when i.valid_from is null then null else to_char(i.valid_from::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'validUntil',case when i.valid_until is null then null else to_char(i.valid_until::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'fileName',i.original_filename,'byteSize',i.declared_size_bytes,'status',i.state,
    'classification',jsonb_build_object('source',i.suggestion_source,'suggestedDocumentClass',i.suggested_document_class,'documentClass',i.selected_document_class,'decision',i.classification_decision,'decidedByUserId',i.classification_confirmed_by_user_id,'decidedAt',case when i.classification_confirmed_at is null then null else to_char(i.classification_confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end),
    'documentId',i.document_id,'versionId',i.current_version_id,'errorCode',i.error_code,
    'createdAt',to_char(i.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(i.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  from public.evidence_bulk_intake_items i where i.organization_id=p_organization_id and i.id=p_item_id
$$;

create or replace function public.m8_06_bulk_batch_json(p_organization_id uuid,p_batch_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',b.id,'productId',b.product_id,'createdByUserId',b.created_by_user_id,'status',b.state,
    'createdAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(b.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'counts',jsonb_build_object('total',count(i.id),'unconfirmed',count(*) filter(where i.state='unconfirmed'),'ready',count(*) filter(where i.state='ready'),'uploading',count(*) filter(where i.state='uploading'),'scanPending',count(*) filter(where i.state='scan_pending'),
      'clean',count(*) filter(where i.state='clean'),'quarantined',count(*) filter(where i.state='quarantined'),'failed',count(*) filter(where i.state='failed'),'cancelled',count(*) filter(where i.state='cancelled'),'success',count(*) filter(where i.state='clean'),'pending',count(*) filter(where i.state in ('unconfirmed','ready','uploading','scan_pending')),'rejected',count(*) filter(where i.state in ('quarantined','failed'))),
    'items',coalesce(jsonb_agg(public.m8_06_bulk_item_json(p_organization_id,i.id) order by i.ordinal),'[]'::jsonb))
  from public.evidence_bulk_intake_batches b left join public.evidence_bulk_intake_items i on i.organization_id=b.organization_id and i.batch_id=b.id
  where b.organization_id=p_organization_id and b.id=p_batch_id group by b.id
$$;

create or replace function public.create_evidence_bulk_intake_batch_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_items jsonb,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.evidence_bulk_intake_batches%rowtype; x jsonb; n integer:=0; total_bytes bigint:=0; v_digest text;
begin
  if p_idempotency_key is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20
    or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(p_items::text,'sha256'),'hex');
  select * into b from public.evidence_bulk_intake_batches where organization_id=p_organization_id and created_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then return query select case when b.request_digest=v_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('batch',public.m8_06_bulk_batch_json(p_organization_id,b.id)); return; end if;
  if not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null) then return query select 'not_found',null::jsonb; return; end if;
  for x in select value from jsonb_array_elements(p_items) loop
    n:=n+1; total_bytes:=total_bytes+coalesce(coalesce(x->>'declaredByteSize',x->>'byteSize')::bigint,0);
    if x ?& array['clientItemId','idempotencyKey','title','ownerUserId','productIds','fileName'] is false or coalesce(x->>'declaredByteSize',x->>'byteSize') is null or x->>'title'<>btrim(x->>'title') or char_length(x->>'title') not between 1 and 500 or x->>'title'~'[[:cntrl:]]'
      or x->>'fileName'<>btrim(x->>'fileName') or char_length(x->>'fileName') not between 1 and 255 or x->>'fileName'~'[[:cntrl:]/\\]'
      or coalesce(coalesce(x->>'declaredByteSize',x->>'byteSize')::bigint,0) not between 1 and 52428800
      or not exists(select 1 from public.users u where u.id=(x->>'ownerUserId')::uuid)
      or jsonb_typeof(x->'productIds')<>'array' or jsonb_array_length(x->'productIds') not between 1 and 100
      or exists(select 1 from jsonb_array_elements_text(x->'productIds') q(product_id) left join public.products p on p.organization_id=p_organization_id and p.id=q.product_id::uuid where p.id is null or p.archived_at is not null)
      or not exists(select 1 from jsonb_array_elements_text(x->'productIds') q(product_id) where q.product_id::uuid=p_product_id)
      or x->'classification'->>'source'<>'filename_rules_v1' or x->'classification'->>'suggestedDocumentClass' is distinct from public.m8_06_bulk_suggested_class(x->>'fileName')
      or ((x->>'validFrom') is not null and (x->>'validUntil') is not null and (x->>'validFrom')::date>(x->>'validUntil')::date)
    then return query select 'invalid_request',null::jsonb; return; end if;
  end loop;
  if total_bytes>262144000 then return query select 'invalid_request',null::jsonb; return; end if;
  insert into public.evidence_bulk_intake_batches(organization_id,product_id,created_by_user_id,idempotency_key,request_digest) values(p_organization_id,p_product_id,p_actor_user_id,p_idempotency_key,v_digest) returning * into b;
  insert into public.evidence_bulk_intake_items(organization_id,batch_id,client_item_id,intake_idempotency_key,ordinal,title,owner_user_id,product_ids,valid_from,valid_until,original_filename,declared_size_bytes,suggested_document_class,suggestion_source)
  select p_organization_id,b.id,(input_item->>'clientItemId')::uuid,(input_item->>'idempotencyKey')::uuid,ord::integer,input_item->>'title',(input_item->>'ownerUserId')::uuid,array(select y::uuid from jsonb_array_elements_text(input_item->'productIds') y),(input_item->>'validFrom')::date,(input_item->>'validUntil')::date,input_item->>'fileName',coalesce(input_item->>'declaredByteSize',input_item->>'byteSize')::bigint,public.m8_06_bulk_suggested_class(input_item->>'fileName'),'filename_rules_v1'
  from jsonb_array_elements(p_items) with ordinality as q(input_item,ord);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.bulk_intake_created','evidence_bulk_intake_batch',b.id::text,jsonb_build_object('productId',p_product_id,'itemCount',n,'idempotencyKey',p_idempotency_key));
  return query select 'created',jsonb_build_object('batch',public.m8_06_bulk_batch_json(p_organization_id,b.id));
end $$;

create or replace function public.initialize_evidence_bulk_intake_item_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid,p_document_class text,p_classification_decision text,p_object_key text,p_upload_expires_at timestamptz,p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.evidence_bulk_intake_batches%rowtype; i public.evidence_bulk_intake_items%rowtype; r record; v_attempt integer; v_decision text;
begin
  if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_document_class not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other') or p_classification_decision not in ('accepted','corrected')
    or p_object_key is null or p_object_key<>btrim(p_object_key) or p_object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    or p_upload_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '30 minutes'
    or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
  select * into b from public.evidence_bulk_intake_batches where organization_id=p_organization_id and id=p_batch_id and product_id=p_product_id for update;
  select * into i from public.evidence_bulk_intake_items where organization_id=p_organization_id and id=p_item_id and batch_id=p_batch_id for update;
  if not found or b.id is null then return query select 'not_found',null::jsonb; return; end if;
  if b.created_by_user_id<>p_actor_user_id or b.state<>'active' or i.state='cancelled' then return query select 'conflict',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
  if i.current_version_id is not null then return query select 'conflict',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
  v_decision:=case when p_document_class=i.suggested_document_class then 'accepted' else 'corrected' end;
  if v_decision<>p_classification_decision then return query select 'invalid_request',null::jsonb; return; end if;
  select * into r from public.reserve_evidence_document_upload_atomic(p_organization_id,p_actor_user_id,i.title,p_document_class,i.owner_user_id,i.product_ids,i.valid_from,i.valid_until,i.original_filename,i.declared_size_bytes,p_object_key,p_upload_expires_at,p_idempotency_key,p_request_digest);
  if r.outcome not in ('reserved','replayed') then return query select r.outcome,r.result; return; end if;
  v_attempt:=coalesce((select max(attempt_number) from public.evidence_bulk_intake_attempts where organization_id=p_organization_id and batch_item_id=i.id),0)+1;
  insert into public.evidence_bulk_intake_attempts(organization_id,batch_item_id,attempt_number,document_id,version_id,object_key,initialize_idempotency_key)
  values(p_organization_id,i.id,v_attempt,(r.result->>'documentId')::uuid,(r.result->>'versionId')::uuid,p_object_key,p_idempotency_key) on conflict (organization_id,version_id) do nothing;
  update public.evidence_bulk_intake_items set selected_document_class=p_document_class,classification_decision=v_decision,classification_confirmed_by_user_id=p_actor_user_id,classification_confirmed_at=clock_timestamp(),state='ready',document_id=(r.result->>'documentId')::uuid,current_version_id=(r.result->>'versionId')::uuid,updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.id;
  return query select case when r.outcome='replayed' then 'replayed' else 'reserved' end,r.result || jsonb_build_object('declaredByteSize',i.declared_size_bytes,'item',public.m8_06_bulk_item_json(p_organization_id,i.id));
end $$;

create or replace function public.complete_evidence_bulk_intake_item_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid,p_version_id uuid,p_actual_size_bytes bigint,p_detected_media_type text,p_original_sha256 text,p_failure_code text,p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.evidence_bulk_intake_items%rowtype; r record;
begin
  select bi.* into i from public.evidence_bulk_intake_items bi join public.evidence_bulk_intake_batches b on b.organization_id=bi.organization_id and b.id=bi.batch_id and b.product_id=p_product_id and b.created_by_user_id=p_actor_user_id where bi.organization_id=p_organization_id and bi.id=p_item_id and bi.batch_id=p_batch_id for update;
  if not found or i.current_version_id<>p_version_id then return query select 'not_found',null::jsonb; return; end if;
  if i.state='cancelled' then return query select 'cancelled',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
  select * into r from public.finalize_evidence_document_upload_atomic(p_organization_id,p_actor_user_id,p_version_id,p_actual_size_bytes,p_detected_media_type,p_original_sha256,p_idempotency_key,p_request_digest);
  update public.evidence_bulk_intake_items set state=case when r.outcome in ('scan_pending','replayed') then 'scan_pending' when r.outcome='failed' then 'failed' else state end,updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.id;
  return query select r.outcome,coalesce(r.result,'{}'::jsonb)||jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id));
end $$;

create or replace function public.get_evidence_bulk_intake_item_upload_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('objectKey',a.object_key,'versionId',a.version_id,'declaredByteSize',i.declared_size_bytes) from public.evidence_bulk_intake_items i join public.evidence_bulk_intake_batches b on b.organization_id=i.organization_id and b.id=i.batch_id and b.product_id=p_product_id join public.evidence_bulk_intake_attempts a on a.organization_id=i.organization_id and a.version_id=i.current_version_id where i.organization_id=p_organization_id and i.batch_id=p_batch_id and i.id=p_item_id and i.state in ('ready','uploading');
 if found then return; end if;
 return query select 'not_found',null::jsonb;
end $$;

create or replace function public.get_evidence_bulk_intake_batch_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 if not exists(select 1 from public.evidence_bulk_intake_batches b where b.organization_id=p_organization_id and b.id=p_batch_id and b.product_id=p_product_id and b.created_by_user_id=p_actor_user_id) then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('batch',public.m8_06_bulk_batch_json(p_organization_id,p_batch_id));
end $$;

create or replace function public.cancel_evidence_bulk_intake_item_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.evidence_bulk_intake_items%rowtype;
begin
 if p_idempotency_key is null or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 select bi.* into i from public.evidence_bulk_intake_items bi join public.evidence_bulk_intake_batches b on b.organization_id=bi.organization_id and b.id=bi.batch_id and b.product_id=p_product_id where bi.organization_id=p_organization_id and bi.batch_id=p_batch_id and bi.id=p_item_id and b.created_by_user_id=p_actor_user_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if i.state='cancelled' then return query select 'replayed',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
 if i.state in ('clean','quarantined','failed','scan_pending') then return query select 'conflict',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
 update public.evidence_bulk_intake_items set state='cancelled',cancelled_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.bulk_intake_item_cancelled','evidence_bulk_intake_item',i.id::text,jsonb_build_object('batchId',p_batch_id,'idempotencyKey',p_idempotency_key));
 return query select 'cancelled',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id));
end $$;


notify pgrst,'reload schema';
