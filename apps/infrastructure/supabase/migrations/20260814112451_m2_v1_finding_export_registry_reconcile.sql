-- Reconcile the export catalogue after additive finding migrations. The
-- baseline lifecycle fact is deliberately excluded in the application registry
-- because it is a rebuildable projection of finding_propagation_sources.
insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
)
values
  ('finding_propagation', 'finding_propagation_sources', 'organization_id', 'id', 1),
  ('finding_propagation', 'finding_impact_associations', 'organization_id', 'id', 2),
  ('finding_propagation', 'finding_product_impact_overrides', 'organization_id', 'id', 3),
  ('finding_propagation', 'finding_propagation_jobs', 'organization_id', 'id', 4)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;
