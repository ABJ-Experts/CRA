insert into public.organization_export_sources(source_id, enabled, sort_order)
values ('vulnerability_vex_exports', true, 48)
on conflict (source_id) do update set
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('vulnerability_vex_exports', 'vulnerability_vex_export_snapshots', 'organization_id', 'id', 1),
  ('vulnerability_vex_exports', 'vulnerability_vex_export_snapshot_assessments', 'organization_id', 'snapshot_id', 2),
  ('vulnerability_vex_exports', 'vulnerability_vex_publication_targets', 'organization_id', 'id', 3),
  ('vulnerability_vex_exports', 'vulnerability_vex_publication_jobs', 'organization_id', 'id', 4),
  ('vulnerability_vex_exports', 'vulnerability_vex_publication_attempts', 'organization_id', 'id', 5)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

do $$
declare
  v_definition text;
  v_old_lock text := 'public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events, public.vulnerability_finding_remediation_anchors' || chr(10) || '  in share mode';
  v_new_lock text := 'public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events, public.vulnerability_finding_remediation_anchors, public.vulnerability_vex_export_snapshots, public.vulnerability_vex_export_snapshot_assessments, public.vulnerability_vex_publication_targets, public.vulnerability_vex_publication_jobs, public.vulnerability_vex_publication_attempts' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')
  ) into v_definition;

  if position(v_old_lock in v_definition) = 0 then
    raise exception 'M5-06 export lock anchor is missing';
  end if;

  execute replace(v_definition, v_old_lock, v_new_lock);
end;
$$;
