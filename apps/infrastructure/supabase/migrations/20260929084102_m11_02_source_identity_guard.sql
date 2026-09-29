-- Bounded page validation prevents ambiguous decoration/retained-source replay.
-- Identity comparison follows the existing persisted external-identity key.
do $$
declare v_def text; v_anchor text;
begin
 select pg_get_functiondef('public.m1102_save_sync_run_plan_atomic(uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)'::regprocedure) into v_def;
 v_anchor:=' -- Existing planner owns conflict insertion and dry-run transitions.';
 if strpos(v_def,v_anchor)=0 then raise exception 'M11-02 duplicate source guard anchor missing'; end if;
 v_def:=replace(v_def,v_anchor,E' if exists(select 1 from jsonb_array_elements(p_plan_items) entries(value)\n group by value->>''entityType'',lower(regexp_replace(normalize(value->>''externalId'',nfkc),''\\s+'','''',''g'')) having count(*)>1) then\n return query select ''invalid_data''::text,null::jsonb; return; end if;\n'||v_anchor);
 v_anchor:='status=case when v_failed>0 then ''failed''';
 if strpos(v_def,v_anchor)=0 then raise exception 'M11-02 poison run diagnostic anchor missing'; end if;
 v_def:=replace(v_def,v_anchor,'error_code=case when v_failed>0 then ''invalid_record'' else error_code end,'||E'\n '||v_anchor);
 execute v_def;
end $$;
