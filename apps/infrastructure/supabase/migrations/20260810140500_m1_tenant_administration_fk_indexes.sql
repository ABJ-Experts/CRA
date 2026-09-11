create index if not exists destructive_reauth_grants_actor_user_id_idx
  on public.destructive_reauth_grants (actor_user_id);

create index if not exists evidence_protection_watermarks_evidence_class_idx
  on public.evidence_protection_watermarks (evidence_class);

create index if not exists organization_export_artifact_snapshots_export_job_id_idx
  on public.organization_export_artifact_snapshots (export_job_id);

create index if not exists organization_export_idempotencies_export_job_id_idx
  on public.organization_export_idempotencies (export_job_id);

create index if not exists organization_export_parts_export_job_id_idx
  on public.organization_export_parts (export_job_id);

create index if not exists organization_export_parts_source_id_idx
  on public.organization_export_parts (source_id);

create index if not exists organization_export_snapshot_records_export_job_id_idx
  on public.organization_export_snapshot_records (export_job_id);

create index if not exists organization_export_snapshot_records_source_id_idx
  on public.organization_export_snapshot_records (source_id);

create index if not exists organization_export_snapshot_records_source_table_idx
  on public.organization_export_snapshot_records (source_id, table_name);

create index if not exists organization_export_snapshots_export_job_id_idx
  on public.organization_export_snapshots (export_job_id);

create index if not exists organization_export_snapshots_materialized_by_idx
  on public.organization_export_snapshots (materialized_by);

create index if not exists organization_purge_work_items_purge_job_id_idx
  on public.organization_purge_work_items (purge_job_id);

create index if not exists organization_retention_policies_evidence_class_idx
  on public.organization_retention_policies (evidence_class);

create index if not exists retention_authoritative_facts_evidence_class_idx
  on public.retention_authoritative_facts (evidence_class);

create index if not exists retention_cleanup_items_cleanup_run_id_idx
  on public.retention_cleanup_items (cleanup_run_id);

create index if not exists retention_cleanup_items_evidence_class_idx
  on public.retention_cleanup_items (evidence_class);

create index if not exists retention_cleanup_runs_evidence_class_idx
  on public.retention_cleanup_runs (evidence_class);
