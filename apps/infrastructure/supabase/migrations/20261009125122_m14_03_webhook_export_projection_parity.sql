-- Preserve native webhook list semantics in approved export projections.
-- This additive replacement retains the existing signature, grants and search_path.
do $projection$
declare definition text; branch text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('public.m14_03_operational_source_rows_unprojected(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 start_at:=position('when ''connectors.webhook_endpoints'' then' in definition);
 end_at:=position('when ''connectors.siem_destinations'' then' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'webhook_export_projection_baseline_changed';end if;
 branch:=substring(definition from start_at for end_at-start_at);
 if position('''outcome'',r.outcome' in branch)=0 or position('''nextAttemptAt'',r.next_attempt_at' in branch)=0 then raise exception 'webhook_export_projection_baseline_changed';end if;
 branch:=replace(branch,'r.secret_id is not null','r.secret_ciphertext is not null');
 branch:=replace(branch,'''outcome'',r.outcome','''outcome'',coalesce(r.outcome,''running'')');
 branch:=replace(branch,'''nextAttemptAt'',r.next_attempt_at','''nextAttemptAt'',case when r.status in (''pending'',''retrying'',''delivering'') then r.next_attempt_at else null end');
 definition:=substring(definition from 1 for start_at-1)||branch||substring(definition from end_at);
 execute definition;
end $projection$;
