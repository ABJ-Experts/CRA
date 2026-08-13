-- The dependency fact key is composite. A generated tenant-local export key
-- gives snapshot materialization one deterministic, unique ordering column.
alter table public.product_lifecycle_dependency_facts
  add column if not exists export_order_key text generated always as (
    authority_kind || ':' || record_id::text
  ) stored;

update public.organization_export_source_tables
   set record_order_column = 'export_order_key'
 where source_id = 'product_registry'
   and table_name = 'product_lifecycle_dependency_facts';
