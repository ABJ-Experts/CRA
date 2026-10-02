set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.retry_supplier_evidence_reminder_delivery_atomic(p_organization_id uuid, p_actor_user_id uuid, p_delivery_id uuid, p_idempotency_key uuid)
 RETURNS TABLE(outcome text, result jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d public.supplier_evidence_reminder_deliveries%rowtype;
begin
  if not public.m9_04_can_manage(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null then return query select 'invalid_request',null::jsonb; return; end if;
  select * into d from public.supplier_evidence_reminder_deliveries where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.state not in ('failed','recipient_unavailable') then return query select 'conflict',jsonb_build_object('id',d.id,'state',d.state); return; end if;
  update public.supplier_evidence_reminder_deliveries set state='queued',next_attempt_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null,updated_at=clock_timestamp() where id=d.id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_reminder_retry_requested','supplier_evidence_reminder_delivery',d.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
  return query select 'queued',jsonb_build_object('id',d.id,'state','pending');
end $function$
;

CREATE OR REPLACE FUNCTION public.m7_declaration_json(p_organization_id uuid, p_declaration_id uuid, p_include_payload boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select jsonb_build_object(
   'id',d.id,'organizationId',d.organization_id,'productId',d.product_id,'snapshotId',d.snapshot_id,'templateId',d.template_id,
   'version',d.declaration_version,'draftVersion',d.draft_version,'status',case when d.status in ('issued','superseded') then d.status else 'draft' end,
   'signatory',jsonb_build_object('userId',d.signatory_user_id,'name',d.signatory_name,'capacity',d.signatory_capacity,'place',coalesce(d.signatory_place,d.issue_place)),
   'assessmentRoute',d.assessment_route,
   'notifiedBody',case when d.notified_body_identifier is null then null else jsonb_build_object('identifier',d.notified_body_identifier) end,
   'certificateReferences',d.certificate_references,'sourceProvenance',d.source_provenance,'missingFacts',d.missing_facts,
   'previewDigest',coalesce(d.preview_digest,repeat('0',64)),
   'snapshotSha256',coalesce(d.snapshot_sha256,(select payload_sha256 from public.technical_file_snapshots s where s.organization_id=d.organization_id and s.id=d.snapshot_id)),
   'issuedPayload',case when d.status in ('issued','superseded') then d.immutable_payload || jsonb_build_object('issuedAt',to_char(d.issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) else null end,
   'issuedArtifact',case when d.status in ('issued','superseded') then jsonb_build_object('fileName','eu-declaration-of-conformity-v'||d.declaration_version||'.pdf','mimeType','application/pdf','byteLength',d.pdf_bytes,'sha256',d.pdf_sha256) else null end,
   'issuedAt',case when d.issued_at is null then null else to_char(d.issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
   'supersededByDeclarationId',d.superseded_by_declaration_id,'supersedesDeclarationId',d.supersedes_declaration_id,'reissueReason',d.reissue_reason,
   'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 ) from public.technical_file_declarations d join public.technical_file_declaration_templates t on t.id=d.template_id where d.organization_id=p_organization_id and d.id=p_declaration_id
$function$
;

CREATE OR REPLACE FUNCTION public.m8_evidence_validity_status(p_starts_on date, p_ends_on date, p_thresholds integer[])
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when p_starts_on is null then 'missing'
    when p_ends_on is null then 'open_ended'
    when p_starts_on is not null and p_starts_on > current_date then 'not_yet_valid'
    when p_ends_on < current_date then 'expired'
    when p_ends_on <= current_date + coalesce((select max(x) from unnest(p_thresholds) x), 0) then 'expiring_soon'
    else 'current' end
$function$
;

CREATE OR REPLACE FUNCTION public.retry_evidence_text_extraction_atomic(p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_document_id uuid, p_version_id uuid)
 RETURNS TABLE(outcome text, result jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'evidence.extraction_retry_requested','evidence_document_version',p_version_id::text,
   jsonb_build_object('productId',p_product_id));
 select * into t from public.evidence_document_version_texts
 where organization_id=p_organization_id and version_id=p_version_id;
 return query select 'queued'::text,jsonb_build_object('extraction',jsonb_build_object(
   'status',t.extraction_status,'sourceSha256',t.source_sha256,'extractorVersion',t.extractor_version,
   'updatedAt',to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'failureCode',t.failure_code,'truncated',t.is_truncated,'quality',t.quality));
end $function$
;


