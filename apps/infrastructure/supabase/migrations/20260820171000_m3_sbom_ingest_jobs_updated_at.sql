-- Keep the durable SBOM job lifecycle aligned with the repository-wide
-- updated_at invariant. This forward-only fix is safe for already-deployed
-- M3 foundations and does not alter evidence or job history.

drop trigger if exists set_sbom_ingest_jobs_updated_at on public.sbom_ingest_jobs;
create trigger set_sbom_ingest_jobs_updated_at
before update on public.sbom_ingest_jobs
for each row execute function public.set_updated_at();
