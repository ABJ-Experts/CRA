-- Keep the four closed authority-unavailable codes inside the shared safeCode
-- wire grammar. Do not broaden contracts to admit arbitrary punctuation.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m15_04_cleanup_policy(public.support_diagnostic_jobs)'::regprocedure);
 anchor:='''authority_unavailable:''||authority';
 if position(anchor in d)=0 then raise exception 'M15-04 cleanup authority code anchor missing';end if;
 execute replace(d,anchor,'''authority_unavailable_''||authority');
end $$;
