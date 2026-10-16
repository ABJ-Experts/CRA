-- Reuse M13-03 inward-only permission snapshots once per guarded operation.
create or replace function public.m13_05_event_selected_cached(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs,p_products uuid[],p_permissions jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_permission text; v_table text; v_source jsonb; v_related jsonb; v_product uuid; v_release uuid;v_evidence_links boolean:=false; begin
 if p_event.organization_id is distinct from p_organization_id or not coalesce((p_permissions->>'can_view_audit')::boolean,false) then return false; end if;
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
 if not public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,p_event,p_permissions) then return false; end if;
 if v_permission is null or not coalesce((p_permissions->>v_permission)::boolean,false) then return false; end if;
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
 if p_event.entity_type='ai_inference_run' and not coalesce((p_permissions->>'can_view_evidence')::boolean,false) then return false; end if;
 if p_event.entity_type='evidence_document_version' and not exists(select 1 from public.evidence_documents document where document.organization_id=p_organization_id and document.id=(v_source->>'document_id')::uuid) then return false; end if;
 if p_event.entity_type='evidence_document_version' and exists(select 1 from public.evidence_document_version_products link where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid) then
  v_evidence_links:=true;
  if exists(select 1 from public.evidence_document_version_products link where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and not link.product_id=any(p_products)) then return false; end if;
  if not coalesce((p_permissions->>'can_view_products')::boolean,false) or exists(select 1 from public.evidence_document_version_products link left join public.products product on product.organization_id=p_organization_id and product.id=link.product_id where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and product.id is null) then return false; end if;
 end if;
 v_product:=case when p_event.entity_type='product' then p_event.entity_id::uuid else (v_source->>'product_id')::uuid end;
 v_release:=coalesce((v_source->>'release_id')::uuid,(v_source->>'product_release_id')::uuid);
 if v_release is not null then select product_id into v_product from public.product_releases where organization_id=p_organization_id and id=v_release; if not found then return false; end if; end if;
 if v_product is null and p_event.entity_type in ('product','product_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission','technical_file','technical_file_auditor_snapshot_grant','technical_file_declaration','technical_file_section','technical_file_section_source','technical_file_snapshot','technical_file_snapshot_export','vulnerability_match_job','vulnerability_finding','reporting_obligation','reporting_submission') then return false; end if;
 if p_event.entity_type='vulnerability_reevaluation_job' and not coalesce((p_permissions->>'can_view_products')::boolean,false) then return false; end if;
 if v_product is null and public.m13_05_event_class(p_event) in ('products','sboms','findings','evidence','technical_files','suppliers','reporting') and not v_evidence_links then return false;end if;
 if v_product is not null and not v_product=any(p_products) then return false; end if;
 if v_product is not null then return coalesce((p_permissions->>'can_view_products')::boolean,false) and exists(select 1 from public.products where organization_id=p_organization_id and id=v_product); end if;
 return true;
exception when invalid_text_representation or undefined_column then return false;
end $$;

create or replace function public.m13_05_event_selected(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs,p_products uuid[]) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m13_05_event_selected_cached(p_organization_id,p_actor_user_id,p_event,p_products,public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id))
$$;

