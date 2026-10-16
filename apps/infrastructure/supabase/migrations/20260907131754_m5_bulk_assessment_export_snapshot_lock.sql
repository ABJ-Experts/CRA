-- Existing local databases applied the registry expansion before the lock set
-- was extended. Recreate the established materializer from its catalogued
-- definition with the two immutable bulk tables added to its share lock.
do $$
declare v_definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'))
    into v_definition;
  v_definition := replace(
    v_definition,
    'public.vulnerability_assessment_approval_policies\n  IN SHARE MODE',
    'public.vulnerability_assessment_approval_policies, public.vulnerability_finding_assessment_bulk_operations, public.vulnerability_finding_assessment_bulk_operation_targets\n  IN SHARE MODE'
  );
  execute v_definition;
end;
$$;
