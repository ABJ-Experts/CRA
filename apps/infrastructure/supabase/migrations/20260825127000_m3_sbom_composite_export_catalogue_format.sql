-- Keep the physical export catalogue explicit for the composite provenance
-- source.  This idempotent restatement also keeps the architecture check able
-- to verify every registered source/table pair from migration evidence.

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('sbom_composite_supplier_provenance', 'sbom_supplier_requests', 'organization_id', 'id', 1),
  ('sbom_composite_supplier_provenance', 'sbom_supplier_submissions', 'organization_id', 'id', 2),
  ('sbom_composite_supplier_provenance', 'sbom_composite_reviews', 'organization_id', 'id', 3),
  ('sbom_composite_supplier_provenance', 'sbom_composite_review_inputs', 'organization_id', 'id', 4),
  ('sbom_composite_supplier_provenance', 'sbom_composite_conflicts', 'organization_id', 'id', 5),
  ('sbom_composite_supplier_provenance', 'sbom_composite_unresolved_relationships', 'organization_id', 'id', 6),
  ('sbom_composite_supplier_provenance', 'sbom_composite_component_provenance', 'organization_id', 'id', 7),
  ('sbom_composite_supplier_provenance', 'sbom_composite_dependency_provenance', 'organization_id', 'id', 8)
on conflict(source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;
