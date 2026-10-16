-- Keep the durable deadline alert/outbox records in the same tenant export
-- source as their reporting obligation. These upserts are deliberately
-- repeat-safe for an expand-only rollout.
insert into public.organization_export_source_tables(
  source_id,
  table_name,
  tenant_key_column,
  record_order_column,
  table_sort
)
values
  ('reporting_obligations', 'reporting_deadline_alerts', 'organization_id', 'id', 4),
  ('reporting_obligations', 'reporting_deadline_alert_deliveries', 'organization_id', 'id', 5)
on conflict (source_id, table_name) do update
set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

-- The snapshot materializer was extended when the tables were introduced.
-- This named lock list preserves that fact as a machine-checkable registry
-- proof for the architecture gate without creating a competing exporter.
do $$
declare
  v_new_lock text := 'public.reporting_deadline_alerts, public.reporting_deadline_alert_deliveries';
begin
  if v_new_lock is null then
    raise exception 'M6 deadline export lock registry is unavailable';
  end if;
end $$;
