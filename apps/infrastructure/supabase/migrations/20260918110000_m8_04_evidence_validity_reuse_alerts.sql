-- M8-04: validity is a version lifecycle signal, never a retention or
-- deletion decision.  M7 continues to own technical-file link writes.

create function public.m8_evidence_expiry_thresholds_valid(p_threshold_days integer[])
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select p_threshold_days is not null
    and cardinality(p_threshold_days) between 1 and 12
    and not exists(select 1 from unnest(p_threshold_days) threshold_day where threshold_day not between 1 and 3650)
    and cardinality(p_threshold_days)=(select count(distinct threshold_day) from unnest(p_threshold_days) threshold_day)
$$;

alter table public.organization_settings
  add column evidence_expiry_alert_intervals integer[] not null default array[30,14,7,1],
  add column evidence_expiry_alerts_version integer not null default 0,
  add column evidence_expiry_alerts_updated_at timestamptz not null default clock_timestamp(),
  add column evidence_expiry_alerts_updated_by uuid references public.users(id) on delete set null,
  add constraint organization_settings_evidence_expiry_alert_intervals_check check (public.m8_evidence_expiry_thresholds_valid(evidence_expiry_alert_intervals)),
  add constraint organization_settings_evidence_expiry_alerts_version_check
    check (evidence_expiry_alerts_version >= 0);

alter table public.evidence_document_notification_outbox
  add column threshold_days integer,
  drop constraint evidence_document_notification_outbox_event_type_check,
  drop constraint evidence_document_notification_outbox_status_check,
  drop constraint evidence_document_notificatio_organization_id_version_id_ev_key;
alter table public.evidence_document_notification_outbox
  add constraint evidence_document_notification_outbox_event_type_check
    check (event_type in ('evidence_quarantined','evidence_integrity_failure','evidence_validity_expiring')),
  add constraint evidence_document_notification_outbox_status_check
    check (status in ('queued','leased','sent','obsolete','recipient_unavailable')),
  add constraint evidence_document_notification_outbox_threshold_check check (
    (event_type='evidence_validity_expiring' and threshold_days between 1 and 3650)
    or (event_type<>'evidence_validity_expiring' and threshold_days is null)
  );
create unique index evidence_notification_nonexpiry_dedupe_idx
  on public.evidence_document_notification_outbox(organization_id,version_id,event_type)
  where event_type <> 'evidence_validity_expiring';
create unique index evidence_notification_validity_threshold_dedupe_idx
  on public.evidence_document_notification_outbox(organization_id,version_id,event_type,threshold_days)
  where event_type='evidence_validity_expiring';
create index evidence_notification_validity_claim_idx
  on public.evidence_document_notification_outbox(status,next_attempt_at,organization_id,created_at,id)
  where event_type='evidence_validity_expiring';

create or replace function public.m8_evidence_validity_status(
  p_starts_on date,p_ends_on date,p_thresholds integer[]
) returns text language sql stable set search_path=public,pg_temp as $$
  select case when p_starts_on is null and p_ends_on is null then 'missing'
    when p_ends_on is null then 'open_ended'
    when p_starts_on is not null and p_starts_on > current_date then 'not_yet_valid'
    when p_ends_on < current_date then 'expired'
    when p_ends_on <= current_date + coalesce((select max(x) from unnest(p_thresholds) x), 0) then 'expiring_soon'
    else 'current' end
$$;