create or replace function public.m13_05_siem_stage(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_event public.audit_logs;v_count integer:=0;v_bytes integer:=0;v_payload jsonb;v_head bigint;v_last bigint;v_pending integer;v_permissions jsonb;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 100 then raise exception 'invalid worker' using errcode='22023'; end if;
 select * into v_dest from public.siem_destinations where state='enabled' order by scheduled_at,id for update skip locked limit 1;
 if not found then return jsonb_build_object('staged',0); end if;
 if not public.m13_05_authority_valid(v_dest) then
  update public.siem_destinations set state='paused',failure_code='authority_changed',version=version+1,updated_at=clock_timestamp() where id=v_dest.id;
  perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'paused',v_dest.id,repeat('0',64)); return jsonb_build_object('staged',0);
 end if;
 select count(*) into v_pending from public.siem_deliveries where organization_id=v_dest.organization_id and destination_id=v_dest.id and state in ('queued','processing');
 if v_pending>=10000 then update public.siem_destinations set failure_code='backpressure',scheduled_at=clock_timestamp() where id=v_dest.id; return jsonb_build_object('staged',0); end if;
 select last_sequence into v_head from public.audit_chain_heads where organization_id=v_dest.organization_id;
 v_permissions:=public.m13_03_permission_snapshot(v_dest.organization_id,v_dest.authority_user_id);
 v_last:=v_dest.scan_sequence;
 for v_event in select * from public.audit_logs where organization_id=v_dest.organization_id and chain_sequence>v_dest.scan_sequence and chain_sequence<=coalesce(v_head,0) order by chain_sequence limit least(250,10000-v_pending) loop
  if public.m13_05_event_class(v_event)=any(v_dest.event_classes) then
   if public.m13_05_event_selected_cached(v_dest.organization_id,v_dest.authority_user_id,v_event,v_dest.product_ids,v_permissions) then
   v_payload:=public.m13_05_event_projection(v_event);
   if octet_length(v_payload::text)>8192 then raise exception 'siem_payload_limit' using errcode='54000'; end if;
   if v_bytes+octet_length(v_payload::text)>1048576 then exit; end if;
   insert into public.siem_deliveries(organization_id,destination_id,event_id,event_sequence,destination_revision,payload) values(v_dest.organization_id,v_dest.id,v_event.id,v_event.chain_sequence,v_dest.destination_revision,v_payload) on conflict do nothing;
   v_count:=v_count+1;v_bytes:=v_bytes+octet_length(v_payload::text);
   end if;
  end if;
  v_last:=v_event.chain_sequence;
 end loop;
 update public.siem_destinations set scan_sequence=v_last,scheduled_at=clock_timestamp(),failure_code=null where id=v_dest.id;
 if v_last<>v_dest.scan_sequence then perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'staged',v_dest.id,encode(extensions.digest(convert_to(v_last::text,'UTF8'),'sha256'),'hex')); end if;
 return jsonb_build_object('staged',v_count);
end $$;

