-- M8-01: immutable, tenant-owned evidence intake.  Object bytes remain in the
-- private storage bucket; this schema never stores file content or signed URLs.

insert into public.retention_evidence_classes(identifier, default_requested_retention_days)
values ('evidence_document', 3650)
on conflict (identifier) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('evidence-documents', 'evidence-documents', false, 52428800,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain'])
on conflict (id) do update set public=false, file_size_limit=52428800,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.m8_evidence_retention_class(p_document_class text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case when p_document_class in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other') then 'evidence_document' end
$$;

create table public.evidence_documents (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 current_version_id uuid,
 created_by uuid not null references public.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (organization_id,id)
);

create table public.evidence_document_versions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 document_id uuid not null,
 version_number integer not null check (version_number > 0),
 title text not null check (title=btrim(title) and char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'),
 document_class text not null check (document_class in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')),
 retention_evidence_class text not null references public.retention_evidence_classes(identifier),
 owner_user_id uuid not null references public.users(id) on delete restrict,
 uploader_user_id uuid not null references public.users(id) on delete restrict,
 validity_starts_on date,
 validity_ends_on date,
 object_bucket text not null default 'evidence-documents' check (object_bucket='evidence-documents'),
 object_key text not null check (object_key=btrim(object_key) and char_length(object_key) between 1 and 1000 and object_key !~ '[[:cntrl:]]'),
 original_filename text not null check (original_filename=btrim(original_filename) and char_length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]/\\]'),
 declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800),
 actual_size_bytes bigint check (actual_size_bytes between 1 and 52428800),
 detected_media_type text check (detected_media_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain')),
 original_sha256 text check (original_sha256 ~ '^[a-f0-9]{64}$'),
 processing_state text not null default 'uploading' check (processing_state in ('uploading','scan_pending','clean','quarantined','failed')),
 upload_expires_at timestamptz not null,
 finalized_at timestamptz,
 failure_code text check (failure_code is null or failure_code in ('upload_expired','object_missing','content_invalid','integrity_mismatch','unsupported_type','scan_failed')),
 scan_engine_name text,
 scan_engine_version text,
 scan_signature_version text,
 scanned_at timestamptz,
 scan_detection text,
 initialize_idempotency_key uuid not null,
 initialize_request_digest text not null check (initialize_request_digest ~ '^[a-f0-9]{64}$'),
 finalize_idempotency_key uuid,
 finalize_request_digest text check (finalize_request_digest is null or finalize_request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 check (validity_ends_on is null or validity_starts_on is null or validity_ends_on >= validity_starts_on),
 check ((processing_state='uploading' and actual_size_bytes is null and detected_media_type is null and original_sha256 is null and finalized_at is null)
   or (processing_state<>'uploading' and actual_size_bytes is not null and detected_media_type is not null and original_sha256 is not null and finalized_at is not null)),
 unique (organization_id,id),
 unique (organization_id,document_id,version_number),
 unique (organization_id,object_key),
 unique (organization_id,uploader_user_id,initialize_idempotency_key),
 foreign key (organization_id,document_id) references public.evidence_documents(organization_id,id) on delete restrict
);
alter table public.evidence_documents add constraint evidence_documents_current_version_fkey foreign key (organization_id,current_version_id) references public.evidence_document_versions(organization_id,id) on delete restrict;

create table public.evidence_document_version_products (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 version_id uuid not null,
 product_id uuid not null,
 primary key (organization_id,version_id,product_id),
 foreign key (organization_id,version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
 foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict
);

create table public.evidence_document_scan_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 version_id uuid not null, status text not null default 'queued' check(status in ('queued','leased','completed')),
 attempt_count integer not null default 0 check(attempt_count >= 0), next_attempt_at timestamptz not null default clock_timestamp(),
 lease_owner uuid, lease_expires_at timestamptz, last_error text check(last_error is null or char_length(last_error)<=1000),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,version_id), foreign key(organization_id,version_id) references public.evidence_document_versions(organization_id,id) on delete restrict
);
create table public.evidence_document_notification_outbox (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 version_id uuid not null, owner_user_id uuid not null references public.users(id) on delete restrict,
 event_type text not null check(event_type='evidence_quarantined'), status text not null default 'queued' check(status in ('queued','leased','sent')),
 attempt_count integer not null default 0 check(attempt_count>=0), next_attempt_at timestamptz not null default clock_timestamp(), lease_owner uuid, lease_expires_at timestamptz, last_error text check(last_error is null or char_length(last_error)<=1000), created_at timestamptz not null default clock_timestamp(), sent_at timestamptz,
 unique(organization_id,version_id,event_type), foreign key(organization_id,version_id) references public.evidence_document_versions(organization_id,id) on delete restrict
);
create index evidence_versions_list_idx on public.evidence_document_versions(organization_id,created_at desc,id);
create index evidence_version_products_product_idx on public.evidence_document_version_products(organization_id,product_id,version_id);
create index evidence_scan_jobs_claim_idx on public.evidence_document_scan_jobs(status,next_attempt_at,organization_id,created_at);

create or replace function public.m8_evidence_actor_active(p_organization_id uuid,p_user_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active join public.organizations o on o.id=m.organization_id and o.is_active where m.organization_id=p_organization_id and m.user_id=p_user_id)
$$;

create or replace function public.prevent_evidence_version_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.processing_state <> 'uploading' and (
   old.document_id is distinct from new.document_id or old.version_number is distinct from new.version_number or old.title is distinct from new.title or old.document_class is distinct from new.document_class or old.owner_user_id is distinct from new.owner_user_id or old.validity_starts_on is distinct from new.validity_starts_on or old.validity_ends_on is distinct from new.validity_ends_on or old.object_bucket is distinct from new.object_bucket or old.object_key is distinct from new.object_key or old.original_filename is distinct from new.original_filename or old.declared_size_bytes is distinct from new.declared_size_bytes or old.actual_size_bytes is distinct from new.actual_size_bytes or old.detected_media_type is distinct from new.detected_media_type or old.original_sha256 is distinct from new.original_sha256
 ) then raise exception using errcode='55000', message='Evidence version identity and metadata are immutable'; end if;
 return new;
end $$;
create trigger evidence_versions_immutable before update on public.evidence_document_versions for each row execute function public.prevent_evidence_version_mutation();
create or replace function public.prevent_evidence_version_product_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
 if tg_op in ('UPDATE','DELETE') then raise exception using errcode='55000', message='Evidence version product applicability is immutable'; end if;
 if not exists(select 1 from public.evidence_document_versions v where v.organization_id=new.organization_id and v.id=new.version_id and v.processing_state='uploading') then raise exception using errcode='55000', message='Evidence products may only be added during reservation'; end if;
 return new;
end $$;
create trigger evidence_version_products_immutable before insert or update or delete on public.evidence_document_version_products for each row execute function public.prevent_evidence_version_product_mutation();

create or replace function public.reserve_evidence_document_upload_atomic(p_organization_id uuid,p_actor_user_id uuid,p_title text,p_document_class text,p_owner_user_id uuid,p_product_ids uuid[],p_validity_starts_on date,p_validity_ends_on date,p_original_filename text,p_declared_size_bytes bigint,p_object_key text,p_upload_expires_at timestamptz,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version public.evidence_document_versions%rowtype; v_document_id uuid; v_version_id uuid;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m8_evidence_actor_active(p_organization_id,p_owner_user_id) or p_document_class is null or public.m8_evidence_retention_class(p_document_class) is null or p_title<>btrim(p_title) or char_length(p_title) not between 1 and 500 or p_original_filename<>btrim(p_original_filename) or char_length(p_original_filename) not between 1 and 255 or p_declared_size_bytes not between 1 and 52428800 or p_upload_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '30 minutes' or cardinality(p_product_ids)<1 or p_validity_ends_on is not null and p_validity_starts_on is not null and p_validity_ends_on<p_validity_starts_on then return query select 'invalid_request',null::jsonb; return; end if;
 select * into v_version from public.evidence_document_versions where organization_id=p_organization_id and uploader_user_id=p_actor_user_id and initialize_idempotency_key=p_idempotency_key;
 if found then return query select case when v_version.initialize_request_digest=p_request_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('documentId',v_version.document_id,'versionId',v_version.id,'objectKey',v_version.object_key,'uploadExpiresAt',v_version.upload_expires_at); return; end if;
 if exists(select 1 from unnest(p_product_ids) x group by x having count(*)>1) or exists(select 1 from unnest(p_product_ids) x left join public.products p on p.organization_id=p_organization_id and p.id=x where p.id is null or p.archived_at is not null) then return query select 'invalid_request',null::jsonb; return; end if;
 insert into public.evidence_documents(organization_id,created_by) values(p_organization_id,p_actor_user_id) returning id into v_document_id;
 insert into public.evidence_document_versions(organization_id,document_id,version_number,title,document_class,retention_evidence_class,owner_user_id,uploader_user_id,validity_starts_on,validity_ends_on,object_key,original_filename,declared_size_bytes,upload_expires_at,initialize_idempotency_key,initialize_request_digest) values(p_organization_id,v_document_id,1,p_title,p_document_class,public.m8_evidence_retention_class(p_document_class),p_owner_user_id,p_actor_user_id,p_validity_starts_on,p_validity_ends_on,p_object_key,p_original_filename,p_declared_size_bytes,p_upload_expires_at,p_idempotency_key,p_request_digest) returning id into v_version_id;
 update public.evidence_documents set current_version_id=v_version_id where organization_id=p_organization_id and id=v_document_id;
 insert into public.evidence_document_version_products(organization_id,version_id,product_id) select p_organization_id,v_version_id,x from unnest(p_product_ids) x;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.upload_reserved','evidence_document_version',v_version_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 return query select 'reserved',jsonb_build_object('documentId',v_document_id,'versionId',v_version_id,'objectKey',p_object_key,'uploadExpiresAt',p_upload_expires_at);
end $$;

create or replace function public.finalize_evidence_document_upload_atomic(p_organization_id uuid,p_actor_user_id uuid,p_version_id uuid,p_actual_size_bytes bigint,p_detected_media_type text,p_original_sha256 text,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.evidence_document_versions%rowtype;
begin
 if p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) then return query select 'invalid_request',null::jsonb; return; end if;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=p_version_id for update;
 if not found or v.uploader_user_id<>p_actor_user_id then return query select 'not_found',null::jsonb; return; end if;
 if v.finalize_idempotency_key is not null then return query select case when v.finalize_idempotency_key=p_idempotency_key and v.finalize_request_digest=p_request_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('versionId',v.id,'state',v.processing_state); return; end if;
 if v.processing_state<>'uploading' or v.upload_expires_at<clock_timestamp() or p_actual_size_bytes is null or p_detected_media_type is null or p_original_sha256 is null or p_actual_size_bytes not between 1 and 52428800 or p_actual_size_bytes<>v.declared_size_bytes or p_detected_media_type not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain') or p_original_sha256 !~ '^[a-f0-9]{64}$' then update public.evidence_document_versions set processing_state='failed',failure_code=case when v.upload_expires_at<clock_timestamp() then 'upload_expired' else 'integrity_mismatch' end,finalize_idempotency_key=p_idempotency_key,finalize_request_digest=p_request_digest,actual_size_bytes=coalesce(p_actual_size_bytes,1),detected_media_type=coalesce(p_detected_media_type,'text/plain'),original_sha256=coalesce(p_original_sha256,repeat('0',64)),finalized_at=clock_timestamp() where organization_id=p_organization_id and id=v.id; return query select 'failed',jsonb_build_object('versionId',v.id,'state','failed'); return; end if;
 update public.evidence_document_versions set processing_state='scan_pending',actual_size_bytes=p_actual_size_bytes,detected_media_type=p_detected_media_type,original_sha256=p_original_sha256,finalized_at=clock_timestamp(),finalize_idempotency_key=p_idempotency_key,finalize_request_digest=p_request_digest where organization_id=p_organization_id and id=v.id;
 insert into public.evidence_document_scan_jobs(organization_id,version_id) values(p_organization_id,v.id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.upload_completed','evidence_document_version',v.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'sha256',p_original_sha256));
 return query select 'scan_pending',jsonb_build_object('versionId',v.id,'state','scan_pending');
end $$;

create or replace function public.list_evidence_documents(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select case when not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) then null else jsonb_build_object('items',coalesce((
  select jsonb_agg(jsonb_build_object('document',jsonb_build_object('id',d.id,'organizationId',d.organization_id,'currentVersionId',v.id,'currentVersion',jsonb_build_object('id',v.id,'documentId',v.document_id,'organizationId',v.organization_id,'versionNumber',v.version_number,'title',v.title,'documentClass',v.document_class,'ownerUserId',v.owner_user_id,'productIds',(select coalesce(jsonb_agg(x.product_id order by x.product_id),'[]'::jsonb) from public.evidence_document_version_products x where x.organization_id=v.organization_id and x.version_id=v.id),'validFrom',case when v.validity_starts_on is null then null else to_char(v.validity_starts_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'validUntil',case when v.validity_ends_on is null then null else to_char(v.validity_ends_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'fileName',v.original_filename,'mediaType',v.detected_media_type,'byteSize',v.actual_size_bytes,'sha256',v.original_sha256,'status',v.processing_state,'scan',case when v.scan_engine_name is null then null else jsonb_build_object('outcome',case when v.processing_state='clean' then 'clean' when v.processing_state='quarantined' then 'detected' else 'failed' end,'engineName',v.scan_engine_name,'engineVersion',v.scan_engine_version,'signatureVersion',v.scan_signature_version,'scannedAt',to_char(v.scanned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'detectionName',v.scan_detection) end,'uploadExpiresAt',case when v.processing_state='uploading' then to_char(v.upload_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,'uploadedByUserId',v.uploader_user_id,'completedAt',case when v.finalized_at is null then null else to_char(v.finalized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'createdAt',to_char(v.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'createdByUserId',d.created_by,'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'linkageCount',(select count(*)::int from public.technical_file_section_sources s where s.organization_id=d.organization_id and s.source_kind='evidence_document' and s.record_id=d.id)) order by v.created_at desc,v.id)
  from public.evidence_documents d join public.evidence_document_versions v on v.organization_id=d.organization_id and v.id=d.current_version_id join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id
  where d.organization_id=p_organization_id and vp.product_id=p_product_id
 ),'[]'::jsonb),'nextCursor',null) end
$$;

create or replace function public.get_evidence_document_download_atomic(p_organization_id uuid,p_actor_user_id uuid,p_version_id uuid,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.evidence_document_versions%rowtype;
begin
 if p_idempotency_key is null or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=p_version_id;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if v.processing_state<>'clean' or (v.validity_ends_on is not null and v.validity_ends_on<current_date) then return query select 'unavailable',jsonb_build_object('state',case when v.validity_ends_on is not null and v.validity_ends_on<current_date then 'expired' else v.processing_state end); return; end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.download_requested','evidence_document_version',v.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 return query select 'ready',jsonb_build_object('versionId',v.id,'objectBucket',v.object_bucket,'objectKey',v.object_key,'filename',v.original_filename,'sha256',v.original_sha256);
end $$;

create or replace function public.claim_evidence_scan_job_atomic(p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.evidence_document_scan_jobs%rowtype;
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
 select * into j from public.evidence_document_scan_jobs x where x.organization_id=p_organization_id and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp() and (x.status='queued' or x.lease_expires_at<=clock_timestamp()) order by x.created_at,x.id for update skip locked limit 1;
 if not found then return null; end if;
 update public.evidence_document_scan_jobs set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,updated_at=clock_timestamp() where id=j.id returning * into j;
 return jsonb_build_object('jobId',j.id,'versionId',j.version_id,'attemptCount',j.attempt_count);
end $$;

create or replace function public.complete_evidence_scan_job_atomic(p_organization_id uuid,p_worker_id uuid,p_version_id uuid,p_engine_name text,p_engine_version text,p_signature_version text,p_outcome text,p_detection text default null,p_retry_after_seconds integer default null,p_error text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.evidence_document_scan_jobs%rowtype;
begin
 select * into j from public.evidence_document_scan_jobs where organization_id=p_organization_id and version_id=p_version_id for update;
 if not found then return 'not_found'; end if;
 if j.status='completed' then return 'replayed'; end if;
 if j.status<>'leased' or j.lease_owner<>p_worker_id or j.lease_expires_at<clock_timestamp() then return 'lease_lost'; end if;
 if p_outcome='unavailable' then update public.evidence_document_scan_jobs set status='queued',lease_owner=null,lease_expires_at=null,next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(30,least(coalesce(p_retry_after_seconds,300),3600))),last_error=left(coalesce(p_error,'scanner unavailable'),1000),updated_at=clock_timestamp() where id=j.id; return 'scan_pending'; end if;
 return public.record_evidence_document_scan_atomic(p_organization_id,p_version_id,p_engine_name,p_engine_version,p_signature_version,p_outcome,p_detection);
end $$;

-- M7 consumes logical document IDs and resolves the current immutable version.
alter table public.technical_file_section_sources drop constraint technical_file_section_sources_source_kind_check;
alter table public.technical_file_section_sources add constraint technical_file_section_sources_source_kind_check check (source_kind in ('product','release','support_period','sbom_document','finding','risk_register','evidence_document','manual_reference'));
create or replace function public.m7_evidence_source_snapshot(p_organization_id uuid,p_product_id uuid,p_kind text,p_record_id uuid)
returns table(exists_now boolean,is_current boolean,revision text,fingerprint text,title text,availability_reason text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_kind='evidence_document' then
  return query select true,
   v.processing_state='clean' and (v.validity_ends_on is null or v.validity_ends_on>=current_date) and exists(select 1 from public.evidence_document_version_products vp join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id where vp.organization_id=d.organization_id and vp.version_id=v.id and vp.product_id=p_product_id and p.archived_at is null),
   v.version_number::text,encode(extensions.digest(concat_ws('|',v.id::text,v.version_number::text,v.original_sha256,v.processing_state,v.validity_ends_on::text),'sha256'),'hex'),v.title,
   case when v.processing_state='quarantined' then 'source_quarantined' when v.processing_state<>'clean' then 'evidence_not_clean' when v.validity_ends_on is not null and v.validity_ends_on<current_date then 'source_validity_changed' when not exists(select 1 from public.evidence_document_version_products vp where vp.organization_id=d.organization_id and vp.version_id=v.id and vp.product_id=p_product_id) then 'evidence_product_unavailable' else null end
  from public.evidence_documents d join public.evidence_document_versions v on v.organization_id=d.organization_id and v.id=d.current_version_id where d.organization_id=p_organization_id and d.id=p_record_id;
  return;
 end if;
 if p_kind='product' then return query select true,p.archived_at is null,p.version::text,encode(extensions.digest(concat_ws('|',p.id::text,p.version::text,p.archived_at::text),'sha256'),'hex'),p.name,case when p.archived_at is null then null else 'product_archived' end from public.products p where p.organization_id=p_organization_id and p.id=p_record_id and p.id=p_product_id;
 elsif p_kind='release' then return query select true,r.archived_at is null,r.version::text,encode(extensions.digest(concat_ws('|',r.id::text,r.version::text,r.archived_at::text),'sha256'),'hex'),r.label,case when r.archived_at is null then null else 'release_archived' end from public.product_releases r where r.organization_id=p_organization_id and r.id=p_record_id and r.product_id=p_product_id;
 elsif p_kind='support_period' then return query select true,x.superseded_at is null,x.version::text,encode(extensions.digest(concat_ws('|',x.id::text,x.version::text,x.superseded_at::text),'sha256'),'hex'),'Support period',case when x.superseded_at is null then null else 'support_period_superseded' end from public.product_support_periods x where x.organization_id=p_organization_id and x.id=p_record_id and x.product_id=p_product_id;
 elsif p_kind='sbom_document' then return query select true,d.state='completed' and exists(select 1 from public.sbom_document_sources ds join public.product_releases r on r.organization_id=ds.organization_id and r.id=ds.release_id where ds.organization_id=d.organization_id and ds.document_id=d.id and r.product_id=p_product_id and r.archived_at is null),d.document_sha256,d.document_sha256,'SBOM document',case when d.state<>'completed' then 'sbom_not_completed' else null end from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_record_id;
 elsif p_kind='finding' then return query select true,f.status='active',f.source_record_version_id::text,encode(extensions.digest(concat_ws('|',f.id::text,f.source_record_version_id::text,f.status),'sha256'),'hex'),f.canonical_advisory_id,case when f.status='active' then null else 'finding_unavailable' end from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id where f.organization_id=p_organization_id and f.id=p_record_id and r.product_id=p_product_id;
 elsif p_kind='risk_register' then return query select true,true,rr.version::text,encode(extensions.digest(concat_ws('|',rr.id::text,rr.version::text),'sha256'),'hex'),'Cybersecurity risk register',null from public.technical_file_risk_registers rr join public.technical_files tf on tf.organization_id=rr.organization_id and tf.id=rr.technical_file_id where rr.organization_id=p_organization_id and rr.id=p_record_id and tf.product_id=p_product_id and tf.status='active'; end if;
end $$;
create or replace function public.m7_technical_file_source_exists(p_organization_id uuid,p_kind text,p_record_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case p_kind when 'evidence_document' then exists(select 1 from public.evidence_documents where organization_id=p_organization_id and id=p_record_id) when 'risk_register' then exists(select 1 from public.technical_file_risk_registers where organization_id=p_organization_id and id=p_record_id) when 'product' then exists(select 1 from public.products where organization_id=p_organization_id and id=p_record_id) when 'release' then exists(select 1 from public.product_releases where organization_id=p_organization_id and id=p_record_id) when 'support_period' then exists(select 1 from public.product_support_periods where organization_id=p_organization_id and id=p_record_id) when 'sbom_document' then exists(select 1 from public.sbom_documents where organization_id=p_organization_id and id=p_record_id) when 'finding' then exists(select 1 from public.vulnerability_findings where organization_id=p_organization_id and id=p_record_id) else false end
$$;
-- Evidence documents are permitted only in the Annex VII test-report section by
-- default; other sections retain their existing narrowly typed source contracts.
alter table public.technical_file_templates
  drop constraint technical_file_templates_allowed_source_kinds_check;
alter table public.technical_file_templates
  add constraint technical_file_templates_allowed_source_kinds_check
  check (cardinality(allowed_source_kinds) > 0 and allowed_source_kinds <@ array['product','release','support_period','sbom_document','finding','risk_register','evidence_document','manual_reference']);
update public.technical_file_templates set allowed_source_kinds=array_append(allowed_source_kinds,'evidence_document') where template_key='annex_vii' and section_key='test_reports' and not ('evidence_document'=any(allowed_source_kinds));
create or replace function public.add_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_expected_version integer,p_source_kind text,p_record_id uuid,p_title text,p_edition_or_revision text,p_issuer text,p_locator text,p_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_snapshot record; v_source_id uuid; v_digest text; v_replay record; v_allowed text[];
begin
 if p_expected_version<1 or p_idempotency_key is null or p_source_kind not in ('product','release','support_period','sbom_document','finding','risk_register','evidence_document','manual_reference') then return query select 'invalid_request',null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('operation','add_source','productId',p_product_id,'sectionKey',p_section_key,'expectedVersion',p_expected_version,'sourceKind',p_source_kind,'recordId',p_record_id,'title',nullif(btrim(coalesce(p_title,'')),''),'editionOrRevision',nullif(btrim(coalesce(p_edition_or_revision,'')),''),'issuer',nullif(btrim(coalesce(p_issuer,'')),''),'locator',nullif(btrim(coalesce(p_locator,'')),''),'rationale',nullif(btrim(coalesce(p_rationale,'')),''))::text,'sha256'),'hex');
 select * into v_replay from public.m7_technical_file_mutation_replay(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,'technical_file.source_linked');
 if found then if v_replay.outcome='idempotency_conflict' then return query select 'idempotency_conflict',null::jsonb; else return query select 'created',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_replay.section_id)); end if; return; end if;
 select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update;
 if not found then return query select 'not_found',null::jsonb; return; end if; if v_section.version<>p_expected_version then return query select 'conflict',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
 select t.allowed_source_kinds into v_allowed from public.technical_files f join public.technical_file_templates t on t.template_key=f.template_key and t.template_version=f.template_version and t.section_key=p_section_key where f.organization_id=p_organization_id and f.id=v_section.technical_file_id;
 if not p_source_kind=any(v_allowed) then return query select 'invalid_request',null::jsonb; return; end if;
 if p_source_kind='manual_reference' then if p_record_id is not null or char_length(btrim(coalesce(p_title,''))) not between 1 and 500 then return query select 'invalid_request',null::jsonb; return; end if; insert into public.technical_file_section_sources(organization_id,section_id,source_kind,title,edition_or_revision,issuer,locator,rationale,source_fingerprint) values(p_organization_id,v_section.id,p_source_kind,btrim(p_title),nullif(btrim(coalesce(p_edition_or_revision,'')),''),nullif(btrim(coalesce(p_issuer,'')),''),nullif(btrim(coalesce(p_locator,'')),''),nullif(btrim(coalesce(p_rationale,'')),''),encode(extensions.digest(concat_ws('|',btrim(p_title),nullif(btrim(coalesce(p_edition_or_revision,'')),''),nullif(btrim(coalesce(p_issuer,'')),''),nullif(btrim(coalesce(p_locator,'')),'')),'sha256'),'hex')) returning id into v_source_id;
 else if p_record_id is null then return query select 'invalid_request',null::jsonb; return; end if; select * into v_snapshot from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,p_source_kind,p_record_id); if not found or not v_snapshot.is_current then return query select 'not_found',null::jsonb; return; end if; insert into public.technical_file_section_sources(organization_id,section_id,source_kind,record_id,observed_revision,title,source_fingerprint) values(p_organization_id,v_section.id,p_source_kind,p_record_id,v_snapshot.revision,coalesce(nullif(btrim(coalesce(p_title,'')),''),v_snapshot.title),v_snapshot.fingerprint) returning id into v_source_id; end if;
 update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=v_section.id returning * into v_section;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_linked','technical_file_section_source',v_source_id::text,jsonb_build_object('sectionKey',p_section_key,'sectionId',v_section.id,'sourceKind',p_source_kind,'idempotencyKey',p_idempotency_key,'payloadDigest',v_digest)); return query select 'created',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

create or replace function public.record_evidence_document_scan_atomic(p_organization_id uuid,p_version_id uuid,p_engine_name text,p_engine_version text,p_signature_version text,p_outcome text,p_detection text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.evidence_document_versions%rowtype; v_state text;
begin
 if p_outcome not in ('clean','detected') or char_length(btrim(coalesce(p_engine_name,''))) not between 1 and 120 then return 'invalid_request'; end if;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=p_version_id for update;
 if not found then return 'not_found'; end if; if v.processing_state in ('clean','quarantined','failed') then return 'replayed'; end if;
 v_state:=case when p_outcome='clean' then 'clean' else 'quarantined' end;
 update public.evidence_document_versions set processing_state=v_state,scan_engine_name=p_engine_name,scan_engine_version=nullif(btrim(coalesce(p_engine_version,'')),''),scan_signature_version=nullif(btrim(coalesce(p_signature_version,'')),''),scanned_at=clock_timestamp(),scan_detection=case when p_outcome='detected' then left(nullif(btrim(coalesce(p_detection,'')),''),300) else null end where organization_id=p_organization_id and id=p_version_id;
 update public.evidence_document_scan_jobs set status='completed',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where organization_id=p_organization_id and version_id=p_version_id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'evidence.scan_completed','evidence_document_version',p_version_id::text,jsonb_build_object('outcome',p_outcome,'engine',p_engine_name));
 if p_outcome='detected' then insert into public.evidence_document_notification_outbox(organization_id,version_id,owner_user_id,event_type) values(p_organization_id,p_version_id,v.owner_user_id,'evidence_quarantined') on conflict do nothing; end if;
 return v_state;
end $$;

alter table public.evidence_documents enable row level security; alter table public.evidence_document_versions enable row level security; alter table public.evidence_document_version_products enable row level security; alter table public.evidence_document_scan_jobs enable row level security; alter table public.evidence_document_notification_outbox enable row level security;
revoke all on table public.evidence_documents,public.evidence_document_versions,public.evidence_document_version_products,public.evidence_document_scan_jobs,public.evidence_document_notification_outbox from public,anon,authenticated;
grant all on table public.evidence_documents,public.evidence_document_versions,public.evidence_document_version_products,public.evidence_document_scan_jobs,public.evidence_document_notification_outbox to service_role;
revoke all on function public.m8_evidence_retention_class(text),public.m8_evidence_actor_active(uuid,uuid),public.reserve_evidence_document_upload_atomic(uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text),public.finalize_evidence_document_upload_atomic(uuid,uuid,uuid,bigint,text,text,uuid,text),public.list_evidence_documents(uuid,uuid,uuid),public.get_evidence_document_download_atomic(uuid,uuid,uuid,uuid),public.claim_evidence_scan_job_atomic(uuid,uuid,integer),public.complete_evidence_scan_job_atomic(uuid,uuid,uuid,text,text,text,text,text,integer,text),public.record_evidence_document_scan_atomic(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.m8_evidence_retention_class(text),public.m8_evidence_actor_active(uuid,uuid),public.reserve_evidence_document_upload_atomic(uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text),public.finalize_evidence_document_upload_atomic(uuid,uuid,uuid,bigint,text,text,uuid,text),public.list_evidence_documents(uuid,uuid,uuid),public.get_evidence_document_download_atomic(uuid,uuid,uuid,uuid),public.claim_evidence_scan_job_atomic(uuid,uuid,integer),public.complete_evidence_scan_job_atomic(uuid,uuid,uuid,text,text,text,text,text,integer,text),public.record_evidence_document_scan_atomic(uuid,uuid,text,text,text,text,text) to service_role;
notify pgrst, 'reload schema';
