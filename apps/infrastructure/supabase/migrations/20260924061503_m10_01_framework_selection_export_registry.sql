-- M10-01: include explicit tenant framework selection in M1 export snapshots.
-- Global immutable legal text is a deployment asset; selection and audit are
-- portable tenant state. The snapshot SHARE lock preserves a consistent view.
insert into public.organization_export_sources(source_id,enabled,sort_order)
values ('framework_selections',true,49)
on conflict (source_id) do update
set enabled=excluded.enabled,sort_order=excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values ('framework_selections', 'organization_framework_selections',
  'organization_id','pack_key',1)
on conflict (source_id,table_name) do update
set tenant_key_column=excluded.tenant_key_column,
  record_order_column=excluded.record_order_column,
  table_sort=excluded.table_sort;

do $$
declare
  v_definition text;
  v_old_lock text := 'public.reporting_deadline_alert_deliveries' || chr(10) || '  in share mode';
  v_new_lock text := 'public.reporting_deadline_alert_deliveries, public.organization_framework_selections' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
  ) into v_definition;
  if position(v_old_lock in v_definition)=0 then
    raise exception 'M10 framework selection export lock anchor is missing';
  end if;
  execute replace(v_definition,v_old_lock,v_new_lock);
end $$;
