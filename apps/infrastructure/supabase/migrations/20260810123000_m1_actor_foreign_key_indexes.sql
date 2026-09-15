-- Keep M1 actor foreign keys efficient for user lifecycle writes and audit lookups.
create index if not exists organization_legal_profiles_created_by_idx
  on public.organization_legal_profiles (created_by);

create index if not exists organization_onboarding_completed_by_idx
  on public.organization_onboarding (completed_by);

create index if not exists organization_onboarding_evidence_recorded_by_idx
  on public.organization_onboarding_evidence (recorded_by);

create index if not exists organization_onboarding_stages_completed_by_idx
  on public.organization_onboarding_stages (completed_by);
