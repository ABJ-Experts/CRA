-- M13-05 deployment-local SIEM workflow. Original evidence is never modified.
create table public.siem_destinations (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete restrict,
 display_name text not null check(length(display_name) between 1 and 120), transport text not null check(transport in ('https','syslog_tls')),
 format text not null check(format in ('json','cef')), endpoint text not null check(length(endpoint)<=2048),
 event_classes text[] not null check(cardinality(event_classes) between 1 and 20), product_ids uuid[] not null default '{}' check(cardinality(product_ids)<=100),
 state text not null default 'draft' check(state in ('draft','disabled','enabled','paused')), version integer not null default 1 check(version>0),
 destination_revision integer not null default 1, credential_revision integer not null default 0, credential_id uuid, credentials jsonb,
 authority_user_id uuid not null references public.users(id), dataset_epoch uuid not null, database_identity text not null,
 scan_sequence bigint not null default 0 check(scan_sequence>=0), tested_revision integer, failure_code text,
 last_accepted_at timestamptz, scheduled_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), check(pg_column_size(credentials)<=100000), check(failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,79}$')
);
create table public.siem_deliveries (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null, destination_id uuid not null,
 event_id uuid not null references public.audit_logs(id) on delete restrict, destination_revision integer not null,
 event_sequence bigint not null, payload jsonb not null check(pg_column_size(payload)<=8192),
 state text not null default 'queued' check(state in ('queued','processing','accepted','sent_unacknowledged','failed','cancelled')),
 replay_of uuid references public.siem_deliveries(id) on delete restrict, version integer not null default 1, attempt_count integer not null default 0 check(attempt_count between 0 and 6),
 worker_id text,lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default now(),first_attempt_at timestamptz,
 failure_code text, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(organization_id,destination_id) references public.siem_destinations(organization_id,id) on delete restrict,
 unique(organization_id,id), check(failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,79}$')
);
create unique index siem_delivery_event_once on public.siem_deliveries(organization_id,destination_id,destination_revision,event_id) where replay_of is null;
create index siem_delivery_queue on public.siem_deliveries(next_attempt_at,created_at,id) where state in ('queued','processing');
create unique index siem_delivery_tenant_slot on public.siem_deliveries(organization_id) where state='processing';
create index siem_delivery_history on public.siem_deliveries(organization_id,destination_id,created_at desc,id desc);
create table public.siem_delivery_attempts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null, delivery_id uuid not null,lease_token uuid not null,
 attempt_number integer not null check(attempt_number between 1 and 6),state text not null check(state in ('accepted','sent_unacknowledged','retry','failed','interrupted')),
 code text not null check(code ~ '^[a-z][a-z0-9_]{0,79}$'),http_status integer check(http_status between 100 and 599),duration_ms integer check(duration_ms between 0 and 60000),
 created_at timestamptz not null default now(),foreign key(organization_id,delivery_id) references public.siem_deliveries(organization_id,id) on delete restrict,unique(delivery_id,lease_token)
);
alter table public.siem_destinations enable row level security;
alter table public.siem_deliveries enable row level security;
alter table public.siem_delivery_attempts enable row level security;
revoke all on public.siem_destinations,public.siem_deliveries,public.siem_delivery_attempts from public,anon,authenticated,service_role;

