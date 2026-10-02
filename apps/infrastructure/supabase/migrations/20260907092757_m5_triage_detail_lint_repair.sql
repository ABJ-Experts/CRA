-- The detail function only needs to verify the finding exists; retaining an
-- unused row variable triggers a database linter warning in every deployment.
do $$
declare
  v_function_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.get_finding_triage_detail(uuid, uuid, uuid)'::regprocedure
  ) into v_function_definition;
  v_updated_definition := replace(
    replace(
      v_function_definition,
      'declare v_finding public.vulnerability_findings%rowtype; v_document_id uuid;',
      'declare v_document_id uuid;'
    ),
    $from$  select * into v_finding from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active';
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;$from$,
    $to$  if not exists (
    select 1 from public.vulnerability_findings findings
    where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active'
  ) then return query select 'not_found'::text, null::jsonb; return; end if;$to$
  );
  if v_updated_definition = v_function_definition then
    raise exception 'Could not remove the unused M5 triage detail variable';
  end if;
  execute v_updated_definition;
end;
$$;
