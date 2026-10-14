-- Every fixture and audit event is rolled back. No worker or migration is applied.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin
 if not coalesce(ok,false) then raise exception 'M15-04: %',label;end if;
end $$;
create function pg_temp.audit_outage() returns trigger language plpgsql as $$begin
 if new.action='support.diagnostic.consented' and current_setting('m15_04.test_audit_outage',true)='on' then raise exception 'test_audit_outage' using errcode='P0002';end if;return new;
end $$;
create trigger m15_04_test_outage before insert on public.audit_logs for each row execute function pg_temp.audit_outage();

do $$
declare org uuid:=gen_random_uuid();other_org uuid:=gen_random_uuid();actor uuid;other_actor uuid;session uuid;session2 uuid;auth_user uuid;
 selection jsonb:=jsonb_build_object('categories',jsonb_build_array('logs','configuration','metrics'),'from',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '1 day'),'to',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '1 millisecond'));
 r jsonb;replay jsonb;job uuid;key uuid:=gen_random_uuid();v integer;path text;grant_id uuid:=gen_random_uuid();req uuid:=gen_random_uuid();artifact jsonb;manifest jsonb;review jsonb;old_meter bigint;rejected boolean;cancel_key uuid:=gen_random_uuid();receipt record;corpus_req uuid:=gen_random_uuid();canary text:='m15_04_canary_access_token_1q2w3e4r5t6y7u8i';encoded_canary text;event public.audit_logs;
