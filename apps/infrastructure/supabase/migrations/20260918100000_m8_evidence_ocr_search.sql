-- M8-03: Derived, local text extraction and product-scoped evidence search.
-- Evidence versions remain immutable.  This migration stores only derived text and
-- durable work state; it never stores an object URL or grants browser access to text.

create table public.evidence_document_version_texts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  extractor_version text not null check (extractor_version = btrim(extractor_version)
    and char_length(extractor_version) between 1 and 120 and extractor_version !~ '[[:cntrl:]]'),
  extraction_status text not null default 'queued'
    check (extraction_status in ('queued', 'running', 'complete', 'failed')),
  extracted_text text,
  search_document tsvector generated always as
    (to_tsvector('simple'::regconfig, coalesce(extracted_text, ''))) stored,
  quality text not null default 'not_assessed'
    check (quality in ('not_assessed', 'sufficient', 'low')),
  is_truncated boolean not null default false,
  failure_code text check (failure_code is null or failure_code in
    ('unavailable', 'unsupported_media_type', 'encrypted', 'malformed', 'resource_limit',
     'timeout', 'output_limit', 'empty', 'low_quality', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (organization_id, version_id),
  foreign key (organization_id, version_id)
    references public.evidence_document_versions(organization_id, id) on delete restrict,
  check ((extraction_status = 'complete' and extracted_text is not null
      and char_length(extracted_text) between 1 and 4194304 and failure_code is null
      and completed_at is not null)
    or (extraction_status <> 'complete' and extracted_text is null and completed_at is null))
);

create table public.evidence_document_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  extractor_version text not null check (extractor_version = btrim(extractor_version)
  and char_length(extractor_version) between 1 and 120 and extractor_version !~ '[[:cntrl:]]'),
  status text not null default 'queued' check (status in ('queued', 'leased', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  max_attempts integer not null default 5 check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (organization_id, version_id),
  foreign key (organization_id, version_id)
    references public.evidence_document_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, version_id)
    references public.evidence_document_version_texts(organization_id, version_id) on delete restrict,
  check ((status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null))
);

create index evidence_version_texts_search_idx
  on public.evidence_document_version_texts using gin (search_document)
  where extraction_status = 'complete';
create index evidence_version_texts_status_idx
  on public.evidence_document_version_texts(organization_id, extraction_status, version_id);
create index evidence_extraction_jobs_claim_idx
  on public.evidence_document_extraction_jobs(status, next_attempt_at, organization_id, created_at, id);
create index evidence_extraction_jobs_version_idx
  on public.evidence_document_extraction_jobs(organization_id, version_id);

alter table public.evidence_document_version_texts enable row level security;
alter table public.evidence_document_extraction_jobs enable row level security;
revoke all on table public.evidence_document_version_texts,
  public.evidence_document_extraction_jobs from public, anon, authenticated;
grant all on table public.evidence_document_version_texts,
  public.evidence_document_extraction_jobs to service_role;

-- Keep existing M5/M6 semantics intact while making the established permission
-- machinery usable from the evidence RPCs.  Overrides remain the final word.
create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_view_findings' then true
      when 'can_edit_findings' then role in ('owner', 'admin')
      when 'can_edit_organization' then role = 'owner'
      when 'can_submit_reporting' then role in ('owner', 'admin')
      when 'can_export_findings' then role in ('owner', 'admin')
      when 'can_manage_finding_publication' then role in ('owner', 'admin')
      when 'can_view_evidence' then true
      when 'can_upload_evidence' then role in ('owner', 'admin', 'member')
      else false end as granted
    from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments assignment
      on assignment.organization_id = p_organization_id and assignment.user_id = p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id = p_organization_id and custom_role.id = assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key) = 'boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key) = 'boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id = p_organization_id
      and permission_override.base_role = base_permission.role
  ) select coalesce((select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted, false) or coalesce(custom_permissions.granted, false)
      from base_permissions cross join custom_permissions), false)
