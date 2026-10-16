-- Restore the table-aware business-record projection in the final M1 export
-- materializer. The prior replay-stabilizing definition accidentally reset it
-- to generic redaction, which could expose idempotency and lease fields.

CREATE OR REPLACE FUNCTION public.materialize_organization_export_snapshot_atomic(p_organization_id uuid, p_export_job_id uuid, p_lease_owner uuid, p_expected_checkpoint_version integer)
 RETURNS TABLE(outcome text, checkpoint_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.organization_export_jobs%rowtype;
  v_snapshot public.organization_export_snapshots%rowtype;
  v_mapping public.organization_export_source_tables%rowtype;
  v_source_id text;
  v_source_count integer := 0;
  v_artifact_inventory jsonb;
begin
  lock table
    public.organizations, public.organization_legal_profiles, public.organization_members, public.audit_logs, public.invitations, public.custom_roles, public.base_role_permission_overrides, public.menu_permissions, public.user_role_assignments, public.user_table_preferences, public.organization_onboarding, public.organization_onboarding_stages, public.organization_onboarding_evidence, public.organization_settings, public.organization_lifecycles, public.organization_retention_policies, public.retention_authority_states, public.retention_authoritative_facts, public.retention_floor_snapshots, public.retention_floor_reasons, public.evidence_protection_watermarks, public.retention_cleanup_runs, public.retention_cleanup_items, public.organization_export_jobs, public.organization_export_parts, public.organization_export_snapshots, public.organization_purge_jobs, public.organization_purge_work_items, public.organization_permissions_version, public.organization_legal_entities, public.organization_legal_entity_dependency_authorities, public.organization_legal_entity_dependency_facts, public.organization_branding_drafts, public.organization_branding_assets, public.organization_branding_versions, public.products, public.product_releases, public.product_legal_entity_assignments, public.product_lifecycle_dependency_facts, public.product_release_market_availability, public.product_regulatory_outbox_events, public.product_support_periods, public.software_baselines, public.software_baseline_release_memberships, public.product_relationships, public.finding_propagation_sources, public.finding_impact_associations, public.finding_product_impact_overrides, public.finding_propagation_jobs, public.product_import_jobs, public.product_import_rows, public.product_substantial_modification_assessments, public.product_substantial_modification_releases, public.product_security_update_artifacts, public.connectors, public.product_external_identities, public.field_authority_policies, public.sync_runs, public.sync_run_plan_items, public.sync_conflicts, public.sync_connector_cursors, public.sbom_documents, public.sbom_document_sources, public.sbom_components, public.sbom_component_identities, public.sbom_component_dependencies, public.organization_sbom_quality_settings, public.sbom_quality_reports, public.sbom_quality_findings, public.sbom_diff_reports, public.sbom_diff_component_changes, public.sbom_supplier_requests, public.sbom_supplier_submissions, public.sbom_composite_reviews, public.sbom_composite_review_inputs, public.sbom_composite_conflicts, public.sbom_composite_unresolved_relationships, public.sbom_composite_component_provenance, public.sbom_composite_dependency_provenance, public.vulnerability_reachability_results, public.vulnerability_finding_review_events, public.vulnerability_finding_assessments, public.vulnerability_finding_assessment_evidence_links, public.vulnerability_finding_assessment_history_events, public.vulnerability_assessment_approval_policies, public.vulnerability_finding_assessment_bulk_operations, public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events, public.vulnerability_finding_remediation_anchors, public.vulnerability_vex_export_snapshots, public.vulnerability_vex_export_snapshot_assessments, public.vulnerability_vex_publication_targets, public.vulnerability_vex_publication_jobs, public.vulnerability_vex_publication_attempts, public.vulnerability_finding_notes, public.vulnerability_finding_note_revisions, public.vulnerability_finding_note_mentions, public.reporting_obligations, public.reporting_obligation_stages, public.reporting_obligation_events, public.reporting_deadline_alerts, public.reporting_deadline_alert_deliveries, public.organization_framework_selections, public.framework_controls, public.framework_control_revisions, public.framework_control_evidence_links, public.framework_control_requirement_mappings, public.framework_control_mapping_products, public.framework_requirement_applicability, public.framework_upgrade_reviews, public.framework_upgrade_decisions, public.framework_custom_pack_drafts, public.framework_pack_versions, public.framework_requirements, public.reporting_obligation_evidence_packs, public.reporting_stage_filing_proofs, public.evidence_bulk_intake_batches, public.evidence_bulk_intake_items, public.evidence_document_version_texts, public.evidence_document_watermark_exports, public.technical_file_auditor_access_events, public.vulnerability_component_occurrences, public.vulnerability_findings, public.vulnerability_finding_component_occurrences, public.vulnerability_match_evaluations, public.vulnerability_kev_alerts, public.vulnerability_manual_findings, public.vulnerability_triage_saved_views, public.vulnerability_triage_saved_view_defaults
  in share mode;
  select * into v_job from public.organization_export_jobs jobs
   where jobs.id = p_export_job_id and jobs.organization_id = p_organization_id
   for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;

  select * into v_snapshot from public.organization_export_snapshots snapshots
   where snapshots.organization_id = p_organization_id
     and snapshots.export_job_id = p_export_job_id
   order by snapshots.snapshot_version desc
   limit 1
   for update;
  if not found or cardinality(v_snapshot.source_ids) = 0 then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  if v_snapshot.materialized_at is not null then
    return query select 'replayed'::text, v_job.checkpoint_version; return;
  end if;
  if exists (
    select 1 from public.organization_export_snapshot_records records
     where records.organization_id = p_organization_id
       and records.export_job_id = p_export_job_id
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  if exists (
    select 1 from unnest(v_snapshot.source_ids) requested(source_id)
     where not exists (
       select 1 from public.organization_export_source_tables mappings
        where mappings.source_id = requested.source_id
     )
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;

  if exists (
    select 1
      from storage.objects objects
      join storage.buckets buckets on buckets.id = objects.bucket_id
     where buckets.public = false
       and objects.bucket_id <> 'tenant-exports'
       and objects.name like p_organization_id::text || '/%'
       and (
         objects.name ~ '(^|/)[.][.]?(/|$)'
         or position('//' in objects.name) > 0
       )
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version;
    return;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'bucketId', source.bucket_id,
      'sourcePath', source.name,
      'contentType', source.content_type,
      'objectId', source.id,
      'version', source.version,
      'updatedAt', source.updated_at,
      'byteSize', source.byte_size
    )
    order by source.bucket_id, source.name, source.id
  ), '[]'::jsonb)
    into v_artifact_inventory
  from (
    select objects.id, objects.bucket_id, objects.name, objects.version, objects.updated_at,
      coalesce(nullif(objects.metadata->>'mimetype', ''), 'application/octet-stream') as content_type,
      case
        when objects.metadata ? 'size' and objects.metadata->>'size' ~ '^[0-9]+$'
          then (objects.metadata->>'size')::bigint
        else null
      end as byte_size
    from storage.objects objects
    join storage.buckets buckets on buckets.id = objects.bucket_id
    where buckets.public = false
      and objects.bucket_id <> 'tenant-exports'
      and objects.name like p_organization_id::text || '/%'
      and objects.name !~ '(^|/)[.][.]?(/|$)'
      and position('//' in objects.name) = 0
    order by objects.bucket_id, objects.name, objects.id
  ) source;

  foreach v_source_id in array v_snapshot.source_ids loop
    for v_mapping in
      select * from public.organization_export_source_tables mappings
       where mappings.source_id = v_source_id
       order by mappings.table_sort
    loop
      if v_mapping.table_name = 'product_import_jobs' then
        insert into public.organization_export_snapshot_records(
          organization_id, export_job_id, source_id, table_name, table_sort,
          record_index, record_payload
        )
        select p_organization_id, p_export_job_id, v_source_id,
          v_mapping.table_name, v_mapping.table_sort,
          row_number() over(order by jobs.created_at, jobs.id),
          public.m1_export_redact_jsonb(public.m2_product_import_job_export_json(jobs))
        from public.product_import_jobs jobs
        where jobs.organization_id = p_organization_id
        order by jobs.created_at, jobs.id;
      elsif v_mapping.table_name = 'product_import_rows' then
        insert into public.organization_export_snapshot_records(
          organization_id, export_job_id, source_id, table_name, table_sort,
          record_index, record_payload
        )
        select p_organization_id, p_export_job_id, v_source_id,
          v_mapping.table_name, v_mapping.table_sort,
          row_number() over(order by rows.import_id, rows.source_row_number, rows.id),
          public.m1_export_redact_jsonb(public.m2_product_import_row_export_json(rows))
        from public.product_import_rows rows
        where rows.organization_id = p_organization_id
        order by rows.import_id, rows.source_row_number, rows.id;
      else
        execute format(
          'insert into public.organization_export_snapshot_records (organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload) select $1,$2,$3,$4,$5,row_number() over(order by source.%I),public.m1_export_business_record_jsonb($4, to_jsonb(source)) from public.%I source where source.%I=$1 order by source.%I',
          v_mapping.record_order_column,
          v_mapping.table_name,
          v_mapping.tenant_key_column,
          v_mapping.record_order_column
        ) using p_organization_id, p_export_job_id, v_source_id,
          v_mapping.table_name, v_mapping.table_sort;
      end if;
      v_source_count := v_source_count + 1;
    end loop;
  end loop;

  if v_source_count <> (
    select count(*) from public.organization_export_source_tables mappings
     where mappings.source_id = any(v_snapshot.source_ids)
  ) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;

  update public.organization_export_snapshots snapshots
     set materialized_at = now(),
         materialized_by = v_job.actor_user_id,
         materialized_checkpoint_version = v_job.checkpoint_version,
         artifact_inventory = v_artifact_inventory
   where snapshots.id = v_snapshot.id;
  insert into public.audit_logs(
    organization_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, 'organization.export_snapshot_materialized',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('sourceCount', v_source_count,
      'checkpointVersion', v_job.checkpoint_version)
  );
  return query select 'materialized'::text, v_job.checkpoint_version;
end;
$function$;

alter function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(
  uuid, uuid, uuid, integer
) to service_role;
