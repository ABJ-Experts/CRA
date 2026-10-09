-- Removes only tenant-local data made by m5-triage-100-fixture.sql. M4 source
-- record versions are append-only evidence, so the marker-prefixed global
-- source record/version/sync run intentionally remain untouched.
do $$
declare
  v_marker constant text := 'M5-E2E-LOCAL-20260907';
  v_hash constant text := repeat('a', 64);
begin
  delete from public.vulnerability_findings
  where canonical_advisory_id like v_marker || '-%';

  delete from public.vulnerability_component_occurrences occurrences
  using public.sbom_documents documents
  where occurrences.organization_id = documents.organization_id
    and occurrences.document_id = documents.id
    and documents.document_sha256 = v_hash;

  delete from public.sbom_documents where document_sha256 = v_hash;
  delete from public.sbom_ingest_jobs where input_sha256 = v_hash;
  delete from public.sbom_sources where declared_sha256 = v_hash;
  delete from public.sbom_raw_objects where sha256 = v_hash;

  delete from public.vulnerability_affected_ranges ranges
  using public.vulnerability_source_records records
  where ranges.source_record_version_id = records.current_version_id
    and records.feed_key = 'osv'
    and records.source_record_key = v_marker;

  if exists (
    select 1 from public.vulnerability_findings
    where canonical_advisory_id like v_marker || '-%'
  ) then
    raise exception 'M5 fixture cleanup left tenant findings behind';
  end if;
end;
$$;
