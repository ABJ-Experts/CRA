-- SQL NULL must never bypass an optimistic version fence. API schemas already
-- reject null; RPCs independently enforce the same boundary for service callers.
do $$ declare f record;d text;begin
 for f in select oid::regprocedure signature from pg_proc
 where pronamespace='public'::regnamespace and proname like 'm15_04_%'
 and proargnames @> array['p_expected_version'] and prolang=(select oid from pg_language where lanname='plpgsql') loop
  d:=pg_get_functiondef(f.signature);
  if d !~* '\mbegin\M' then raise exception 'M15-04 version fence body missing';end if;
  execute regexp_replace(d,'\mbegin\M',E'begin\n if p_expected_version is null or p_expected_version<1 then return jsonb_build_object(''outcome'',''conflict'');end if;','i');
 end loop;
end $$;
