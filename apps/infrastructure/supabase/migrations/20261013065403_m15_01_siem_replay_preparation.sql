-- Replay preview creates the source replay authorization receipt; elective
-- replay admission therefore covers preparation as well as execution.
do $siem_replay_preview$
declare r regprocedure:='public.m13_05_siem_command(uuid,uuid,text,uuid,integer,uuid,jsonb)'::regprocedure;b text;d text;
begin
 select prosrc into b from pg_proc where oid=r;
 d:=pg_get_functiondef(r);
 b:=replace(b,'p_operation in (''create'',''update'',''credentials'',''test_prepare'',''enable'',''replay'')',
   'p_operation in (''create'',''update'',''credentials'',''test_prepare'',''enable'',''replay_preview'',''replay'')');
 execute replace(d,(select prosrc from pg_proc where oid=r),b);
end $siem_replay_preview$;
notify pgrst,'reload schema';
