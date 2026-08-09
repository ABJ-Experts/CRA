-- Existing organizations predate the insert trigger in some deployments.
-- Backfill them before the API treats a missing cache-version row as an
-- availability failure. The statement is idempotent for partially migrated
-- environments and leaves trigger-managed versions unchanged.
insert into public.organization_permissions_version (organization_id)
select organizations.id
from public.organizations
left join public.organization_permissions_version
  on organization_permissions_version.organization_id = organizations.id
where organization_permissions_version.organization_id is null
on conflict (organization_id) do nothing;
