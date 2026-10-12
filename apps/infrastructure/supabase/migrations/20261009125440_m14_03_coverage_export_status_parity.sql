-- Match the source-owned requirementCoverage calculation/row statuses.
-- Stale evidence is never converted into current readiness by an export.
do $projection$
declare definition text; branch text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('public.m14_03_operational_source_rows_unprojected(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 start_at:=position('when ''frameworks.coverage_requirements'' then' in definition);
 end_at:=position('else return query select * from public.m14_03_additional_source_rows' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'coverage_export_projection_baseline_changed';end if;
 branch:=substring(definition from start_at for end_at-start_at);
 if position('then v.status else ''unavailable'' end' in branch)=0 or position('when c.status is null then ''unavailable''' in branch)=0 then raise exception 'coverage_export_projection_baseline_changed';end if;
 branch:=replace(branch,'then v.status else ''unavailable'' end','then coalesce(v.status,''stale'') else ''stale'' end');
 branch:=replace(branch,'when c.status is null then ''unavailable''','when c.status=''error'' then ''unavailable''');
 definition:=substring(definition from 1 for start_at-1)||branch||substring(definition from end_at);
 execute definition;
end $projection$;
