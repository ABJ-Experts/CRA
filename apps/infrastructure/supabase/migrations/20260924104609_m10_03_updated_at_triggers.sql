-- Keep both mutable M10-03 heads aligned with the repository timestamp gate.
create trigger set_framework_requirement_applicability_updated_at
  before update on public.framework_requirement_applicability
  for each row execute function public.set_updated_at();

create trigger set_framework_coverage_scopes_updated_at
  before update on public.framework_coverage_scopes
  for each row execute function public.set_updated_at();
