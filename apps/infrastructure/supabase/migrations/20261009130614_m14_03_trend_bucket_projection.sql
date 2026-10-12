-- Export every canonical visible bucket value without recalculating M14-02
-- metrics. Pin, authorization and source revision checks remain native-owned.
do $projection$ declare v_def text;v_old text;begin
 v_def:=pg_get_functiondef('public.m14_03_dashboard_trend_rows(uuid,uuid,jsonb,jsonb)'::regprocedure);
 v_old:=$old$jsonb_build_object('bucket',v_bucket->'start','metric',v_metric.key,'value',v_bucket->'value','sourceVersion',v_result#>'{result,datasetRevision}','asOf',v_result#>'{snapshot,cutoffAt}')$old$;
 if position(v_old in v_def)=0 then raise exception 'trend_export_projection_baseline_changed';end if;
 v_def:=replace(v_def,v_old,$new$jsonb_build_object('bucket',v_bucket->'start','metric',v_metric.key,'start',v_bucket->'start','end',v_bucket->'end','partial',v_bucket->'partial','opened',v_bucket->'opened','closed',v_bucket->'closed','reopened',v_bucket->'reopened','value',v_bucket->'value','sampleCount',v_bucket->'sampleCount','excludedCount',v_bucket->'excludedCount','numerator',v_bucket->'numerator','denominator',v_bucket->'denominator','sourceCount',v_bucket->'sourceCount','sourceVersion',v_result#>'{result,datasetRevision}','asOf',v_result#>'{snapshot,cutoffAt}')$new$);
 execute v_def;
end $projection$;
