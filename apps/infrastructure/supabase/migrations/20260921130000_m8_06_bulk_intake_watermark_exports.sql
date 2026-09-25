-- M8-06: bounded reviewable intake and recipient-watermarked derivatives.
-- Originals remain immutable in evidence-documents.  This migration records
-- only metadata and opaque private object paths; recipient/purpose never form
-- part of an object key or an audit payload.

create table public.evidence_bulk_intake_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'active' check (state in ('active','cancelled','completed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,created_by_user_id,idempotency_key),
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict
);

create table public.evidence_bulk_intake_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  client_item_id uuid not null,
  intake_idempotency_key uuid not null,
  ordinal integer not null check (ordinal between 1 and 20),
  title text not null check (title=btrim(title) and char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'),
  owner_user_id uuid not null references public.users(id) on delete restrict,
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 100),
  valid_from date,
  valid_until date,
  original_filename text not null check (original_filename=btrim(original_filename) and char_length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]/\\]'),
  declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800),
  suggested_document_class text not null check (suggested_document_class in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')),
  suggestion_source text not null check (suggestion_source='filename_rules_v1'),
  selected_document_class text check (selected_document_class is null or selected_document_class in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')),
  classification_decision text not null default 'unconfirmed' check (classification_decision in ('unconfirmed','accepted','corrected')),
  classification_confirmed_by_user_id uuid references public.users(id) on delete restrict,
  classification_confirmed_at timestamptz,
  state text not null default 'unconfirmed' check (state in ('unconfirmed','ready','uploading','scan_pending','clean','quarantined','failed','cancelled')),
  error_code text check (error_code is null or error_code in ('upload_expired','upload_cancelled','invalid_content','scan_unavailable','scan_failed','malware_detected','storage_failed','conflict')),
  document_id uuid,
  current_version_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,batch_id,ordinal),
  unique (organization_id,batch_id,client_item_id),
  unique (organization_id,batch_id,intake_idempotency_key),
  foreign key (organization_id,batch_id) references public.evidence_bulk_intake_batches(organization_id,id) on delete restrict,
  foreign key (organization_id,document_id) references public.evidence_documents(organization_id,id) on delete restrict,
  foreign key (organization_id,current_version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
  check ((classification_decision='unconfirmed' and selected_document_class is null and classification_confirmed_by_user_id is null and classification_confirmed_at is null)
    or (classification_decision in ('accepted','corrected') and selected_document_class is not null and classification_confirmed_by_user_id is not null and classification_confirmed_at is not null)),
  check ((state='cancelled') = (cancelled_at is not null)),
  check (valid_until is null or valid_from is null or valid_until>=valid_from),
  check ((state='failed')=(error_code is not null))
);

create table public.evidence_bulk_intake_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_item_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  document_id uuid not null,
  version_id uuid not null,
  object_key text not null check (object_key=btrim(object_key) and char_length(object_key) between 1 and 1000 and object_key !~ '[[:cntrl:] ]'),
  initialize_idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,batch_item_id,attempt_number),
  unique (organization_id,version_id),
  foreign key (organization_id,batch_item_id) references public.evidence_bulk_intake_items(organization_id,id) on delete restrict,
  foreign key (organization_id,document_id) references public.evidence_documents(organization_id,id) on delete restrict,
  foreign key (organization_id,version_id) references public.evidence_document_versions(organization_id,id) on delete restrict
);
create index evidence_bulk_intake_batches_product_idx on public.evidence_bulk_intake_batches(organization_id,product_id,created_at desc,id desc);
create index evidence_bulk_intake_items_batch_idx on public.evidence_bulk_intake_items(organization_id,batch_id,ordinal);
create index evidence_bulk_intake_attempts_version_idx on public.evidence_bulk_intake_attempts(organization_id,version_id);

