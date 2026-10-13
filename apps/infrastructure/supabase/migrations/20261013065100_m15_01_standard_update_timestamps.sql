-- Use the repository's shared trigger authority while preserving source-owned
-- explicit timestamps when a transactional mutation already supplies one.
create trigger organization_license_states_set_updated_at
before update on public.organization_license_states for each row
when (not (new.updated_at is distinct from old.updated_at))
execute function public.set_updated_at();
create trigger organization_storage_admissions_set_updated_at
before update on public.organization_storage_admissions for each row
when (not (new.updated_at is distinct from old.updated_at))
execute function public.set_updated_at();
