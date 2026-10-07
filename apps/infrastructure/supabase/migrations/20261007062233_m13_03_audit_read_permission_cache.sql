-- Measured M13-03 correction: resolve the immutable permission snapshot once
-- per guarded RPC instead of repeating RBAC joins for every candidate event.
-- The cache is an inward-only function argument; no session/global state or
-- browser-controlled permission payload is accepted.
create function public.m13_03_permission_snapshot(p_organization_id uuid,p_actor_user_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_object_agg(permission,public.m13_03_actor_can(p_organization_id,p_actor_user_id,permission))
 from unnest(array['can_view_audit','can_view_users','can_view_roles','can_view_invitations','can_view_organization','can_view_products','can_view_connectors','can_view_sboms','can_view_evidence','can_view_frameworks','can_view_findings','can_view_technical_files','can_view_suppliers','can_view_reporting','can_export_audit']::text[]) permission
$$;

create function public.m13_03_event_visible_cached(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs,p_permissions jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_permission text; v_table text; v_source jsonb; v_related jsonb; v_product uuid; v_release uuid; begin
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
  if not coalesce((p_permissions->>'can_view_products')::boolean,false) or exists(select 1 from public.evidence_document_version_products link left join public.products product on product.organization_id=p_organization_id and product.id=link.product_id where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and product.id is null) then return false; end if;
 end if;
 v_product:=case when p_event.entity_type='product' then p_event.entity_id::uuid else (v_source->>'product_id')::uuid end;
 v_release:=coalesce((v_source->>'release_id')::uuid,(v_source->>'product_release_id')::uuid);
 if v_release is not null then select product_id into v_product from public.product_releases where organization_id=p_organization_id and id=v_release; if not found then return false; end if; end if;
 if v_product is null and p_event.entity_type in ('product','product_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission','technical_file','technical_file_auditor_snapshot_grant','technical_file_declaration','technical_file_section','technical_file_section_source','technical_file_snapshot','technical_file_snapshot_export','vulnerability_match_job','vulnerability_finding','reporting_obligation','reporting_submission') then return false; end if;
 if p_event.entity_type='vulnerability_reevaluation_job' and not coalesce((p_permissions->>'can_view_products')::boolean,false) then return false; end if;
 if v_product is not null then return coalesce((p_permissions->>'can_view_products')::boolean,false) and exists(select 1 from public.products where organization_id=p_organization_id and id=v_product); end if;
 return true;
exception when invalid_text_representation or undefined_column then return false;
end $$;

create or replace function public.m13_03_read_page(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb,p_allowed_entity_types text[],p_after_sequence text,p_after_created_at timestamptz,p_after_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_snapshot public.audit_logs; v_result jsonb; begin
 if p_limit is null or p_limit not between 1 and 200 or (p_after_sequence is not null and p_after_sequence !~ '^[1-9][0-9]{0,18}$') then raise exception 'invalid page' using errcode='22023'; end if;
 v_snapshot:=public.m13_03_assert_snapshot(p_organization_id,p_actor_user_id,p_receipt_id,p_filter_digest,p_scope_digest,p_filters);
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 with chained as materialized (
  select a.* from public.audit_logs a
  where a.organization_id=p_organization_id and a.chain_sequence is not null
   and a.chain_sequence<=(v_snapshot.after_redacted->>'highWaterSequence')::bigint
   and a.entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters)
   and public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions)
   and (p_after_id is null or (p_after_sequence is not null and a.chain_sequence<p_after_sequence::bigint))
  order by a.chain_sequence desc limit p_limit
 ), legacy as materialized (
  select a.* from public.audit_logs a
  where a.organization_id=p_organization_id and a.chain_version is null
   and a.entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters)
   and public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions)
   and (p_after_id is null or p_after_sequence is not null or (a.created_at,a.id)<(p_after_created_at,p_after_id))
  order by a.created_at desc,a.id desc limit greatest(0,p_limit-(select count(*) from chained))
 ), selected as (select * from chained union all select * from legacy)
 select coalesce(jsonb_agg(jsonb_build_object('event',public.m13_03_event_json(a),'afterSequence',a.chain_sequence::text,'afterCreatedAt',case when a.chain_version is null then to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') else null end,'afterId',a.id) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc),'[]'::jsonb) into v_result from selected a;
 return v_result;
end $$;

create or replace function public.m13_03_read_detail(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb,p_allowed_entity_types text[],p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_snapshot public.audit_logs; v_event public.audit_logs; begin
 v_snapshot:=public.m13_03_assert_snapshot(p_organization_id,p_actor_user_id,p_receipt_id,p_filter_digest,p_scope_digest,p_filters);
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 select * into v_event from public.audit_logs a where organization_id=p_organization_id and id=p_event_id and (chain_version is null or chain_sequence<=(v_snapshot.after_redacted->>'highWaterSequence')::bigint) and entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters) and public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions);
 if not found then raise exception 'audit_event_not_found' using errcode='P0002'; end if;
 return jsonb_build_object('event',public.m13_03_event_json(v_event),'before',public.m13_03_read_projection(v_event.before_redacted),'after',public.m13_03_read_projection(coalesce(v_event.after_redacted,v_event.changes)),'reason',public.m13_01_project_v2_reason(v_event.reason));
end $$;

create or replace function public.m13_03_verify_events(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb,p_allowed_entity_types text[],p_event_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_snapshot public.audit_logs; v_items jsonb; v_count integer; begin
 if p_event_ids is null or cardinality(p_event_ids) not between 1 and 200 or cardinality(p_event_ids)<>(select count(distinct x) from unnest(p_event_ids) x) then raise exception 'invalid verification selection' using errcode='22023'; end if;
 v_snapshot:=public.m13_03_assert_snapshot(p_organization_id,p_actor_user_id,p_receipt_id,p_filter_digest,p_scope_digest,p_filters);
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 select count(*),jsonb_agg(jsonb_build_object('eventId',a.id,'status',case when a.chain_version is null then 'legacy_unchained' when a.canonical_content=public.m13_02_canonical_content(a,a.chain_sequence) and a.content_hash=encode(extensions.digest(decode(a.previous_hash,'hex')||convert_to(a.canonical_content,'UTF8'),'sha256'),'hex') then 'event_hashes_checked' else 'integrity_break' end) order by ids.ordinality) into v_count,v_items from unnest(p_event_ids) with ordinality ids(id,ordinality) join public.audit_logs a on a.id=ids.id and a.organization_id=p_organization_id and (a.chain_version is null or a.chain_sequence<=(v_snapshot.after_redacted->>'highWaterSequence')::bigint) and a.entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters) and public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions);
 if v_count<>cardinality(p_event_ids) then raise exception 'audit_event_not_found' using errcode='P0002'; end if;
 return jsonb_build_object('checkedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'completenessProven',false,'authenticityProven',false);
end $$;

create or replace function public.m13_03_read_export_events(p_organization_id uuid,p_export_job_id uuid,p_worker_id text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_job public.audit_export_jobs; v_result jsonb; begin
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 250 or p_worker_id is null then raise exception 'invalid export page' using errcode='22023'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and id=p_export_job_id and state='processing' and worker_id=p_worker_id and lease_expires_at>clock_timestamp();
 if not found then raise exception 'audit_export_conflict' using errcode='40001'; end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,v_job.requester_id);
 if not public.m13_03_actor_can(p_organization_id,v_job.requester_id,'can_export_audit') or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,a,v_permissions) or not public.m13_03_matches_filters(a,v_job.filters)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'sequence',a.chain_sequence::text,'previous_hash',a.previous_hash,'content_hash',a.content_hash,'canonical_content',a.canonical_content,'recomputed_canonical_content',case when a.chain_sequence is not null then public.m13_02_canonical_content(a,a.chain_sequence) else null end,'canonical_disclosable',a.schema_version=2 and a.ip_address is null and a.actor_email is null and a.user_agent is null and a.changes is null and a.before_redacted is not distinct from public.m13_03_read_projection(a.before_redacted) and a.after_redacted is not distinct from public.m13_03_read_projection(a.after_redacted) and a.reason is not distinct from public.m13_01_project_v2_reason(a.reason),'legacy',a.chain_version is null,'created_at',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actor_id',coalesce(a.actor_id,a.user_id::text),'actor_type',coalesce(a.actor_type,case when a.user_id is not null then 'user' else 'unknown' end),'actor_label',null,'action',a.action,'resource_type',a.entity_type,'resource_id',a.entity_id,'correlation_id',a.correlation_id,'outcome',a.outcome,'before',public.m13_03_read_projection(a.before_redacted),'after',public.m13_03_read_projection(coalesce(a.after_redacted,a.changes)),'reason',public.m13_01_project_v2_reason(a.reason)) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc),'[]'::jsonb) into v_result from (select a.* from unnest(v_job.selected_event_ids) with ordinality ids(id,ordinality) join public.audit_logs a on a.id=ids.id and a.organization_id=p_organization_id order by ids.ordinality offset p_offset limit p_limit) a;
 if pg_column_size(v_result)>16777216 then raise exception 'audit_export_limit' using errcode='54000'; end if;
 return v_result;
end $$;

create or replace function public.m13_03_claim_export(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_job public.audit_export_jobs; v_selected uuid[]; begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 120 then raise exception 'invalid worker' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('m13_03_export_slots',0));
 if (select count(*) from public.audit_export_jobs where state='processing' and lease_expires_at>clock_timestamp())>=2 then return null; end if;
 select * into v_job from public.audit_export_jobs j where ((j.state='queued' and not exists(select 1 from public.audit_export_jobs a where a.organization_id=j.organization_id and a.state='processing')) or (j.state='processing' and j.lease_expires_at<=clock_timestamp())) order by coalesce((select max(previous.updated_at) from public.audit_export_jobs previous where previous.organization_id=j.organization_id and previous.attempts>0),'-infinity'::timestamptz),j.created_at,j.id for update skip locked limit 1;
 if not found then return null; end if;
 v_permissions:=public.m13_03_permission_snapshot(v_job.organization_id,v_job.requester_id);
 if v_job.attempts>=3 then
  update public.audit_export_jobs set state='failed',failure_code='generation_failed',worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
  perform public.m13_03_export_audit(v_job,'audit.export.failed',gen_random_uuid()); return null;
 end if;
 if not public.m13_03_actor_can(v_job.organization_id,v_job.requester_id,'can_view_audit') or not public.m13_03_actor_can(v_job.organization_id,v_job.requester_id,'can_export_audit') or not exists(select 1 from public.organization_permissions_version where organization_id=v_job.organization_id and version=v_job.scope_version) or (v_job.attempts>0 and exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=v_job.organization_id where a.id is null or not public.m13_03_event_visible_cached(v_job.organization_id,v_job.requester_id,a,v_permissions))) then
  update public.audit_export_jobs set state='failed',failure_code='access_changed',worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job; perform public.m13_03_export_audit(v_job,'audit.export.failed',gen_random_uuid()); return null;
 end if;
 if v_job.attempts=0 then
 select coalesce(array_agg(a.id order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc),'{}'::uuid[]) into v_selected from (select a.* from public.audit_logs a where a.organization_id=v_job.organization_id and (a.chain_version is null or a.chain_sequence<=v_job.high_water_sequence) and (not v_job.filters ? 'allowedEntityTypes' or a.entity_type in (select jsonb_array_elements_text(v_job.filters->'allowedEntityTypes'))) and public.m13_03_matches_filters(a,v_job.filters) and public.m13_03_event_visible_cached(v_job.organization_id,v_job.requester_id,a,v_permissions) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc limit 100001) a;
 else v_selected:=v_job.selected_event_ids; end if;
 if cardinality(v_selected)>100000 then
  update public.audit_export_jobs set state='failed',failure_code='export_limit',version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job; perform public.m13_03_export_audit(v_job,'audit.export.failed',gen_random_uuid()); return null;
 end if;
 update public.audit_export_jobs set state='processing',attempts=attempts+1,selected_event_ids=v_selected,worker_id=p_worker_id,lease_expires_at=clock_timestamp()+interval '120 seconds',version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
 perform public.m13_03_export_audit(v_job,'audit.export.processing',gen_random_uuid());
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create or replace function public.m13_03_transition_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_next_state text,p_selected_ids uuid[],p_artifact jsonb,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_job public.audit_export_jobs; begin
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found then raise exception 'audit_export_not_found' using errcode='P0002'; end if;
 if p_expected_version is null or p_worker_id is null or v_job.version<>p_expected_version or v_job.state<>'processing' or v_job.worker_id<>p_worker_id or v_job.lease_expires_at<=clock_timestamp() then raise exception 'audit_export_conflict' using errcode='40001'; end if;
 if p_next_state is null or p_next_state not in ('processing','ready','failed','queued') then raise exception 'invalid transition' using errcode='22023'; end if;
 if p_next_state='queued' then
  if p_failure_code is null or p_failure_code not in ('storage_unavailable','generation_failed') then raise exception 'invalid retry' using errcode='22023'; end if;
  if v_job.attempts>=3 then p_next_state:='failed'; end if;
 end if;
 if p_next_state='ready' then
  v_permissions:=public.m13_03_permission_snapshot(p_organization_id,v_job.requester_id);
  if p_selected_ids is distinct from v_job.selected_event_ids or p_selected_ids is null or cardinality(p_selected_ids)>100000 or cardinality(p_selected_ids)<>(select count(distinct x) from unnest(p_selected_ids) x) or exists(select 1 from unnest(p_selected_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id and (a.chain_version is null or a.chain_sequence<=v_job.high_water_sequence) and public.m13_03_matches_filters(a,v_job.filters) and public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,a,v_permissions) where a.id is null) then raise exception 'invalid export selection' using errcode='22023'; end if;
  if p_artifact is null or p_artifact->>'sha256' is null or p_artifact->>'objectPath' is null or p_artifact->>'bytes' is null or p_artifact->>'sha256' !~ '^[a-f0-9]{64}$' or p_artifact->>'objectPath'<>p_organization_id::text||'/'||p_job_id::text||'/'||(p_artifact->>'sha256')||'.zip' or (p_artifact->>'bytes')::bigint not between 1 and 268435456 then raise exception 'invalid export artifact' using errcode='22023'; end if;
  if not public.m13_03_actor_can(p_organization_id,v_job.requester_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,v_job.requester_id,'can_export_audit') or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 end if;
 update public.audit_export_jobs set state=p_next_state,selected_event_ids=case when p_next_state='ready' then p_selected_ids else selected_event_ids end,artifact=case when p_next_state='ready' then p_artifact else artifact end,failure_code=case when p_next_state='failed' then coalesce(p_failure_code,'generation_failed') else null end,lease_expires_at=case when p_next_state='processing' then clock_timestamp()+interval '120 seconds' else null end,worker_id=case when p_next_state='processing' then p_worker_id else null end,expires_at=case when p_next_state='ready' then clock_timestamp()+interval '24 hours' else expires_at end,version=version+1,updated_at=clock_timestamp() where id=p_job_id returning * into v_job;
 if p_next_state<>'processing' then perform public.m13_03_export_audit(v_job,'audit.export.'||p_next_state,gen_random_uuid()); end if;
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create or replace function public.m13_03_get_export(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_job public.audit_export_jobs; begin
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id;
 if not found then raise exception 'audit_export_not_found' using errcode='P0002'; end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 if not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) or exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 if p_request_id is not null then perform public.m13_03_export_audit(v_job,'audit.export.status_read',p_request_id); end if;
 -- Physical object paths/grant digests are never returned by public presentation.
 return (to_jsonb(v_job)-'selected_event_ids'-'download_grant_digest'-'download_session_id')||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text,'row_count',cardinality(v_job.selected_event_ids));
