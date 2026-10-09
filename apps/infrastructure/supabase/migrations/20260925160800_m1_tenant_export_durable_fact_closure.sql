-- M1 tenant export closure: register remaining durable tenant facts and repair
-- the already-applied business-record projection volatility without editing the
-- applied 20260925160700 migration. Owner-private tenant content, PII, hashes,
-- object paths, source spans, and business evidence remain in the export.

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
      'create_idempotency_key', 'intake_idempotency_key',
      'lock_token', 'lock_expires_at', 'lease_owner', 'lease_expires_at',
      'attempt_count'
    ];
begin
  case p_table_name
    when 'vulnerability_kev_alerts' then
      return v_record - array[
        'delivery_attempts', 'max_delivery_attempts',
        'last_delivery_error_code', 'last_delivery_error_message'
      ];
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
  ('vulnerability_detection_records', true, 57),
  ('vulnerability_triage_views', true, 58)
on conflict(source_id) do update set
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('reporting_obligations', 'reporting_obligation_evidence_packs', 'organization_id', 'id', 14),
  ('reporting_obligations', 'reporting_stage_filing_proofs', 'organization_id', 'id', 15),
  ('evidence_business_records', 'evidence_bulk_intake_batches', 'organization_id', 'id', 6),
  ('evidence_business_records', 'evidence_bulk_intake_items', 'organization_id', 'id', 7),
  ('evidence_business_records', 'evidence_document_version_texts', 'organization_id', 'version_id', 8),
  ('evidence_business_records', 'evidence_document_watermark_exports', 'organization_id', 'id', 9),
  ('technical_file_business_records', 'technical_file_auditor_access_events', 'organization_id', 'id', 14),
  ('vulnerability_detection_records', 'vulnerability_component_occurrences', 'organization_id', 'id', 1),
  ('vulnerability_detection_records', 'vulnerability_findings', 'organization_id', 'id', 2),
  ('vulnerability_detection_records', 'vulnerability_finding_component_occurrences', 'organization_id', 'finding_id', 3),
  ('vulnerability_detection_records', 'vulnerability_match_evaluations', 'organization_id', 'id', 4),
  ('vulnerability_detection_records', 'vulnerability_kev_alerts', 'organization_id', 'id', 5),
  ('vulnerability_detection_records', 'vulnerability_manual_findings', 'organization_id', 'id', 6),
  ('vulnerability_triage_views', 'vulnerability_triage_saved_views', 'organization_id', 'id', 1),
  ('vulnerability_triage_views', 'vulnerability_triage_saved_view_defaults', 'organization_id', 'user_id', 2)
on conflict(source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

do $$
declare
  v_definition text;
  v_lock_fragment text := 'public.reporting_obligation_evidence_packs, public.reporting_stage_filing_proofs, public.evidence_bulk_intake_batches, public.evidence_bulk_intake_items, public.evidence_document_version_texts, public.evidence_document_watermark_exports, public.technical_file_auditor_access_events, public.vulnerability_component_occurrences, public.vulnerability_findings, public.vulnerability_finding_component_occurrences, public.vulnerability_match_evaluations, public.vulnerability_kev_alerts, public.vulnerability_manual_findings, public.vulnerability_triage_saved_views, public.vulnerability_triage_saved_view_defaults';
  v_new_lock text := 'public.reporting_obligation_evidence_packs, public.reporting_stage_filing_proofs, public.evidence_bulk_intake_batches, public.evidence_bulk_intake_items, public.evidence_document_version_texts, public.evidence_document_watermark_exports, public.technical_file_auditor_access_events, public.vulnerability_component_occurrences, public.vulnerability_findings, public.vulnerability_finding_component_occurrences, public.vulnerability_match_evaluations, public.vulnerability_kev_alerts, public.vulnerability_manual_findings, public.vulnerability_triage_saved_views, public.vulnerability_triage_saved_view_defaults';
begin
  select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)
    into v_definition;

  if position('public.vulnerability_triage_saved_view_defaults' in v_definition) = 0 then
    if position(chr(10) || '  in share mode' in v_definition) = 0 then
      raise exception 'M1 durable fact lock anchor missing';
    end if;
    v_definition := replace(
      v_definition,
      chr(10) || '  in share mode',
      ', ' || v_lock_fragment || chr(10) || '  in share mode'
    );
  end if;

  if v_new_lock is null then
    raise exception 'M1 durable fact lock list cannot be empty';
  end if;

  execute v_definition;
end $$;
