-- Sources without a direct product key conservatively invalidate all scopes
-- in the organization. PL/pgSQL CASE requires an explicit fallback branch.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.m10_invalidate_coverage_source()'::regprocedure)
    into v_definition;
  if position('  end case;' in v_definition)=0 then
    raise exception 'M10 invalidation case anchor missing';
  end if;
  execute replace(v_definition,'  end case;',
    '    else null;'||chr(10)||'  end case;');
end $$;
