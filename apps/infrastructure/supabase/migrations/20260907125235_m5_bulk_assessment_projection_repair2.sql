-- Apply the qualified source expressions to installations that received the
-- first M5-03 migration before those lint repairs. `pg_get_functiondef` keeps
-- the tested function bodies intact and changes only the ambiguous selectors.
do $$
declare v_sql text;
begin
  select pg_get_functiondef('public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text)'::regprocedure) into v_sql;
  v_sql:=replace(v_sql,'select result into v_queue from public.list_finding_triage_queue(','select queue.result into v_queue from public.list_finding_triage_queue(');
  v_sql:=replace(v_sql,E') limit 1;\n      if v_queue',E') queue limit 1;\n      if v_queue');
  execute v_sql;
  select pg_get_functiondef('public.execute_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text)'::regprocedure) into v_sql;
  v_sql:=replace(v_sql,'select outcome,result into v_submit_outcome,v_result from public.submit_vulnerability_finding_vex_assessment_atomic(','select submission.outcome,submission.result into v_submit_outcome,v_result from public.submit_vulnerability_finding_vex_assessment_atomic(');
  v_sql:=replace(v_sql,E') limit 1;\n    if v_submit_outcome',E') submission limit 1;\n    if v_submit_outcome');
  execute v_sql;
end;
$$;

alter table public.vulnerability_finding_assessment_bulk_operations
  add column if not exists excluded_count integer not null default 0 check (excluded_count >= 0);
