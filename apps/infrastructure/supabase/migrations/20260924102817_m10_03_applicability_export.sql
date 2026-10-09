-- Approved applicability is a durable tenant decision and belongs in the M1
-- tenant export. Calculated coverage rows and worker leases are derivable.
insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values ('framework_controls','framework_requirement_applicability',
  'organization_id','requirement_key',6)
on conflict (source_id,table_name) do update
set tenant_key_column=excluded.tenant_key_column,
  record_order_column=excluded.record_order_column,
  table_sort=excluded.table_sort;

do $$
declare
  v_definition text;
  v_old text := 'public.framework_control_mapping_products' || chr(10) || '  in share mode';
  v_new text := 'public.framework_control_mapping_products, public.framework_requirement_applicability'
    || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)
  into v_definition;
  if position(v_old in v_definition)=0 then
    raise exception 'M10 applicability export lock anchor missing';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
