-- Product registry records are authoritative tenant evidence and must be
-- present in durable organization exports. Idempotency rows remain excluded.

insert into public.organization_export_sources (source_id, enabled, sort_order)
values ('product_registry', true, 31)
on conflict (source_id) do update
  set enabled = excluded.enabled, sort_order = excluded.sort_order;

insert into public.organization_export_source_tables (
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('product_registry', 'products', 'organization_id', 'id', 1),
  ('product_registry', 'product_releases', 'organization_id', 'id', 2),
  ('product_registry', 'product_legal_entity_assignments', 'organization_id', 'id', 3),
  ('product_registry', 'product_lifecycle_dependency_facts', 'organization_id', 'record_id', 4)
on conflict (source_id, table_name) do update
  set tenant_key_column = excluded.tenant_key_column,
      record_order_column = excluded.record_order_column,
      table_sort = excluded.table_sort;
