-- M13-03 additive private explorer/export workflow. Historical audit bytes are untouched.
create function public.m13_03_actor_can(p_organization_id uuid,p_actor_user_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 with actor as (
  select m.role from public.organization_members m
  join public.users u on u.id=m.user_id and u.is_active
  join public.organizations o on o.id=m.organization_id and o.is_active
  where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
 ), grants as (
  select role, case
   when p_permission in ('can_view_audit','can_export_audit','can_view_users','can_view_roles','can_view_invitations','can_view_technical_files','can_view_suppliers','can_view_reporting') then role in ('owner','admin')
   when p_permission in ('can_view_organization','can_view_products','can_view_connectors','can_view_sboms','can_view_evidence','can_view_frameworks','can_view_findings') then true
   else false end as base_grant,
   exists (
    select 1 from public.user_role_assignments a
    join public.custom_roles r on r.id=a.role_id and r.organization_id=p_organization_id and r.is_active and not r.is_deleted
    where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
     and (r.permissions->p_permission='true'::jsonb or exists (
       select 1 from jsonb_each(r.permissions) g
       where g.value='true'::jsonb and g.key=any(case p_permission
          when 'can_view_audit' then array['can_export_audit']::text[]
          when 'can_view_users' then array['can_create_users','can_edit_users','can_delete_users','can_export_users']::text[]
          when 'can_view_roles' then array['can_create_roles','can_edit_roles','can_delete_roles']::text[]
          when 'can_view_invitations' then array['can_create_invitations','can_delete_invitations']::text[]
          when 'can_view_organization' then array['can_edit_organization','can_delete_organization','can_export_organization']::text[]
          when 'can_view_products' then array['can_create_products','can_edit_products','can_delete_products','can_export_products','can_approve_products']::text[]
          when 'can_view_connectors' then array['can_create_connectors','can_edit_connectors','can_delete_connectors','can_export_connectors','can_approve_connectors']::text[]
          when 'can_view_sboms' then array['can_upload_sboms','can_review_sboms']::text[]
          when 'can_view_evidence' then array['can_upload_evidence','can_review_evidence']::text[]
          when 'can_view_frameworks' then array[]::text[]
          when 'can_view_findings' then array['can_edit_findings','can_approve_findings','can_export_findings']::text[]
          when 'can_view_technical_files' then array['can_edit_technical_files','can_snapshot_technical_files','can_issue_technical_files','can_share_technical_files']::text[]
          when 'can_view_suppliers' then array[]::text[]
          when 'can_view_reporting' then array['can_submit_reporting']::text[]
          else '{}'::text[] end)
     ))
   ) as custom_grant from actor
 ) select coalesce((select case
  when jsonb_typeof(o.permissions->p_permission)='boolean' then (o.permissions->>p_permission)::boolean
  else g.base_grant or g.custom_grant end
  from grants g left join public.base_role_permission_overrides o
   on o.organization_id=p_organization_id and o.base_role=g.role),false)
$$;

-- Dedicated receipt projection accepts only structural UUIDs, validated hashes,
-- sequence/version and expiry. Generic M13-01 projection remains unchanged.
create function public.m13_03_guard_receipt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; begin
 if new.entity_type='audit_search' and new.action='audit.search.denied' and new.changes ? 'requestId' then
  if new.changes->>'operationDigest' is null or new.changes->>'operationDigest' !~ '^[a-f0-9]{64}$' or new.changes->>'requestId' is null or new.changes->>'requestId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid denial receipt' using errcode='22023'; end if;
  new.after_redacted:=jsonb_build_object('requestId',new.changes->>'requestId','operationDigest',new.changes->>'operationDigest'); new.before_redacted:=null; new.changes:=null; return new;
 end if;
 if new.entity_type='audit_search' and new.action like 'audit.search.%' then
  v:=new.changes;
  if v is null or jsonb_typeof(v)<>'object' or v->>'filterDigest' is null or v->>'scopeDigest' is null or v->>'highWaterSequence' is null or v->>'scopeVersion' is null or v->>'filterDigest' !~ '^[a-f0-9]{64}$' or v->>'scopeDigest' !~ '^[a-f0-9]{64}$' or v->>'highWaterSequence' !~ '^(0|[1-9][0-9]{0,18})$' or v->>'scopeVersion' !~ '^[0-9]+$' or v->>'expiresAt' is null or not isfinite((v->>'expiresAt')::timestamptz) then raise exception 'invalid audit search receipt' using errcode='22023'; end if;
  new.after_redacted:=jsonb_build_object('filterDigest',v->>'filterDigest','scopeDigest',v->>'scopeDigest','highWaterSequence',v->>'highWaterSequence','scopeVersion',(v->>'scopeVersion')::bigint,'expiresAt',v->>'expiresAt');
  if v ? 'operationDigest' then
   if v->>'operationDigest' !~ '^[a-f0-9]{64}$' then raise exception 'invalid operation digest' using errcode='22023'; end if;
   new.after_redacted:=new.after_redacted||jsonb_build_object('operationDigest',v->>'operationDigest');
  end if;
  new.before_redacted:=null; new.changes:=null;
 end if; return new;
end $$;
create trigger m13_03_guard_receipt before insert on public.audit_logs for each row execute function public.m13_03_guard_receipt();

create function public.m13_03_create_snapshot(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_filter_digest text,p_scope_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.audit_logs; v_head bigint; v_version bigint; v_metadata jsonb; begin
 if p_request_id is null or p_filter_digest is null or p_filter_digest !~ '^[a-f0-9]{64}$' or p_scope_digest is null or p_scope_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid snapshot' using errcode='22023'; end if;
 select version into v_version from public.organization_permissions_version where organization_id=p_organization_id for share;
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501'; end if;
 select * into v_row from public.audit_logs where organization_id=p_organization_id and event_key='audit.search:'||p_request_id::text;
 if found then
  if v_row.actor_id<>p_actor_user_id::text or v_row.after_redacted->>'filterDigest'<>p_filter_digest or v_row.after_redacted->>'scopeDigest'<>p_scope_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
 else
  select coalesce(last_sequence,0) into v_head from public.audit_chain_heads where organization_id=p_organization_id;
  v_metadata:=jsonb_build_object('filterDigest',p_filter_digest,'scopeDigest',p_scope_digest,'highWaterSequence',coalesce(v_head,0)::text,'scopeVersion',coalesce(v_version,0),'expiresAt',to_char((clock_timestamp()+interval '30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version) values(p_organization_id,p_actor_user_id,'audit.search.created','audit_search',p_request_id::text,2,'organization','audit.search:'||p_request_id::text,'user',p_actor_user_id::text,'completed',p_request_id,v_metadata,1) returning * into v_row;
 end if;
 return jsonb_build_object('receiptId',v_row.id,'highWaterSequence',v_row.after_redacted->>'highWaterSequence','expiresAt',v_row.after_redacted->>'expiresAt','filterDigest',p_filter_digest,'scopeDigest',p_scope_digest,'scopeVersion',(v_row.after_redacted->>'scopeVersion')::bigint);
end $$;

create function public.m13_03_record_access(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_action text,p_receipt_id uuid,p_operation_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_snapshot public.audit_logs; v_existing public.audit_logs; v_id uuid; begin
 if p_request_id is null or p_action not in ('audit.search.page','audit.search.detail','audit.search.verify','audit.search.denied') or p_operation_digest is null or p_operation_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid access receipt' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 select * into v_snapshot from public.audit_logs where organization_id=p_organization_id and id=p_receipt_id and action='audit.search.created' and actor_id=p_actor_user_id::text;
 if not found then raise exception 'audit_snapshot_not_found' using errcode='P0002'; end if;
 if p_action<>'audit.search.denied' and (not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or (v_snapshot.after_redacted->>'expiresAt')::timestamptz<=clock_timestamp()) then raise exception 'audit_snapshot_unavailable' using errcode='42501'; end if;
 if p_action<>'audit.search.denied' and not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=(v_snapshot.after_redacted->>'scopeVersion')::bigint) then raise exception 'audit_scope_changed' using errcode='40001'; end if;
 select * into v_existing from public.audit_logs where organization_id=p_organization_id and event_key=p_action||':'||p_request_id::text;
 if found then
  if v_existing.actor_id<>p_actor_user_id::text or v_existing.entity_id<>p_receipt_id::text or v_existing.after_redacted->>'operationDigest'<>p_operation_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return jsonb_build_object('receiptId',v_existing.id,'replayed',true);
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version) values(p_organization_id,p_actor_user_id,p_action,'audit_search',p_receipt_id::text,2,'organization',p_action||':'||p_request_id::text,'user',p_actor_user_id::text,case when p_action='audit.search.denied' then 'denied' else 'completed' end,p_request_id,v_snapshot.after_redacted||jsonb_build_object('operationDigest',p_operation_digest),1) returning id into v_id;
 return jsonb_build_object('receiptId',v_id,'replayed',false);
end $$;

-- Shared membership/filter predicate used by explorer, generation and delivery.
create function public.m13_03_matches_filters(p_event public.audit_logs,p_filters jsonb)
returns boolean language sql stable set search_path=pg_catalog,public as $$
 select coalesce(p_event.created_at >= (p_filters->>'from')::timestamptz and p_event.created_at < (p_filters->>'to')::timestamptz
 and (not p_filters ? 'actorId' or coalesce(p_event.actor_id,p_event.user_id::text)=p_filters->>'actorId')
 and (not p_filters ? 'action' or p_event.action=p_filters->>'action')
 and (not p_filters ? 'resourceType' or p_event.entity_type=p_filters->>'resourceType')
 and (not p_filters ? 'resourceId' or p_event.entity_id=p_filters->>'resourceId')
 and (not p_filters ? 'correlationId' or p_event.correlation_id::text=p_filters->>'correlationId'),false)
$$;
create function public.m13_03_event_visible(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_permission text; v_table text; v_source jsonb; v_related jsonb; v_product uuid; v_release uuid; begin
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
  if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or exists(select 1 from public.evidence_document_version_products link left join public.products product on product.organization_id=p_organization_id and product.id=link.product_id where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and product.id is null) then return false; end if;
 end if;
 v_product:=case when p_event.entity_type='product' then p_event.entity_id::uuid else (v_source->>'product_id')::uuid end;
 v_release:=coalesce((v_source->>'release_id')::uuid,(v_source->>'product_release_id')::uuid);
 if v_release is not null then select product_id into v_product from public.product_releases where organization_id=p_organization_id and id=v_release; if not found then return false; end if; end if;
 if v_product is null and p_event.entity_type in ('product','product_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission','technical_file','technical_file_auditor_snapshot_grant','technical_file_declaration','technical_file_section','technical_file_section_source','technical_file_snapshot','technical_file_snapshot_export','vulnerability_match_job','vulnerability_finding','reporting_obligation','reporting_submission') then return false; end if;
 if p_event.entity_type='vulnerability_reevaluation_job' and not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') then return false; end if;
 if v_product is not null then return public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') and exists(select 1 from public.products where organization_id=p_organization_id and id=v_product); end if;
 return true;
exception when invalid_text_representation or undefined_column then return false;
end $$;

create table public.audit_export_jobs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 requester_id uuid not null, request_id uuid not null, snapshot_receipt_id uuid not null references public.audit_logs(id) on delete restrict,
 filters jsonb not null check(jsonb_typeof(filters)='object' and pg_column_size(filters)<=16384), filter_digest text not null check(filter_digest ~ '^[a-f0-9]{64}$'), scope_digest text not null check(scope_digest ~ '^[a-f0-9]{64}$'), scope_version bigint not null,
 high_water_sequence bigint not null check(high_water_sequence>=0), format text not null check(format in ('csv','json')),
 state text not null default 'queued' check(state in ('queued','processing','ready','failed','expired')), version integer not null default 1 check(version>0), attempts integer not null default 0 check(attempts between 0 and 3),
 worker_id text, lease_expires_at timestamptz, selected_event_ids uuid[] not null default '{}', artifact jsonb, failure_code text,
 download_grant_digest text check(download_grant_digest ~ '^[a-f0-9]{64}$'), download_session_id uuid, download_expires_at timestamptz, download_grant_version integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz,
 unique(organization_id,requester_id,request_id), check(cardinality(selected_event_ids)<=100000), check(artifact is null or jsonb_typeof(artifact)='object'), check(failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,79}$')
);
alter table public.audit_export_jobs enable row level security;
revoke all on public.audit_export_jobs from public,anon,authenticated,service_role;
grant select on public.audit_export_jobs to service_role;
create index audit_export_jobs_queue on public.audit_export_jobs(created_at,id) where state in ('queued','processing');
create index audit_export_jobs_tenant on public.audit_export_jobs(organization_id,requester_id,created_at desc);
create unique index audit_export_jobs_active_tenant on public.audit_export_jobs(organization_id) where state='processing';
insert into storage.buckets(id,name,public,file_size_limit) values('audit-exports','audit-exports',false,268435456) on conflict(id) do update set public=false;

create function public.m13_03_export_audit(p_job public.audit_export_jobs,p_action text,p_request_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_outcome text; begin
 select result.outcome into v_outcome from public.m13_01_append_audit_event(p_job.organization_id,'organization',p_action||':'||p_request_id::text,'user',p_job.requester_id::text,p_action,'audit_export',p_job.id::text,'completed',p_request_id,null,case when p_action='audit.export.status_read' then jsonb_build_object('requestId',p_job.request_id) else jsonb_build_object('requestId',p_job.request_id,'version',p_job.version,'state',p_job.state) end,null,null,null,p_job.requester_id) result;
 if v_outcome='conflict' then raise exception 'audit_request_conflict' using errcode='23505'; end if;
end $$;

create function public.m13_03_create_export(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_receipt_id uuid,p_filters jsonb,p_filter_digest text,p_scope_digest text,p_format text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_snapshot public.audit_logs; v_job public.audit_export_jobs; begin
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 if p_filters is null or p_filters->>'from' is null or p_filters->>'to' is null or not isfinite((p_filters->>'from')::timestamptz) or not isfinite((p_filters->>'to')::timestamptz) or (p_filters->>'to')::timestamptz <= (p_filters->>'from')::timestamptz or (p_filters->>'to')::timestamptz-(p_filters->>'from')::timestamptz>interval '366 days' or encode(extensions.digest(convert_to(public.m13_02_canonical_json(p_filters-'allowedEntityTypes'),'UTF8'),'sha256'),'hex') is distinct from p_filter_digest then raise exception 'invalid filters' using errcode='22023'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and request_id=p_request_id;
 if found then
  if v_job.filters<>p_filters or v_job.filter_digest<>p_filter_digest or v_job.scope_digest<>p_scope_digest or v_job.format<>p_format or v_job.snapshot_receipt_id<>p_receipt_id then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
 end if;
 select * into v_snapshot from public.audit_logs where organization_id=p_organization_id and id=p_receipt_id and actor_id=p_actor_user_id::text and action='audit.search.created';
 if not found or (v_snapshot.after_redacted->>'expiresAt')::timestamptz<=clock_timestamp() or v_snapshot.after_redacted->>'filterDigest'<>p_filter_digest or v_snapshot.after_redacted->>'scopeDigest'<>p_scope_digest then raise exception 'audit_snapshot_unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=(v_snapshot.after_redacted->>'scopeVersion')::bigint) then raise exception 'audit_scope_changed' using errcode='40001'; end if;
 insert into public.audit_export_jobs(organization_id,requester_id,request_id,snapshot_receipt_id,filters,filter_digest,scope_digest,scope_version,high_water_sequence,format) values(p_organization_id,p_actor_user_id,p_request_id,p_receipt_id,p_filters,p_filter_digest,p_scope_digest,(v_snapshot.after_redacted->>'scopeVersion')::bigint,(v_snapshot.after_redacted->>'highWaterSequence')::bigint,p_format) returning * into v_job;
 perform public.m13_03_export_audit(v_job,'audit.export.queued',p_request_id);
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create function public.m13_03_claim_export(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_export_jobs; v_selected uuid[]; begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 120 then raise exception 'invalid worker' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('m13_03_export_slots',0));
 if (select count(*) from public.audit_export_jobs where state='processing' and lease_expires_at>clock_timestamp())>=2 then return null; end if;
 select * into v_job from public.audit_export_jobs j where ((j.state='queued' and not exists(select 1 from public.audit_export_jobs a where a.organization_id=j.organization_id and a.state='processing')) or (j.state='processing' and j.lease_expires_at<=clock_timestamp())) order by coalesce((select max(previous.updated_at) from public.audit_export_jobs previous where previous.organization_id=j.organization_id and previous.attempts>0),'-infinity'::timestamptz),j.created_at,j.id for update skip locked limit 1;
 if not found then return null; end if;
 if v_job.attempts>=3 then
  update public.audit_export_jobs set state='failed',failure_code='generation_failed',worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
  perform public.m13_03_export_audit(v_job,'audit.export.failed',gen_random_uuid()); return null;
 end if;
 if not public.m13_03_actor_can(v_job.organization_id,v_job.requester_id,'can_view_audit') or not public.m13_03_actor_can(v_job.organization_id,v_job.requester_id,'can_export_audit') or not exists(select 1 from public.organization_permissions_version where organization_id=v_job.organization_id and version=v_job.scope_version) or (v_job.attempts>0 and exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=v_job.organization_id where a.id is null or not public.m13_03_event_visible(v_job.organization_id,v_job.requester_id,a))) then
  update public.audit_export_jobs set state='failed',failure_code='access_changed',worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job; perform public.m13_03_export_audit(v_job,'audit.export.failed',gen_random_uuid()); return null;
 end if;
 if v_job.attempts=0 then
 select coalesce(array_agg(a.id order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc),'{}'::uuid[]) into v_selected from (select a.* from public.audit_logs a where a.organization_id=v_job.organization_id and (a.chain_version is null or a.chain_sequence<=v_job.high_water_sequence) and (not v_job.filters ? 'allowedEntityTypes' or a.entity_type in (select jsonb_array_elements_text(v_job.filters->'allowedEntityTypes'))) and public.m13_03_matches_filters(a,v_job.filters) and public.m13_03_event_visible(v_job.organization_id,v_job.requester_id,a) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc limit 100001) a;
 else v_selected:=v_job.selected_event_ids; end if;
 if cardinality(v_selected)>100000 then
  update public.audit_export_jobs set state='failed',failure_code='export_limit',version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job; perform public.m13_03_export_audit(v_job,'audit.export.failed',gen_random_uuid()); return null;
 end if;
 update public.audit_export_jobs set state='processing',attempts=attempts+1,selected_event_ids=v_selected,worker_id=p_worker_id,lease_expires_at=clock_timestamp()+interval '120 seconds',version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
 perform public.m13_03_export_audit(v_job,'audit.export.processing',gen_random_uuid());
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create function public.m13_03_transition_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_next_state text,p_selected_ids uuid[],p_artifact jsonb,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_export_jobs; begin
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found then raise exception 'audit_export_not_found' using errcode='P0002'; end if;
 if p_expected_version is null or p_worker_id is null or v_job.version<>p_expected_version or v_job.state<>'processing' or v_job.worker_id<>p_worker_id or v_job.lease_expires_at<=clock_timestamp() then raise exception 'audit_export_conflict' using errcode='40001'; end if;
 if p_next_state is null or p_next_state not in ('processing','ready','failed','queued') then raise exception 'invalid transition' using errcode='22023'; end if;
 if p_next_state='queued' then
  if p_failure_code is null or p_failure_code not in ('storage_unavailable','generation_failed') then raise exception 'invalid retry' using errcode='22023'; end if;
  if v_job.attempts>=3 then p_next_state:='failed'; end if;
 end if;
 if p_next_state='ready' then
  if p_selected_ids is distinct from v_job.selected_event_ids or p_selected_ids is null or cardinality(p_selected_ids)>100000 or cardinality(p_selected_ids)<>(select count(distinct x) from unnest(p_selected_ids) x) or exists(select 1 from unnest(p_selected_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id and (a.chain_version is null or a.chain_sequence<=v_job.high_water_sequence) and public.m13_03_matches_filters(a,v_job.filters) and public.m13_03_event_visible(p_organization_id,v_job.requester_id,a) where a.id is null) then raise exception 'invalid export selection' using errcode='22023'; end if;
  if p_artifact is null or p_artifact->>'sha256' is null or p_artifact->>'objectPath' is null or p_artifact->>'bytes' is null or p_artifact->>'sha256' !~ '^[a-f0-9]{64}$' or p_artifact->>'objectPath'<>p_organization_id::text||'/'||p_job_id::text||'/'||(p_artifact->>'sha256')||'.zip' or (p_artifact->>'bytes')::bigint not between 1 and 268435456 then raise exception 'invalid export artifact' using errcode='22023'; end if;
  if not public.m13_03_actor_can(p_organization_id,v_job.requester_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,v_job.requester_id,'can_export_audit') or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 end if;
 update public.audit_export_jobs set state=p_next_state,selected_event_ids=case when p_next_state='ready' then p_selected_ids else selected_event_ids end,artifact=case when p_next_state='ready' then p_artifact else artifact end,failure_code=case when p_next_state='failed' then coalesce(p_failure_code,'generation_failed') else null end,lease_expires_at=case when p_next_state='processing' then clock_timestamp()+interval '120 seconds' else null end,worker_id=case when p_next_state='processing' then p_worker_id else null end,expires_at=case when p_next_state='ready' then clock_timestamp()+interval '24 hours' else expires_at end,version=version+1,updated_at=clock_timestamp() where id=p_job_id returning * into v_job;
 if p_next_state<>'processing' then perform public.m13_03_export_audit(v_job,'audit.export.'||p_next_state,gen_random_uuid()); end if;
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create function public.m13_03_get_export(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_export_jobs; begin
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id;
 if not found then raise exception 'audit_export_not_found' using errcode='P0002'; end if;
 if not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) or exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible(p_organization_id,p_actor_user_id,a)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 if p_request_id is not null then perform public.m13_03_export_audit(v_job,'audit.export.status_read',p_request_id); end if;
 -- Physical object paths/grant digests are never returned by public presentation.
 return (to_jsonb(v_job)-'selected_event_ids'-'download_grant_digest'-'download_session_id')||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text,'row_count',cardinality(v_job.selected_event_ids));
end $$;

create function public.m13_03_issue_download_grant(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_session_id uuid,p_digest text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_export_jobs; begin
 if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_session_id is null or p_request_id is null then raise exception 'invalid grant' using errcode='22023'; end if;
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id for update;
 if not found or v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_export_unavailable' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible(p_organization_id,p_actor_user_id,a) or not public.m13_03_matches_filters(a,v_job.filters)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 update public.audit_export_jobs set download_grant_digest=p_digest,download_session_id=p_session_id,download_expires_at=clock_timestamp()+interval '5 minutes',download_grant_version=download_grant_version+1,version=version+1,updated_at=clock_timestamp() where id=p_job_id returning * into v_job;
 perform public.m13_03_export_audit(v_job,'audit.export.download_authorized',p_request_id);
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create function public.m13_03_redeem_download_grant(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_session_id uuid,p_digest text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_export_jobs; begin
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') then raise exception 'audit_export_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id for update;
 if not found or p_request_id is null or p_digest is null or v_job.download_grant_digest is distinct from p_digest or v_job.download_session_id is distinct from p_session_id or v_job.download_expires_at is null or v_job.download_expires_at<=clock_timestamp() or v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_download_denied' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible(p_organization_id,p_actor_user_id,a) or not public.m13_03_matches_filters(a,v_job.filters)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 perform public.m13_03_export_audit(v_job,'audit.export.download_started',p_request_id);
 update public.audit_export_jobs set download_grant_digest=null,download_session_id=null,download_expires_at=null,updated_at=clock_timestamp() where id=p_job_id;
 return to_jsonb(v_job)||jsonb_build_object('high_water_sequence',v_job.high_water_sequence::text);
end $$;

create function public.m13_03_event_json(p_event public.audit_logs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_event.id,'sequence',p_event.chain_sequence::text,'legacy',p_event.chain_version is null,'createdAt',to_char(p_event.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actor',jsonb_build_object('id',coalesce(p_event.actor_id,p_event.user_id::text),'type',coalesce(p_event.actor_type,case when p_event.user_id is not null then 'user' else 'unknown' end),'label',null),'action',p_event.action,'resourceType',p_event.entity_type,'resourceId',p_event.entity_id,'correlationId',p_event.correlation_id,'outcome',p_event.outcome,'verificationStatus',case when p_event.chain_version is null then 'legacy_unchained' else 'not_verified' end)
$$;
create function public.m13_03_read_projection(p_value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select case when p_value is null then null else coalesce((select jsonb_object_agg(key,value) from jsonb_each(public.m13_01_project_v2_audit_json(p_value)) where key in ('actorId','artifactId','attemptId','eventId','evidenceVersionId','factorId','fieldId','memberId','organizationId','productId','requestId','roleId','runId','sessionId','sourceId','submissionId','userId','decision','model','outcome','promptVersion','reasonCode','stage','state','status','role','baseRole','permissionKey','attemptCount','count','newVersion','oldVersion','version','active','accepted','enabled','verified','isActive','isDeleted','member')),'{}'::jsonb) end
$$;
create function public.m13_03_assert_snapshot(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb)
returns public.audit_logs language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_snapshot public.audit_logs; begin
 perform 1 from public.organization_permissions_version where organization_id=p_organization_id for share;
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501'; end if;
 select * into v_snapshot from public.audit_logs where organization_id=p_organization_id and id=p_receipt_id and actor_id=p_actor_user_id::text and action='audit.search.created';
 if not found or (v_snapshot.after_redacted->>'expiresAt')::timestamptz<=clock_timestamp() or v_snapshot.after_redacted->>'filterDigest' is distinct from p_filter_digest or v_snapshot.after_redacted->>'scopeDigest' is distinct from p_scope_digest or encode(extensions.digest(convert_to(public.m13_02_canonical_json(p_filters),'UTF8'),'sha256'),'hex') is distinct from p_filter_digest then raise exception 'audit_snapshot_unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=(v_snapshot.after_redacted->>'scopeVersion')::bigint) then raise exception 'audit_scope_changed' using errcode='40001'; end if;
 return v_snapshot;
end $$;
create function public.m13_03_read_page(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb,p_allowed_entity_types text[],p_after_sequence text,p_after_created_at timestamptz,p_after_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_snapshot public.audit_logs; v_result jsonb; begin
 if p_limit is null or p_limit not between 1 and 200 or (p_after_sequence is not null and p_after_sequence !~ '^[1-9][0-9]{0,18}$') then raise exception 'invalid page' using errcode='22023'; end if;
 v_snapshot:=public.m13_03_assert_snapshot(p_organization_id,p_actor_user_id,p_receipt_id,p_filter_digest,p_scope_digest,p_filters);
 select coalesce(jsonb_agg(jsonb_build_object('event',public.m13_03_event_json(a),'afterSequence',a.chain_sequence::text,'afterCreatedAt',case when a.chain_version is null then to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') else null end,'afterId',a.id) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc),'[]'::jsonb) into v_result from (
 select a.* from public.audit_logs a where a.organization_id=p_organization_id and (a.chain_version is null or a.chain_sequence<=(v_snapshot.after_redacted->>'highWaterSequence')::bigint) and a.entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters) and public.m13_03_event_visible(p_organization_id,p_actor_user_id,a)
 and (p_after_id is null or (p_after_sequence is not null and (a.chain_sequence<p_after_sequence::bigint or a.chain_version is null)) or (p_after_sequence is null and a.chain_version is null and (a.created_at,a.id)<(p_after_created_at,p_after_id))) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc limit p_limit) a;
 return v_result;
end $$;
create function public.m13_03_read_detail(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb,p_allowed_entity_types text[],p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_snapshot public.audit_logs; v_event public.audit_logs; begin
 v_snapshot:=public.m13_03_assert_snapshot(p_organization_id,p_actor_user_id,p_receipt_id,p_filter_digest,p_scope_digest,p_filters);
 select * into v_event from public.audit_logs a where organization_id=p_organization_id and id=p_event_id and (chain_version is null or chain_sequence<=(v_snapshot.after_redacted->>'highWaterSequence')::bigint) and entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters) and public.m13_03_event_visible(p_organization_id,p_actor_user_id,a);
 if not found then raise exception 'audit_event_not_found' using errcode='P0002'; end if;
 return jsonb_build_object('event',public.m13_03_event_json(v_event),'before',public.m13_03_read_projection(v_event.before_redacted),'after',public.m13_03_read_projection(coalesce(v_event.after_redacted,v_event.changes)),'reason',public.m13_01_project_v2_reason(v_event.reason));
end $$;
create function public.m13_03_verify_events(p_organization_id uuid,p_actor_user_id uuid,p_receipt_id uuid,p_filter_digest text,p_scope_digest text,p_filters jsonb,p_allowed_entity_types text[],p_event_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_snapshot public.audit_logs; v_items jsonb; v_count integer; begin
 if p_event_ids is null or cardinality(p_event_ids) not between 1 and 200 or cardinality(p_event_ids)<>(select count(distinct x) from unnest(p_event_ids) x) then raise exception 'invalid verification selection' using errcode='22023'; end if;
 v_snapshot:=public.m13_03_assert_snapshot(p_organization_id,p_actor_user_id,p_receipt_id,p_filter_digest,p_scope_digest,p_filters);
 select count(*),jsonb_agg(jsonb_build_object('eventId',a.id,'status',case when a.chain_version is null then 'legacy_unchained' when a.canonical_content=public.m13_02_canonical_content(a,a.chain_sequence) and a.content_hash=encode(extensions.digest(decode(a.previous_hash,'hex')||convert_to(a.canonical_content,'UTF8'),'sha256'),'hex') then 'event_hashes_checked' else 'integrity_break' end) order by ids.ordinality) into v_count,v_items from unnest(p_event_ids) with ordinality ids(id,ordinality) join public.audit_logs a on a.id=ids.id and a.organization_id=p_organization_id and (a.chain_version is null or a.chain_sequence<=(v_snapshot.after_redacted->>'highWaterSequence')::bigint) and a.entity_type=any(p_allowed_entity_types) and public.m13_03_matches_filters(a,p_filters) and public.m13_03_event_visible(p_organization_id,p_actor_user_id,a);
 if v_count<>cardinality(p_event_ids) then raise exception 'audit_event_not_found' using errcode='P0002'; end if;
 return jsonb_build_object('checkedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'completenessProven',false,'authenticityProven',false);
end $$;
create function public.m13_03_read_export_events(p_organization_id uuid,p_export_job_id uuid,p_worker_id text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_export_jobs; v_result jsonb; begin
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 250 or p_worker_id is null then raise exception 'invalid export page' using errcode='22023'; end if;
 select * into v_job from public.audit_export_jobs where organization_id=p_organization_id and id=p_export_job_id and state='processing' and worker_id=p_worker_id and lease_expires_at>clock_timestamp();
 if not found then raise exception 'audit_export_conflict' using errcode='40001'; end if;
 if not public.m13_03_actor_can(p_organization_id,v_job.requester_id,'can_export_audit') or not exists(select 1 from public.organization_permissions_version where organization_id=p_organization_id and version=v_job.scope_version) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_job.selected_event_ids) x left join public.audit_logs a on a.id=x and a.organization_id=p_organization_id where a.id is null or not public.m13_03_event_visible(p_organization_id,v_job.requester_id,a) or not public.m13_03_matches_filters(a,v_job.filters)) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'sequence',a.chain_sequence::text,'previous_hash',a.previous_hash,'content_hash',a.content_hash,'canonical_content',a.canonical_content,'recomputed_canonical_content',case when a.chain_sequence is not null then public.m13_02_canonical_content(a,a.chain_sequence) else null end,'canonical_disclosable',a.schema_version=2 and a.ip_address is null and a.actor_email is null and a.user_agent is null and a.changes is null and a.before_redacted is not distinct from public.m13_03_read_projection(a.before_redacted) and a.after_redacted is not distinct from public.m13_03_read_projection(a.after_redacted) and a.reason is not distinct from public.m13_01_project_v2_reason(a.reason),'legacy',a.chain_version is null,'created_at',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actor_id',coalesce(a.actor_id,a.user_id::text),'actor_type',coalesce(a.actor_type,case when a.user_id is not null then 'user' else 'unknown' end),'actor_label',null,'action',a.action,'resource_type',a.entity_type,'resource_id',a.entity_id,'correlation_id',a.correlation_id,'outcome',a.outcome,'before',public.m13_03_read_projection(a.before_redacted),'after',public.m13_03_read_projection(coalesce(a.after_redacted,a.changes)),'reason',public.m13_01_project_v2_reason(a.reason)) order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc),'[]'::jsonb) into v_result from (select a.* from unnest(v_job.selected_event_ids) with ordinality ids(id,ordinality) join public.audit_logs a on a.id=ids.id and a.organization_id=p_organization_id order by ids.ordinality offset p_offset limit p_limit) a;
 if pg_column_size(v_result)>16777216 then raise exception 'audit_export_limit' using errcode='54000'; end if;
 return v_result;
end $$;

create function public.m13_03_record_denial(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_operation_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_existing public.audit_logs; v_id uuid; begin
 if p_request_id is null or p_operation_digest is null or p_operation_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid denial receipt' using errcode='22023'; end if;
 if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active join public.organizations o on o.id=m.organization_id and o.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id) then raise exception 'audit_access_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 select * into v_existing from public.audit_logs where organization_id=p_organization_id and event_key='audit.search.denied:'||p_request_id::text;
 if found then
  if v_existing.actor_id<>p_actor_user_id::text or v_existing.entity_id<>p_request_id::text or v_existing.after_redacted->>'operationDigest' is distinct from p_operation_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return jsonb_build_object('receiptId',v_existing.id,'replayed',true);
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version) values(p_organization_id,p_actor_user_id,'audit.search.denied','audit_search',p_request_id::text,2,'organization','audit.search.denied:'||p_request_id::text,'user',p_actor_user_id::text,'denied',p_request_id,jsonb_build_object('requestId',p_request_id,'operationDigest',p_operation_digest),1) returning id into v_id;
 return jsonb_build_object('receiptId',v_id,'replayed',false);
end $$;

-- Browser roles cannot invoke any helper or bypass guarded transitions.
do $$ declare v_function record; begin
 for v_function in select p.proname,p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'm13_03_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
  if v_function.proname in ('m13_03_create_snapshot','m13_03_record_access','m13_03_create_export','m13_03_claim_export','m13_03_transition_export','m13_03_get_export','m13_03_issue_download_grant','m13_03_redeem_download_grant','m13_03_read_page','m13_03_read_detail','m13_03_verify_events','m13_03_read_export_events','m13_03_record_denial') then execute format('grant execute on function %s to service_role',v_function.signature); end if;
 end loop;
end $$;
