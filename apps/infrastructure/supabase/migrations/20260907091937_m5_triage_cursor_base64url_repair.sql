-- PostgreSQL's base64 encoder wraps long output. A cursor is a single URL
-- token, so remove those wrap newlines before translating to base64url.
do $$
declare
  v_function_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text)'::regprocedure
  ) into v_function_definition;

  v_updated_definition := replace(
    replace(v_function_definition, 'translate(encode(', 'translate(replace(encode('),
    $from$), 'base64'), '+/=', '-_')$from$,
    $to$), 'base64'), E'\n', ''), '+/=', '-_')$to$
  );

  if v_updated_definition = v_function_definition then
    raise exception 'Could not repair M5 triage cursor base64url encoding';
  end if;
  execute v_updated_definition;
end;
$$;
