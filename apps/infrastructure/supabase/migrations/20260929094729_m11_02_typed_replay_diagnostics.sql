-- Keep replay diagnostics explicitly typed; no state or API behavior change.
do $$
declare v_def text; v_anchor text := 'v_issues jsonb:=''[]'';';
begin
 select pg_get_functiondef('public.m1102_replay_preview(uuid,uuid,uuid,uuid,bigint,integer,text,text)'::regprocedure) into v_def;
 if strpos(v_def,v_anchor)=0 then raise exception 'M11-02 replay diagnostic type anchor missing'; end if;
 execute replace(v_def,v_anchor,'v_issues jsonb:=''[]''::jsonb;');
end $$;
