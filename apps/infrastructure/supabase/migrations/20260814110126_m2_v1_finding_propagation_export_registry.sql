-- Finding impacts are a distinct high-volume export source; they must never
-- be appended to product_registry or its static lock set.
insert into public.organization_export_sources(source_id,enabled,sort_order)
values ('finding_propagation',true,32)
on conflict (source_id) do update set enabled=excluded.enabled,sort_order=excluded.sort_order;

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
values
  ('finding_propagation','finding_propagation_sources','organization_id','id',1),
  ('finding_propagation','finding_impact_associations','organization_id','id',2),
  ('finding_propagation','finding_product_impact_overrides','organization_id','id',3),
  ('finding_propagation','finding_propagation_jobs','organization_id','id',4)
on conflict (source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;