create or replace function public.m13_05_public_destination(p_dest public.siem_destinations,p_actor uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb:=public.m13_03_permission_snapshot(p_dest.organization_id,coalesce(p_actor,p_dest.authority_user_id));v_result jsonb;begin
 select jsonb_build_object('id',p_dest.id,'name',p_dest.display_name,'transport',p_dest.transport,'format',p_dest.format,'endpoint',p_dest.endpoint,'eventClasses',p_dest.event_classes,'productIds',p_dest.product_ids,'state',p_dest.state,'version',p_dest.version,'credentialState',case when p_dest.credentials is not null then 'active' when p_dest.credential_revision>0 then 'revoked' else 'missing' end,'authorityUserId',p_dest.authority_user_id,'createdAt',p_dest.created_at,'updatedAt',p_dest.updated_at,'health',jsonb_build_object('pendingCount',count(*) filter(where d.state in ('queued','processing')),'failedCount',count(*) filter(where d.state='failed'),'oldestPendingAt',min(d.created_at) filter(where d.state in ('queued','processing')),'lastAcceptedAt',max(d.updated_at) filter(where d.state='accepted'),'safeFailureCode',p_dest.failure_code)) into v_result from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_dest.organization_id and d.destination_id=p_dest.id and public.m13_05_event_selected_cached(p_dest.organization_id,coalesce(p_actor,p_dest.authority_user_id),a,p_dest.product_ids,v_permissions);
 return v_result;end
$$;

create or replace function public.m13_05_siem_command(p_organization_id uuid,p_actor_user_id uuid,p_operation text,p_request_id uuid,p_expected_version integer,p_destination_id uuid,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_receipt public.audit_logs;v_delivery public.siem_deliveries;v_event public.audit_logs;v_result jsonb;v_digest text;v_head bigint;v_epoch uuid;v_limit integer;v_preview_digest text;v_preview_expiry timestamptz;v_cursor_date timestamptz;v_cursor_id uuid;v_receipt_result jsonb:='{}'::jsonb;v_intent public.audit_logs;v_permissions jsonb;begin
 if p_operation='denial' then
  if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id) then raise exception 'siem_access_denied' using errcode='42501';end if;
  if exists(select 1 from public.audit_logs where event_scope='security' and event_key='audit.siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id and action='audit.siem.denial') then return jsonb_build_object('ok',true);end if;
  perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,'denial',p_destination_id,encode(extensions.digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex'));return jsonb_build_object('ok',true);
 end if;
 if not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_view_connectors') then raise exception 'siem_access_denied' using errcode='42501'; end if;
 if p_request_id is null or p_operation not in ('create','update','credentials','revoke_credentials','test','enable','disable','list','read','deliveries','delivery','replay_preview','replay','fingerprint_key','test_prepare','credential_context','catalogue','denial') then raise exception 'invalid SIEM operation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id,0));
 select * into v_receipt from public.audit_logs where event_scope='security' and event_key='audit.siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;
 if p_operation='fingerprint_key' then
  if v_receipt.id is null then select * into v_receipt from public.audit_logs where event_scope='security' and event_key='audit.siem.prepare:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;end if;
  return jsonb_build_object('keyId',v_receipt.after_redacted->>'keyId'); end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 v_digest:=coalesce(p_input->>'operationDigest',encode(extensions.digest(convert_to(p_operation||':'||coalesce(p_destination_id::text,'')||':'||coalesce(p_expected_version::text,'')||':'||(p_input-'operationDigest'-'keyId')::text,'UTF8'),'sha256'),'hex'));
 if v_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid SIEM digest' using errcode='22023'; end if;
 if p_operation='test_prepare' and v_receipt.id is not null and v_receipt.action='audit.siem.test' then
  if v_receipt.after_redacted->>'operationDigest'<>v_digest then raise exception 'siem_request_conflict' using errcode='23505'; end if;
  select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id;
  if not found or not public.m13_05_scope_can(p_organization_id,p_actor_user_id,v_dest.event_classes,v_dest.product_ids) then raise exception 'siem_not_found' using errcode='P0002';end if;
  return jsonb_build_object('completed',true,'result',jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',v_receipt.after_redacted->'result'->>'testState','safeFailureCode',v_receipt.after_redacted->'result'->>'safeFailureCode'));
 end if;
 if v_receipt.id is not null then
  if v_receipt.after_redacted->>'operationDigest'<>v_digest or v_receipt.action<>'audit.siem.'||p_operation then raise exception 'siem_request_conflict' using errcode='23505'; end if;
  if p_operation='test' then select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id;if not found or not public.m13_05_scope_can(p_organization_id,p_actor_user_id,v_dest.event_classes,v_dest.product_ids) then raise exception 'siem_not_found' using errcode='P0002';end if;return jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',v_receipt.after_redacted->'result'->>'testState','safeFailureCode',v_receipt.after_redacted->'result'->>'safeFailureCode');end if;
  if p_operation not in ('list','read','deliveries','delivery','replay_preview','test') then
   select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=(v_receipt.after_redacted->'result'->>'id')::uuid;
   if not public.m13_05_scope_can(p_organization_id,p_actor_user_id,v_dest.event_classes,v_dest.product_ids) then raise exception 'siem_not_found' using errcode='P0002';end if;
   if p_operation='replay' then select d.* into v_delivery from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.id=(v_receipt.after_redacted->'result'->>'deliveryId')::uuid and public.m13_05_event_selected_cached(p_organization_id,p_actor_user_id,a,v_dest.product_ids,v_permissions); if not found then raise exception 'siem_not_found' using errcode='P0002'; end if; return public.m13_05_public_delivery(v_delivery); end if;
   return public.m13_05_public_destination(v_dest,p_actor_user_id);
  end if;
 end if;
 if p_operation not in ('list','read','deliveries','delivery','replay_preview','catalogue') and (not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') or not public.m13_05_actor_can(p_organization_id,p_actor_user_id,case when p_operation='create' then 'can_create_connectors' else 'can_edit_connectors' end)) then raise exception 'siem_access_denied' using errcode='42501'; end if;
 if p_operation in ('credentials','revoke_credentials') and not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and role='owner') then raise exception 'siem_owner_required' using errcode='42501'; end if;
 if p_operation in ('create','update') and not public.m13_05_scope_can(p_organization_id,p_actor_user_id,array(select jsonb_array_elements_text(p_input->'eventClasses')),array(select jsonb_array_elements_text(p_input->'productIds'))::uuid[]) then raise exception 'scope_unavailable' using errcode='42501';end if;
 if p_operation='catalogue' then
  v_result:=jsonb_build_object('ok',true);
 elsif p_operation='create' then
  perform pg_advisory_xact_lock(hashtextextended('siem-config:'||p_organization_id,0));
  if (select count(*) from public.siem_destinations where organization_id=p_organization_id)>=10 then raise exception 'siem_destination_limit' using errcode='54000'; end if;
  select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id;
  insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,product_ids,authority_user_id,dataset_epoch,database_identity)
  values(p_destination_id,p_organization_id,p_input->>'name',p_input->>'transport',p_input->>'format',p_input->>'endpoint',array(select jsonb_array_elements_text(p_input->'eventClasses')),array(select jsonb_array_elements_text(p_input->'productIds'))::uuid[],p_actor_user_id,v_epoch,public.m13_04_database_identity()) returning * into v_dest;
 elsif p_operation='list' then
  select jsonb_build_object('items',coalesce(jsonb_agg(public.m13_05_public_destination(d,p_actor_user_id) order by d.created_at,d.id),'[]'::jsonb)) into v_result from public.siem_destinations d where organization_id=p_organization_id and public.m13_05_scope_can(p_organization_id,p_actor_user_id,d.event_classes,d.product_ids);
 else
  select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id for update;
  if not found or not public.m13_05_scope_can(p_organization_id,p_actor_user_id,v_dest.event_classes,v_dest.product_ids) then raise exception 'siem_not_found' using errcode='P0002'; end if;
  if p_operation not in ('read','deliveries','delivery','replay_preview','catalogue') and v_dest.version is distinct from p_expected_version then raise exception 'siem_version_conflict' using errcode='23505'; end if;
  if p_operation in ('test_prepare','credential_context','catalogue','denial') then
   if p_operation='test_prepare' then
    select * into v_intent from public.audit_logs where event_scope='security' and event_key='audit.siem.prepare:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;
    if v_intent.id is not null and v_intent.after_redacted->>'operationDigest'<>v_digest then raise exception 'siem_request_conflict' using errcode='23505';end if;
    if v_intent.id is null then perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,'test_prepare',v_dest.id,v_digest,jsonb_build_object('id',v_dest.id,'version',v_dest.version),p_input->>'keyId');end if;
   end if;
   if p_operation='test_prepare' and (not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') or v_dest.credentials is null) then raise exception 'siem_access_denied' using errcode='42501'; end if;
   return jsonb_build_object('organizationId',p_organization_id,'destinationId',v_dest.id,'endpoint',v_dest.endpoint,'transport',v_dest.transport,'format',v_dest.format,'credentials',v_dest.credentials,'credentialId',v_dest.credential_id,'credentialRevision',v_dest.credential_revision,'authorityUserId',v_dest.authority_user_id);
  elsif p_operation='update' then
   if p_input->>'backlogPolicy' is distinct from 'cancel_pending_start_future' then raise exception 'backlog confirmation required' using errcode='22023'; end if;
   update public.siem_deliveries set state='cancelled',version=version+1,lease_token=null,lease_expires_at=null,failure_code='destination_changed',updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
   update public.siem_destinations set display_name=p_input->>'name',transport=p_input->>'transport',format=p_input->>'format',endpoint=p_input->>'endpoint',event_classes=array(select jsonb_array_elements_text(p_input->'eventClasses')),product_ids=array(select jsonb_array_elements_text(p_input->'productIds'))::uuid[],destination_revision=destination_revision+1,tested_revision=null,state='disabled',version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
  elsif p_operation='credentials' then
   if (p_input->>'credentialRevision')::integer is distinct from p_expected_version+1 or (p_input->>'credentialRevision')::integer<=v_dest.credential_revision then raise exception 'invalid credential revision' using errcode='22023'; end if;
   if p_input->'encryptedCredential' is null or p_input->>'credentialId' is null then raise exception 'encrypted credential required' using errcode='22023'; end if;
   update public.siem_destinations set credentials=p_input->'encryptedCredential',credential_id=(p_input->>'credentialId')::uuid,credential_revision=(p_input->>'credentialRevision')::integer,tested_revision=null,version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='queued',version=version+1,lease_token=null,lease_expires_at=null,worker_id=null,updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state='processing';
  elsif p_operation='revoke_credentials' then
   update public.siem_destinations set credentials=null,state='paused',version=version+1,tested_revision=null,failure_code='credential_revoked',updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='queued',version=version+1,lease_token=null,lease_expires_at=null,worker_id=null,updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state='processing';
  elsif p_operation='test' then
   if v_dest.credentials is null then raise exception 'credential_required' using errcode='22023'; end if;
   if p_input->>'state' in ('accepted','sent_unacknowledged') then update public.siem_destinations set tested_revision=destination_revision,version=version+1,failure_code=null,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest; end if;
   v_receipt_result:=jsonb_build_object('testState',coalesce(p_input->>'state','failed'),'safeFailureCode',p_input->>'safeFailureCode');
   v_result:=jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',coalesce(p_input->>'state','failed'),'safeFailureCode',p_input->>'safeFailureCode');
  elsif p_operation='enable' then
   v_dest.authority_user_id:=p_actor_user_id;
   if not public.m13_05_authority_valid(v_dest) and v_dest.dataset_epoch=(select audit_dataset_epoch from public.organizations where id=p_organization_id) and v_dest.database_identity=public.m13_04_database_identity() then raise exception 'scope_unavailable' using errcode='42501';end if;
   if v_dest.credentials is null or v_dest.tested_revision is distinct from v_dest.destination_revision then raise exception 'tested_credential_required' using errcode='22023'; end if;
   if exists(select 1 from unnest(v_dest.product_ids) p where not exists(select 1 from public.products where organization_id=p_organization_id and id=p)) then raise exception 'scope_unavailable' using errcode='42501'; end if;
   perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
   select coalesce(last_sequence,0) into v_head from public.audit_chain_heads where organization_id=p_organization_id;
   select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id;
   if v_dest.dataset_epoch<>v_epoch or v_dest.database_identity<>public.m13_04_database_identity() then
    if length(coalesce(p_input->>'reason',''))=0 then raise exception 'dataset fresh start reason required' using errcode='22023';end if;
    update public.siem_deliveries set state='cancelled',failure_code='dataset_changed',version=version+1,lease_token=null,lease_expires_at=null where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
   end if;
   update public.siem_destinations set state='enabled',authority_user_id=p_actor_user_id,scan_sequence=case when state='paused' and dataset_epoch=v_epoch and database_identity=public.m13_04_database_identity() then scan_sequence else coalesce(v_head,0) end,dataset_epoch=v_epoch,database_identity=public.m13_04_database_identity(),version=version+1,failure_code=null,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
  elsif p_operation='disable' then
   update public.siem_destinations set state='disabled',version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='cancelled',version=version+1,lease_token=null,lease_expires_at=null,failure_code='destination_disabled',updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
  elsif p_operation in ('deliveries','delivery','replay_preview','replay') then
   if p_operation='deliveries' then
    v_limit:=coalesce((p_input->>'limit')::integer,50); if v_limit<1 or v_limit>200 then raise exception 'invalid page limit' using errcode='22023'; end if;
    if p_input->>'cursor' is not null then
     select (after_redacted->'result'->>'cursorDate')::timestamptz,(after_redacted->'result'->>'cursorId')::uuid into v_cursor_date,v_cursor_id from public.audit_logs where event_scope='security' and action='audit.siem.deliveries' and correlation_id=(p_input->>'cursor')::uuid and actor_id=p_actor_user_id::text and entity_id=v_dest.id::text and after_redacted->>'organizationId'=p_organization_id::text;
     if not found or v_cursor_date is null then raise exception 'invalid cursor' using errcode='22023';end if;
    end if;
    with selected as (select d.* from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.destination_id=v_dest.id and (v_cursor_date is null or (d.created_at,d.id)<(v_cursor_date,v_cursor_id)) and public.m13_05_event_selected_cached(p_organization_id,p_actor_user_id,a,v_dest.product_ids,v_permissions) order by d.created_at desc,d.id desc limit v_limit+1), page as(select * from selected order by created_at desc,id desc limit v_limit)
    select jsonb_build_object('items',coalesce(jsonb_agg(public.m13_05_public_delivery(page) order by page.created_at desc,page.id desc),'[]'::jsonb),'nextCursor',case when (select count(*) from selected)>v_limit then p_request_id::text else null end) into v_result from page;
    if v_result->>'nextCursor' is not null then v_receipt_result:=jsonb_build_object('cursorDate',v_result->'items'->(jsonb_array_length(v_result->'items')-1)->>'createdAt','cursorId',v_result->'items'->(jsonb_array_length(v_result->'items')-1)->>'id');end if;
   else
    select d.* into v_delivery from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.destination_id=v_dest.id and d.id=(p_input->>'deliveryId')::uuid and public.m13_05_event_selected_cached(p_organization_id,p_actor_user_id,a,v_dest.product_ids,v_permissions);
    if not found then raise exception 'siem_not_found' using errcode='P0002'; end if;
    if p_operation='delivery' then
     select public.m13_05_public_delivery(v_delivery)||jsonb_build_object('attempts',coalesce(jsonb_agg(jsonb_build_object('id',id,'attempt',attempt_number,'state',case when state='retry' then 'retrying' when state='interrupted' then 'failed' else state end,'safeFailureCode',code,'httpStatus',http_status,'startedAt',created_at,'finishedAt',created_at) order by attempt_number),'[]'::jsonb)) into v_result from public.siem_delivery_attempts where organization_id=p_organization_id and delivery_id=v_delivery.id;
    else
     if v_delivery.state not in ('failed','cancelled','sent_unacknowledged') then raise exception 'replay_not_eligible' using errcode='22023'; end if;
     select * into v_event from public.audit_logs where id=v_delivery.event_id and organization_id=p_organization_id;
     if public.m13_05_event_class(v_event) is null or not public.m13_05_event_class(v_event)=any(v_dest.event_classes) then raise exception 'siem_not_found' using errcode='P0002';end if;
     v_preview_digest:=encode(extensions.digest(convert_to(v_delivery.id::text||':'||v_dest.version||':'||v_dest.endpoint||':'||v_dest.format||':'||public.m13_05_event_projection(v_event)::text,'UTF8'),'sha256'),'hex');
     if p_operation='replay_preview' then
      if v_receipt.id is not null and ((v_receipt.after_redacted->'result'->>'version')::integer<>v_dest.version or v_receipt.after_redacted->'result'->>'previewDigest'<>v_preview_digest) then raise exception 'replay_preview_conflict' using errcode='23505';end if;
      v_preview_expiry:=coalesce((v_receipt.after_redacted->'result'->>'previewExpiresAt')::timestamptz,clock_timestamp()+interval '5 minutes');v_receipt_result:=jsonb_build_object('previewDigest',v_preview_digest,'previewExpiresAt',v_preview_expiry);
      v_result:=jsonb_build_object('deliveryId',v_delivery.id,'destinationId',v_dest.id,'expectedVersion',v_dest.version,'endpoint',v_dest.endpoint,'format',v_dest.format,'transport',v_dest.transport,'event',public.m13_05_event_projection(v_event),'previewDigest',v_preview_digest,'expiresAt',v_preview_expiry);
     else
      if not exists(select 1 from public.audit_logs where event_scope='security' and action='audit.siem.replay_preview' and actor_id=p_actor_user_id::text and entity_id=v_dest.id::text and after_redacted->>'organizationId'=p_organization_id::text and after_redacted->'result'->>'previewDigest'=v_preview_digest and (after_redacted->'result'->>'previewExpiresAt')::timestamptz>clock_timestamp()) then raise exception 'replay_preview_expired' using errcode='23505';end if;
      if v_dest.state<>'enabled' or not public.m13_05_authority_valid(v_dest) or p_input->>'previewDigest' is distinct from v_preview_digest or p_input->>'confirmRecipient' is distinct from 'true' then raise exception 'replay_preview_conflict' using errcode='23505'; end if;
      insert into public.siem_deliveries(organization_id,destination_id,event_id,event_sequence,destination_revision,payload,replay_of) values(p_organization_id,v_dest.id,v_event.id,v_event.chain_sequence,v_dest.destination_revision,public.m13_05_event_projection(v_event),v_delivery.id) returning * into v_delivery;
      v_result:=public.m13_05_public_delivery(v_delivery);
     end if;
    end if;
   end if;
  end if;
 end if;
 v_result:=coalesce(v_result,public.m13_05_public_destination(v_dest,p_actor_user_id));
 if v_receipt.id is null then perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,p_operation,p_destination_id,coalesce(p_input->>'operationDigest',v_digest),v_receipt_result||jsonb_strip_nulls(jsonb_build_object('id',v_dest.id,'version',v_dest.version,'status',v_dest.state,'deliveryId',case when p_operation='replay' then v_delivery.id else null end)),p_input->>'keyId'); end if;
 return v_result;
end $$;
revoke all on function public.m13_05_event_selected_cached(uuid,uuid,public.audit_logs,uuid[],jsonb) from public,anon,authenticated,service_role;
