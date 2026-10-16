-- Excluded negative cohorts are explainable source rows, never mean values.
-- Pre-baseline terminal events remain unavailable in both chart and source views.
do $migration$
declare definition text;changed text;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 changed:=replace(definition,'count(*)filter(where value<0)excluded_count','count(*)filter(where value<0 and d.at>=baseline)excluded_count');
 if changed=definition then raise exception 'M14-02 negative cohort aggregate anchor missing';end if;
 execute changed;
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 changed:=replace(definition,$anchor$case when metric='triage'then'first_triage'when metric='remediation'then'applied_remediation'else'observation'end kind$anchor$,$replacement$case when extract(epoch from(case metric when'triage'then(f.payload->>'triagedAt')::timestamptz else(f.payload->>'fixedAt')::timestamptz end-(f.payload->>'firstDetectedAt')::timestamptz))<0 then 'excluded_negative_'||metric when metric='triage'then'first_triage'when metric='remediation'then'applied_remediation'else'observation'end kind$replacement$);
 changed:=replace(changed,$anchor$and extract(epoch from(case metric when'triage'then(f.payload->>'triagedAt')::timestamptz else(f.payload->>'fixedAt')::timestamptz end-(f.payload->>'firstDetectedAt')::timestamptz))>=0$anchor$,'');
 if changed=definition then raise exception 'M14-02 negative cohort source anchor missing';end if;
 execute changed;
end $migration$;