create function public.m13_05_actor_can(p_org uuid,p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_permission in ('can_create_connectors','can_edit_connectors') then coalesce((select case when jsonb_typeof(o.permissions->p_permission)='boolean' then (o.permissions->>p_permission)::boolean else m.role in ('owner','admin') or exists(select 1 from public.user_role_assignments a join public.custom_roles r on r.id=a.role_id and r.organization_id=p_org and r.is_active and not r.is_deleted where a.organization_id=p_org and a.user_id=p_actor and r.permissions->p_permission='true'::jsonb) end from public.organization_members m join public.users u on u.id=m.user_id and u.is_active join public.organizations org on org.id=m.organization_id and org.is_active left join public.base_role_permission_overrides o on o.organization_id=p_org and o.base_role=m.role where m.organization_id=p_org and m.user_id=p_actor),false) else public.m13_03_actor_can(p_org,p_actor,p_permission) end
$$;
create function public.m13_05_guard_receipt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb:=new.changes; begin
 if new.entity_type<>'audit_siem' then return new; end if;
 if new.organization_id is not null or new.event_scope<>'security' or new.action not like 'audit.siem.%' or v->>'organizationId' is null or v->>'organizationId' !~* '^[a-f0-9-]{36}$' or v->>'operationDigest' is null or v->>'operationDigest' !~ '^[a-f0-9]{64}$' then raise exception 'invalid SIEM receipt' using errcode='22023'; end if;
 new.after_redacted:=jsonb_build_object('organizationId',v->>'organizationId','operationDigest',v->>'operationDigest');
 if v ? 'result' then
  if jsonb_typeof(v->'result')<>'object' or exists(select 1 from jsonb_object_keys(v->'result') k where k not in ('id','version','status','deliveryId','previewDigest','destinationVersion','recipientChanged','credentialRevision')) then raise exception 'invalid SIEM result receipt' using errcode='22023'; end if;
  if (v->'result' ? 'id' and v->'result'->>'id' !~* '^[a-f0-9-]{36}$') or (v->'result' ? 'deliveryId' and v->'result'->>'deliveryId' !~* '^[a-f0-9-]{36}$') or (v->'result' ? 'version' and v->'result'->>'version' !~ '^[0-9]{1,9}$') or (v->'result' ? 'status' and v->'result'->>'status' not in ('draft','enabled','disabled','paused')) or pg_column_size(v->'result')>1024 then raise exception 'invalid SIEM receipt values' using errcode='22023'; end if;
  new.after_redacted:=new.after_redacted||jsonb_build_object('result',v->'result');
 end if;
 if v->>'keyId' is not null then if v->>'keyId' !~ '^[A-Za-z0-9_.-]{1,80}$' then raise exception 'invalid key id' using errcode='22023'; end if; new.after_redacted:=new.after_redacted||jsonb_build_object('keyId',v->>'keyId'); end if;
 new.before_redacted:=null;new.reason:=null;new.changes:=null; return new;
end $$;
create trigger m13_05_guard_receipt before insert on public.audit_logs for each row execute function public.m13_05_guard_receipt();
create function public.m13_05_receipt(p_org uuid,p_actor uuid,p_request uuid,p_operation text,p_entity uuid,p_digest text,p_result jsonb default '{}'::jsonb,p_key_id text default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if p_request is null or p_operation !~ '^[a-z_]{1,40}$' or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid SIEM receipt' using errcode='22023'; end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version)
 values(null,p_actor,'audit.siem.'||p_operation,'audit_siem',p_entity::text,2,'security','audit.siem:'||p_org||':'||coalesce(p_actor::text,'system')||':'||p_request,case when p_actor is null then 'system' else 'user' end,coalesce(p_actor::text,'system'),'completed',p_request,jsonb_build_object('organizationId',p_org,'operationDigest',p_digest,'result',p_result,'keyId',p_key_id),1);
end $$;

create function public.m13_05_public_destination(p_dest public.siem_destinations,p_actor uuid default null) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_dest.id,'name',p_dest.display_name,'transport',p_dest.transport,'format',p_dest.format,'endpoint',p_dest.endpoint,'eventClasses',p_dest.event_classes,'productIds',p_dest.product_ids,'state',p_dest.state,'version',p_dest.version,'credentialState',case when p_dest.credentials is not null then 'active' when p_dest.credential_revision>0 then 'revoked' else 'missing' end,'authorityUserId',p_dest.authority_user_id,'createdAt',p_dest.created_at,'updatedAt',p_dest.updated_at,'health',jsonb_build_object('pendingCount',count(*) filter(where d.state in ('queued','processing')),'failedCount',count(*) filter(where d.state='failed'),'oldestPendingAt',min(d.created_at) filter(where d.state in ('queued','processing')),'lastAcceptedAt',p_dest.last_accepted_at,'safeFailureCode',p_dest.failure_code)) from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_dest.organization_id and d.destination_id=p_dest.id and public.m13_03_event_visible(p_dest.organization_id,coalesce(p_actor,p_dest.authority_user_id),a)
$$;
create function public.m13_05_authority_valid(p_dest public.siem_destinations) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_audit') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_export_audit') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_edit_connectors') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_connectors') and not exists(select 1 from unnest(p_dest.product_ids) pid where not exists(select 1 from public.products where organization_id=p_dest.organization_id and id=pid)) and (cardinality(p_dest.product_ids)=0 or public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_products')) and not exists(select 1 from unnest(p_dest.event_classes) cls where not public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,case cls when 'access_control' then 'can_view_users' when 'organization' then 'can_view_organization' when 'products' then 'can_view_products' when 'sboms' then 'can_view_sboms' when 'findings' then 'can_view_findings' when 'evidence' then 'can_view_evidence' when 'technical_files' then 'can_view_technical_files' when 'suppliers' then 'can_view_suppliers' when 'frameworks' then 'can_view_frameworks' when 'reporting' then 'can_view_reporting' when 'integrations' then 'can_view_connectors' when 'audit_access' then 'can_view_audit' else 'unknown' end)) and exists(select 1 from public.organizations where id=p_dest.organization_id and audit_dataset_epoch=p_dest.dataset_epoch) and public.m13_04_database_identity()=p_dest.database_identity
$$;

create function public.m13_05_event_selected(p_organization_id uuid,p_actor_user_id uuid,p_event public.audit_logs,p_products uuid[])
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
  if exists(select 1 from public.evidence_document_version_products link where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and not link.product_id=any(p_products)) then return false; end if;
  if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or exists(select 1 from public.evidence_document_version_products link left join public.products product on product.organization_id=p_organization_id and product.id=link.product_id where link.organization_id=p_organization_id and link.version_id=p_event.entity_id::uuid and product.id is null) then return false; end if;
 end if;
 v_product:=case when p_event.entity_type='product' then p_event.entity_id::uuid else (v_source->>'product_id')::uuid end;
 v_release:=coalesce((v_source->>'release_id')::uuid,(v_source->>'product_release_id')::uuid);
 if v_release is not null then select product_id into v_product from public.product_releases where organization_id=p_organization_id and id=v_release; if not found then return false; end if; end if;
 if v_product is null and p_event.entity_type in ('product','product_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission','technical_file','technical_file_auditor_snapshot_grant','technical_file_declaration','technical_file_section','technical_file_section_source','technical_file_snapshot','technical_file_snapshot_export','vulnerability_match_job','vulnerability_finding','reporting_obligation','reporting_submission') then return false; end if;
 if p_event.entity_type='vulnerability_reevaluation_job' and not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') then return false; end if;
 if v_product is not null and not v_product=any(p_products) then return false; end if;
 if v_product is not null then return public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') and exists(select 1 from public.products where organization_id=p_organization_id and id=v_product); end if;
 return true;
exception when invalid_text_representation or undefined_column then return false;
end $$;


create function public.m13_05_event_class(p_event public.audit_logs) returns text language sql immutable set search_path=pg_catalog,public as $$
 select event_class from (values
('audit_search','audit.search.created','audit_access'),
('audit_search','audit.search.denied','audit_access'),
('connector','connector.archived','integrations'),
('connector','connector.created','integrations'),
('connector','connector.field_mapping_saved','integrations'),
('connector','connector.key_rewrapped','integrations'),
('connector','connector.secret_rotated','integrations'),
('connector','connector.test_interrupted','integrations'),
('connector','connector.test_started','integrations'),
('connector','connector.tested','integrations'),
('connector','connector.updated','integrations'),
('evidence_document_version','evidence.access_authorized','evidence'),
('evidence_document_version','evidence.access_expired','evidence'),
('evidence_document_version','evidence.byte_delivery_started','evidence'),
('evidence_document_version','evidence.download_requested','evidence'),
('evidence_document_version','evidence.extraction_retry_requested','evidence'),
('evidence_document_version','evidence.integrity_failure','evidence'),
('evidence_document_version','evidence.replacement_reserved','evidence'),
('evidence_document_version','evidence.scan_completed','evidence'),
('evidence_document_version','evidence.upload_completed','evidence'),
('evidence_document_version','evidence.upload_reserved','evidence'),
('framework_pack_version','framework.pack_imported','frameworks'),
('framework_pack_version','framework.pack_provenance_corrected','frameworks'),
('invitation','invitation.accepted','access_control'),
('invitation','invitation.created','access_control'),
('invitation','invitation.delivery_cancelled','access_control'),
('invitation','invitation.delivery_confirmed','access_control'),
('invitation','invitation.resent','access_control'),
('invitation','invitation.revoked','access_control'),
('organization','organization.created','organization'),
('organization','organization.creation_rejected','organization'),
('organization','organization.switched','organization'),
('organization_branding_draft','organization.branding_draft_logo_selected','organization'),
('organization_branding_draft','organization.branding_draft_updated','organization'),
('organization_legal_entity','organization.legal_entity_backfilled','organization'),
('organization_legal_entity','organization.legal_entity_created','organization'),
('organization_legal_entity','organization.legal_entity_dependencies_reconciled','organization'),
('organization_legal_entity','organization.legal_entity_lifecycle_changed','organization'),
('organization_legal_entity','organization.legal_entity_updated','organization'),
('organization_onboarding_stage','onboarding.stage_completed','organization'),
('product','product.archived','products'),
('product','product.classification_saved','products'),
('product','product.created','products'),
('product','product.legal_entity_assigned','products'),
('product','product.relationship_reevaluation_requested','products'),
('product','product.retention_recalculated','products'),
('product','product.updated','products'),
('product_release','product.release_archived','products'),
('product_release','product.release_created','products'),
('product_release','product.release_legal_entity_snapshot_backfilled','products'),
('product_release','product.release_lifecycle_transitioned','products'),
('product_release','product.release_market_availability_added','products'),
('product_release','product.release_market_availability_corrected','products'),
('product_release','product.release_market_availability_removed','products'),
('product_release','product.release_placed_on_market_date_corrected','products'),
('product_release','product.release_updated','products'),
('reporting_obligation','reporting.anchor_corrected.high','reporting'),
('reporting_obligation','reporting.obligation_cancelled.high','reporting'),
('reporting_obligation','reporting.obligation_created','reporting'),
('reporting_obligation','reporting.rehearsal_created','reporting'),
('reporting_obligation','reporting.rehearsal_replayed','reporting'),
('reporting_obligation','reporting.stage_overdue.high','reporting'),
('reporting_obligation','reporting.stage_submitted','reporting'),
('sbom_document','sbom.normalization_completed','sboms'),
('sbom_ingest_job','sbom.job_failed','sboms'),
('sbom_ingest_job','sbom.job_queued','sboms'),
('sbom_ingest_job','sbom.job_replayed','sboms'),
('sbom_ingest_job','sbom.validation_recorded','sboms'),
('sbom_supplier_request','sbom.supplier_request_created','sboms'),
('sbom_supplier_request','supplier.request_associated','sboms'),
('sbom_supplier_submission','sbom.supplier_submission_queued','sboms'),
('sbom_supplier_submission','sbom.supplier_submission_reserved','sboms'),
('supplier_contact','supplier.contact_archived','suppliers'),
('supplier_contact','supplier.contact_created','suppliers'),
('supplier_contact','supplier.contact_updated','suppliers'),
('supplier_document_field','supplier.document_field_manual','suppliers'),
('supplier_evidence_invitation','supplier.evidence_invitation_revoked','suppliers'),
('supplier_evidence_request','supplier.evidence_request_closed','suppliers'),
('supplier_evidence_request','supplier.evidence_request_created','suppliers'),
('supplier_evidence_request','supplier.evidence_request_re_requested','suppliers'),
('supplier_evidence_request','supplier.evidence_request_revised','suppliers'),
('supplier_evidence_submission','supplier.evidence_submission_failed','suppliers'),
('supplier_evidence_submission','supplier.evidence_submission_reserved','suppliers'),
('supplier_evidence_submission_review','supplier.evidence_submission_reviewed','suppliers'),
('supplier_organization','supplier.archived','suppliers'),
('supplier_organization','supplier.created','suppliers'),
('supplier_organization','supplier.updated','suppliers'),
('technical_file','technical_file.created','technical_files'),
('technical_file','technical_file.readiness_recalculated','technical_files'),
('technical_file_auditor_snapshot_grant','technical_file.auditor_grant_created','technical_files'),
('technical_file_auditor_snapshot_grant','technical_file.auditor_grant_revoked','technical_files'),
('technical_file_declaration','technical_file.declaration_downloaded','technical_files'),
('technical_file_declaration','technical_file.declaration_draft_saved','technical_files'),
('technical_file_declaration','technical_file.declaration_failed','technical_files'),
('technical_file_declaration','technical_file.declaration_issuance_prepared','technical_files'),
('technical_file_declaration','technical_file.declaration_issued','technical_files'),
('technical_file_declaration','technical_file.declaration_reissued','technical_files'),
('technical_file_section','technical_file.section_updated','technical_files'),
('technical_file_section_source','technical_file.source_linked','technical_files'),
('technical_file_section_source','technical_file.source_marked_stale','technical_files'),
('technical_file_section_source','technical_file.source_reviewed','technical_files'),
('technical_file_section_source','technical_file.source_unlinked','technical_files'),
('technical_file_snapshot','technical_file.snapshot_created','technical_files'),
('technical_file_snapshot_export','technical_file.snapshot_export_cancelled','technical_files'),
('technical_file_snapshot_export','technical_file.snapshot_export_downloaded','technical_files'),
('technical_file_snapshot_export','technical_file.snapshot_export_failed','technical_files'),
('technical_file_snapshot_export','technical_file.snapshot_export_ready','technical_files'),
('technical_file_snapshot_export','technical_file.snapshot_export_requested','technical_files'),
('user','auth.email_verification_changed','access_control'),
('user','auth.session_revoked','access_control'),
('user','mfa.recovery_code_used','access_control'),
('user','user.profile_updated','access_control'),
('vulnerability_finding','vulnerability.component_reintroduced','findings'),
('vulnerability_finding','vulnerability.finding_human_verdict_recorded','findings'),
('vulnerability_finding','vulnerability.triage_assignee_changed','findings'),
('vulnerability_match_job','vulnerability.match_page_persisted','findings'),
('vulnerability_match_job','vulnerability.match_queued','findings'),
('vulnerability_reevaluation_job','vulnerability.csaf_reevaluation_provenance_applied','findings'),
('vulnerability_reevaluation_job','vulnerability.reevaluation_discovery_failed','findings'),
('vulnerability_reevaluation_job','vulnerability.reevaluation_discovery_page_persisted','findings'),
('vulnerability_reevaluation_job','vulnerability.reevaluation_discovery_queued','findings'),
('vulnerability_reevaluation_job','vulnerability.reevaluation_failed','findings')) registry(resource_type,action,event_class) where resource_type=p_event.entity_type and action=p_event.action
$$;
create function public.m13_05_event_projection(p_event public.audit_logs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('schemaVersion',1,'eventId',p_event.id,'organizationId',p_event.organization_id,'occurredAt',p_event.created_at,'eventClass',public.m13_05_event_class(p_event),'action',p_event.action,'outcome',case when p_event.outcome in ('intent','completed','failed','denied') then p_event.outcome else 'unknown' end,'actorType',case when p_event.actor_type in ('user','service_account','system','ai','operator') then p_event.actor_type else 'unknown' end,'actorId',case when p_event.actor_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then p_event.actor_id else null end,'resourceType',p_event.entity_type,'resourceId',case when p_event.entity_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then p_event.entity_id else null end,'correlationId',p_event.correlation_id,'chainSequence',p_event.chain_sequence::text)
$$;
create function public.m13_05_public_delivery(p_delivery public.siem_deliveries) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_delivery.id,'destinationId',p_delivery.destination_id,'eventId',p_delivery.event_id,'destinationRevision',p_delivery.destination_revision,'state',case when p_delivery.state='queued' and p_delivery.attempt_count>0 then 'retrying' else p_delivery.state end,'attemptCount',p_delivery.attempt_count,'createdAt',p_delivery.created_at,'updatedAt',p_delivery.updated_at,'nextAttemptAt',case when p_delivery.state='queued' then p_delivery.next_attempt_at else null end,'safeFailureCode',p_delivery.failure_code,'parentDeliveryId',p_delivery.replay_of,'event',p_delivery.payload)
$$;
create function public.m13_05_siem_command(p_organization_id uuid,p_actor_user_id uuid,p_operation text,p_request_id uuid,p_expected_version integer,p_destination_id uuid,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_receipt public.audit_logs;v_delivery public.siem_deliveries;v_event public.audit_logs;v_result jsonb;v_digest text;v_head bigint;v_epoch uuid;v_limit integer;v_key text;v_preview_digest text; begin
 if not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_view_connectors') then raise exception 'siem_access_denied' using errcode='42501'; end if;
 if p_request_id is null or p_operation not in ('create','update','credentials','revoke_credentials','test','enable','disable','list','read','deliveries','delivery','replay_preview','replay','fingerprint_key','test_prepare','credential_context') then raise exception 'invalid SIEM operation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id,0));
 select * into v_receipt from public.audit_logs where event_scope='security' and event_key='audit.siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;
 if p_operation='fingerprint_key' then return jsonb_build_object('keyId',v_receipt.after_redacted->>'keyId'); end if;
 v_digest:=coalesce(p_input->>'operationDigest',encode(extensions.digest(convert_to(p_operation||':'||coalesce(p_destination_id::text,'')||':'||coalesce(p_expected_version::text,'')||':'||(p_input-'operationDigest'-'keyId')::text,'UTF8'),'sha256'),'hex'));
 if v_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid SIEM digest' using errcode='22023'; end if;
 if v_receipt.id is not null then
  if v_receipt.after_redacted->>'operationDigest'<>v_digest or v_receipt.action<>'audit.siem.'||p_operation then raise exception 'siem_request_conflict' using errcode='23505'; end if;
  if p_operation not in ('list','read','deliveries','delivery','replay_preview','test') then
   select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=(v_receipt.after_redacted->'result'->>'id')::uuid;
   if p_operation='replay' then select d.* into v_delivery from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.id=(v_receipt.after_redacted->'result'->>'deliveryId')::uuid and public.m13_05_event_selected(p_organization_id,p_actor_user_id,a,v_dest.product_ids); if not found then raise exception 'siem_not_found' using errcode='P0002'; end if; return public.m13_05_public_delivery(v_delivery); end if;
   return public.m13_05_public_destination(v_dest,p_actor_user_id);
  end if;
 end if;
 if p_operation not in ('list','read','deliveries','delivery','replay_preview') and (not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') or not public.m13_05_actor_can(p_organization_id,p_actor_user_id,case when p_operation='create' then 'can_create_connectors' else 'can_edit_connectors' end)) then raise exception 'siem_access_denied' using errcode='42501'; end if;
 if p_operation in ('credentials','revoke_credentials') and not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and role='owner') then raise exception 'siem_owner_required' using errcode='42501'; end if;
 if p_operation='create' then
  perform pg_advisory_xact_lock(hashtextextended('siem-config:'||p_organization_id,0));
  if (select count(*) from public.siem_destinations where organization_id=p_organization_id)>=10 then raise exception 'siem_destination_limit' using errcode='54000'; end if;
  select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id;
  insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,product_ids,authority_user_id,dataset_epoch,database_identity)
  values(p_destination_id,p_organization_id,p_input->>'name',p_input->>'transport',p_input->>'format',p_input->>'endpoint',array(select jsonb_array_elements_text(p_input->'eventClasses')),array(select jsonb_array_elements_text(p_input->'productIds'))::uuid[],p_actor_user_id,v_epoch,public.m13_04_database_identity()) returning * into v_dest;
 elsif p_operation='list' then
  select jsonb_build_object('items',coalesce(jsonb_agg(public.m13_05_public_destination(d,p_actor_user_id) order by d.created_at,d.id),'[]'::jsonb)) into v_result from public.siem_destinations d where organization_id=p_organization_id;
 else
  select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id for update;
  if not found then raise exception 'siem_not_found' using errcode='P0002'; end if;
  if p_operation not in ('read','deliveries','delivery','replay_preview') and v_dest.version is distinct from p_expected_version then raise exception 'siem_version_conflict' using errcode='23505'; end if;
  if p_operation in ('test_prepare','credential_context') then
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
   v_result:=jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',coalesce(p_input->>'state','failed'),'safeFailureCode',p_input->>'safeFailureCode');
  elsif p_operation='enable' then
   if v_dest.credentials is null or v_dest.tested_revision is distinct from v_dest.destination_revision then raise exception 'tested_credential_required' using errcode='22023'; end if;
   if exists(select 1 from unnest(v_dest.product_ids) p where not exists(select 1 from public.products where organization_id=p_organization_id and id=p)) then raise exception 'scope_unavailable' using errcode='42501'; end if;
   perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
   select coalesce(last_sequence,0) into v_head from public.audit_chain_heads where organization_id=p_organization_id;
   select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id;
   update public.siem_destinations set state='enabled',authority_user_id=p_actor_user_id,scan_sequence=case when state='paused' and dataset_epoch=v_epoch then scan_sequence else coalesce(v_head,0) end,dataset_epoch=v_epoch,database_identity=public.m13_04_database_identity(),version=version+1,failure_code=null,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
  elsif p_operation='disable' then
   update public.siem_destinations set state='disabled',version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='cancelled',version=version+1,lease_token=null,lease_expires_at=null,failure_code='destination_disabled',updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
  elsif p_operation in ('deliveries','delivery','replay_preview','replay') then
   if p_operation='deliveries' then
    v_limit:=coalesce((p_input->>'limit')::integer,50); if v_limit<1 or v_limit>200 then raise exception 'invalid page limit' using errcode='22023'; end if;
    select jsonb_build_object('items',coalesce(jsonb_agg(public.m13_05_public_delivery(d) order by d.created_at desc,d.id desc),'[]'::jsonb),'nextCursor',null) into v_result from (select d.* from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.destination_id=v_dest.id and public.m13_05_event_selected(p_organization_id,p_actor_user_id,a,v_dest.product_ids) order by d.created_at desc,d.id desc limit v_limit) d;
   else
    select d.* into v_delivery from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.destination_id=v_dest.id and d.id=(p_input->>'deliveryId')::uuid and public.m13_05_event_selected(p_organization_id,p_actor_user_id,a,v_dest.product_ids);
    if not found then raise exception 'siem_not_found' using errcode='P0002'; end if;
    if p_operation='delivery' then
     select public.m13_05_public_delivery(v_delivery)||jsonb_build_object('attempts',coalesce(jsonb_agg(jsonb_build_object('id',id,'attempt',attempt_number,'state',case when state='retry' then 'retrying' when state='interrupted' then 'failed' else state end,'safeFailureCode',code,'httpStatus',http_status,'startedAt',created_at,'finishedAt',created_at) order by attempt_number),'[]'::jsonb)) into v_result from public.siem_delivery_attempts where organization_id=p_organization_id and delivery_id=v_delivery.id;
    else
     if v_delivery.state not in ('failed','cancelled','sent_unacknowledged') then raise exception 'replay_not_eligible' using errcode='22023'; end if;
     select * into v_event from public.audit_logs where id=v_delivery.event_id and organization_id=p_organization_id;
     v_preview_digest:=encode(extensions.digest(convert_to(v_delivery.id::text||':'||v_dest.version||':'||v_dest.endpoint||':'||v_dest.format||':'||public.m13_05_event_projection(v_event)::text,'UTF8'),'sha256'),'hex');
     if p_operation='replay_preview' then v_result:=jsonb_build_object('deliveryId',v_delivery.id,'destinationId',v_dest.id,'expectedVersion',v_dest.version,'endpoint',v_dest.endpoint,'format',v_dest.format,'transport',v_dest.transport,'event',public.m13_05_event_projection(v_event),'previewDigest',v_preview_digest,'expiresAt',clock_timestamp()+interval '5 minutes');
     else
      if v_dest.state<>'enabled' or not public.m13_05_authority_valid(v_dest) or p_input->>'previewDigest' is distinct from v_preview_digest or p_input->>'confirmRecipient' is distinct from 'true' then raise exception 'replay_preview_conflict' using errcode='23505'; end if;
      insert into public.siem_deliveries(organization_id,destination_id,event_id,event_sequence,destination_revision,payload,replay_of) values(p_organization_id,v_dest.id,v_event.id,v_event.chain_sequence,v_dest.destination_revision,public.m13_05_event_projection(v_event),v_delivery.id) returning * into v_delivery;
      v_result:=public.m13_05_public_delivery(v_delivery);
     end if;
    end if;
   end if;
  end if;
 end if;
 v_result:=coalesce(v_result,public.m13_05_public_destination(v_dest,p_actor_user_id));
 if v_receipt.id is null then perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,p_operation,p_destination_id,coalesce(p_input->>'operationDigest',v_digest),jsonb_strip_nulls(jsonb_build_object('id',v_dest.id,'version',v_dest.version,'status',v_dest.state,'deliveryId',case when p_operation='replay' then v_delivery.id else null end)),p_input->>'keyId'); end if;
 return v_result;
