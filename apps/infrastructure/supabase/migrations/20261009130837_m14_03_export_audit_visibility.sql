-- M14 emits only organization-scoped opaque job identity and structural audit
-- metadata. Make those durable events available through the M13 audit reader.
-- The independent SIEM event catalogue remains unchanged.
do $export_audit$ declare v_definition text;v_old text;begin
 v_definition:=pg_get_functiondef('public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)'::regprocedure);
 v_old:='''audit_chain'',''audit_search'',''audit_export'',';
 if position(v_old in v_definition)=0 then raise exception 'export_audit_visibility_baseline_changed';end if;
 v_definition:=replace(v_definition,v_old,'''audit_chain'',''audit_search'',''audit_export'',''export_job'',');
 execute v_definition;
end $export_audit$;
