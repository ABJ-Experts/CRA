-- Triage state is mutable operational state, so it follows the repository-wide
-- updated_at invariant. The state machine still sets its logical timestamp
-- explicitly; this trigger protects future writers as well.

create trigger set_vulnerability_finding_triage_states_updated_at
  before update on public.vulnerability_finding_triage_states
  for each row execute function public.set_updated_at();