end $$;
create function public.m13_05_siem_stage(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_event public.audit_logs;v_count integer:=0;v_bytes integer:=0;v_payload jsonb;v_head bigint;v_last bigint;v_pending integer;begin
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
 v_last:=v_dest.scan_sequence;
 for v_event in select * from public.audit_logs where organization_id=v_dest.organization_id and chain_sequence>v_dest.scan_sequence and chain_sequence<=coalesce(v_head,0) order by chain_sequence limit least(250,10000-v_pending) loop
  if public.m13_05_event_class(v_event)=any(v_dest.event_classes) and public.m13_05_event_selected(v_dest.organization_id,v_dest.authority_user_id,v_event,v_dest.product_ids) then
   v_payload:=public.m13_05_event_projection(v_event);
   if octet_length(v_payload::text)>8192 then raise exception 'siem_payload_limit' using errcode='54000'; end if;
   if v_bytes+octet_length(v_payload::text)>1048576 then exit; end if;
   insert into public.siem_deliveries(organization_id,destination_id,event_id,event_sequence,destination_revision,payload) values(v_dest.organization_id,v_dest.id,v_event.id,v_event.chain_sequence,v_dest.destination_revision,v_payload) on conflict do nothing;
   v_count:=v_count+1;v_bytes:=v_bytes+octet_length(v_payload::text);
  end if;
  v_last:=v_event.chain_sequence;
 end loop;
 update public.siem_destinations set scan_sequence=v_last,scheduled_at=clock_timestamp(),failure_code=null where id=v_dest.id;
 if v_last<>v_dest.scan_sequence then perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'staged',v_dest.id,encode(extensions.digest(convert_to(v_last::text,'UTF8'),'sha256'),'hex')); end if;
 return jsonb_build_object('staged',v_count);
