-- M1 tenant export: register reviewed M6-M9 durable business records.
-- Operational credentials, bearer verifiers, idempotency ledgers, and active
-- lease state remain excluded or are stripped by the table-aware snapshot
-- projection below. Owner-private business content, PII, signatures, hashes,
-- source spans, and object paths are preserved for full tenant export.

create or replace function public.m1_export_usable_security_redact_jsonb(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(jsonb_object_agg(item.key, public.m1_export_usable_security_redact_jsonb(item.value)), '{}'::jsonb)
        into v_result
        from jsonb_each(p_value) item
       where lower(item.key) not in (
         'password', 'password_hash', 'secret', 'client_secret', 'credential',
         'credentials', 'api_key', 'access_token', 'refresh_token',
         'bearer_token', 'session_id', 'session_identifier', 'token_hash',
         'token_verifier', 'verifier', 'private_key', 'encryption_key',
         'signing_secret', 'otp', 'recovery_code'
       )
       and lower(item.key) !~ '(^|_)(token|verifier|session_id|password|secret|credential)(_|$)';
      return v_result;
    when 'array' then
      select coalesce(jsonb_agg(public.m1_export_usable_security_redact_jsonb(item.value)), '[]'::jsonb)
        into v_result
        from jsonb_array_elements(p_value) item;
      return v_result;
    else
      return p_value;
  end case;
end;
$$;

alter function public.m1_export_usable_security_redact_jsonb(jsonb) owner to postgres;
revoke all on function public.m1_export_usable_security_redact_jsonb(jsonb)
  from public, anon, authenticated;
grant execute on function public.m1_export_usable_security_redact_jsonb(jsonb)
  to service_role;

-- Exact table-aware export redactions remove only usable security or active
-- workflow material: token/session/verifier/password/secret/credential keys,
-- idempotency keys, request/payload/command digests, lock tokens, active lease
-- owner/expiry, and retry attempts. Legitimate tenant PII, business content,
-- source spans, signatures, hashes, and object paths are retained so the owner
-- export remains a complete tenant record with links to copied bytes.
create or replace function public.m1_export_business_record_jsonb(
  p_table_name text,
  p_record jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_record jsonb := public.m1_export_usable_security_redact_jsonb(coalesce(p_record, '{}'::jsonb))
    - array[
      'idempotency_key', 'request_digest', 'payload_digest', 'command_digest',
      'initialize_idempotency_key', 'initialize_request_digest',
      'finalize_idempotency_key', 'finalize_request_digest',
      'place_idempotency_key', 'place_payload_digest',
      'release_idempotency_key', 'release_payload_digest',
      'create_idempotency_key', 'lock_token', 'lock_expires_at',
      'lease_owner', 'lease_expires_at', 'attempt_count'
    ];
begin
  case p_table_name
    when 'reporting_stage_drafts', 'reporting_stage_draft_revisions',
      'reporting_stage_submissions', 'reporting_family_template_versions' then
      return v_record;
    when 'reporting_stage_packages' then
      return v_record;
    when 'evidence_document_versions' then
      return v_record;
    when 'evidence_document_legal_holds' then
      return v_record;
    when 'technical_file_sections' then
      return v_record;
    when 'technical_file_section_sources' then
      return v_record;
    when 'technical_file_section_source_reviews' then
      return v_record;
    when 'technical_file_risk_revisions' then
      return v_record;
    when 'technical_file_risk_revision_evidence' then
      return v_record;
    when 'technical_file_risk_revision_requirements' then
      return v_record;
    when 'technical_file_snapshots' then
      return v_record;
    when 'technical_file_snapshot_exports' then
      return v_record;
    when 'technical_file_declarations' then
      return v_record;
    when 'supplier_contacts' then
      return v_record;
    when 'supplier_evidence_requests' then
      return v_record;
    when 'supplier_evidence_request_revisions' then
      return v_record;
    when 'supplier_evidence_request_items' then
      return v_record;
    when 'supplier_evidence_submissions' then
      return v_record;
    when 'supplier_evidence_submission_reviews' then
      return v_record;
    when 'supplier_document_fields' then
      return v_record;
    else
      return v_record;
  end case;
end;
$$;

alter function public.m1_export_business_record_jsonb(text, jsonb) owner to postgres;
revoke all on function public.m1_export_business_record_jsonb(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.m1_export_business_record_jsonb(text, jsonb)
  to service_role;

insert into public.organization_export_sources(source_id, enabled, sort_order)
values
  ('evidence_business_records', true, 54),
  ('technical_file_business_records', true, 55),
  ('supplier_business_records', true, 56)
on conflict(source_id) do update set
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('reporting_obligations', 'reporting_stage_drafts', 'organization_id', 'id', 6),
  ('reporting_obligations', 'reporting_stage_draft_revisions', 'organization_id', 'id', 7),
  ('reporting_obligations', 'reporting_stage_submissions', 'organization_id', 'id', 8),
  ('reporting_obligations', 'reporting_family_templates', 'organization_id', 'id', 9),
  ('reporting_obligations', 'reporting_family_template_versions', 'organization_id', 'id', 10),
  ('reporting_obligations', 'reporting_stage_approvals', 'organization_id', 'id', 11),
  ('reporting_obligations', 'reporting_stage_packages', 'organization_id', 'id', 12),
  ('reporting_obligations', 'reporting_stage_submission_acknowledgements', 'organization_id', 'id', 13),
  ('evidence_business_records', 'evidence_documents', 'organization_id', 'id', 1),
  ('evidence_business_records', 'evidence_document_versions', 'organization_id', 'id', 2),
  ('evidence_business_records', 'evidence_document_version_products', 'organization_id', 'version_id', 3),
  ('evidence_business_records', 'evidence_document_version_retention_protections', 'organization_id', 'version_id', 4),
  ('evidence_business_records', 'evidence_document_legal_holds', 'organization_id', 'id', 5),
  ('technical_file_business_records', 'technical_files', 'organization_id', 'id', 1),
  ('technical_file_business_records', 'technical_file_sections', 'organization_id', 'id', 2),
  ('technical_file_business_records', 'technical_file_section_sources', 'organization_id', 'id', 3),
  ('technical_file_business_records', 'technical_file_section_source_reviews', 'organization_id', 'id', 4),
  ('technical_file_business_records', 'technical_file_risk_registers', 'organization_id', 'id', 5),
  ('technical_file_business_records', 'technical_file_risks', 'organization_id', 'id', 6),
  ('technical_file_business_records', 'technical_file_risk_revisions', 'organization_id', 'id', 7),
  ('technical_file_business_records', 'technical_file_risk_revision_requirements', 'organization_id', 'id', 8),
  ('technical_file_business_records', 'technical_file_risk_revision_assets', 'organization_id', 'revision_id', 9),
  ('technical_file_business_records', 'technical_file_risk_revision_evidence', 'organization_id', 'id', 10),
  ('technical_file_business_records', 'technical_file_snapshots', 'organization_id', 'id', 11),
  ('technical_file_business_records', 'technical_file_snapshot_exports', 'organization_id', 'id', 12),
  ('technical_file_business_records', 'technical_file_declarations', 'organization_id', 'id', 13),
  ('supplier_business_records', 'supplier_organizations', 'organization_id', 'id', 1),
  ('supplier_business_records', 'supplier_contacts', 'organization_id', 'id', 2),
  ('supplier_business_records', 'supplier_component_responsibilities', 'organization_id', 'id', 3),
  ('supplier_business_records', 'supplier_evidence_requests', 'organization_id', 'id', 4),
  ('supplier_business_records', 'supplier_evidence_request_revisions', 'organization_id', 'id', 5),
  ('supplier_business_records', 'supplier_evidence_request_items', 'organization_id', 'id', 6),
  ('supplier_business_records', 'supplier_evidence_submissions', 'organization_id', 'id', 7),
  ('supplier_business_records', 'supplier_evidence_submission_reviews', 'organization_id', 'id', 8),
  ('supplier_business_records', 'supplier_document_fields', 'organization_id', 'id', 9)
on conflict(source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

do $$
declare
  v_definition text;
  v_old_projection text := 'public.m1_export_redact_jsonb(to_jsonb(source))';
  v_new_projection text := 'public.m1_export_business_record_jsonb($4, to_jsonb(source))';
  v_lock_fragment text := 'public.reporting_stage_drafts, public.reporting_stage_draft_revisions, public.reporting_stage_submissions, public.reporting_family_templates, public.reporting_family_template_versions, public.reporting_stage_approvals, public.reporting_stage_packages, public.reporting_stage_submission_acknowledgements, public.evidence_documents, public.evidence_document_versions, public.evidence_document_version_products, public.evidence_document_version_retention_protections, public.evidence_document_legal_holds, public.technical_files, public.technical_file_sections, public.technical_file_section_sources, public.technical_file_section_source_reviews, public.technical_file_risk_registers, public.technical_file_risks, public.technical_file_risk_revisions, public.technical_file_risk_revision_requirements, public.technical_file_risk_revision_assets, public.technical_file_risk_revision_evidence, public.technical_file_snapshots, public.technical_file_snapshot_exports, public.technical_file_declarations, public.supplier_organizations, public.supplier_contacts, public.supplier_component_responsibilities, public.supplier_evidence_requests, public.supplier_evidence_request_revisions, public.supplier_evidence_request_items, public.supplier_evidence_submissions, public.supplier_evidence_submission_reviews, public.supplier_document_fields';
  v_new_lock text := 'public.reporting_stage_drafts, public.reporting_stage_draft_revisions, public.reporting_stage_submissions, public.reporting_family_templates, public.reporting_family_template_versions, public.reporting_stage_approvals, public.reporting_stage_packages, public.reporting_stage_submission_acknowledgements, public.evidence_documents, public.evidence_document_versions, public.evidence_document_version_products, public.evidence_document_version_retention_protections, public.evidence_document_legal_holds, public.technical_files, public.technical_file_sections, public.technical_file_section_sources, public.technical_file_section_source_reviews, public.technical_file_risk_registers, public.technical_file_risks, public.technical_file_risk_revisions, public.technical_file_risk_revision_requirements, public.technical_file_risk_revision_assets, public.technical_file_risk_revision_evidence, public.technical_file_snapshots, public.technical_file_snapshot_exports, public.technical_file_declarations, public.supplier_organizations, public.supplier_contacts, public.supplier_component_responsibilities, public.supplier_evidence_requests, public.supplier_evidence_request_revisions, public.supplier_evidence_request_items, public.supplier_evidence_submissions, public.supplier_evidence_submission_reviews, public.supplier_document_fields';
begin
  select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)
    into v_definition;

  if position(v_new_projection in v_definition) = 0 then
    if position(v_old_projection in v_definition) = 0 then
      raise exception 'M1 export snapshot projection anchor missing';
    end if;
    v_definition := replace(v_definition, v_old_projection, v_new_projection);
  end if;

  if position('public.supplier_document_fields' in v_definition) = 0 then
    if position(chr(10) || '  in share mode' in v_definition) = 0 then
      raise exception 'M1 export snapshot lock anchor missing';
    end if;
    v_definition := replace(
      v_definition,
      chr(10) || '  in share mode',
      ', ' || v_lock_fragment || chr(10) || '  in share mode'
    );
  end if;

  if v_new_lock is null then
    raise exception 'M1 business record lock list cannot be empty';
  end if;

  execute v_definition;
end $$;