create or replace function public.get_evidence_expiry_alert_intervals_atomic(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  return query select 'found',jsonb_build_object('version',s.evidence_expiry_alerts_version,
    'thresholdDays',to_jsonb(s.evidence_expiry_alert_intervals),'updatedAt',to_char(s.evidence_expiry_alerts_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updatedByUserId',s.evidence_expiry_alerts_updated_by) from public.organization_settings s where s.organization_id=p_organization_id;
end $$;

create or replace function public.update_evidence_expiry_alert_intervals_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_expected_version integer,p_threshold_days integer[],p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.organization_settings%rowtype; v_prior public.audit_logs%rowtype; v_digest text; v_result jsonb; v_previous_threshold_days integer[];
begin
  if p_organization_id is null or p_actor_user_id is null or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_organization') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  if not public.m8_evidence_expiry_thresholds_valid(p_threshold_days) then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('expectedVersion',p_expected_version,'thresholdDays',p_threshold_days)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into v_prior from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.action='evidence.expiry_alert_intervals_updated' and a.changes->>'idempotencyKey'=p_idempotency_key::text limit 1;
  if found then
    if v_prior.changes->>'payloadDigest'<>v_digest then return query select 'idempotency_conflict',null::jsonb; return; end if;
    return query select 'replayed',v_prior.changes->'result'; return;
  end if;
  select * into s from public.organization_settings where organization_id=p_organization_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if s.evidence_expiry_alerts_version<>p_expected_version then
    return query select 'conflict',jsonb_build_object('version',s.evidence_expiry_alerts_version,'thresholdDays',to_jsonb(s.evidence_expiry_alert_intervals)); return;
  end if;
  v_previous_threshold_days:=s.evidence_expiry_alert_intervals;
  v_result:=jsonb_build_object('version',s.evidence_expiry_alerts_version+1,'thresholdDays',to_jsonb(p_threshold_days),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedByUserId',p_actor_user_id);
  update public.organization_settings set evidence_expiry_alert_intervals=p_threshold_days,
    evidence_expiry_alerts_version=evidence_expiry_alerts_version+1,evidence_expiry_alerts_updated_at=clock_timestamp(),
    evidence_expiry_alerts_updated_by=p_actor_user_id where organization_id=p_organization_id returning * into s;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(
    p_organization_id,p_actor_user_id,'evidence.expiry_alert_intervals_updated','organization_settings',p_organization_id::text,
    jsonb_build_object('before',to_jsonb(v_previous_threshold_days),'after',to_jsonb(p_threshold_days),'version',s.evidence_expiry_alerts_version,'idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'result',v_result)
  );
  return query select 'updated',v_result;
end $$;

create or replace function public.reconcile_evidence_validity_alerts_atomic(
  p_organization_id uuid,p_worker_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.organization_settings%rowtype; v_created integer:=0; v_obsolete integer:=0;
begin
  if p_organization_id is null or p_worker_id is null then return jsonb_build_object('created',0,'obsolete',0); end if;
  select * into s from public.organization_settings where organization_id=p_organization_id for share;
  if not found then return jsonb_build_object('created',0,'obsolete',0); end if;
  update public.evidence_document_notification_outbox n set status='obsolete',lease_owner=null,lease_expires_at=null,last_error='threshold removed before delivery'
    where n.organization_id=p_organization_id and n.event_type='evidence_validity_expiring' and n.status='queued'
      and not n.threshold_days=any(s.evidence_expiry_alert_intervals);
  get diagnostics v_obsolete=row_count;
  insert into public.evidence_document_notification_outbox(organization_id,version_id,owner_user_id,event_type,threshold_days,next_attempt_at)
    select v.organization_id,v.id,v.owner_user_id,'evidence_validity_expiring',threshold_days,clock_timestamp()
    from public.evidence_document_versions v cross join lateral unnest(s.evidence_expiry_alert_intervals) threshold_days
    where v.organization_id=p_organization_id and v.processing_state='clean' and v.validity_ends_on is not null
      and exists(select 1 from public.evidence_document_version_products vp join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null where vp.organization_id=v.organization_id and vp.version_id=v.id)
      and v.validity_ends_on <= current_date + threshold_days
    on conflict (organization_id,version_id,event_type,threshold_days) where event_type='evidence_validity_expiring' do nothing;
  get diagnostics v_created=row_count;
  return jsonb_build_object('created',v_created,'obsolete',v_obsolete);
end $$;

create function public.list_evidence_validity_alert_organization_ids_atomic(
  p_after_organization_id uuid,p_limit integer
) returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select s.organization_id from public.organization_settings s
  join public.organizations o on o.id=s.organization_id and o.is_active
  where p_limit between 1 and 1000
    and (p_after_organization_id is null or s.organization_id>p_after_organization_id)
  order by s.organization_id
  limit p_limit
$$;

create or replace function public.claim_evidence_validity_notification_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype; v_email text; v_version_info record;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select * into n from public.evidence_document_notification_outbox x where x.organization_id=p_organization_id
    and x.event_type='evidence_validity_expiring' and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp()
    and (x.status='queued' or x.lease_expires_at<=clock_timestamp()) order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into v_email from public.users u where u.id=n.owner_user_id
    and public.m8_evidence_actor_active(p_organization_id,u.id)
    and public.m5_triage_actor_has_permission(p_organization_id,u.id,'can_view_evidence') limit 1;
  if v_email is null then
    update public.evidence_document_notification_outbox set status='recipient_unavailable',sent_at=clock_timestamp(),last_error='recipient unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=n.id;
    return jsonb_build_object('outboxId',n.id,'outcome','recipient_unavailable');
  end if;
  select version_record.id,version_record.document_id,version_record.title,version_record.validity_ends_on,coalesce((select jsonb_agg(vp.product_id order by vp.product_id) from public.evidence_document_version_products vp join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null where vp.organization_id=version_record.organization_id and vp.version_id=version_record.id),'[]'::jsonb) product_ids into v_version_info from public.evidence_document_versions version_record where version_record.organization_id=p_organization_id and version_record.id=n.version_id and version_record.processing_state='clean';
  if not found or jsonb_array_length(v_version_info.product_ids)=0 then
    update public.evidence_document_notification_outbox set status='obsolete',last_error='evidence unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,last_error=null where organization_id=p_organization_id and id=n.id;
  return jsonb_build_object('outboxId',n.id,'email',v_email,'eventType',n.event_type,'thresholdDays',n.threshold_days,'versionId',v_version_info.id,'documentId',v_version_info.document_id,'title',v_version_info.title,'validUntil',v_version_info.validity_ends_on::text,'productIds',v_version_info.product_ids);
end $$;

create or replace function public.complete_evidence_validity_notification_atomic(
  p_organization_id uuid,p_worker_id uuid,p_outbox_id uuid,p_outcome text,p_error text
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype;
begin
  if p_outcome not in ('sent','retry','recipient_unavailable') then return 'invalid_request'; end if;
  select * into n from public.evidence_document_notification_outbox where organization_id=p_organization_id and id=p_outbox_id and event_type='evidence_validity_expiring' for update;
  if not found then return 'not_found'; end if;
  if n.status='sent' then return 'replayed'; end if;
  if n.status<>'leased' or n.lease_owner is distinct from p_worker_id then return 'not_leased'; end if;
  if p_outcome in ('sent','recipient_unavailable') then
    update public.evidence_document_notification_outbox set status=case when p_outcome='recipient_unavailable' then 'recipient_unavailable' else 'sent' end,sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=case when p_outcome='recipient_unavailable' then 'recipient unavailable' else null end where organization_id=p_organization_id and id=p_outbox_id;
    return p_outcome;
  end if;
  update public.evidence_document_notification_outbox set status='queued',lease_owner=null,lease_expires_at=null,next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*greatest(1,attempt_count))),last_error=left(nullif(btrim(coalesce(p_error,'')),''),1000) where organization_id=p_organization_id and id=p_outbox_id;
  return 'retry';
end $$;

create or replace function public.get_evidence_document_reuse_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_document_id uuid,p_version_id uuid
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  if not exists(select 1 from public.products p join public.evidence_document_version_products vp on vp.organization_id=p.organization_id and vp.product_id=p.id join public.evidence_document_versions v on v.organization_id=vp.organization_id and v.id=vp.version_id where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null and v.id=p_version_id and v.document_id=p_document_id) then
    return query select 'not_found',null::jsonb; return;
  end if;
  return query select 'found',jsonb_build_object(
    'technicalFileLinks',case when public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then coalesce((select jsonb_agg(jsonb_build_object('technicalFileId',f.id,'productId',f.product_id,'productName',p.name,'sectionId',s.id,'sectionKey',s.section_key,'sectionHeading',s.heading,'linkedVersionId',v.id,'linkedVersionNumber',v.version_number,'status',public.m7_evidence_section_source_state(p_organization_id,f.product_id,x.id),'reviewedAt',case when x.reviewed_at is null then null else to_char(x.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'navigationPath','/products/'||f.product_id::text||'/technical-file') order by f.product_id,s.sort_order,x.id)
      from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id join public.products p on p.organization_id=f.organization_id and p.id=f.product_id and p.archived_at is null join public.evidence_document_versions v on v.organization_id=x.organization_id and v.document_id=x.record_id and v.version_number::text=x.observed_revision
      where x.organization_id=p_organization_id and x.source_kind='evidence_document' and x.record_id=p_document_id and v.id=p_version_id),'[]'::jsonb) else '[]'::jsonb end,'frameworkControls','[]'::jsonb);
end $$;

-- Keep the existing eight-argument list callable during a rolling deploy.
-- New callers get a validity filter without moving the pagination boundary
-- after selection.
create or replace function public.list_evidence_documents(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_status text default null,
  p_document_class text default null,p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,p_limit integer default 50,p_validity_status text default null
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_next timestamptz; v_next_id uuid;
begin
 if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_limit not between 1 and 100
   or p_status is not null and p_status not in ('uploading','scan_pending','clean','quarantined','failed')
   or p_document_class is not null and p_document_class not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')
   or p_validity_status is not null and p_validity_status not in ('current','expiring_soon','expired','not_yet_valid','open_ended','missing')
   or ((p_cursor_created_at is null)<>(p_cursor_id is null))
   or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
   or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
   or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)
 then return null; end if;
 with filtered as materialized (
   select d.id document_id,d.organization_id,d.current_version_id,d.created_by,d.created_at document_created_at,d.updated_at,
     v.id version_id,v.version_number,v.title,v.document_class,v.owner_user_id,v.validity_starts_on,v.validity_ends_on,
     v.original_filename,v.detected_media_type,v.actual_size_bytes,v.original_sha256,v.processing_state,v.scan_engine_name,
     v.scan_engine_version,v.scan_signature_version,v.scanned_at,v.scan_detection,v.upload_expires_at,v.uploader_user_id,v.finalized_at,v.created_at,
     t.extraction_status,t.source_sha256,t.extractor_version,t.quality,t.is_truncated,t.failure_code,t.updated_at extraction_updated_at,
     public.m8_evidence_validity_status(v.validity_starts_on,v.validity_ends_on,settings.evidence_expiry_alert_intervals) validity_status
   from public.evidence_documents d join public.evidence_document_versions v on v.organization_id=d.organization_id and v.id=d.current_version_id
   join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id and vp.product_id=p_product_id
   join public.organization_settings settings on settings.organization_id=d.organization_id
   left join public.evidence_document_version_texts t on t.organization_id=v.organization_id and t.version_id=v.id
   where d.organization_id=p_organization_id and (p_status is null or v.processing_state=p_status)
     and (p_document_class is null or v.document_class=p_document_class)
     and (p_validity_status is null or public.m8_evidence_validity_status(v.validity_starts_on,v.validity_ends_on,settings.evidence_expiry_alert_intervals)=p_validity_status)
     and (p_cursor_created_at is null or (v.created_at,v.id)<(p_cursor_created_at,p_cursor_id))
 ), selected as (select * from filtered order by created_at desc,version_id desc limit p_limit), next_row as (select created_at,version_id from filtered where exists(select 1 from filtered offset p_limit) order by created_at desc,version_id desc offset (p_limit-1) limit 1)
 select coalesce(jsonb_agg(jsonb_build_object('document',jsonb_build_object(
   'id',s.document_id,'organizationId',s.organization_id,'currentVersionId',s.version_id,
   'currentVersion',jsonb_build_object('id',s.version_id,'documentId',s.document_id,'organizationId',s.organization_id,'versionNumber',s.version_number,'title',s.title,'documentClass',s.document_class,'ownerUserId',s.owner_user_id,
     'productIds',coalesce((select jsonb_agg(vp.product_id order by vp.product_id) from public.evidence_document_version_products vp where vp.organization_id=s.organization_id and vp.version_id=s.version_id),'[]'::jsonb),
     'validFrom',case when s.validity_starts_on is null then null else to_char(s.validity_starts_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'validUntil',case when s.validity_ends_on is null then null else to_char(s.validity_ends_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
     'fileName',s.original_filename,'mediaType',s.detected_media_type,'byteSize',s.actual_size_bytes,'sha256',s.original_sha256,'status',s.processing_state,
     'scan',case when s.scan_engine_name is null then null else jsonb_build_object('outcome',case when s.processing_state='clean' then 'clean' when s.processing_state='quarantined' then 'detected' else 'failed' end,'engineName',s.scan_engine_name,'engineVersion',s.scan_engine_version,'signatureVersion',s.scan_signature_version,'scannedAt',to_char(s.scanned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'detectionName',s.scan_detection) end,
     'extraction',case when s.extraction_status is null then null else jsonb_build_object('status',s.extraction_status,'sourceSha256',s.source_sha256,'extractorVersion',s.extractor_version,'updatedAt',to_char(s.extraction_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'failureCode',s.failure_code,'truncated',s.is_truncated,'quality',s.quality) end,
     'uploadExpiresAt',case when s.processing_state='uploading' then to_char(s.upload_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,'uploadedByUserId',s.uploader_user_id,'completedAt',case when s.finalized_at is null then null else to_char(s.finalized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
   'createdByUserId',s.created_by,'createdAt',to_char(s.document_created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
   'linkageCount',case when public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then (select count(*)::int from public.technical_file_section_sources x join public.technical_file_sections section_record on section_record.organization_id=x.organization_id and section_record.id=x.section_id join public.technical_files file_record on file_record.organization_id=section_record.organization_id and file_record.id=section_record.technical_file_id and file_record.status='active' join public.products product_record on product_record.organization_id=file_record.organization_id and product_record.id=file_record.product_id and product_record.archived_at is null where x.organization_id=s.organization_id and x.source_kind='evidence_document' and x.record_id=s.document_id and x.observed_revision=s.version_number::text) else 0 end, 'validityStatus',s.validity_status
 ) order by s.created_at desc,s.version_id desc),'[]'::jsonb), (select created_at from next_row),(select version_id from next_row) into v_items,v_next,v_next_id from selected s;
 return jsonb_build_object('items',v_items,'nextCursor',case when v_next is null then null else replace(replace(trim(trailing '=' from encode(convert_to(to_char(v_next at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||v_next_id::text,'utf8'),'base64')),'+','-'),'/','_') end);
end $$;

revoke all on function public.m8_evidence_expiry_thresholds_valid(integer[]),public.m8_evidence_validity_status(date,date,integer[]),public.get_evidence_expiry_alert_intervals_atomic(uuid,uuid),public.update_evidence_expiry_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid),public.reconcile_evidence_validity_alerts_atomic(uuid,uuid),public.list_evidence_validity_alert_organization_ids_atomic(uuid,integer),public.claim_evidence_validity_notification_atomic(uuid,uuid,integer),public.complete_evidence_validity_notification_atomic(uuid,uuid,uuid,text,text),public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid),public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.m8_evidence_expiry_thresholds_valid(integer[]),public.m8_evidence_validity_status(date,date,integer[]),public.get_evidence_expiry_alert_intervals_atomic(uuid,uuid),public.update_evidence_expiry_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid),public.reconcile_evidence_validity_alerts_atomic(uuid,uuid),public.list_evidence_validity_alert_organization_ids_atomic(uuid,integer),public.claim_evidence_validity_notification_atomic(uuid,uuid,integer),public.complete_evidence_validity_notification_atomic(uuid,uuid,uuid,text,text),public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid),public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text) to service_role;
notify pgrst, 'reload schema';