$$;
alter function public.m5_triage_actor_has_permission(uuid, uuid, text) owner to postgres;
revoke all on function public.m5_triage_actor_has_permission(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.m5_triage_actor_has_permission(uuid, uuid, text) to service_role;

-- Existing clean evidence predates this derived table.  It is explicitly queued
-- rather than treated as indexed, so users see extraction pending/unavailable.
insert into public.evidence_document_version_texts(
  organization_id, version_id, source_sha256, extractor_version, extraction_status
)
select v.organization_id, v.id, v.original_sha256, 'm8-03-local-v1', 'queued'
from public.evidence_document_versions v
where v.processing_state = 'clean' and v.original_sha256 is not null
on conflict (organization_id, version_id) do nothing;

insert into public.evidence_document_extraction_jobs(
  organization_id, version_id, source_sha256, extractor_version
)
select t.organization_id, t.version_id, t.source_sha256, t.extractor_version
from public.evidence_document_version_texts t
where t.extraction_status = 'queued'
on conflict (organization_id, version_id) do nothing;

-- The scan result and derived-work enqueue commit together.  A clean file never
-- briefly claims that its text is ready, and replays cannot create duplicate work.
create or replace function public.record_evidence_document_scan_atomic(
  p_organization_id uuid, p_version_id uuid, p_engine_name text, p_engine_version text,
  p_signature_version text, p_outcome text, p_detection text default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.evidence_document_versions%rowtype; v_state text;
begin
 if p_outcome not in ('clean','detected') or char_length(btrim(coalesce(p_engine_name,''))) not between 1 and 120 then return 'invalid_request'; end if;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=p_version_id for update;
 if not found then return 'not_found'; end if;
 if v.processing_state in ('clean','quarantined','failed') then return 'replayed'; end if;
 v_state:=case when p_outcome='clean' then 'clean' else 'quarantined' end;
 update public.evidence_document_versions set processing_state=v_state,scan_engine_name=p_engine_name,
   scan_engine_version=nullif(btrim(coalesce(p_engine_version,'')),''),
   scan_signature_version=nullif(btrim(coalesce(p_signature_version,'')),''),scanned_at=clock_timestamp(),
   scan_detection=case when p_outcome='detected' then left(nullif(btrim(coalesce(p_detection,'')),''),300) else null end
   where organization_id=p_organization_id and id=p_version_id;
 update public.evidence_document_scan_jobs set status='completed',lease_owner=null,lease_expires_at=null,
   updated_at=clock_timestamp() where organization_id=p_organization_id and version_id=p_version_id;
 if p_outcome = 'clean' then
   insert into public.evidence_document_version_texts(
     organization_id, version_id, source_sha256, extractor_version, extraction_status
   ) values (p_organization_id, p_version_id, v.original_sha256, 'm8-03-local-v1', 'queued')
   on conflict (organization_id, version_id) do nothing;
   insert into public.evidence_document_extraction_jobs(
     organization_id, version_id, source_sha256, extractor_version
   ) values (p_organization_id, p_version_id, v.original_sha256, 'm8-03-local-v1')
   on conflict (organization_id, version_id) do nothing;
 end if;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
 values(p_organization_id,'evidence.scan_completed','evidence_document_version',p_version_id::text,
   jsonb_build_object('outcome',p_outcome,'engine',p_engine_name));
 if p_outcome='detected' then
   insert into public.evidence_document_notification_outbox(organization_id,version_id,owner_user_id,event_type)
   values(p_organization_id,p_version_id,v.owner_user_id,'evidence_quarantined') on conflict do nothing;
 end if;
 return v_state;
end $$;

create or replace function public.claim_evidence_text_extraction_job_atomic(
  p_organization_id uuid, p_worker_id uuid, p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.evidence_document_extraction_jobs%rowtype;
begin
 if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
 -- An abandoned final attempt is terminally visible, rather than silently stuck.
 update public.evidence_document_extraction_jobs j0 set status='failed', lease_owner=null,
   lease_expires_at=null, last_error='worker lease expired', updated_at=clock_timestamp(), completed_at=clock_timestamp()
 where j0.organization_id=p_organization_id and j0.status='leased'
   and j0.lease_expires_at <= clock_timestamp() and j0.attempt_count >= j0.max_attempts;
  update public.evidence_document_version_texts t set extraction_status='failed', failure_code='failed',
   updated_at=clock_timestamp()
 where t.organization_id=p_organization_id and t.extraction_status='running'
   and exists(select 1 from public.evidence_document_extraction_jobs j0 where j0.organization_id=t.organization_id
     and j0.version_id=t.version_id and j0.status='failed' and j0.last_error='worker lease expired');
 select x.* into j from public.evidence_document_extraction_jobs x
 join public.evidence_document_versions v on v.organization_id=x.organization_id and v.id=x.version_id
 where x.organization_id=p_organization_id and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp()
   and x.attempt_count < x.max_attempts and (x.status='queued' or x.lease_expires_at<=clock_timestamp())
   and v.processing_state='clean' and v.original_sha256=x.source_sha256
 order by x.created_at,x.id for update of x skip locked limit 1;
 if not found then return null; end if;
 update public.evidence_document_extraction_jobs set status='leased',lease_owner=p_worker_id,
   lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,
   updated_at=clock_timestamp() where id=j.id returning * into j;
 update public.evidence_document_version_texts set extraction_status='running',failure_code=null,updated_at=clock_timestamp()
 where organization_id=j.organization_id and version_id=j.version_id and source_sha256=j.source_sha256
   and extractor_version=j.extractor_version;
 return jsonb_build_object('jobId',j.id,'versionId',j.version_id,'sourceSha256',j.source_sha256,
   'extractorVersion',j.extractor_version,'attemptCount',j.attempt_count);
end $$;

create or replace function public.complete_evidence_text_extraction_job_atomic(
  p_organization_id uuid, p_worker_id uuid, p_version_id uuid, p_source_sha256 text,
  p_extractor_version text, p_outcome text, p_extracted_text text default null,
  p_quality text default null, p_is_truncated boolean default false, p_failure_code text default null,
  p_retry_after_seconds integer default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.evidence_document_extraction_jobs%rowtype; v public.evidence_document_versions%rowtype;
declare v_terminal boolean;
begin
 if p_outcome not in ('complete','retry','failed') or p_source_sha256 !~ '^[a-f0-9]{64}$'
   or p_extractor_version <> btrim(coalesce(p_extractor_version,''))
   or char_length(coalesce(p_extractor_version,'')) not between 1 and 120
   or p_quality is not null and p_quality not in ('not_assessed','sufficient','low')
   or p_failure_code is not null and p_failure_code not in ('unavailable','unsupported_media_type','encrypted','malformed',
     'resource_limit','timeout','output_limit','empty','low_quality','failed')
 then return 'invalid_request'; end if;
 select * into j from public.evidence_document_extraction_jobs
 where organization_id=p_organization_id and version_id=p_version_id for update;
 if not found then return 'not_found'; end if;
 if j.status='completed' then return 'replayed'; end if;
 if j.status<>'leased' or j.lease_owner<>p_worker_id or j.lease_expires_at<clock_timestamp() then return 'lease_lost'; end if;
 select * into v from public.evidence_document_versions where organization_id=p_organization_id and id=p_version_id;
 if not found or v.processing_state<>'clean' or v.original_sha256<>j.source_sha256
   or j.source_sha256<>p_source_sha256 or j.extractor_version<>p_extractor_version then
   update public.evidence_document_extraction_jobs set status='failed',lease_owner=null,lease_expires_at=null,
     last_error='source changed or unavailable',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
   update public.evidence_document_version_texts set extraction_status='failed',failure_code='failed',
     updated_at=clock_timestamp() where organization_id=p_organization_id and version_id=p_version_id
       and source_sha256=j.source_sha256;
   return 'stale_source';
 end if;
 if p_outcome='complete' then
   if p_extracted_text is null or char_length(p_extracted_text) not between 1 and 4194304 then return 'invalid_request'; end if;
   update public.evidence_document_version_texts set extraction_status='complete',extracted_text=p_extracted_text,
     quality=coalesce(p_quality,'sufficient'),is_truncated=coalesce(p_is_truncated,false),failure_code=null,updated_at=clock_timestamp(),completed_at=clock_timestamp()
   where organization_id=p_organization_id and version_id=p_version_id and source_sha256=p_source_sha256
     and extractor_version=p_extractor_version;
   update public.evidence_document_extraction_jobs set status='completed',lease_owner=null,lease_expires_at=null,
     completed_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp() where id=j.id;
   return 'completed';
 end if;
 v_terminal := p_outcome='failed' or j.attempt_count >= j.max_attempts;
 if v_terminal then
   update public.evidence_document_version_texts set extraction_status='failed',failure_code=coalesce(p_failure_code,'unavailable'),
     updated_at=clock_timestamp() where organization_id=p_organization_id and version_id=p_version_id;
   update public.evidence_document_extraction_jobs set status='failed',lease_owner=null,lease_expires_at=null,
     last_error=left(coalesce(p_failure_code,'unavailable'),1000),completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=j.id;
   return 'failed';
 end if;
 update public.evidence_document_version_texts set extraction_status='queued',failure_code=null,updated_at=clock_timestamp()
 where organization_id=p_organization_id and version_id=p_version_id;
 update public.evidence_document_extraction_jobs set status='queued',lease_owner=null,lease_expires_at=null,
   next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(30,least(coalesce(p_retry_after_seconds,300),3600))),
   last_error=left(coalesce(p_failure_code,'unavailable'),1000),updated_at=clock_timestamp() where id=j.id;
 return 'queued';
end $$;

create or replace function public.retry_evidence_text_extraction_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_document_id uuid, p_version_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.evidence_document_version_texts%rowtype; v public.evidence_document_versions%rowtype;
begin
 if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_document_id is null or p_version_id is null
   or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
   or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence')
   or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)
 then return query select 'forbidden'::text,null::jsonb; return; end if;
 select v0.* into v from public.evidence_document_versions v0 join public.evidence_document_version_products vp
   on vp.organization_id=v0.organization_id and vp.version_id=v0.id and vp.product_id=p_product_id
 where v0.organization_id=p_organization_id and v0.id=p_version_id and v0.document_id=p_document_id for update;
 if not found or v.processing_state<>'clean' or v.validity_ends_on<current_date then return query select 'unavailable'::text,null::jsonb; return; end if;
 select * into t from public.evidence_document_version_texts where organization_id=p_organization_id and version_id=p_version_id for update;
 if not found or t.source_sha256<>v.original_sha256 then return query select 'unavailable'::text,null::jsonb; return; end if;
 if t.extraction_status in ('queued','running') then
   return query select 'replayed'::text,jsonb_build_object('extraction',jsonb_build_object(
     'status',t.extraction_status,'sourceSha256',t.source_sha256,'extractorVersion',t.extractor_version,
     'updatedAt',to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
     'failureCode',t.failure_code,'truncated',t.is_truncated,'quality',t.quality));
   return;
 end if;
 update public.evidence_document_version_texts set extraction_status='queued',failure_code=null,updated_at=clock_timestamp()
 where organization_id=p_organization_id and version_id=p_version_id;
 update public.evidence_document_extraction_jobs set status='queued',attempt_count=0,lease_owner=null,lease_expires_at=null,
   next_attempt_at=clock_timestamp(),last_error=null,completed_at=null,updated_at=clock_timestamp()
 where organization_id=p_organization_id and version_id=p_version_id;
 if not found then
   insert into public.evidence_document_extraction_jobs(
     organization_id, version_id, source_sha256, extractor_version
   ) values (p_organization_id, p_version_id, t.source_sha256, t.extractor_version);
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'evidence.extraction_retry_requested','evidence_document_version',p_version_id::text,
   jsonb_build_object('productId',p_product_id));
 select * into t from public.evidence_document_version_texts
 where organization_id=p_organization_id and version_id=p_version_id;
 return query select 'queued'::text,jsonb_build_object('extraction',jsonb_build_object(
   'status',t.extraction_status,'sourceSha256',t.source_sha256,'extractorVersion',t.extractor_version,
   'updatedAt',to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'failureCode',t.failure_code,'truncated',t.is_truncated,'quality',t.quality));
end $$;

create or replace function public.get_evidence_document_extracted_text_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_document_id uuid, p_version_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_document_id is null or p_version_id is null
   or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
   or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
   or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)
 then return query select 'forbidden'::text,null::jsonb; return; end if;
 return query
 select case when t.extraction_status='complete' and v.processing_state='clean'
     and (v.validity_ends_on is null or v.validity_ends_on>=current_date) and t.source_sha256=v.original_sha256
   then 'found' else 'unavailable' end,
   jsonb_build_object('documentId',v.document_id,'versionId',v.id,
     'extraction',jsonb_build_object('status',t.extraction_status,'sourceSha256',t.source_sha256,
       'extractorVersion',t.extractor_version,'quality',t.quality,'truncated',t.is_truncated,
       'failureCode',t.failure_code,'updatedAt',to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
     'snippetText',case when t.extraction_status='complete' and v.processing_state='clean'
       and (v.validity_ends_on is null or v.validity_ends_on>=current_date)
       and t.source_sha256=v.original_sha256 then left(t.extracted_text,16000) else null end)
 from public.evidence_document_versions v join public.evidence_document_version_texts t
   on t.organization_id=v.organization_id and t.version_id=v.id
 join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
 where v.organization_id=p_organization_id and v.id=p_version_id and v.document_id=p_document_id;
 if not found then return query select 'not_found'::text,null::jsonb; end if;
end $$;

create or replace function public.search_evidence_documents_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_query text,
  p_document_class text default null, p_include_historical boolean default false, p_limit integer default 25,
  p_after_rank integer default null, p_after_created_at timestamptz default null, p_after_version_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare q tsquery; v_items jsonb; v_facets jsonb; v_coverage jsonb; v_total bigint;
begin
 if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_limit not between 1 and 50
   or p_query is null or p_query<>btrim(p_query) or char_length(p_query) not between 2 and 200 or p_query ~ '[[:cntrl:]]'
   or p_document_class is not null and p_document_class not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')
   or ((p_after_rank is null) <> (p_after_created_at is null))
   or ((p_after_rank is null) <> (p_after_version_id is null))
 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
   or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
   or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)
 then return query select 'forbidden'::text,null::jsonb; return; end if;
 q := plainto_tsquery('simple', p_query);
 with eligible as (
   select v.id version_id,v.document_id,v.version_number,v.title,v.document_class,v.original_filename,v.created_at,
     v.validity_ends_on,d.current_version_id,v.processing_state,
     t.extraction_status,t.source_sha256,t.extractor_version,t.extracted_text,t.search_document,t.quality,t.is_truncated,t.updated_at
   from public.evidence_document_versions v
   join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
   join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
   join public.evidence_document_version_texts t on t.organization_id=v.organization_id and t.version_id=v.id
   where v.organization_id=p_organization_id and v.processing_state='clean' and v.original_sha256=t.source_sha256
     and (v.validity_ends_on is null or v.validity_ends_on>=current_date)
     and (p_include_historical or d.current_version_id=v.id)
     and (p_document_class is null or v.document_class=p_document_class)
 ), matched as (
   select e.*, round(ts_rank_cd(e.search_document,q)*1000000)::integer rank_key
   from eligible e where e.extraction_status='complete' and e.search_document @@ q
 )
 select coalesce(jsonb_agg(jsonb_build_object('documentId',s.document_id,'versionId',s.version_id,
   'versionNumber',s.version_number,'title',s.title,'documentClass',s.document_class,'fileName',s.original_filename,
   'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'validUntil',case when s.validity_ends_on is null then null else to_char(s.validity_ends_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
   'currentVersion',s.current_version_id=s.version_id,'score',s.rank_key / 1000000.0,
   'snippetText',ts_headline('simple',s.extracted_text,q,'MaxWords=35, MinWords=15, MaxFragments=1, StartSel=, StopSel='),
   'extraction',jsonb_build_object('status',s.extraction_status,'sourceSha256',s.source_sha256,
     'extractorVersion',s.extractor_version,'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
     'failureCode',null,'truncated',s.is_truncated,'quality',s.quality),
   'cursor',jsonb_build_object('rank',s.rank_key,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'versionId',s.version_id))
   order by s.rank_key desc,s.created_at desc,s.version_id desc),'[]'::jsonb),coalesce(max(s.total),0) into v_items,v_total
 from (select matched.*,count(*) over() total from matched where p_after_rank is null or rank_key<p_after_rank
    or (rank_key=p_after_rank and (created_at,version_id)<(p_after_created_at,p_after_version_id))
   order by rank_key desc,created_at desc,version_id desc limit p_limit) s;
 with eligible as (
   select v.document_class,t.extraction_status,t.search_document from public.evidence_document_versions v
   join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
   join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
   join public.evidence_document_version_texts t on t.organization_id=v.organization_id and t.version_id=v.id
   where v.organization_id=p_organization_id and v.processing_state='clean' and v.original_sha256=t.source_sha256
     and (v.validity_ends_on is null or v.validity_ends_on>=current_date)
     and (p_include_historical or d.current_version_id=v.id)
     and (p_document_class is null or v.document_class=p_document_class)
 ), matched as (select * from eligible where extraction_status='complete' and search_document @@ q)
 select coalesce(jsonb_agg(jsonb_build_object('documentClass',document_class,'count',count) order by document_class),'[]'::jsonb)
 into v_facets from (select document_class,count(*)::int count from matched group by document_class) f;
 with eligible as (
   select t.extraction_status from public.evidence_document_versions v
   join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
   join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
   join public.evidence_document_version_texts t on t.organization_id=v.organization_id and t.version_id=v.id
   where v.organization_id=p_organization_id and v.processing_state='clean' and v.original_sha256=t.source_sha256
     and (v.validity_ends_on is null or v.validity_ends_on>=current_date)
     and (p_include_historical or d.current_version_id=v.id)
     and (p_document_class is null or v.document_class=p_document_class)
 ) select jsonb_build_object('indexed',count(*) filter(where extraction_status='complete'),
   'pending',count(*) filter(where extraction_status in ('queued','running')),
   'unavailable',count(*) filter(where extraction_status='failed')) into v_coverage from eligible;
 return query select 'found'::text,jsonb_build_object('items',v_items,'total',v_total,'facets',v_facets,'coverage',v_coverage);
