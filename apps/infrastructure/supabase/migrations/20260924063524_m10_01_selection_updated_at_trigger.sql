-- Keep framework selection timestamps consistent with other mutable tenant rows.
create trigger set_organization_framework_selections_updated_at
  before update on public.organization_framework_selections
  for each row execute function public.set_updated_at();
