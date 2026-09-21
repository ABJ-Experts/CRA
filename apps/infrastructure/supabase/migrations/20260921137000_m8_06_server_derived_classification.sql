-- Client bulk metadata intentionally omits classification. Suggestions are
-- derived only by m8_06_bulk_suggested_class and remain unconfirmed.
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

notify pgrst,'reload schema';