end $$;

-- New callers use this bounded overload.  The earlier three-argument function
-- remains available during a rolling API deploy, while the controller decodes
-- its opaque cursor before crossing this database boundary.
create function public.list_evidence_documents(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid,
  p_status text default null, p_document_class text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_next timestamptz; v_next_id uuid;
begin
 if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_limit not between 1 and 100
   or p_status is not null and p_status not in ('uploading','scan_pending','clean','quarantined','failed')
   or p_document_class is not null and p_document_class not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')
   or ((p_cursor_created_at is null) <> (p_cursor_id is null))
   or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
   or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
   or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)
 then return null; end if;
 with selected as (
   select d.id document_id,d.organization_id,d.current_version_id,d.created_by,d.created_at document_created_at,d.updated_at,
     v.id version_id,v.version_number,v.title,v.document_class,v.owner_user_id,v.validity_starts_on,v.validity_ends_on,
     v.original_filename,v.detected_media_type,v.actual_size_bytes,v.original_sha256,v.processing_state,
     v.scan_engine_name,v.scan_engine_version,v.scan_signature_version,v.scanned_at,v.scan_detection,v.upload_expires_at,
     v.uploader_user_id,v.finalized_at,v.created_at,
     t.extraction_status,t.source_sha256,t.extractor_version,t.quality,t.is_truncated,t.failure_code,t.updated_at extraction_updated_at
   from public.evidence_documents d
   join public.evidence_document_versions v on v.organization_id=d.organization_id and v.id=d.current_version_id
   join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
   left join public.evidence_document_version_texts t on t.organization_id=v.organization_id and t.version_id=v.id
   where d.organization_id=p_organization_id and (p_status is null or v.processing_state=p_status)
     and (p_document_class is null or v.document_class=p_document_class)
     and (p_cursor_created_at is null or (v.created_at,v.id)<(p_cursor_created_at,p_cursor_id))
   order by v.created_at desc,v.id desc limit p_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object('document',jsonb_build_object(
   'id',s.document_id,'organizationId',s.organization_id,'currentVersionId',s.version_id,
   'currentVersion',jsonb_build_object('id',s.version_id,'documentId',s.document_id,'organizationId',s.organization_id,
     'versionNumber',s.version_number,'title',s.title,'documentClass',s.document_class,'ownerUserId',s.owner_user_id,
     'productIds',coalesce((select jsonb_agg(x.product_id order by x.product_id) from public.evidence_document_version_products x where x.organization_id=s.organization_id and x.version_id=s.version_id),'[]'::jsonb),
     'validFrom',case when s.validity_starts_on is null then null else to_char(s.validity_starts_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
     'validUntil',case when s.validity_ends_on is null then null else to_char(s.validity_ends_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
     'fileName',s.original_filename,'mediaType',s.detected_media_type,'byteSize',s.actual_size_bytes,'sha256',s.original_sha256,
     'status',s.processing_state,'scan',case when s.scan_engine_name is null then null else jsonb_build_object('outcome',case when s.processing_state='clean' then 'clean' when s.processing_state='quarantined' then 'detected' else 'failed' end,'engineName',s.scan_engine_name,'engineVersion',s.scan_engine_version,'signatureVersion',s.scan_signature_version,'scannedAt',to_char(s.scanned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'detectionName',s.scan_detection) end,
     'extraction',case when s.extraction_status is null then null else jsonb_build_object('status',s.extraction_status,'sourceSha256',s.source_sha256,'extractorVersion',s.extractor_version,'updatedAt',to_char(s.extraction_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'failureCode',s.failure_code,'truncated',s.is_truncated,'quality',s.quality) end,
     'uploadExpiresAt',case when s.processing_state='uploading' then to_char(s.upload_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,
     'uploadedByUserId',s.uploader_user_id,'completedAt',case when s.finalized_at is null then null else to_char(s.finalized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
   'createdByUserId',s.created_by,'createdAt',to_char(s.document_created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
   'linkageCount',(select count(*)::int from public.technical_file_section_sources source where source.organization_id=s.organization_id and source.source_kind='evidence_document' and source.record_id=s.document_id)) order by s.created_at desc,s.version_id desc),'[]'::jsonb) into v_items from selected s;
 select v.created_at,v.id into v_next,v_next_id from public.evidence_documents d
   join public.evidence_document_versions v on v.organization_id=d.organization_id and v.id=d.current_version_id
   join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
   where d.organization_id=p_organization_id and (p_status is null or v.processing_state=p_status)
     and (p_document_class is null or v.document_class=p_document_class)
     and (p_cursor_created_at is null or (v.created_at,v.id)<(p_cursor_created_at,p_cursor_id))
   order by v.created_at desc,v.id desc offset p_limit limit 1;
 return jsonb_build_object('items',v_items,
   'nextCursor',case when v_next is null then null else replace(replace(trim(trailing '=' from encode(convert_to(to_char(v_next at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || v_next_id::text,'utf8'),'base64')),'+','-'),'/','_') end);
end $$;

-- Keep the version selector schema-compatible after extraction metadata became
-- part of the shared version contract.  Historical rows without derived text
-- intentionally return extraction: null.
create or replace function public.list_evidence_document_versions(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_document_id uuid
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select case when not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
    or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)
    or not exists(select 1 from public.evidence_documents d where d.organization_id=p_organization_id and d.id=p_document_id)
    then null else jsonb_build_object('documentId',p_document_id,'items',coalesce((
      select jsonb_agg(jsonb_build_object('id',v.id,'documentId',v.document_id,'organizationId',v.organization_id,
        'versionNumber',v.version_number,'title',v.title,'documentClass',v.document_class,'ownerUserId',v.owner_user_id,
        'productIds',coalesce((select jsonb_agg(vp2.product_id order by vp2.product_id) from public.evidence_document_version_products vp2 where vp2.organization_id=v.organization_id and vp2.version_id=v.id),'[]'::jsonb),
        'validFrom',case when v.validity_starts_on is null then null else to_char(v.validity_starts_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'validUntil',case when v.validity_ends_on is null then null else to_char(v.validity_ends_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'fileName',v.original_filename,'mediaType',v.detected_media_type,'byteSize',v.actual_size_bytes,'sha256',v.original_sha256,
        'status',v.processing_state,'scan',case when v.scan_engine_name is null then null else jsonb_build_object('outcome',case when v.processing_state='clean' then 'clean' when v.processing_state='quarantined' then 'detected' else 'failed' end,'engineName',v.scan_engine_name,'engineVersion',v.scan_engine_version,'signatureVersion',v.scan_signature_version,'scannedAt',to_char(v.scanned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'detectionName',v.scan_detection) end,
        'extraction',case when t.extraction_status is null then null else jsonb_build_object('status',t.extraction_status,'sourceSha256',t.source_sha256,'extractorVersion',t.extractor_version,'updatedAt',to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'failureCode',t.failure_code,'truncated',t.is_truncated,'quality',t.quality) end,
        'uploadExpiresAt',case when v.processing_state='uploading' then to_char(v.upload_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,
        'uploadedByUserId',v.uploader_user_id,'completedAt',case when v.finalized_at is null then null else to_char(v.finalized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'createdAt',to_char(v.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        order by v.version_number desc,v.id desc)
      from public.evidence_document_versions v
      join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
      left join public.evidence_document_version_texts t on t.organization_id=v.organization_id and t.version_id=v.id
      where v.organization_id=p_organization_id and v.document_id=p_document_id
    ),'[]'::jsonb)) end
$$;

revoke all on function public.claim_evidence_text_extraction_job_atomic(uuid,uuid,integer),
  public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer),
  public.retry_evidence_text_extraction_atomic(uuid,uuid,uuid,uuid,uuid),
  public.get_evidence_document_extracted_text_atomic(uuid,uuid,uuid,uuid,uuid),
  public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid),
  public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.claim_evidence_text_extraction_job_atomic(uuid,uuid,integer),
  public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer),
  public.retry_evidence_text_extraction_atomic(uuid,uuid,uuid,uuid,uuid),
  public.get_evidence_document_extracted_text_atomic(uuid,uuid,uuid,uuid,uuid),
  public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid),
  public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)
  to service_role;
notify pgrst, 'reload schema';
