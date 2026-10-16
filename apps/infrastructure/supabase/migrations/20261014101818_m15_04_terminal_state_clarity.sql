-- A successful retry publishes a ready artifact, clearing its earlier failure.
-- Once cleanup has been reviewed, cancellation cannot rewrite that workflow.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m15_04_complete(uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure);
 anchor:='set state=''ready'',stage=''ready'',artifact=p_artifact';
 if position(anchor in d)=0 then raise exception 'M15-04 ready publication anchor missing';end if;
 execute replace(d,anchor,'set state=''ready'',stage=''ready'',failure_code=null,artifact=p_artifact');
 d:=pg_get_functiondef('public.m15_04_cancel(uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure);
 anchor:='or j.state not in (''queued'',''running'',''ready'') then';
 if position(anchor in d)=0 then raise exception 'M15-04 cancellation state anchor missing';end if;
 execute replace(d,anchor,'or j.cleanup_state<>''none'' '||anchor);
end $$;
