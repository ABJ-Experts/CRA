begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin
 if not coalesce(ok,false) then raise exception 'M15-04 retry: %',label;end if;
end $$;
do $$
declare org uuid:=gen_random_uuid();actor uuid;session uuid;job uuid;r jsonb;v int;attempt int;paths text[];path text;artifact jsonb;manifest jsonb;review jsonb;
 selection jsonb:=jsonb_build_object('categories',jsonb_build_array('configuration'),'from',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '1 day'),'to',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '1 millisecond'));
begin
 select u.id,s.id into strict actor,session from public.users u join auth.sessions s on s.user_id=u.auth_user_id
 where u.is_active and u.email_verified_at is not null and (s.not_after is null or s.not_after>clock_timestamp()) order by s.created_at desc limit 1;
 insert into public.organizations(id,name,slug) values(org,'M15-04 retry rollback','m15-04-retry-'||org);
 insert into public.organization_members(organization_id,user_id,role) values(org,actor,'owner');
 insert into public.organization_session_bindings(organization_id,session_id,user_id,issued_at,last_seen_at) values(org,session,actor,clock_timestamp(),clock_timestamp());
 r:=public.m15_04_create(org,actor,session,repeat('a',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 for attempt in 1..3 loop
  r:=public.m15_04_claim('retry_test');v:=(r->'result'->'job'->>'version')::int;
  perform pg_temp.check('attempt belongs to rollback job',r->'result'->'job'->>'id'=job::text and r->'result'->>'objectPath'=org::text||'/'||job::text||'/attempt-'||attempt::text||'/bundle.zip');
  r:=public.m15_04_fail(org,job,'retry_test',v,'storage_unavailable');
  perform pg_temp.check('bounded infrastructure retry',r->>'outcome'='ok' and r->'result'->>'state'=case when attempt<3 then 'queued' else 'failed' end);
 end loop;
 select object_paths into paths from public.support_diagnostic_jobs where organization_id=org and id=job;
 perform pg_temp.check('all stale upload paths retained for metering',cardinality(paths)=3);
 perform pg_temp.check('fourth attempt unavailable',public.m15_04_claim('retry_test')->>'outcome'='empty');
 perform pg_temp.check('each failed attempt durable audited',(select count(*)=3 from public.audit_logs where organization_id=org and entity_id=job::text and action='support.diagnostic.failed' and outcome='failed'));
 -- A retried infrastructure failure must not leak into the final ready state.
 r:=public.m15_04_create(org,actor,session,repeat('d',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 r:=public.m15_04_claim('retry_success');v:=(r->'result'->'job'->>'version')::int;
 r:=public.m15_04_fail(org,job,'retry_success',v,'storage_unavailable');
 perform pg_temp.check('first infrastructure failure remains retryable',r->>'outcome'='ok' and r->'result'->>'state'='queued');
 r:=public.m15_04_claim('retry_success');v:=(r->'result'->'job'->>'version')::int;path:=r->'result'->>'objectPath';
 insert into storage.objects(bucket_id,name,metadata) values('support-diagnostics',path,'{"size":73,"mimetype":"application/zip"}');
 artifact:=jsonb_build_object('sha256',repeat('d',64),'byteSize',73,'fileName','support-diagnostics-'||job::text||'.zip');
 manifest:=jsonb_build_object('version','m15_04_v1','jobId',job,'generatedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'selection',selection,'entries',jsonb_build_array(jsonb_build_object('name','configuration.json','sha256',repeat('e',64),'byteSize',2)),'omissions','[]'::jsonb);
 r:=public.m15_04_complete(org,job,'retry_success',v,artifact,manifest);v:=(r->'result'->>'version')::int;
 perform pg_temp.check('successful retry clears previous failure code',r->>'outcome'='ok' and r->'result'->>'state'='ready' and r->'result'->'failureCode'='null'::jsonb);
 -- A caller with the latest version cannot withdraw a reviewed cleanup job.
 update public.support_diagnostic_jobs set expires_at=clock_timestamp()-interval '1 second' where organization_id=org and id=job;
 update public.retention_authority_states set available=true,last_reconciled_at=clock_timestamp() where organization_id=org;
 review:=public.m15_04_cleanup_review(org,actor,session,job)->'result';
 r:=public.m15_04_request_cleanup(org,actor,session,job,v,review->>'reviewFingerprint',gen_random_uuid());v:=(r->'result'->>'version')::int;
 perform pg_temp.check('ready artifact reaches reviewed cleanup intent',r->>'outcome'='ok' and r->'result'->'cleanup'->>'state'='requested');
 r:=public.m15_04_cancel(org,actor,session,job,v,gen_random_uuid());
 perform pg_temp.check('current version cannot cancel reviewed physical cleanup',r->>'outcome'='conflict' and (select state='ready' and cleanup_state='requested' and version=v from public.support_diagnostic_jobs where organization_id=org and id=job));
 r:=public.m15_04_create(org,actor,session,repeat('b',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 r:=public.m15_04_claim('lease_test');v:=(r->'result'->'job'->>'version')::int;
 update public.support_diagnostic_jobs set attempt_started_at=clock_timestamp()-interval '61 seconds',lease_expires_at=clock_timestamp()+interval '20 seconds' where organization_id=org and id=job;
 perform pg_temp.check('heartbeat cannot extend total generation bound',public.m15_04_heartbeat(org,job,'lease_test',v)->>'outcome'='conflict');
 update public.support_diagnostic_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where organization_id=org and id=job;
 r:=public.m15_04_claim('replacement_worker');
 perform pg_temp.check('expired attempt has new immutable path',r->>'outcome'='ok' and r->'result'->>'objectPath'=org::text||'/'||job::text||'/attempt-2/bundle.zip');
 perform pg_temp.check('stale worker cannot checkpoint',public.m15_04_checkpoint(org,job,'lease_test',v,'packaging','{"completed":3,"total":4}','[]')->>'outcome'='conflict');
 v:=(r->'result'->'job'->>'version')::int;
 r:=public.m15_04_fail(org,job,'replacement_worker',v,'source_unavailable');
 perform pg_temp.check('all sources failure does not repeat collection',r->>'outcome'='ok' and r->'result'->>'state'='failed');
 r:=public.m15_04_create(org,actor,session,repeat('c',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 r:=public.m15_04_claim('revocation_test');v:=(r->'result'->'job'->>'version')::int;
 update public.organization_permissions_version set version=version+1 where organization_id=org;
 perform pg_temp.check('worker stops on permission scope change',public.m15_04_authorize_worker(org,job,'revocation_test',v)->>'outcome'='conflict');
 update public.organization_members set role='member' where organization_id=org and user_id=actor;
 perform pg_temp.check('member cannot use custom grant as admin',public.m15_04_authority(org,actor,session)->>'outcome'='forbidden');
end $$;
rollback;
