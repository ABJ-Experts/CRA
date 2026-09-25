-- Correct escaped POSIX regexes in the already-applied package/proof schema.
alter table public.reporting_stage_packages drop constraint if exists reporting_stage_packages_storage_object_path_check;
alter table public.reporting_stage_packages add constraint reporting_stage_packages_storage_object_path_check
  check (storage_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/packages/[0-9a-f-]{36}\.zip$');
alter table public.reporting_stage_submissions drop constraint if exists reporting_stage_submissions_proof_check;
alter table public.reporting_stage_submissions add constraint reporting_stage_submissions_proof_check check (
  (proof_storage_bucket is null and proof_object_path is null and proof_sha256 is null and proof_byte_size is null and proof_mime_type is null and proof_filename is null)
  or (proof_storage_bucket = 'reporting-evidence' and proof_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/filings/[0-9a-f-]{36}/receipt\.(pdf|png|jpg|txt)$'
    and proof_sha256 ~ '^[a-f0-9]{64}$' and proof_byte_size between 1 and 10485760 and proof_mime_type in ('application/pdf','image/png','image/jpeg','text/plain') and proof_filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$')
);
