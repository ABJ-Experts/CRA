-- Real native pinned trend response; no fabricated token, source fact or metric.
begin;
set local statement_timeout='30s';
do $$ declare o uuid:='00000000-0000-4000-8000-0000000000ca';u uuid;f jsonb;native jsonb;pin jsonb;ctx jsonb;expected jsonb;actual jsonb;begin
 select id into strict u from public.users where email='owner@cra.test';
 f:=jsonb_build_object('from',(current_date-1)::text,'to',current_date::text,'timezone','UTC','bucket','day','sourceAccess',jsonb_build_object('products',true,'findings',true,'sbomCoverage',true,'readiness',true));
 native:=public.get_dashboard_trends(o,u,f,null);
 if native->>'outcome'<>'found' then raise exception 'native trend fixture unavailable: %',native->>'outcome';end if;
 pin:=native->'snapshot';ctx:=jsonb_build_object('_datasetSnapshot',pin,'_datasetRevision',native#>'{result,datasetRevision}','_sourceAccess',f->'sourceAccess');
 select jsonb_agg(b.value||jsonb_build_object('bucket',b.value->'start','metric',m.key,'sourceVersion',native#>'{result,datasetRevision}','asOf',native#>'{snapshot,cutoffAt}')order by m.key,b.ordinality) into expected
 from jsonb_each(native#>'{result,series}')m cross join lateral jsonb_array_elements(m.value->'buckets')with ordinality b;
 select jsonb_agg(x.row_values order by x.ordinality) into actual from public.m14_03_dashboard_trend_rows(o,u,f-'sourceAccess',ctx)with ordinality x;
 if expected is null or jsonb_array_length(expected)=0 then raise exception 'native nonempty trend bucket fixture missing';end if;
 if actual is distinct from expected then raise exception 'native pinned trend complete bucket projection parity failed';end if;
 if exists(select 1 from jsonb_array_elements(actual)x where not(x.value ?& array['start','end','partial','opened','closed','reopened','sampleCount','excludedCount','numerator','denominator','sourceCount']))then raise exception 'visible native trend fields missing';end if;
 begin perform public.m14_03_dashboard_trend_rows(o,u,f,ctx||jsonb_build_object('_datasetRevision','wrong'));raise exception 'forged dataset revision allowed';exception when serialization_failure then null;end;
 raise notice 'M14 real pinned trend full native bucket parity, nonempty %, exact source revision and as-of',jsonb_array_length(actual);
end $$;
rollback;
