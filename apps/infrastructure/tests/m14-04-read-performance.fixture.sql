-- SQL read latency evidence, rollback only. No authentication or storage provider
-- is fabricated: fixture identities are internal verified members and the
-- artifacts are database metadata only; no download is attempted.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='180s';
create temp table report_bench_context(org uuid,actor uuid);
create temp table report_bench_members(n int primary key,id uuid unique);
insert into report_bench_members select n,gen_random_uuid() from generate_series(1,1100) n;
insert into public.users(id,email,first_name,last_name,is_active,email_verified_at)
 select id,'m14-perf-'||id||'@example.test','Fixture','Member '||n,true,clock_timestamp() from report_bench_members;
insert into report_bench_context select gen_random_uuid(),id from report_bench_members where n=1;
insert into public.organizations(id,name,slug) select org,'M14 read performance rollback fixture','m14-perf-'||org from report_bench_context;
insert into public.organization_members(organization_id,user_id,role)
 select c.org,m.id,case when m.n=1 then 'owner' else 'member' end from report_bench_context c cross join report_bench_members m;
create temp table report_bench_definitions(n int primary key,id uuid unique,config jsonb);
insert into report_bench_definitions
 select n,gen_random_uuid(),jsonb_build_object('title','Historical report '||n,'report',jsonb_build_object('kind','list','source','products.registry','format','csv','filters','{}'::jsonb,'context','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily','timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),'recipientUserIds',(select jsonb_agg(id order by n) from report_bench_members where n<=10),'emailEnabled',false) from generate_series(1,100) n;
insert into public.report_definitions(id,organization_id,owner_user_id,state,config,config_digest,source_schema_digest,create_key)
 select d.id,c.org,c.actor,'paused',d.config,public.m14_04_digest(d.config),repeat('a',64),gen_random_uuid() from report_bench_definitions d cross join report_bench_context c;
create temp table report_bench_runs(n int primary key,id uuid unique,definition_id uuid,owner_recipient uuid,job_id uuid);
insert into report_bench_runs select counter.n,gen_random_uuid(),d.id,gen_random_uuid(),gen_random_uuid() from generate_series(1,10000) counter(n) join report_bench_definitions d on d.n=1+(counter.n-1)%100;
insert into public.report_runs(id,organization_id,definition_id,definition_version,owner_user_id,kind,state,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key,finished_at,created_at)
 select r.id,c.org,r.definition_id,1,c.actor,'scheduled','succeeded',d.config,public.m14_04_digest(d.config),'m14_04_v1',repeat('a',64),clock_timestamp()-r.n*interval '1 day','benchmark:'||r.n,clock_timestamp()-r.n*interval '1 day',clock_timestamp()-r.n*interval '1 day'
 from report_bench_runs r join report_bench_definitions d on d.id=r.definition_id cross join report_bench_context c;
insert into public.report_run_recipients(id,organization_id,run_id,user_id,generation_state,email_state,created_at)
 select case when m.n=1 then r.owner_recipient else gen_random_uuid() end,c.org,r.id,m.id,'ready','off',clock_timestamp()-r.n*interval '1 day'
 from report_bench_runs r cross join report_bench_context c cross join report_bench_members m where m.n<=10;
insert into public.export_jobs(id,organization_id,subject_kind,requester_id,report_recipient_id,source,format,scope,filters,context,columns,idempotency_key,request_digest,permission_version,state,snapshot_as_of,row_count,capture_bytes,processed_rows,parts)
 select r.job_id,c.org,'scheduled',c.actor,r.owner_recipient,'products.registry','csv','all_filtered','{}','{}',public.m14_03_source_policy('products.registry')->'columns',r.owner_recipient,repeat('b',64),coalesce(pv.version,0),'ready',clock_timestamp(),0,0,0,
 jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','fixture.csv','mediaType','text/csv','byteLength',0,'sha256',repeat('c',64),'rowCount',0,'objectPath',c.org||'/'||r.job_id||'/fixture.csv','startOrdinal',1,'endOrdinal',0))
 from report_bench_runs r cross join report_bench_context c left join public.organization_permissions_version pv on pv.organization_id=c.org;
update public.export_jobs j set manifest=jsonb_build_object('version','m14_03_v1','jobId',j.id,'source',j.source,'requestedAt',j.requested_at,'snapshotAsOf',j.snapshot_as_of,'scope',j.scope,'requestDigest',j.request_digest,'rowCount',0,'columns',j.columns,'artifacts',(select jsonb_agg(p-'objectPath'-'startOrdinal'-'endOrdinal') from jsonb_array_elements(j.parts) p),'sourceVersionsDigest',repeat('0',64),'documentationReadinessOnly',false)
 from report_bench_context c where j.organization_id=c.org;
update public.report_run_recipients q set export_job_id=j.id,manifest=jsonb_build_object('schemaVersion','m14_04_v1','definitionId',r.definition_id,'definitionVersion',1,'configDigest',r.config_digest,'runId',r.id,'recipientId',q.id,'occurrenceKey',r.occurrence_key,'scheduledFor',r.scheduled_for,'asOf',j.snapshot_as_of,'sourceContextDigest',repeat('a',64),'ownerPermissionVersion',j.permission_version::text,'recipientPermissionVersion',j.permission_version::text,'scopeDigest',repeat('b',64),'exportManifest',j.manifest)
 from public.export_jobs j,public.report_runs r,report_bench_context c where q.organization_id=c.org and j.organization_id=c.org and j.report_recipient_id=q.id and r.organization_id=c.org and r.id=q.run_id;
update public.report_run_recipients q set manifest_digest=public.m14_04_digest(q.manifest) from report_bench_context c where q.organization_id=c.org and q.manifest is not null;
-- ANALYZE only fixture-specific temporary maps; no persistent relation statistics
-- are rewritten. The server planner sees the existing production statistics.
analyze report_bench_runs;
analyze report_bench_members;
create temp table report_bench_samples(operation text,sample int,milliseconds double precision);
do $$
declare c record;i int;started timestamptz;value jsonb;definition uuid;run uuid;definition_cursor text;run_cursor text;member_cursor text;begin
 select * into c from report_bench_context;
 select id into definition from report_bench_definitions where n=1;
 definition_cursor:=public.m14_04_list_definitions(c.org,c.actor,'{"limit":50}')->>'nextCursor';
 run_cursor:=public.m14_04_list_runs(c.org,c.actor,'{"limit":50}')->>'nextCursor';
 member_cursor:=public.m14_04_recipients(c.org,c.actor,'{"limit":50}')->>'nextCursor';
 -- Ten warmup rounds plus 200 independent measured calls for each route.
 for i in -9..200 loop
 select id into run from report_bench_runs where n=greatest(i,1)*47%10000+1;
 started:=clock_timestamp();value:=public.m14_04_get_definition(c.org,c.actor,definition);
 if i>0 then insert into report_bench_samples values('definition_get',i,extract(epoch from clock_timestamp()-started)*1000);end if;
 started:=clock_timestamp();value:=public.m14_04_list_definitions(c.org,c.actor,jsonb_build_object('limit',50,'cursor',case when i%2=0 then definition_cursor else null end));
 if i>0 then insert into report_bench_samples values('definitions_page_50',i,extract(epoch from clock_timestamp()-started)*1000);end if;
 started:=clock_timestamp();value:=public.m14_04_list_runs(c.org,c.actor,jsonb_build_object('limit',50,'cursor',case when i%2=0 then run_cursor else null end));
 if i>0 then insert into report_bench_samples values('runs_page_50',i,extract(epoch from clock_timestamp()-started)*1000);end if;
 started:=clock_timestamp();value:=public.m14_04_get_run(c.org,c.actor,run);
 if i>0 then insert into report_bench_samples values('run_detail_10_recipients',i,extract(epoch from clock_timestamp()-started)*1000);end if;
 if not exists(select 1 from jsonb_array_elements(value->'recipients') recipient where recipient->>'userId'=c.actor::text and jsonb_array_length(recipient->'artifacts')=1) then raise exception 'benchmark did not exercise authorized artifact read';end if;
 started:=clock_timestamp();value:=public.m14_04_list_administration(c.org,c.actor,jsonb_build_object('limit',50,'cursor',case when i%2=0 then definition_cursor else null end));
 if i>0 then insert into report_bench_samples values('administration_page_50',i,extract(epoch from clock_timestamp()-started)*1000);end if;
 started:=clock_timestamp();value:=public.m14_04_recipients(c.org,c.actor,jsonb_build_object('limit',50,'cursor',case when i%2=0 then member_cursor else null end));
 if i>0 then insert into report_bench_samples values('recipients_page_50',i,extract(epoch from clock_timestamp()-started)*1000);end if;
 end loop;
end$$;
select '100 definitions / 10,000 runs / 100,000 recipient rows / 10,000 completed export metadata rows / 1,100 verified members' as fixture_scale;
select operation,count(*) samples,round(percentile_cont(0.50) within group(order by milliseconds)::numeric,3) p50_ms,round(percentile_cont(0.95) within group(order by milliseconds)::numeric,3) p95_ms,round(percentile_cont(0.99) within group(order by milliseconds)::numeric,3) p99_ms,round(max(milliseconds)::numeric,3) max_ms from report_bench_samples group by operation order by operation;
do $$begin
 if exists(select 1 from report_bench_samples group by operation having percentile_cont(0.95) within group(order by milliseconds)>=400 or percentile_cont(0.99) within group(order by milliseconds)>=1000) then raise exception 'scheduled_report_read_latency_budget_failed';end if;
end$$;
rollback;
