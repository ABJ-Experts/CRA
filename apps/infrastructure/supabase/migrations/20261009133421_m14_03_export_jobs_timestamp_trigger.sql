-- Mutable export job heads follow the existing canonical timestamp invariant.
-- Immutable snapshot rows have no updated_at and receive no update trigger.
create trigger set_export_jobs_updated_at
 before update on public.export_jobs
 for each row execute function public.set_updated_at();
