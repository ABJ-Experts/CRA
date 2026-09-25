-- A requirement's gap reason follows its implemented control paths. Linked
-- evidence on an unfinished alternative control remains visible in detail,
-- but cannot mask the implemented path's missing/expired evidence reason.
do $$
declare
  v_definition text;
  v_old text := 'bool_or(expired) expired,bool_or(future) future,bool_or(quarantined) quarantined,'
    || chr(10) || '      bool_or(has_link) has_link';
  v_new text := 'bool_or(implementation_status=''implemented'' and expired) expired,'
    || 'bool_or(implementation_status=''implemented'' and future) future,'
    || 'bool_or(implementation_status=''implemented'' and quarantined) quarantined,'
    || chr(10) || '      bool_or(implementation_status=''implemented'' and has_link) has_link';
begin
  select pg_get_functiondef(
    'public.m10_recalculate_coverage_scope(uuid,uuid,uuid,text,text)'::regprocedure)
  into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'M10 implemented evidence aggregate anchor missing';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
