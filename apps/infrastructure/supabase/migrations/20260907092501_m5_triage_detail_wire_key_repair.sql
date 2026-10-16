-- Align the existing detail projection with the shared camel-cased contract.
do $$
declare
  v_function_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.get_finding_triage_detail(uuid, uuid, uuid)'::regprocedure
  ) into v_function_definition;
  v_updated_definition := replace(
    v_function_definition,
    '''reevaluationState'', findings.reevaluation_state',
    '''reEvaluationState'', findings.reevaluation_state'
  );
  if v_updated_definition = v_function_definition then
    raise exception 'Could not repair M5 triage detail re-evaluation wire key';
  end if;
  execute v_updated_definition;
end;
$$;
