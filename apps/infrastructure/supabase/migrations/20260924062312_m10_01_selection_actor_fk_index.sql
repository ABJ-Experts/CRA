-- Cover the actor foreign key used by organization framework selections.
create index organization_framework_selections_updated_by_idx
  on public.organization_framework_selections(updated_by)
  where updated_by is not null;
