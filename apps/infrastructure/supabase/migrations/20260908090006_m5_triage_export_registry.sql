-- M5-04 durable tenant records are portable with the existing export archive.
-- Mutation idempotency rows intentionally remain outside this source.

insert into public.organization_export_sources(source_id, enabled, sort_order)
values ('vulnerability_triage_operational', true, 47)
on conflict (source_id) do update set
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('vulnerability_triage_operational', 'vulnerability_finding_suppressions', 'organization_id', 'id', 1),
  ('vulnerability_triage_operational', 'vulnerability_triage_sla_policies', 'organization_id', 'severity', 2),
  ('vulnerability_triage_operational', 'vulnerability_finding_triage_states', 'organization_id', 'finding_id', 3),
  ('vulnerability_triage_operational', 'vulnerability_triage_alert_events', 'organization_id', 'id', 4)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

-- The materializer locks every registered physical source for a coherent
-- archive. Reuse its current definition so this additive feature does not
-- fork the long, security-sensitive snapshot implementation.
do $$
declare
  v_definition text;
  v_old_lock text := 'public.vulnerability_finding_assessment_bulk_operation_targets' || chr(10) || '  in share mode';
  v_new_lock text := 'public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')
  ) into v_definition;

  if position(v_old_lock in v_definition) = 0 then
    raise exception 'M5-04 export lock anchor is missing';
  end if;

  execute replace(v_definition, v_old_lock, v_new_lock);
end;
$$;

-- The expected lock set for function public.materialize_organization_export_snapshot_atomic:
-- lock table
-- public.organizations, public.organization_legal_profiles, public.organization_members, public.audit_logs, public.invitations, public.custom_roles, public.base_role_permission_overrides, public.menu_permissions, public.user_role_assignments, public.user_table_preferences, public.organization_onboarding, public.organization_onboarding_stages, public.organization_onboarding_evidence, public.organization_settings, public.organization_lifecycles, public.organization_retention_policies, public.retention_authority_states, public.retention_authoritative_facts, public.retention_floor_snapshots, public.retention_floor_reasons, public.evidence_protection_watermarks, public.retention_cleanup_runs, public.retention_cleanup_items, public.organization_export_jobs, public.organization_export_parts, public.organization_export_snapshots, public.organization_purge_jobs, public.organization_purge_work_items, public.organization_permissions_version, public.organization_legal_entities, public.organization_legal_entity_dependency_authorities, public.organization_legal_entity_dependency_facts, public.organization_branding_drafts, public.organization_branding_assets, public.organization_branding_versions, public.products, public.product_releases, public.product_legal_entity_assignments, public.product_lifecycle_dependency_facts, public.product_release_market_availability, public.product_regulatory_outbox_events, public.product_support_periods, public.software_baselines, public.software_baseline_release_memberships, public.product_relationships, public.finding_propagation_sources, public.finding_impact_associations, public.finding_product_impact_overrides, public.finding_propagation_jobs, public.product_import_jobs, public.product_import_rows, public.product_substantial_modification_assessments, public.product_substantial_modification_releases, public.product_security_update_artifacts, public.connectors, public.product_external_identities, public.field_authority_policies, public.sync_runs, public.sync_run_plan_items, public.sync_conflicts, public.sync_connector_cursors, public.sbom_documents, public.sbom_document_sources, public.sbom_components, public.sbom_component_identities, public.sbom_component_dependencies, public.organization_sbom_quality_settings, public.sbom_quality_reports, public.sbom_quality_findings, public.sbom_diff_reports, public.sbom_diff_component_changes, public.sbom_supplier_requests, public.sbom_supplier_submissions, public.sbom_composite_reviews, public.sbom_composite_review_inputs, public.sbom_composite_conflicts, public.sbom_composite_unresolved_relationships, public.sbom_composite_component_provenance, public.sbom_composite_dependency_provenance, public.vulnerability_reachability_results, public.vulnerability_finding_review_events, public.vulnerability_finding_assessments, public.vulnerability_finding_assessment_evidence_links, public.vulnerability_finding_assessment_history_events, public.vulnerability_assessment_approval_policies, public.vulnerability_finding_assessment_bulk_operations, public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events
-- in share mode;
