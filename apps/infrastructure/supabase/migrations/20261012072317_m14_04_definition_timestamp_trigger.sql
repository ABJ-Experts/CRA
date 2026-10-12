-- Mutable definition heads follow the repository's canonical timestamp rule.
-- Run snapshots and recipient provenance remain immutable and have no updated_at.
create trigger set_report_definitions_updated_at
 before update on public.report_definitions
 for each row execute function public.set_updated_at();
