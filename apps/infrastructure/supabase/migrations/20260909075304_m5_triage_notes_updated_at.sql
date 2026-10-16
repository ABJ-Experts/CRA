-- Keep the mutable note projection aligned with the repository-wide timestamp
-- invariant; immutable revisions and mention deliveries do not need this hook.
drop trigger if exists set_vulnerability_finding_notes_updated_at
  on public.vulnerability_finding_notes;
create trigger set_vulnerability_finding_notes_updated_at
  before update on public.vulnerability_finding_notes
  for each row execute function public.set_updated_at();
