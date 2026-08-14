-- Covers relationship-history foreign keys used by user/archive checks and
-- prevents deletes or tenant cleanups from scanning historic graph rows.
-- This is additive and intentionally introduces no more tables.

create index if not exists software_baselines_created_by_idx
  on public.software_baselines(created_by);
create index if not exists software_baselines_updated_by_idx
  on public.software_baselines(updated_by);
create index if not exists software_baselines_archived_by_idx
  on public.software_baselines(archived_by)
  where archived_by is not null;

create index if not exists software_baseline_memberships_revision_fkey_idx
  on public.software_baseline_release_memberships(
    organization_id, baseline_revision_id, baseline_id
  );
create index if not exists software_baseline_memberships_release_fkey_idx
  on public.software_baseline_release_memberships(
    organization_id, product_id, release_id
  );
create index if not exists software_baseline_memberships_assigned_by_idx
  on public.software_baseline_release_memberships(assigned_by);
create index if not exists software_baseline_memberships_updated_by_idx
  on public.software_baseline_release_memberships(updated_by);
create index if not exists software_baseline_memberships_ended_by_idx
  on public.software_baseline_release_memberships(ended_by)
  where ended_by is not null;

create index if not exists product_relationships_baseline_revision_fkey_idx
  on public.product_relationships(organization_id, baseline_revision_id)
  where baseline_revision_id is not null;
create index if not exists product_relationships_source_product_fkey_idx
  on public.product_relationships(organization_id, source_product_id)
  where source_product_id is not null;
create index if not exists product_relationships_source_release_fkey_idx
  on public.product_relationships(
    organization_id, source_product_id, source_release_id
  ) where source_release_id is not null;
create index if not exists product_relationships_target_product_fkey_idx
  on public.product_relationships(organization_id, target_product_id);
create index if not exists product_relationships_target_release_fkey_idx
  on public.product_relationships(
    organization_id, target_product_id, target_release_id
  ) where target_release_id is not null;
create index if not exists product_relationships_superseded_by_fkey_idx
  on public.product_relationships(organization_id, superseded_by_id)
  where superseded_by_id is not null;
create index if not exists product_relationships_created_by_idx
  on public.product_relationships(created_by);
create index if not exists product_relationships_updated_by_idx
  on public.product_relationships(updated_by);
create index if not exists product_relationships_ended_by_idx
  on public.product_relationships(ended_by)
  where ended_by is not null;