create table public.evidence_document_watermark_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  original_sha256 text not null check (original_sha256 ~ '^[a-f0-9]{64}$'),
  original_byte_size bigint not null check (original_byte_size between 1 and 52428800),
  original_media_type text not null check (original_media_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  recipient text not null check (recipient=btrim(recipient) and char_length(recipient) between 1 and 160 and recipient !~ '[[:cntrl:]]'),
  purpose text not null check (purpose=btrim(purpose) and char_length(purpose) between 1 and 160 and purpose !~ '[[:cntrl:]]'),
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued','claimed','ready','failed','cancelled')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  derivative_object_key text check (derivative_object_key is null or (derivative_object_key=btrim(derivative_object_key) and char_length(derivative_object_key) between 1 and 1000 and derivative_object_key !~ '[[:cntrl:] ]')),
  derivative_sha256 text check (derivative_sha256 is null or derivative_sha256 ~ '^[a-f0-9]{64}$'),
  derivative_byte_size bigint check (derivative_byte_size is null or derivative_byte_size between 1 and 52428800),
  derivative_media_type text check (derivative_media_type is null or derivative_media_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  failure_code text check (failure_code is null or failure_code in ('unsupported_media_type','source_not_clean','source_unavailable','source_integrity_failed','source_malformed','renderer_unavailable','page_limit','output_limit','storage_failed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,requested_by_user_id,idempotency_key),
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict,
  foreign key (organization_id,document_id) references public.evidence_documents(organization_id,id) on delete restrict,
  foreign key (organization_id,version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
  check ((status='claimed' and lease_owner is not null and lease_expires_at is not null) or (status<>'claimed' and lease_owner is null and lease_expires_at is null)),
  check ((status='ready' and derivative_object_key is not null and derivative_sha256 is not null and derivative_byte_size is not null and derivative_media_type is not null and completed_at is not null) or status<>'ready')
);
create index evidence_watermark_export_claim_idx on public.evidence_document_watermark_exports(status,created_at,id) where status in ('queued','failed');
create index evidence_watermark_export_version_idx on public.evidence_document_watermark_exports(organization_id,version_id,requested_at desc,id desc);

create table public.evidence_document_watermark_export_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  access_mode text not null default 'preview',
  token_sha256 text not null check (token_sha256 ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  previewed_at timestamptz,
  delivered_at timestamptz,
  terminal_outcome text check (terminal_outcome is null or terminal_outcome in ('previewed','delivered','expired','revoked')),
  unique (organization_id,id),
  unique (organization_id,actor_user_id,idempotency_key),
  unique (token_sha256),
  foreign key (organization_id,export_id) references public.evidence_document_watermark_exports(organization_id,id) on delete restrict,
  check (expires_at > issued_at)
);
create index evidence_watermark_access_redeem_idx on public.evidence_document_watermark_export_access_grants(organization_id,actor_user_id,expires_at,id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('evidence-watermark-exports','evidence-watermark-exports',false,52428800,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;

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

-- A retry is deliberately a fresh immutable reservation.  It is only allowed
-- after a user-cancelled, never-finalized transfer; clean, quarantined, and
-- failed evidence is not silently replaced or reclassified by this shortcut.
create or replace function public.retry_evidence_bulk_intake_item_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_batch_id uuid,p_item_id uuid,p_document_class text,p_classification_decision text,p_original_filename text,p_declared_size_bytes bigint,p_object_key text,p_upload_expires_at timestamptz,p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.evidence_bulk_intake_batches%rowtype; i public.evidence_bulk_intake_items%rowtype; r record; v_attempt integer;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_document_class not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other') or p_classification_decision not in ('accepted','corrected') or p_original_filename is null or p_original_filename<>btrim(p_original_filename) or char_length(p_original_filename) not between 1 and 255 or p_original_filename~'[[:cntrl:]/\\]' or p_declared_size_bytes not between 1 and 52428800 or p_object_key is null or p_object_key<>btrim(p_object_key) or p_object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$' or p_upload_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '30 minutes' or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 select * into b from public.evidence_bulk_intake_batches where organization_id=p_organization_id and id=p_batch_id and product_id=p_product_id for update;
 select * into i from public.evidence_bulk_intake_items where organization_id=p_organization_id and id=p_item_id and batch_id=p_batch_id for update;
 if not found or b.id is null then return query select 'not_found',null::jsonb; return; end if;
 if b.created_by_user_id<>p_actor_user_id or b.state<>'active' or i.selected_document_class is null then return query select 'conflict',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
 if (case when p_document_class=i.suggested_document_class then 'accepted' else 'corrected' end)<>p_classification_decision then return query select 'invalid_request',null::jsonb; return; end if;
 if i.state not in ('cancelled','failed','quarantined') then return query select 'conflict',jsonb_build_object('item',public.m8_06_bulk_item_json(p_organization_id,i.id)); return; end if;
 select * into r from public.reserve_evidence_document_replacement_atomic(p_organization_id,p_actor_user_id,i.document_id,i.current_version_id,i.title,p_document_class,i.owner_user_id,i.product_ids,i.valid_from,i.valid_until,p_original_filename,p_declared_size_bytes,p_object_key,p_upload_expires_at,p_idempotency_key,p_request_digest);
 if r.outcome not in ('reserved','replayed') then return query select r.outcome,r.result; return; end if;
 v_attempt:=coalesce((select max(attempt_number) from public.evidence_bulk_intake_attempts where organization_id=p_organization_id and batch_item_id=i.id),0)+1;
 insert into public.evidence_bulk_intake_attempts(organization_id,batch_item_id,attempt_number,document_id,version_id,object_key,initialize_idempotency_key) values(p_organization_id,i.id,v_attempt,(r.result->>'documentId')::uuid,(r.result->>'versionId')::uuid,p_object_key,p_idempotency_key) on conflict (organization_id,version_id) do nothing;
 update public.evidence_bulk_intake_items set original_filename=p_original_filename,declared_size_bytes=p_declared_size_bytes,selected_document_class=p_document_class,classification_decision=p_classification_decision,classification_confirmed_by_user_id=p_actor_user_id,classification_confirmed_at=clock_timestamp(),state='ready',error_code=null,cancelled_at=null,document_id=(r.result->>'documentId')::uuid,current_version_id=(r.result->>'versionId')::uuid,updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.bulk_intake_item_retried','evidence_bulk_intake_item',i.id::text,jsonb_build_object('batchId',p_batch_id,'attempt',v_attempt,'idempotencyKey',p_idempotency_key));
 return query select case when r.outcome='replayed' then 'replayed' else 'reserved' end,r.result || jsonb_build_object('declaredByteSize',i.declared_size_bytes,'item',public.m8_06_bulk_item_json(p_organization_id,i.id));
end $$;

create or replace function public.m8_06_sync_bulk_item_from_version() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.evidence_bulk_intake_items i set state=case new.processing_state when 'uploading' then 'ready' else new.processing_state end,error_code=case when new.processing_state='failed' then case new.failure_code when 'upload_expired' then 'upload_expired' when 'scan_failed' then 'scan_failed' when 'object_missing' then 'storage_failed' when 'content_invalid' then 'invalid_content' else 'conflict' end else null end,updated_at=clock_timestamp()
 from public.evidence_bulk_intake_attempts a where a.organization_id=new.organization_id and a.version_id=new.id and i.organization_id=a.organization_id and i.id=a.batch_item_id and i.current_version_id=new.id and i.state<>'cancelled';
 return new;
end $$;
create trigger m8_06_sync_bulk_item_from_version after update of processing_state on public.evidence_document_versions for each row execute function public.m8_06_sync_bulk_item_from_version();

create or replace function public.m8_06_block_cancelled_bulk_finalization() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.processing_state='uploading' and new.processing_state<>'uploading' and exists(select 1 from public.evidence_bulk_intake_attempts a join public.evidence_bulk_intake_items i on i.organization_id=a.organization_id and i.id=a.batch_item_id where a.organization_id=new.organization_id and a.version_id=new.id and i.state='cancelled') then raise exception using errcode='55000',message='Cancelled bulk intake item may not be finalized'; end if;
 return new;
end $$;
create trigger m8_06_block_cancelled_bulk_finalization before update of processing_state on public.evidence_document_versions for each row execute function public.m8_06_block_cancelled_bulk_finalization();

create or replace function public.m8_06_watermark_export_json(p_organization_id uuid,p_export_id uuid,p_include_confidential boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',e.id,'organizationId',e.organization_id,'productId',e.product_id,'documentId',e.document_id,'sourceVersionId',e.version_id,'sourceSha256',e.original_sha256,'requestedByUserId',e.requested_by_user_id,'requestedAt',to_char(e.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'recipient',case when p_include_confidential then e.recipient else null end,'purpose',case when p_include_confidential then e.purpose else null end,'status',e.status,'failureCode',e.failure_code,'derivative',case when e.status='ready' then jsonb_build_object('fileName','watermarked-'||e.id::text||case when e.derivative_media_type='application/pdf' then '.pdf' when e.derivative_media_type='image/jpeg' then '.jpg' when e.derivative_media_type='image/png' then '.png' else '.webp' end,'mediaType',e.derivative_media_type,'byteSize',e.derivative_byte_size,'sha256',e.derivative_sha256,'createdAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) else null end,'previewedAt',(select to_char(min(g.previewed_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.evidence_document_watermark_export_access_grants g where g.organization_id=e.organization_id and g.export_id=e.id and g.previewed_at is not null),'deliveredAt',(select to_char(min(g.delivered_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.evidence_document_watermark_export_access_grants g where g.organization_id=e.organization_id and g.export_id=e.id and g.delivered_at is not null)) from public.evidence_document_watermark_exports e where e.organization_id=p_organization_id and e.id=p_export_id
$$;

create or replace function public.create_evidence_document_watermark_export_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_document_id uuid,p_version_id uuid,p_recipient text,p_purpose text,p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; v public.evidence_document_versions%rowtype; d public.evidence_documents%rowtype; v_digest text;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_recipient is null or p_recipient<>btrim(p_recipient) or char_length(p_recipient) not between 1 and 160 or p_recipient~'[[:cntrl:]]' or p_purpose is null or p_purpose<>btrim(p_purpose) or char_length(p_purpose) not between 1 and 160 or p_purpose~'[[:cntrl:]]' or not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('productId',p_product_id,'documentId',p_document_id,'versionId',p_version_id,'recipient',p_recipient,'purpose',p_purpose)::text,'sha256'),'hex');
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and requested_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then return query select case when e.request_digest=p_request_digest and e.request_digest=v_digest then 'replayed' else 'idempotency_conflict' end,public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 select * into d from public.evidence_documents where organization_id=p_organization_id and id=p_document_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if d.lifecycle_state<>'active' then return query select 'lifecycle_blocked',jsonb_build_object('lifecycleState',d.lifecycle_state); return; end if;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=p_version_id and document_id=p_document_id for share;
 if not found or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null) or not exists(select 1 from public.evidence_document_version_products x where x.organization_id=p_organization_id and x.version_id=p_version_id and x.product_id=p_product_id) then return query select 'not_found',null::jsonb; return; end if;
 if v.processing_state<>'clean' or v.original_sha256 is null or v.actual_size_bytes is null then return query select 'not_clean',jsonb_build_object('state',v.processing_state); return; end if;
 if v.validity_ends_on is not null and v.validity_ends_on<current_date then return query select 'not_clean',jsonb_build_object('state','expired'); return; end if;
 if v.detected_media_type not in ('application/pdf','image/jpeg','image/png','image/webp') then return query select 'unsupported',jsonb_build_object('mediaType',v.detected_media_type); return; end if;
 if p_request_digest<>v_digest then return query select 'invalid_request',null::jsonb; return; end if;
 insert into public.evidence_document_watermark_exports(organization_id,product_id,document_id,version_id,original_sha256,original_byte_size,original_media_type,recipient,purpose,requested_by_user_id,idempotency_key,request_digest) values(p_organization_id,p_product_id,p_document_id,p_version_id,v.original_sha256,v.actual_size_bytes,v.detected_media_type,p_recipient,p_purpose,p_actor_user_id,p_idempotency_key,v_digest) returning * into e;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.watermark_export_queued','evidence_document_watermark_export',e.id::text,jsonb_build_object('documentId',p_document_id,'versionId',p_version_id,'productId',p_product_id,'requestDigest',v_digest));
 return query select 'queued',public.m8_06_watermark_export_json(p_organization_id,e.id,true);
end $$;

create or replace function public.get_evidence_document_watermark_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_document_id uuid,p_version_id uuid,p_export_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 if not exists(select 1 from public.evidence_document_watermark_exports e where e.organization_id=p_organization_id and e.id=p_export_id and e.product_id=p_product_id and e.document_id=p_document_id and e.version_id=p_version_id) then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',public.m8_06_watermark_export_json(p_organization_id,p_export_id,true);
end $$;

create or replace function public.claim_evidence_document_watermark_export(p_worker_id uuid,p_lease_seconds integer default 120)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; v public.evidence_document_versions%rowtype; d public.evidence_documents%rowtype;
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'empty',null::jsonb; return; end if;
 select * into e from public.evidence_document_watermark_exports where status in ('queued','failed') order by created_at,id for update skip locked limit 1;
 if not found then return query select 'empty',null::jsonb; return; end if;
 select * into d from public.evidence_documents where organization_id=e.organization_id and id=e.document_id for update;
 select * into v from public.evidence_document_versions where organization_id=e.organization_id and id=e.version_id for share;
 if not found or d.lifecycle_state<>'active' or v.processing_state<>'clean' or v.original_sha256<>e.original_sha256 or v.actual_size_bytes<>e.original_byte_size then update public.evidence_document_watermark_exports set status='failed',failure_code=case when d.lifecycle_state<>'active' then 'source_unavailable' else 'source_integrity_failed' end,lease_owner=null,lease_expires_at=null where id=e.id; return query select 'empty',null::jsonb; return; end if;
 update public.evidence_document_watermark_exports set status='claimed',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,started_at=coalesce(started_at,clock_timestamp()),failure_code=null where id=e.id returning * into e;
 return query select 'claimed',jsonb_build_object('export',public.m8_06_watermark_export_json(e.organization_id,e.id,true),'organizationId',e.organization_id,'objectKey',v.object_key,'sourceByteSize',v.actual_size_bytes,'sourceMediaType',v.detected_media_type);
end $$;

create or replace function public.finalize_evidence_document_watermark_export_atomic(p_organization_id uuid,p_export_id uuid,p_worker_id uuid,p_derivative_object_key text,p_derivative_sha256 text,p_derivative_size_bytes bigint,p_derivative_media_type text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype; v public.evidence_document_versions%rowtype; d public.evidence_documents%rowtype;
begin
 if p_derivative_object_key is null or p_derivative_object_key<>btrim(p_derivative_object_key) or char_length(p_derivative_object_key) not between 1 and 1000 or p_derivative_object_key~'[[:cntrl:] ]' or p_derivative_sha256 !~ '^[a-f0-9]{64}$' or p_derivative_size_bytes not between 1 and 52428800 or p_derivative_media_type not in ('application/pdf','image/jpeg','image/png','image/webp') then return query select 'invalid_request',null::jsonb; return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status='ready' then return query select 'replayed',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 if e.status<>'claimed' or e.lease_owner<>p_worker_id then return query select 'conflict',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 select * into d from public.evidence_documents where organization_id=p_organization_id and id=e.document_id for update;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=e.version_id for share;
 if not found or d.lifecycle_state<>'active' or v.processing_state<>'clean' or v.original_sha256<>e.original_sha256 then update public.evidence_document_watermark_exports set status='failed',failure_code='source_integrity_failed',lease_owner=null,lease_expires_at=null where id=e.id; return query select 'conflict',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 update public.evidence_document_watermark_exports set status='ready',derivative_object_key=p_derivative_object_key,derivative_sha256=p_derivative_sha256,derivative_byte_size=p_derivative_size_bytes,derivative_media_type=p_derivative_media_type,completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,failure_code=null where id=e.id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'evidence.watermark_export_ready','evidence_document_watermark_export',e.id::text,jsonb_build_object('documentId',e.document_id,'versionId',e.version_id,'derivativeSha256',p_derivative_sha256));
 return query select 'ready',public.m8_06_watermark_export_json(p_organization_id,e.id,true);
end $$;

create or replace function public.fail_evidence_document_watermark_export_atomic(p_organization_id uuid,p_export_id uuid,p_worker_id uuid,p_failure_code text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_document_watermark_exports%rowtype;
begin
 if p_failure_code not in ('unsupported_media_type','source_not_clean','source_unavailable','source_integrity_failed','source_malformed','renderer_unavailable','page_limit','output_limit','storage_failed') then return query select 'invalid_request',null::jsonb; return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status<>'claimed' or e.lease_owner<>p_worker_id then return query select 'conflict',public.m8_06_watermark_export_json(p_organization_id,e.id,true); return; end if;
 update public.evidence_document_watermark_exports set status='failed',failure_code=p_failure_code,lease_owner=null,lease_expires_at=null where id=e.id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'evidence.watermark_export_failed','evidence_document_watermark_export',e.id::text,jsonb_build_object('documentId',e.document_id,'versionId',e.version_id,'failureCode',p_failure_code));
 return query select 'failed',public.m8_06_watermark_export_json(p_organization_id,e.id,true);
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
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.evidence_document_watermark_export_access_grants(organization_id,export_id,actor_user_id,idempotency_key,request_digest,token_sha256,expires_at) values(p_organization_id,e.id,p_actor_user_id,p_idempotency_key,v_digest,encode(extensions.digest(v_token,'sha256'),'hex'),clock_timestamp()+interval '5 minutes') returning * into g;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.watermark_export_preview_authorized','evidence_document_watermark_export',e.id::text,jsonb_build_object('grantId',g.id,'exportId',e.id));
 return query select 'ready',jsonb_build_object('token',v_token,'expiresAt',g.expires_at,'fileName','watermarked-'||e.id::text||case when e.derivative_media_type='application/pdf' then '.pdf' when e.derivative_media_type='image/jpeg' then '.jpg' when e.derivative_media_type='image/png' then '.png' else '.webp' end,'mediaType',e.derivative_media_type);
end $$;

create or replace function public.redeem_evidence_document_watermark_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_export_id uuid,p_token_sha256 text,p_delivery boolean,p_correlation_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.evidence_document_watermark_export_access_grants%rowtype; e public.evidence_document_watermark_exports%rowtype; d public.evidence_documents%rowtype;
begin
 if p_token_sha256 !~ '^[a-f0-9]{64}$' or p_correlation_id is null or not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 select * into g from public.evidence_document_watermark_export_access_grants where organization_id=p_organization_id and export_id=p_export_id and token_sha256=p_token_sha256 for update;
 if not found or g.actor_user_id<>p_actor_user_id or g.terminal_outcome='revoked' then return query select 'forbidden',null::jsonb; return; end if;
 if g.expires_at<clock_timestamp() then update public.evidence_document_watermark_export_access_grants set terminal_outcome='expired' where id=g.id; return query select 'expired',null::jsonb; return; end if;
 select * into e from public.evidence_document_watermark_exports where organization_id=p_organization_id and id=p_export_id and status='ready';
 select * into d from public.evidence_documents where organization_id=p_organization_id and id=e.document_id and lifecycle_state='active';
 if not found then return query select 'unavailable',null::jsonb; return; end if;
 update public.evidence_document_watermark_export_access_grants set previewed_at=coalesce(previewed_at,clock_timestamp()),delivered_at=case when p_delivery then coalesce(delivered_at,clock_timestamp()) else delivered_at end,terminal_outcome=case when p_delivery then 'delivered' else 'previewed' end where id=g.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,case when p_delivery then 'evidence.watermark_export_delivered' else 'evidence.watermark_export_previewed' end,'evidence_document_watermark_export',e.id::text,jsonb_build_object('grantId',g.id,'correlationId',p_correlation_id));
 return query select 'redeemed',jsonb_build_object('objectBucket','evidence-watermark-exports','objectKey',e.derivative_object_key,'sha256',e.derivative_sha256,'byteSize',e.derivative_byte_size,'mediaType',e.derivative_media_type,'fileName','watermarked-'||e.id::text);
end $$;

-- M8-05 cleanup remains object-key based.  Expand it without changing its
-- original item shape: a ready derivative is keyed by its source version and
-- has a distinct bucket/key, so both it and the original are independently
-- claimed, deleted, and retried.
alter table public.evidence_document_deletion_cleanup_items drop constraint evidence_document_deletion_cleanup_items_object_bucket_check;
alter table public.evidence_document_deletion_cleanup_items add constraint evidence_document_deletion_cleanup_items_object_bucket_check check (object_bucket in ('evidence-documents','evidence-watermark-exports'));
alter table public.evidence_document_deletion_cleanup_items drop constraint evidence_document_deletion_cl_organization_id_intent_id_ver_key;
alter table public.evidence_document_deletion_cleanup_items add constraint evidence_document_deletion_cleanup_items_object_unique unique (organization_id,intent_id,object_bucket,object_key);

create or replace function public.m8_06_enqueue_watermark_cleanup_after_deletion_intent() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.evidence_document_watermark_export_access_grants g set terminal_outcome='revoked',expires_at=least(g.expires_at,clock_timestamp()) from public.evidence_document_watermark_exports e where e.organization_id=new.organization_id and e.document_id=new.document_id and e.id=g.export_id and g.terminal_outcome is null;
 insert into public.evidence_document_deletion_cleanup_items(organization_id,intent_id,version_id,object_bucket,object_key)
 select new.organization_id,new.id,e.version_id,'evidence-watermark-exports',e.derivative_object_key from public.evidence_document_watermark_exports e where e.organization_id=new.organization_id and e.document_id=new.document_id and e.status='ready' and e.derivative_object_key is not null on conflict (organization_id,intent_id,object_bucket,object_key) do nothing;
 update public.evidence_document_watermark_exports set status='cancelled',failure_code='cancelled',lease_owner=null,lease_expires_at=null where organization_id=new.organization_id and document_id=new.document_id and status in ('queued','failed','claimed');
 return new;
end $$;
create trigger m8_06_enqueue_watermark_cleanup_after_deletion_intent after insert on public.evidence_document_deletion_intents for each row execute function public.m8_06_enqueue_watermark_cleanup_after_deletion_intent();

alter table public.evidence_bulk_intake_batches enable row level security;
alter table public.evidence_bulk_intake_items enable row level security;
alter table public.evidence_bulk_intake_attempts enable row level security;
alter table public.evidence_document_watermark_exports enable row level security;
alter table public.evidence_document_watermark_export_access_grants enable row level security;
revoke all on table public.evidence_bulk_intake_batches,public.evidence_bulk_intake_items,public.evidence_bulk_intake_attempts,public.evidence_document_watermark_exports,public.evidence_document_watermark_export_access_grants from public,anon,authenticated;
grant all on table public.evidence_bulk_intake_batches,public.evidence_bulk_intake_items,public.evidence_bulk_intake_attempts,public.evidence_document_watermark_exports,public.evidence_document_watermark_export_access_grants to service_role;
revoke all on function public.m8_06_bulk_suggested_class(text),public.m8_06_bulk_item_json(uuid,uuid),public.m8_06_bulk_batch_json(uuid,uuid),public.create_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,jsonb,uuid),public.initialize_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,uuid,text),public.complete_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,text),public.get_evidence_bulk_intake_item_upload_atomic(uuid,uuid,uuid,uuid,uuid),public.get_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,uuid),public.cancel_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid),public.retry_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,timestamptz,uuid,text),public.m8_06_watermark_export_json(uuid,uuid,boolean),public.create_evidence_document_watermark_export_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text),public.get_evidence_document_watermark_export_atomic(uuid,uuid,uuid,uuid,uuid,uuid),public.claim_evidence_document_watermark_export(uuid,integer),public.finalize_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text,text,bigint,text),public.fail_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text),public.preview_evidence_document_watermark_export_atomic(uuid,uuid,uuid,uuid,text),public.redeem_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.m8_06_bulk_suggested_class(text),public.m8_06_bulk_item_json(uuid,uuid),public.m8_06_bulk_batch_json(uuid,uuid),public.create_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,jsonb,uuid),public.initialize_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,uuid,text),public.complete_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,text),public.get_evidence_bulk_intake_item_upload_atomic(uuid,uuid,uuid,uuid,uuid),public.get_evidence_bulk_intake_batch_atomic(uuid,uuid,uuid,uuid),public.cancel_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,uuid),public.retry_evidence_bulk_intake_item_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,timestamptz,uuid,text),public.m8_06_watermark_export_json(uuid,uuid,boolean),public.create_evidence_document_watermark_export_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text),public.get_evidence_document_watermark_export_atomic(uuid,uuid,uuid,uuid,uuid,uuid),public.claim_evidence_document_watermark_export(uuid,integer),public.finalize_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text,text,bigint,text),public.fail_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text),public.preview_evidence_document_watermark_export_atomic(uuid,uuid,uuid,uuid,text),public.redeem_evidence_document_watermark_export_atomic(uuid,uuid,uuid,text,boolean,uuid) to service_role;
notify pgrst,'reload schema';
