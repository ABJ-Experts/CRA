-- Keep the physical export-source registration explicit for the architecture
-- gate as well as for idempotent roll-forward deployments.
insert into public.organization_export_source_tables (source_id, table_name, tenant_key_column, record_order_column, table_sort)
values ('product_registry', 'product_support_periods', 'organization_id', 'id', 7)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;
