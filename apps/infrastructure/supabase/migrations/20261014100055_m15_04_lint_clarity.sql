-- Timestamp text parsing depends on PostgreSQL's stable timestamp input rules.
-- Cleanup reads the wall clock and must observe the post-lock policy snapshot.
alter function public.m15_04_selection_valid(jsonb) stable;

do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m15_04_logs(uuid,uuid,text,integer)'::regprocedure);
 anchor:='omissions jsonb:=''[]'';';
 if position(anchor in d)=0 then raise exception 'M15-04 log JSON initialization anchor missing';end if;
 execute replace(d,anchor,'omissions jsonb:=''[]''::jsonb;');
 d:=pg_get_functiondef('public.m15_04_cleanup_policy(public.support_diagnostic_jobs)'::regprocedure);
 anchor:='blockers jsonb:=''[]'';';
 if position(anchor in d)=0 then raise exception 'M15-04 cleanup JSON initialization anchor missing';end if;
 execute replace(d,anchor,'blockers jsonb:=''[]''::jsonb;');
end $$;

alter function public.m15_04_cleanup_policy(public.support_diagnostic_jobs) volatile;
