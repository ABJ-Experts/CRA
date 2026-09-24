-- Keep the mutable control head aligned with the repository's updated_at gate.
create trigger set_framework_controls_updated_at
  before update on public.framework_controls
  for each row execute function public.set_updated_at();