end $$;

create or replace function public.m13_03_issue_download_grant(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_session_id uuid,p_digest text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_job public.audit_export_jobs; begin
 if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_session_id is null or p_request_id is null then raise exception 'invalid grant' using errcode='22023'; end if;
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id for update;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 if not found or v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_export_unavailable' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions) or not public.m13_03_matches_filters(a,v_job.filters)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 update public.audit_export_jobs set download_grant_digest=p_digest,download_session_id=p_session_id,download_expires_at=clock_timestamp()+interval '5 minutes',download_grant_version=download_grant_version+1,version=version+1,updated_at=clock_timestamp() where id=p_job_id returning * into v_job;
 perform public.m13_03_export_audit(v_job,'audit.export.download_authorized',p_request_id);
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create or replace function public.m13_03_redeem_download_grant(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_session_id uuid,p_digest text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permissions jsonb; v_job public.audit_export_jobs; begin
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id for update;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id);
 if not found or p_request_id is null or p_digest is null or v_job.download_grant_digest is distinct from p_digest or v_job.download_session_id is distinct from p_session_id or v_job.download_expires_at is null or v_job.download_expires_at<=clock_timestamp() or v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_download_denied' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,a,v_permissions) or not public.m13_03_matches_filters(a,v_job.filters)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 perform public.m13_03_export_audit(v_job,'audit.export.download_started',p_request_id);
 update public.audit_export_jobs set download_grant_digest=null,download_session_id=null,download_expires_at=null,updated_at=clock_timestamp() where id=p_job_id;
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

-- Keep one source policy implementation for existing inward callers/tests.
create or replace function public.m13_03_event_visible(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m13_03_event_visible_cached(p_organization_id,p_actor_user_id,p_event,public.m13_03_permission_snapshot(p_organization_id,p_actor_user_id))
$$;

-- Private helpers are callable only from trusted SECURITY DEFINER RPCs.
revoke all on function public.m13_03_permission_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb) from public,anon,authenticated,service_role;
create index audit_logs_legacy_tenant_cursor on public.audit_logs(organization_id,created_at desc,id desc) where chain_version is null;
