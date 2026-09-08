do $$
declare v_definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'))
    into v_definition;
  v_definition := replace(
    v_definition,
    E'public.vulnerability_assessment_approval_policies\n  in share mode',
    E'public.vulnerability_assessment_approval_policies, public.vulnerability_finding_assessment_bulk_operations, public.vulnerability_finding_assessment_bulk_operation_targets\n  in share mode'
  );
  execute v_definition;
end;
$$;
