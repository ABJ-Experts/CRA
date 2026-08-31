-- Old pure-validator reports used a deterministic marker.  Persisted jobs
-- already have their durable completion fact, so preserve the evidence while
-- exposing that real timestamp through the report contract.
update public.sbom_ingest_jobs
set validation_completed_at = coalesce(completed_at, updated_at),
    validation_report = jsonb_set(
      validation_report,
      '{completedAt}',
      to_jsonb(to_char(
        coalesce(completed_at, updated_at) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )),
      false
    )
where validation_report is not null
  and validation_completed_at = '1970-01-01T00:00:00.000Z'::timestamptz;
