-- Existing local environments applied the original M5 queue before the
-- matcher-state predicate was added. Recreate the exact existing function
-- definition with the predicate so the forward migration remains safe and
-- keeps its pinned search path and grants intact.
do $$
declare
  v_function_definition text;
  v_updated_definition text;
  v_original_predicate constant text :=
    'where findings.organization_id = p_organization_id and findings.status = ''active''';
  v_state_predicate constant text :=
    'where findings.organization_id = p_organization_id
      and (p_filters -> ''findingStates'' is null or findings.status::text = any(
        array(select jsonb_array_elements_text(p_filters -> ''findingStates''))
      ))';
begin
  select pg_get_functiondef(
    'public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text)'::regprocedure
  ) into v_function_definition;
  if strpos(v_function_definition, 'p_filters -> ''findingStates''') > 0 then
    return;
  end if;
  v_updated_definition := replace(v_function_definition, v_original_predicate, v_state_predicate);
  if v_updated_definition = v_function_definition then
    raise exception 'Could not apply the M5 finding-state queue predicate';
  end if;
  execute v_updated_definition;
end;
$$;