end $$;
create function public.m13_05_private_claim(p_delivery public.siem_deliveries,p_dest public.siem_destinations) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('organizationId',p_delivery.organization_id,'deliveryId',p_delivery.id,'destinationId',p_dest.id,'leaseToken',p_delivery.lease_token,'version',p_delivery.version,'workerId',p_delivery.worker_id,'eventId',p_delivery.event_id,'attemptCount',p_delivery.attempt_count,'firstAttemptAt',p_delivery.first_attempt_at,'payloadBytes',p_delivery.payload::text,'event',p_delivery.payload,'protocol',p_dest.transport,'format',p_dest.format,'endpoint',p_dest.endpoint,'credentials',p_dest.credentials,'credentialId',p_dest.credential_id,'credentialRevision',p_dest.credential_revision,'authorityUserId',p_dest.authority_user_id)
$$;
create function public.m13_05_siem_claim(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_delivery public.siem_deliveries;v_dest public.siem_destinations;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 100 then raise exception 'invalid worker' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('siem-worker-slots',0));
 -- An expired send can have reached the receiver. Retry retains the event ID.
 for v_delivery in select * from public.siem_deliveries where state='processing' and lease_expires_at<=clock_timestamp() for update skip locked loop
  insert into public.siem_delivery_attempts(organization_id,delivery_id,lease_token,attempt_number,state,code) values(v_delivery.organization_id,v_delivery.id,v_delivery.lease_token,v_delivery.attempt_count,'interrupted','lease_expired') on conflict do nothing;
  update public.siem_deliveries set state=case when attempt_count>=6 then 'failed' else 'queued' end,version=version+1,lease_token=null,lease_expires_at=null,worker_id=null,failure_code='lease_expired',updated_at=clock_timestamp() where id=v_delivery.id;
  perform public.m13_05_receipt(v_delivery.organization_id,null,gen_random_uuid(),'lease_expired',v_delivery.destination_id,repeat('0',64));
 end loop;
 if (select count(*) from public.siem_deliveries where state='processing')>=2 then return null; end if;
 for v_delivery in select d.* from public.siem_deliveries d join public.siem_destinations s on s.organization_id=d.organization_id and s.id=d.destination_id where d.state='queued' and s.state='enabled' and d.next_attempt_at<=clock_timestamp() and not exists(select 1 from public.siem_deliveries active where active.organization_id=d.organization_id and active.state='processing') order by s.scheduled_at,d.next_attempt_at,d.created_at,d.id for update of d skip locked limit 10 loop
  select * into v_dest from public.siem_destinations where organization_id=v_delivery.organization_id and id=v_delivery.destination_id for update;
  if not public.m13_05_authority_valid(v_dest) then
   update public.siem_destinations set state='paused',failure_code='authority_changed',version=version+1 where id=v_dest.id;
   perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'paused',v_dest.id,repeat('0',64));continue;
  end if;
  if v_delivery.destination_revision<>v_dest.destination_revision or not exists(select 1 from public.audit_logs a where a.organization_id=v_dest.organization_id and a.id=v_delivery.event_id and public.m13_05_event_selected(v_dest.organization_id,v_dest.authority_user_id,a,v_dest.product_ids)) then
   update public.siem_deliveries set state='cancelled',failure_code='scope_unavailable',version=version+1 where id=v_delivery.id;
   perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'scope_unavailable',v_dest.id,repeat('0',64));continue;
  end if;
  if v_delivery.attempt_count>=6 or v_delivery.first_attempt_at<clock_timestamp()-interval '24 hours' then
   update public.siem_deliveries set state='failed',failure_code='retry_exhausted',version=version+1 where id=v_delivery.id;
   perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'retry_exhausted',v_dest.id,repeat('0',64));continue;
  end if;
  update public.siem_deliveries set state='processing',version=version+1,attempt_count=attempt_count+1,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',worker_id=p_worker_id,updated_at=clock_timestamp() where id=v_delivery.id returning * into v_delivery;
  update public.siem_destinations set scheduled_at=clock_timestamp() where id=v_dest.id;
  perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'claimed',v_dest.id,repeat('0',64));
  return public.m13_05_private_claim(v_delivery,v_dest);
 end loop;
 return null;
