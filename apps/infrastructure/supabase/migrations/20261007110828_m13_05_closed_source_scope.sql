-- M13-05 closed receipt actions and unresolved product scope fails closed.
create or replace function public.m13_05_event_selected(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs,p_products uuid[])
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_permission text; v_table text; v_source jsonb; v_related jsonb; v_product uuid; v_release uuid;v_evidence_links boolean:=false; begin
 if p_event.organization_id is distinct from p_organization_id or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then return false; end if;
 v_permission:=case
 when p_event.entity_type in ('audit_chain','audit_search','audit_export','auth_email_verifications','auth_login_attempts','auth_mfa_recovery_codes','auth_recovery_tokens','auth_security','notification_preferences','workflow_out_of_office') then 'can_view_audit'
 when p_event.entity_type='ai_inference_run' then 'can_view_suppliers'
 when p_event.entity_type='connector' then 'can_view_connectors'
 when p_event.entity_type in ('role','custom_role') then 'can_view_roles'
 when p_event.entity_type='invitation' then 'can_view_invitations'
 when p_event.entity_type in ('organization','organization_branding_draft','organization_legal_entity','organization_onboarding_stage') then 'can_view_organization'
 when p_event.entity_type in ('product','product_release') then 'can_view_products'
 when p_event.entity_type in ('sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission') then 'can_view_sboms'
 when p_event.entity_type='evidence_document_version' then 'can_view_evidence'
 when p_event.entity_type in ('framework_custom_pack_command','framework_pack_version','framework_selection') then 'can_view_frameworks'
 when p_event.entity_type in ('supplier_contact','supplier_document_field','supplier_evidence_invitation','supplier_evidence_request','supplier_evidence_submission','supplier_evidence_submission_review','supplier_organization') then 'can_view_suppliers'
 when p_event.entity_type in ('technical_file','technical_file_auditor_snapshot_grant','technical_file_declaration','technical_file_section','technical_file_section_source','technical_file_snapshot','technical_file_snapshot_export') then 'can_view_technical_files'
 when p_event.entity_type='user' then 'can_view_users'
 when p_event.entity_type in ('vulnerability_match_job','vulnerability_reevaluation_job','vulnerability_finding') then 'can_view_findings'
 when p_event.entity_type in ('reporting_obligation','reporting_submission') then 'can_view_reporting' else null end;
 if not public.m13_03_event_visible(p_organization_id,p_actor_user_id,p_event) then return false; end if;
 if v_permission is null or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,v_permission) then return false; end if;
 if p_event.entity_type='notification_preferences' then
  return p_event.entity_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and public.m12_03_actor_can_manage_notification_user(p_organization_id,p_actor_user_id,p_event.entity_id::uuid);
 end if;
 if p_event.entity_type='workflow_out_of_office' then
  if p_event.entity_id is null or p_event.entity_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
  return exists(select 1 from public.workflow_out_of_office absence where absence.organization_id=p_organization_id and absence.id=p_event.entity_id::uuid and (absence.user_id=p_actor_user_id or public.m1201_group_admin(p_organization_id,p_actor_user_id)));
 end if;
 -- Identity/organization and audited access have intrinsic organization scope.
 if v_permission in ('can_view_audit','can_view_organization','can_view_users','can_view_roles','can_view_invitations','can_view_frameworks') then return true; end if;
 v_table:=case p_event.entity_type
 when 'ai_inference_run' then 'ai_inference_runs'
 when 'product' then 'products' when 'product_release' then 'product_releases'
 when 'connector' then 'connectors' when 'sbom_document' then 'sbom_documents' when 'sbom_ingest_job' then 'sbom_ingest_jobs'
 when 'sbom_supplier_request' then 'sbom_supplier_requests' when 'sbom_supplier_submission' then 'sbom_supplier_submissions'
 when 'evidence_document_version' then 'evidence_document_versions'
 when 'supplier_contact' then 'supplier_contacts' when 'supplier_document_field' then 'supplier_document_fields'
 when 'supplier_evidence_invitation' then 'supplier_evidence_invitations' when 'supplier_evidence_request' then 'supplier_evidence_requests'
 when 'supplier_evidence_submission' then 'supplier_evidence_submissions' when 'supplier_evidence_submission_review' then 'supplier_evidence_submission_reviews' when 'supplier_organization' then 'supplier_organizations'
 when 'technical_file' then 'technical_files' when 'technical_file_auditor_snapshot_grant' then 'technical_file_auditor_snapshot_grants'
 when 'technical_file_declaration' then 'technical_file_declarations' when 'technical_file_section' then 'technical_file_sections'
 when 'technical_file_section_source' then 'technical_file_section_sources' when 'technical_file_snapshot' then 'technical_file_snapshots' when 'technical_file_snapshot_export' then 'technical_file_snapshot_exports'
 when 'vulnerability_match_job' then 'vulnerability_match_jobs' when 'vulnerability_reevaluation_job' then 'vulnerability_reevaluation_jobs' when 'vulnerability_finding' then 'vulnerability_findings'
 when 'reporting_obligation' then 'reporting_obligations' when 'reporting_submission' then 'reporting_submissions' end;
 if v_table is null or to_regclass('public.'||v_table) is null or p_event.entity_id is null or p_event.entity_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
 execute format('select to_jsonb(s) from public.%I s where s.organization_id=$1 and s.id=$2',v_table) into v_source using p_organization_id,p_event.entity_id::uuid;
 if v_source is null then return false; end if;
 if p_event.entity_type in ('sbom_document','sbom_ingest_job','sbom_supplier_submission') and v_source->>'source_id' is not null then
  select to_jsonb(source) into v_related from public.sbom_sources source where source.organization_id=p_organization_id and source.id=(v_source->>'source_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('product_id',v_related->'product_id','release_id',v_related->'release_id');
 end if;
 if p_event.entity_type='sbom_supplier_submission' then
  select to_jsonb(request) into v_related from public.sbom_supplier_requests request where request.organization_id=p_organization_id and request.id=(v_source->>'request_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('product_id',v_related->'product_id','release_id',v_related->'release_id');
 end if;
 if p_event.entity_type in ('supplier_document_field','ai_inference_run') then
  select to_jsonb(submission) into v_related from public.supplier_evidence_submissions submission where submission.organization_id=p_organization_id and submission.id=(v_source->>'submission_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('request_id',v_related->'request_id');
 end if;
 if p_event.entity_type in ('supplier_document_field','ai_inference_run','supplier_evidence_invitation','supplier_evidence_submission','supplier_evidence_submission_review') then
  select to_jsonb(request) into v_related from public.supplier_evidence_requests request where request.organization_id=p_organization_id and request.id=(v_source->>'request_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('product_id',v_related->'product_id');
 end if;
 if p_event.entity_type='technical_file_section_source' then
  select to_jsonb(section) into v_related from public.technical_file_sections section where section.organization_id=p_organization_id and section.id=(v_source->>'section_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('technical_file_id',v_related->'technical_file_id');
 end if;
 if v_source->>'technical_file_id' is not null then
  select to_jsonb(file) into v_related from public.technical_files file where file.organization_id=p_organization_id and file.id=(v_source->>'technical_file_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('product_id',v_related->'product_id');
 end if;
 if p_event.entity_type='technical_file_snapshot_export' then
  select to_jsonb(snapshot) into v_related from public.technical_file_snapshots snapshot where snapshot.organization_id=p_organization_id and snapshot.id=(v_source->>'snapshot_id')::uuid;
  if v_related is null then return false; end if; v_source:=v_source||jsonb_build_object('product_id',v_related->'product_id');
 end if;
 if p_event.entity_type='ai_inference_run' and not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_evidence') then return false; end if;
 if p_event.entity_type='evidence_document_version' and not exists(select 1 from public.evidence_documents document where document.organization_id=p_organization_id and document.id=(v_source->>'document_id')::uuid) then return false; end if;
 if p_event.entity_type='evidence_document_version' and exists(select 1 from public.evidence_document_version_products link where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid) then
  v_evidence_links:=true;
  if exists(select 1 from public.evidence_document_version_products link where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and not link.product_id=any(p_products)) then return false; end if;
  if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or exists(select 1 from public.evidence_document_version_products link left join public.products product on product.organization_id=p_organization_id and product.id=link.product_id where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and product.id is null) then return false; end if;
 end if;
 v_product:=case when p_event.entity_type='product' then p_event.entity_id::uuid else (v_source->>'product_id')::uuid end;
 v_release:=coalesce((v_source->>'release_id')::uuid,(v_source->>'product_release_id')::uuid);
 if v_release is not null then select product_id into v_product from public.product_releases where organization_id=p_organization_id and id=v_release; if not found then return false; end if; end if;
 if v_product is null and p_event.entity_type in ('product','product_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission','technical_file','technical_file_auditor_snapshot_grant','technical_file_declaration','technical_file_section','technical_file_section_source','technical_file_snapshot','technical_file_snapshot_export','vulnerability_match_job','vulnerability_finding','reporting_obligation','reporting_submission') then return false; end if;
 if p_event.entity_type='vulnerability_reevaluation_job' and not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') then return false; end if;
 if v_product is null and public.m13_05_event_class(p_event) in ('products','sboms','findings','evidence','technical_files','suppliers','reporting') and not v_evidence_links then return false;end if;
 if v_product is not null and not v_product=any(p_products) then return false; end if;
 if v_product is not null then return public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') and exists(select 1 from public.products where organization_id=p_organization_id and id=v_product); end if;
 return true;
exception when invalid_text_representation or undefined_column then return false;
end $$;

create or replace function public.m13_05_guard_receipt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb:=new.changes; begin
 if new.entity_type<>'audit_siem' then return new; end if;
 if new.organization_id is not null or new.event_scope<>'security' or new.action not in ('audit.siem.create','audit.siem.update','audit.siem.credentials','audit.siem.revoke_credentials','audit.siem.test','audit.siem.test_prepare','audit.siem.enable','audit.siem.disable','audit.siem.list','audit.siem.read','audit.siem.deliveries','audit.siem.delivery','audit.siem.replay_preview','audit.siem.replay','audit.siem.catalogue','audit.siem.denial','audit.siem.paused','audit.siem.staged','audit.siem.lease_expired','audit.siem.scope_unavailable','audit.siem.retry_exhausted','audit.siem.claimed','audit.siem.completed','audit.siem.key_rewrapped') or v->>'organizationId' is null or v->>'organizationId' !~* '^[a-f0-9-]{36}$' or v->>'operationDigest' is null or v->>'operationDigest' !~ '^[a-f0-9]{64}$' then raise exception 'invalid SIEM receipt' using errcode='22023'; end if;
 new.after_redacted:=jsonb_build_object('organizationId',v->>'organizationId','operationDigest',v->>'operationDigest');
 if v ? 'result' then
  if jsonb_typeof(v->'result')<>'object' or exists(select 1 from jsonb_object_keys(v->'result') k where k not in ('id','version','status','deliveryId','previewDigest','destinationVersion','recipientChanged','credentialRevision','cursorDate','cursorId','previewExpiresAt','testState','safeFailureCode')) then raise exception 'invalid SIEM result receipt' using errcode='22023'; end if;
  if v->'result' ? 'previewDigest' and v->'result'->>'previewDigest' !~ '^[a-f0-9]{64}$' or v->'result' ? 'cursorId' and v->'result'->>'cursorId' !~* '^[a-f0-9-]{36}$' or v->'result' ? 'testState' and v->'result'->>'testState' not in ('accepted','sent_unacknowledged','failed') or v->'result' ? 'safeFailureCode' and v->'result'->>'safeFailureCode' !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid SIEM receipt values' using errcode='22023'; end if;
  if v->'result' ? 'cursorDate' and not isfinite((v->'result'->>'cursorDate')::timestamptz) or v->'result' ? 'previewExpiresAt' and not isfinite((v->'result'->>'previewExpiresAt')::timestamptz) or v->'result' ? 'destinationVersion' and v->'result'->>'destinationVersion' !~ '^[0-9]{1,9}$' or v->'result' ? 'credentialRevision' and v->'result'->>'credentialRevision' !~ '^[0-9]{1,9}$' or v->'result' ? 'recipientChanged' and jsonb_typeof(v->'result'->'recipientChanged')<>'boolean' then raise exception 'invalid SIEM receipt types' using errcode='22023';end if;
  if (v->'result' ? 'id' and v->'result'->>'id' !~* '^[a-f0-9-]{36}$') or (v->'result' ? 'deliveryId' and v->'result'->>'deliveryId' !~* '^[a-f0-9-]{36}$') or (v->'result' ? 'version' and v->'result'->>'version' !~ '^[0-9]{1,9}$') or (v->'result' ? 'status' and v->'result'->>'status' not in ('draft','enabled','disabled','paused')) or pg_column_size(v->'result')>1024 then raise exception 'invalid SIEM receipt values' using errcode='22023'; end if;
  new.after_redacted:=new.after_redacted||jsonb_build_object('result',v->'result');
 end if;
 if v->>'keyId' is not null then if v->>'keyId' !~ '^[A-Za-z0-9_.-]{1,80}$' then raise exception 'invalid key id' using errcode='22023'; end if; new.after_redacted:=new.after_redacted||jsonb_build_object('keyId',v->>'keyId'); end if;
 new.before_redacted:=null;new.reason:=null;new.changes:=null; return new;
end $$;

create or replace function public.m13_05_receipt(p_org uuid,p_actor uuid,p_request uuid,p_operation text,p_entity uuid,p_digest text,p_result jsonb default '{}'::jsonb,p_key_id text default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if p_request is null or p_operation not in ('create','update','credentials','revoke_credentials','test','test_prepare','enable','disable','list','read','deliveries','delivery','replay_preview','replay','catalogue','denial','paused','staged','lease_expired','scope_unavailable','retry_exhausted','claimed','completed','key_rewrapped') or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid SIEM receipt' using errcode='22023'; end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version)
 values(null,p_actor,'audit.siem.'||p_operation,'audit_siem',p_entity::text,2,'security',case when p_operation='test_prepare' then 'audit.siem.prepare:' else 'audit.siem:' end||p_org||':'||coalesce(p_actor::text,'system')||':'||p_request,case when p_actor is null then 'system' else 'user' end,coalesce(p_actor::text,'system'),case when p_operation='denial' then 'denied' else 'completed' end,p_request,jsonb_build_object('organizationId',p_org,'operationDigest',p_digest,'result',p_result,'keyId',p_key_id),1);
end $$;