begin
 select u.id,u.auth_user_id,s.id into strict actor,auth_user,session from public.users u
 join auth.sessions s on s.user_id=u.auth_user_id where u.is_active and u.email_verified_at is not null
 and (s.not_after is null or s.not_after>clock_timestamp()) order by s.created_at desc limit 1;
 select id into strict other_actor from public.users where id<>actor and is_active limit 1;
 insert into public.organizations(id,name,slug) values(org,'M15-04 rollback','m15-04-'||org),(other_org,'M15-04 other','m15-04-'||other_org);
 insert into public.organization_members(organization_id,user_id,role) values(org,actor,'owner'),(other_org,actor,'owner');
 insert into public.organization_session_bindings(organization_id,session_id,user_id,issued_at,last_seen_at) values(org,session,actor,clock_timestamp(),clock_timestamp()),(other_org,session,actor,clock_timestamp(),clock_timestamp());
 r:=public.m15_04_authority(org,actor,session);
 perform pg_temp.check('live owner permitted',r->>'outcome'='ok' and r->'result'->>'permissionVersion' is not null);
 perform pg_temp.check('random session rejected',public.m15_04_authority(org,actor,gen_random_uuid())->>'outcome'='forbidden');
 perform pg_temp.check('bad selection rejected',public.m15_04_create(org,actor,session,repeat('a',64),selection||'{"categories":["environment"]}',key)->>'outcome'='invalid');
 perform set_config('m15_04.test_audit_outage','on',true);rejected:=false;
 begin perform public.m15_04_create(org,actor,session,repeat('a',64),selection,key);exception when no_data_found then rejected:=true;end;
 perform pg_temp.check('consent audit outage fails closed',rejected and not exists(select 1 from public.support_diagnostic_jobs where organization_id=org));
 perform set_config('m15_04.test_audit_outage','off',true);
 r:=public.m15_04_create(org,actor,session,repeat('a',64),selection,key);job:=(r->'result'->>'id')::uuid;
 perform pg_temp.check('consent creates queued job',r->>'outcome'='ok' and r->'result'->>'state'='queued');
 set constraints m13_02_finalize_audit_chain immediate;
 select * into event from public.audit_logs where organization_id=org and action='support.diagnostic.consented';
 perform pg_temp.check('consent carries durable exact digests',event.after_redacted->>'selectionDigest' ~ '^[a-f0-9]{64}$' and event.after_redacted->>'previewDigest'=repeat('a',64) and event.after_redacted->>'reasonCode'='m15_04_v1' and event.chain_sequence is not null);
 perform pg_temp.check('audit metadata remains visible',public.m13_03_event_visible_cached(org,actor,event,public.m13_03_permission_snapshot(org,actor)));
 encoded_canary:=encode(convert_to(canary,'UTF8'),'base64');
 select * into receipt from public.m13_01_append_audit_event(org,'organization','support.diagnostic.consented:'||corpus_req::text,'user',actor::text,'support.diagnostic.consented','support_diagnostic',job::text,'completed',corpus_req,null,
 jsonb_build_object('requestId',corpus_req,'version',1,'count',0,'reasonCode','m15_04_v1','selectionDigest',event.after_redacted->>'selectionDigest','previewDigest',repeat('a',64),
 'access_token',canary,'cookie',canary,'signedURL','https://example.test/file?token='||canary,'nested',jsonb_build_object('authorization',canary),'encoded',encoded_canary,'stack','/private/'||canary),null,null,null,actor);
 perform pg_temp.check('adversarial diagnostic receipt retains no raw or encoded canary',receipt.outcome='inserted' and exists(select 1 from public.audit_logs where id=receipt.audit_id and position(canary in after_redacted::text)=0 and position(encoded_canary in after_redacted::text)=0 and after_redacted->>'selectionDigest'=event.after_redacted->>'selectionDigest' and after_redacted->>'previewDigest'=repeat('a',64)));

 replay:=public.m15_04_create(org,actor,session,repeat('a',64),selection,key);
 perform pg_temp.check('same consent replays same row',replay->'result'->>'id'=job::text);
 perform pg_temp.check('changed consent cannot reuse key',public.m15_04_create(org,actor,session,repeat('b',64),selection,key)->>'outcome'='conflict');
 perform pg_temp.check('null version cannot bypass cancel fence',public.m15_04_cancel(org,actor,session,job,null,gen_random_uuid())->>'outcome'='conflict');
 perform pg_temp.check('single active job per tenant',public.m15_04_create(org,actor,session,repeat('a',64),selection,gen_random_uuid())->>'outcome'='conflict');
 perform pg_temp.check('cross tenant ID concealed',public.m15_04_get(other_org,actor,session,job)->>'outcome'='not_found');
 perform pg_temp.check('creator identity required',public.m15_04_get(org,other_actor,session,job)->>'outcome'<>'ok');
 rejected:=false;begin update public.support_diagnostic_jobs set selection='{}' where organization_id=org and id=job;exception when insufficient_privilege then rejected:=true;end;
 perform pg_temp.check('consent immutable',rejected);
 r:=public.m15_04_claim('m15_04_test');v:=(r->'result'->'job'->>'version')::integer;path:=r->'result'->>'objectPath';
 perform pg_temp.check('claim fences attempt path',r->'result'->'job'->>'id'=job::text and path=org::text||'/'||job::text||'/attempt-1/bundle.zip');
 perform pg_temp.check('wrong worker denied',public.m15_04_authorize_worker(org,job,'wrong',v)->>'outcome'='conflict');
 perform pg_temp.check('heartbeat does not churn version',public.m15_04_heartbeat(org,job,'m15_04_test',v)->'result'->'job'->>'version'=v::text);
 r:=public.m15_04_logs(org,job,'m15_04_test',v);
 perform pg_temp.check('source logs closed structured projection',r->>'outcome'='ok' and jsonb_typeof(r->'result'->'logs')='array' and not (r->'result')::text ~ '(actorId|entityId|changes|objectPath|password|access_token)' and position(canary in (r->'result')::text)=0 and position(encoded_canary in (r->'result')::text)=0);
 r:=public.m15_04_checkpoint(org,job,'m15_04_test',v,'packaging','{"completed":3,"total":4}','[]');v:=(r->'result'->'job'->>'version')::integer;
 perform pg_temp.check('checkpoint rejects arbitrary omissions',public.m15_04_checkpoint(org,job,'m15_04_test',v,'packaging','{"completed":3,"total":4}','[{"category":"logs","code":"raw_secret"}]')->>'outcome'='invalid');
 insert into storage.objects(bucket_id,name,metadata) values('support-diagnostics',path,'{"size":73,"mimetype":"application/zip"}');
 perform pg_temp.check('protected source-owned bytes counted',(public.m15_01_usage(org)->>'protectedStorageBytes')::bigint=73 and (select protected_storage_bytes=73 from public.organization_usage_meters where organization_id=org));
 artifact:=jsonb_build_object('sha256',repeat('c',64),'byteSize',73,'fileName','support-diagnostics-'||job::text||'.zip');
 manifest:=jsonb_build_object('version','m15_04_v1','jobId',job,'generatedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'selection',selection,'entries',jsonb_build_array(jsonb_build_object('name','logs.json','sha256',repeat('d',64),'byteSize',2)),'omissions','[]'::jsonb);
 r:=public.m15_04_complete(org,job,'m15_04_test',v,artifact,manifest);v:=(r->'result'->>'version')::integer;
 perform pg_temp.check('publication makes artifact ready',r->>'outcome'='ok' and r->'result'->>'state'='ready');
 perform pg_temp.check('private data absent job wire',not (r->'result') ?| array['creatorUserId','sessionId','objectPath','manifest','grantDigest']);
 perform set_config('storage.allow_delete_query','true',true);rejected:=false;
 begin delete from storage.objects where bucket_id='support-diagnostics' and name=path;exception when insufficient_privilege then rejected:=sqlerrm='diagnostic_delete_authority_unavailable';end;
 perform pg_temp.check('storage metadata deletion independently requires cleanup authority',rejected and exists(select 1 from storage.objects where bucket_id='support-diagnostics' and name=path));

 r:=public.m15_04_access(org,actor,session,job,req);
 perform pg_temp.check('content receipt precedes object access',r->>'outcome'='ok' and exists(select 1 from public.audit_logs where organization_id=org and correlation_id=req and action='support.diagnostic.accessed'));
 perform pg_temp.check('streaming reauthorization requires receipt',public.m15_04_revalidate(org,actor,session,job,gen_random_uuid())->>'outcome'='forbidden' and public.m15_04_revalidate(org,actor,session,job,req)->>'outcome'='ok');
 r:=public.m15_04_issue_grant(org,actor,session,job,v,grant_id,repeat('e',64),gen_random_uuid());
 perform pg_temp.check('grant lifetime bounded',r->>'outcome'='ok' and (r->'result'->>'expiresAt')::timestamptz<=clock_timestamp()+interval '60 seconds');
 perform pg_temp.check('wrong grant digest denied',public.m15_04_redeem_grant(org,actor,session,job,grant_id,repeat('f',64),gen_random_uuid())->>'outcome'='forbidden');
 r:=public.m15_04_redeem_grant(org,actor,session,job,grant_id,repeat('e',64),gen_random_uuid());
 perform pg_temp.check('grant redeem once',r->>'outcome'='ok' and public.m15_04_redeem_grant(org,actor,session,job,grant_id,repeat('e',64),gen_random_uuid())->>'outcome'='forbidden');
 r:=public.m15_04_cancel(org,actor,session,job,v,gen_random_uuid());v:=(r->'result'->>'version')::int;
 perform pg_temp.check('ready artifact withdrawal immediately denies access but preserves bytes',r->>'outcome'='ok' and r->'result'->>'state'='cancelled' and r->'result'->'artifact'=artifact and public.m15_04_access(org,actor,session,job,gen_random_uuid())->>'outcome'='forbidden' and (public.m15_01_usage(org)->>'protectedStorageBytes')::bigint=73);
 select public.m1_export_business_record_jsonb('support_diagnostic_jobs',to_jsonb(j)) into r from public.support_diagnostic_jobs j where organization_id=org and id=job;
 perform pg_temp.check('tenant export metadata only',r->>'id'=job::text and r->'artifact'=artifact and not r ?| array['creator_user_id','manifest','session_id','grant_digest','object_path','object_paths','preview_digest','worker_id']);
 update public.support_diagnostic_jobs set expires_at=clock_timestamp()-interval '1 second',grant_expires_at=clock_timestamp()-interval '1 second' where organization_id=org and id=job;
 perform pg_temp.check('expiry denies bytes independently of retention',public.m15_04_access(org,actor,session,job,gen_random_uuid())->>'outcome'='forbidden' and (public.m15_01_usage(org)->>'protectedStorageBytes')::bigint=73);
 review:=public.m15_04_cleanup_review(org,actor,session,job)->'result';
 perform pg_temp.check('cleanup review emits contract-safe finite blocker codes',not exists(select 1 from jsonb_array_elements_text(review->'blockers') b where b !~ '^[a-z][a-z0-9_]{0,79}$'));
 perform pg_temp.check('unknown cleanup authorities deny',not (review->>'eligible')::boolean and jsonb_array_length(review->'blockers')>0);
 update public.organization_retention_policies set requested_retention_days=0,effective_retention_days=0,effective_floor_days=0 where organization_id=org and evidence_class='export_artifact';
 update public.retention_authority_states set available=true,last_reconciled_at=clock_timestamp() where organization_id=org;
 review:=public.m15_04_cleanup_review(org,actor,session,job)->'result';
 perform pg_temp.check('explicit review can authorize known unheld expired artifact',(review->>'eligible')::boolean);
 select version into v from public.support_diagnostic_jobs where organization_id=org and id=job;
 perform pg_temp.check('stale review rejected',public.m15_04_request_cleanup(org,actor,session,job,v,repeat('0',64),gen_random_uuid())->>'outcome'='conflict');
 r:=public.m15_04_request_cleanup(org,actor,session,job,v,review->>'reviewFingerprint',gen_random_uuid());
 perform pg_temp.check('cleanup requires explicit reviewed intent',r->>'outcome'='ok');
 r:=public.m15_04_claim_cleanup('m15_04_cleanup');v:=(r->'result'->'job'->>'version')::integer;
 perform pg_temp.check('cleanup claims immutable attempt paths',r->>'outcome'='ok' and r->'result'->'objectPaths'=jsonb_build_array(path));
 perform pg_temp.check('cannot finish while object remains',public.m15_04_finish_cleanup(org,job,'m15_04_cleanup',v,true)->>'outcome'='conflict');
 update public.retention_authority_states set available=false where organization_id=org and authority_kind='legal_hold';rejected:=false;
 begin delete from storage.objects where bucket_id='support-diagnostics' and name=path;exception when insufficient_privilege then rejected:=sqlerrm='diagnostic_delete_authority_unavailable';end;
 perform pg_temp.check('metadata deletion rechecks newly unknown authority',rejected and exists(select 1 from storage.objects where bucket_id='support-diagnostics' and name=path));
 update public.retention_authority_states set available=true where organization_id=org and authority_kind='legal_hold';
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='support-diagnostics' and name=path;
 r:=public.m15_04_finish_cleanup(org,job,'m15_04_cleanup',v,true);
 perform pg_temp.check('cleanup preserves metadata and audit',r->>'outcome'='ok' and r->'result'->>'state'='deleted' and r->'result'->'artifact'=artifact and exists(select 1 from public.audit_logs where organization_id=org and action='support.diagnostic.cleanup_deleted') and (public.m15_01_usage(org)->>'protectedStorageBytes')::bigint=0);
 -- Reusing a durable request identity across jobs cannot create an unaudited effect.
 perform pg_temp.check('same preview cannot create another job after terminal cleanup',public.m15_04_create(org,actor,session,repeat('a',64),selection,gen_random_uuid())->>'outcome'='conflict');
 perform pg_temp.check('original consent command still replays after terminal cleanup',public.m15_04_create(org,actor,session,repeat('a',64),selection,key)->'result'->>'id'=job::text);
 r:=public.m15_04_create(org,actor,session,repeat('b',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 rejected:=false;begin perform public.m15_04_audit((select j from public.support_diagnostic_jobs j where organization_id=org and id=job),'accessed',req,actor);exception when serialization_failure then rejected:=true;end;
 perform pg_temp.check('audit request reuse across jobs fails closed',rejected);
 r:=public.m15_04_cancel(org,actor,session,job,(r->'result'->>'version')::int,cancel_key);
 perform pg_temp.check('queued job cancel audited',r->>'outcome'='ok');
 r:=public.m15_04_create(org,actor,session,repeat('c',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 rejected:=false;begin perform public.m15_04_cancel(org,actor,session,job,(r->'result'->>'version')::int,cancel_key);exception when serialization_failure then rejected:=true;end;
 perform pg_temp.check('request collision rolls back cancellation mutation',rejected and (select state='queued' from public.support_diagnostic_jobs where organization_id=org and id=job));
 update public.base_role_permission_overrides set permissions=permissions||'{"can_export_system_health":false}' where organization_id=org and base_role='owner';
 if not found then insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(org,'owner','{"can_export_system_health":false}');end if;
 perform pg_temp.check('explicit export override denies owner',public.m15_04_authority(org,actor,session)->>'outcome'='forbidden');
 update public.base_role_permission_overrides set permissions=permissions||'{"can_export_system_health":true}' where organization_id=org and base_role='owner';
 perform pg_temp.check('restored current export authority accepted',public.m15_04_authority(org,actor,session)->>'outcome'='ok');
 insert into public.organization_session_revocations(organization_id,session_id,user_id,reason) values(org,session,actor,'membership_revoked');
 perform pg_temp.check('session revocation immediately denies job access',public.m15_04_authority(org,actor,session)->>'outcome'='forbidden' and public.m15_04_get(org,actor,session,job)->>'outcome'='forbidden');

end $$;

select pg_temp.check('unrelated audit hash stays redacted',public.m13_01_project_v2_audit_json(jsonb_build_object('sha256',repeat('a',64)))->>'sha256'='[REDACTED]');
select pg_temp.check('public roles cannot invoke RPC',not has_function_privilege('anon','public.m15_04_create(uuid,uuid,uuid,text,jsonb,uuid)','execute') and not has_function_privilege('authenticated','public.m15_04_claim(text)','execute'));
select pg_temp.check('service cannot bypass job state',not has_table_privilege('service_role','public.support_diagnostic_jobs','select,insert,update,delete'));
select pg_temp.check('RLS enabled without forcing',exists(select 1 from pg_class where oid='public.support_diagnostic_jobs'::regclass and relrowsecurity and not relforcerowsecurity));
select pg_temp.check('tenant artifact inventory excludes diagnostic bytes',position('objects.bucket_id not in (''tenant-exports'',''support-diagnostics'')' in pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0);
rollback;
