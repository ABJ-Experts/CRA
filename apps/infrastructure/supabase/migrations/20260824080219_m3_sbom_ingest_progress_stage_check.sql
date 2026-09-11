alter table public.sbom_ingest_jobs
  drop constraint if exists sbom_ingest_jobs_progress_stage_check,
  add constraint sbom_ingest_jobs_progress_stage_check check (progress_stage in (
    'queued', 'claiming', 'verifying_original', 'recording_evidence',
    'parsing', 'batching', 'resolving_graph', 'completed', 'failed', 'dead_letter'
  ));