end $$;
create function public.m13_05_siem_authorize_delivery(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_version integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_delivery public.siem_deliveries;v_dest public.siem_destinations;begin
 select * into v_delivery from public.siem_deliveries where organization_id=p_organization_id and id=p_delivery_id and state='processing' and worker_id=p_worker_id and lease_token=p_lease_token and version=p_version and lease_expires_at>clock_timestamp();
 if not found then return null; end if;
 select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=v_delivery.destination_id;
 if v_dest.state<>'enabled' or not public.m13_05_authority_valid(v_dest) or v_dest.destination_revision<>v_delivery.destination_revision or not exists(select 1 from public.audit_logs a where a.organization_id=p_organization_id and a.id=v_delivery.event_id and public.m13_05_event_selected(p_organization_id,v_dest.authority_user_id,a,v_dest.product_ids)) then return null; end if;
 return public.m13_05_private_claim(v_delivery,v_dest);
end $$;
create function public.m13_05_siem_complete(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_version integer,p_outcome jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_delivery public.siem_deliveries;v_state text:=p_outcome->>'state';v_delay integer;begin
 select * into v_delivery from public.siem_deliveries where organization_id=p_organization_id and id=p_delivery_id and state='processing' and worker_id=p_worker_id and lease_token=p_lease_token and version=p_version and lease_expires_at>clock_timestamp() for update;
 if not found then raise exception 'siem_lease_conflict' using errcode='23505'; end if;
 if v_state not in ('accepted','sent_unacknowledged','retry','failed') or coalesce(p_outcome->>'code','delivered') !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid delivery outcome' using errcode='22023'; end if;
 insert into public.siem_delivery_attempts(organization_id,delivery_id,lease_token,attempt_number,state,code,http_status,duration_ms) values(p_organization_id,v_delivery.id,p_lease_token,v_delivery.attempt_count,v_state,coalesce(p_outcome->>'code','delivered'),(p_outcome->>'status')::integer,(p_outcome->>'durationMs')::integer);
 v_delay:=least(86400,greatest(coalesce((p_outcome->>'retryAfterSeconds')::integer,0),least(300,(5*power(2,v_delivery.attempt_count-1)*(0.5+random()*0.5))::integer)));
 update public.siem_deliveries set state=case when v_state='retry' and attempt_count<6 and first_attempt_at>clock_timestamp()-interval '24 hours' then 'queued' when v_state='retry' then 'failed' else v_state end,version=version+1,failure_code=case when v_state in ('accepted','sent_unacknowledged') then null else p_outcome->>'code' end,next_attempt_at=clock_timestamp()+make_interval(secs=>v_delay),lease_token=null,lease_expires_at=null,worker_id=null,updated_at=clock_timestamp() where id=v_delivery.id returning * into v_delivery;
 if v_state in ('accepted','sent_unacknowledged') then update public.siem_destinations set last_accepted_at=clock_timestamp(),failure_code=null where id=v_delivery.destination_id and organization_id=p_organization_id; end if;
 perform public.m13_05_receipt(p_organization_id,null,gen_random_uuid(),'completed',v_delivery.destination_id,repeat('0',64));
 return public.m13_05_public_delivery(v_delivery);
end $$;
-- RPC-only access. Helpers remain private even to the service role.
do $$ declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'm13_05_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('m13_05_siem_command','m13_05_siem_stage','m13_05_siem_claim','m13_05_siem_authorize_delivery','m13_05_siem_complete') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
