drop trigger if exists set_vulnerability_vex_publication_jobs_updated_at
  on public.vulnerability_vex_publication_jobs;

create trigger set_vulnerability_vex_publication_jobs_updated_at
  before update on public.vulnerability_vex_publication_jobs
  for each row execute function public.set_updated_at();
