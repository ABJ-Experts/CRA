-- RBAC cache-invalidating version is tenant-scoped state, not a secret. Keep
-- it in the complete tenant export alongside role assignments and overrides.
insert into public.organization_export_sources (source_id, enabled, sort_order)
values ('organization_permissions_version', true, 28)
on conflict (source_id) do update
  set enabled = excluded.enabled,
      sort_order = excluded.sort_order;
