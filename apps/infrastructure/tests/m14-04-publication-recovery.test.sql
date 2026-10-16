-- Provider-free rollback test for publication-only and partial-run replay.
begin;
set local statement_timeout='30s';
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$begin if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name;end if;end$$;
do $$
declare org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();definition uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();qa uuid:=gen_random_uuid();qb uuid:=gen_random_uuid();job_id uuid:=gen_random_uuid();artifact uuid:=gen_random_uuid();config jsonb;before_a jsonb;before_job jsonb;response jsonb;replay_key uuid:=gen_random_uuid();recipient_version int;job public.export_jobs;begin
 insert into public.users(id,email,first_name,is_active,email_verified_at) values(a,'m14-recovery-'||a||'@example.test','Fixture A',true,clock_timestamp()),(b,'m14-recovery-'||b||'@example.test','Fixture B',true,clock_timestamp());
 insert into public.organizations(id,name,slug) values(org,'M14 recovery rollback fixture','m14-recovery-'||org);
 insert into public.organization_members(organization_id,user_id,role) values(org,a,'owner'),(org,b,'owner');
 config:=jsonb_build_object('title','Recovery fixture','report',jsonb_build_object('kind','list','source','products.registry','format','csv','filters','{}'::jsonb,'context','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily','timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),'recipientUserIds',jsonb_build_array(a,b),'emailEnabled',false);
 insert into public.report_definitions(id,organization_id,owner_user_id,state,config,config_digest,source_schema_digest,create_key) values(definition,org,a,'active',config,public.m14_04_digest(config),repeat('a',64),gen_random_uuid());
 insert into public.report_runs(id,organization_id,definition_id,definition_version,owner_user_id,kind,state,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key,finished_at) values(run_id,org,definition,1,a,'scheduled','succeeded',config,public.m14_04_digest(config),'m14_04_v1',repeat('a',64),clock_timestamp(),'recovery-fixture',clock_timestamp());
 insert into public.report_run_recipients(id,organization_id,run_id,user_id,generation_state,email_state,safe_error_code) values(qa,org,run_id,a,'ready','accepted',null),(qb,org,run_id,b,'failed','off','provider_unavailable');
 insert into public.export_jobs(id,organization_id,subject_kind,requester_id,report_recipient_id,source,format,scope,filters,context,columns,idempotency_key,request_digest,permission_version,state,snapshot_as_of,row_count,capture_bytes,processed_rows,parts)
 values(job_id,org,'scheduled',b,qb,'products.registry','csv','all_filtered','{}','{}',public.m14_03_source_policy('products.registry')->'columns',qb,repeat('b',64),coalesce((select version from public.organization_permissions_version where organization_id=org),0),'ready',clock_timestamp(),0,0,0,jsonb_build_array(jsonb_build_object('id',artifact,'name','fixture.csv','mediaType','text/csv','byteLength',0,'sha256',repeat('c',64),'rowCount',0,'objectPath',org||'/'||job_id||'/fixture.csv','startOrdinal',1,'endOrdinal',0))) returning * into job;
 update public.export_jobs set manifest=jsonb_build_object('version','m14_03_v1','jobId',job_id,'source',job.source,'requestedAt',job.requested_at,'snapshotAsOf',job.snapshot_as_of,'scope',job.scope,'requestDigest',job.request_digest,'rowCount',0,'columns',job.columns,'artifacts',public.m14_03_job_json(job)->'artifacts','sourceVersionsDigest',repeat('0',64),'documentationReadinessOnly',false) where organization_id=org and id=job_id;
 update public.report_run_recipients set export_job_id=job_id where organization_id=org and id=qb;
 select to_jsonb(q) into before_a from public.report_run_recipients q where q.organization_id=org and q.id=qa;
 select to_jsonb(j) into before_job from public.export_jobs j where j.organization_id=org and j.id=job_id;
 begin
 perform public.m14_04_replay(org,a,run_id,jsonb_build_object('expectedVersion',0,'idempotencyKey',gen_random_uuid()));
 raise exception 'invalid replay version accepted';
 exception when raise_exception then if sqlerrm<>'report_replay_conflict' then raise;end if;
 end;
 response:=public.m14_04_replay(org,a,run_id,jsonb_build_object('expectedVersion',1,'idempotencyKey',replay_key));
 perform pg_temp.check('partial success permits failed recipient replay',response->'run'->>'state'='scheduled' and (select generation_state='waiting' from public.report_run_recipients where organization_id=org and id=qb));
 perform pg_temp.check('accepted sibling remains byte-for-byte unchanged',(select to_jsonb(q)=before_a from public.report_run_recipients q where q.organization_id=org and q.id=qa));
 perform pg_temp.check('completed export is never regenerated',(select to_jsonb(j)=before_job from public.export_jobs j where j.organization_id=org and j.id=job_id));
 perform pg_temp.check('replay request remains idempotent',public.m14_04_replay(org,a,run_id,jsonb_build_object('expectedVersion',1,'idempotencyKey',replay_key))=response);
 update public.report_run_recipients set generation_state='running',worker_id='publication-recovery',lease_expires_at=clock_timestamp()+interval '120 seconds',version=version+1 where organization_id=org and id=qb returning version into recipient_version;
 -- Even an otherwise harmless revision cannot relabel captured authority.
 begin
 update public.organization_permissions_version set version=version+1 where organization_id=org;
 perform public.m14_04_publish_recipient(org,qb,'publication-recovery',recipient_version,'{}');
 raise exception 'changed permission version published';
 exception when insufficient_privilege then null;end;
 perform pg_temp.check('permission change did not mutate completed export',(select to_jsonb(j)=before_job from public.export_jobs j where j.organization_id=org and j.id=job_id));
 perform public.m14_04_publish_recipient(org,qb,'publication-recovery',recipient_version,'{}');
 perform pg_temp.check('manifest preserves captured authority',(select manifest->>'ownerPermissionVersion'=job.permission_version::text and manifest->>'recipientPermissionVersion'=job.permission_version::text and manifest->>'scopeDigest'=public.m14_04_digest(jsonb_build_object('owner',a,'recipient',b,'source',job.source,'permissionVersion',job.permission_version::text,'sourceContextDigest',public.m14_04_digest(job.context))) from public.report_run_recipients where organization_id=org and id=qb));
 perform pg_temp.check('publication-only recovery completes original artifact',(select generation_state='ready' and export_job_id=job_id and manifest->'exportManifest'->>'jobId'=job_id::text from public.report_run_recipients where organization_id=org and id=qb));
 perform pg_temp.check('published manifest has durable matching checksum',(select manifest_digest=public.m14_04_digest(manifest) from public.report_run_recipients where organization_id=org and id=qb));
 begin update public.report_run_recipients set manifest_digest=repeat('0',64) where organization_id=org and id=qb;raise exception 'published checksum changed';exception when object_not_in_prerequisite_state then null;end;
 perform pg_temp.check('publication recovery still leaves accepted sibling unchanged',(select to_jsonb(q)=before_a from public.report_run_recipients q where q.organization_id=org and q.id=qa));
 -- A terminal uncertain recipient cannot become a new send through replay,
 -- even if an earlier buggy worker also marked generation failed.
 update public.report_run_recipients set generation_state='failed',email_state='uncertain',safe_error_code='provider_unavailable' where organization_id=org and id=qa;
 select to_jsonb(q) into before_a from public.report_run_recipients q where q.organization_id=org and q.id=qa;
 begin
 perform public.m14_04_replay(org,a,run_id,jsonb_build_object('expectedVersion',1,'idempotencyKey',gen_random_uuid()));raise exception 'uncertain recipient replay accepted';
 exception when raise_exception then if sqlerrm<>'report_replay_unsafe' then raise;end if;
 end;
 perform pg_temp.check('uncertain recipient remains untouched',(select to_jsonb(q)=before_a from public.report_run_recipients q where q.organization_id=org and q.id=qa));
 update public.report_run_recipients set generation_state='failed',safe_error_code='provider_unavailable',expires_at=clock_timestamp()-interval '1 second' where organization_id=org and id=qb;
 begin
 perform public.m14_04_replay(org,a,run_id,jsonb_build_object('expectedVersion',1,'idempotencyKey',gen_random_uuid()));raise exception 'expired artifact replay accepted';
 exception when raise_exception then if sqlerrm<>'report_replay_unsafe' then raise;end if;
 end;
 perform pg_temp.check('expired artifact is never regenerated',(select to_jsonb(j)=before_job from public.export_jobs j where j.organization_id=org and j.id=job_id));
 perform pg_temp.check('one run and one export retained',(select count(*)=1 from public.report_runs where organization_id=org) and (select count(*)=1 from public.export_jobs where organization_id=org));
end$$;
rollback;
