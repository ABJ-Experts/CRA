-- Trend facts are immutable source evidence during normal operation, but they
-- are tenant-owned records and must not block the established organization
-- deletion cascade after the retention gate has already authorized deletion.
create or replace function public.m14_02_fact_immutable()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
 if tg_op='DELETE'
    and not exists(
      select 1 from public.organizations where id=old.organization_id
    ) then
  return old;
 end if;
 raise exception 'source trend facts are immutable';
end$$;

alter table public.vulnerability_finding_lifecycle_facts
 drop constraint vulnerability_finding_lifecycle_facts_organization_id_fkey,
 add constraint vulnerability_finding_lifecycle_facts_organization_id_fkey
 foreign key(organization_id) references public.organizations(id)
 on delete cascade;

alter table public.sbom_release_coverage_facts
 drop constraint sbom_release_coverage_facts_organization_id_fkey,
 add constraint sbom_release_coverage_facts_organization_id_fkey
 foreign key(organization_id) references public.organizations(id)
 on delete cascade;
