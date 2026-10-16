-- Rollback-only contract and lifecycle checks, intentionally red before M14-04.
begin;
set local statement_timeout='30s';
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('scheduled definitions exist',to_regclass('public.report_definitions') is not null);
select pg_temp.check('scheduled runs exist',to_regclass('public.report_runs') is not null);
select pg_temp.check('scheduled recipients exist',to_regclass('public.report_run_recipients') is not null);
select pg_temp.check('private nonforced RLS',not exists(select 1 from pg_class where oid in ('public.report_definitions'::regclass,'public.report_runs'::regclass,'public.report_run_recipients'::regclass) and (not relrowsecurity or relforcerowsecurity)));
select pg_temp.check('definition heads have canonical timestamp trigger',exists(select 1 from pg_trigger where tgrelid='public.report_definitions'::regclass and not tgisinternal and tgenabled='O' and tgfoid='public.set_updated_at'::regproc));
select pg_temp.check('immutable run snapshots have no mutable timestamp',not exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('report_runs','report_run_recipients') and column_name='updated_at'));
select pg_temp.check('no browser table grants',not has_table_privilege('authenticated','public.report_definitions','select') and not has_table_privilege('anon','public.report_run_recipients','select'));
select pg_temp.check('month end clamps',public.m14_04_next_occurrence('{"frequency":"monthly","timezone":"UTC","localTime":"09:00","monthDay":31}', '2026-02-01Z')='2026-02-28 09:00Z');
select pg_temp.check('spring gap skipped',public.m14_04_next_occurrence('{"frequency":"daily","timezone":"America/New_York","localTime":"02:30"}', '2026-03-08 00:00Z')='2026-03-09 06:30Z');
select pg_temp.check('autumn fold first',public.m14_04_next_occurrence('{"frequency":"daily","timezone":"America/New_York","localTime":"01:30"}', '2026-11-01 00:00Z')='2026-11-01 05:30Z');
select pg_temp.check('half hour offset',public.m14_04_next_occurrence('{"frequency":"daily","timezone":"Asia/Kolkata","localTime":"09:00"}', '2026-01-01 00:00Z')='2026-01-01 03:30Z');
do $$ declare o uuid:=gen_random_uuid();u uuid;d jsonb;r jsonb;c jsonb;k uuid:=gen_random_uuid();did uuid;begin
 select id into strict u from public.users where is_active and email_verified_at is not null limit 1;
 insert into public.organizations(id,name,slug) values(o,'Scheduled report rollback fixture','m14-04-'||o);
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner');
 c:=jsonb_build_object('title','Products','report',jsonb_build_object('kind','list','source','products.registry','format','csv','context','{}'::jsonb,'filters','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily','timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),'recipientUserIds',jsonb_build_array(u),'emailEnabled',false);
 d:=public.m14_04_create_definition(o,u,jsonb_build_object('config',c,'idempotencyKey',k));did:=(d->'data'->>'id')::uuid;
 perform pg_temp.check('create draft',d->'data'->>'state'='draft');
 perform pg_temp.check('create idempotent',public.m14_04_create_definition(o,u,jsonb_build_object('config',c,'idempotencyKey',k))=d);
 begin perform public.m14_04_get_definition(gen_random_uuid(),u,did);raise exception 'forged tenant accepted';exception when insufficient_privilege then null;end;
 begin perform public.m14_04_mutate_definition(o,u,did,'activate',jsonb_build_object('expectedVersion',1,'idempotencyKey',gen_random_uuid()));raise exception 'activation without preview accepted';exception when serialization_failure or raise_exception then if sqlerrm not like 'report_%' then raise;end if;end;
 r:=public.m14_04_preview(o,u,did,jsonb_build_object('expectedVersion',1,'idempotencyKey',gen_random_uuid()));
 perform pg_temp.check('preview owner only',(select count(*)=1 and bool_and(user_id=u) from public.report_run_recipients where organization_id=o and run_id=(r->'run'->>'id')::uuid));
 perform pg_temp.check('preview no mail',(select bool_and(email_state='off') from public.report_run_recipients where organization_id=o));
 begin update public.report_runs set config='{}' where organization_id=o;raise exception 'frozen config mutated';exception when object_not_in_prerequisite_state then null;end;
 begin perform public.m14_04_update_definition(o,u,did,jsonb_build_object('config',c,'expectedVersion',99,'idempotencyKey',gen_random_uuid()));raise exception 'stale version accepted';exception when serialization_failure or raise_exception then if sqlerrm not like 'report_%' then raise;end if;end;
end $$;
rollback;

begin;
set local statement_timeout='60s';
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name;end if;end $$;
do $$ declare o uuid:=gen_random_uuid();u uuid;v uuid;d jsonb;run_response jsonb;drow public.report_definitions;r public.report_runs;q public.report_run_recipients;j jsonb;claim jsonb;c jsonb;schema_digest text;did uuid;key uuid:=gen_random_uuid();other_org uuid:=gen_random_uuid();manual_id uuid;fixture_session uuid;begin
 select actor.id into strict u from public.users actor where actor.is_active and actor.email_verified_at is not null and exists(select 1 from auth.sessions ses where ses.user_id=actor.auth_user_id) limit 1;
 select id into strict v from public.users where is_active and email_verified_at is not null and id<>u limit 1;
 insert into public.organizations(id,name,slug) values(o,'Scheduled bounded rollback fixture','m14-04-bound-'||o);
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner'),(o,v,'owner');
 d:=public.m14_04_recipients(o,u,'{"limit":1}');
 perform pg_temp.check('recipient roster page bounded',jsonb_array_length(d->'items')=1 and d->>'nextCursor' is not null);
 run_response:=public.m14_04_recipients(o,u,jsonb_build_object('limit',1,'cursor',d->>'nextCursor'));
 perform pg_temp.check('recipient roster cursor advances',jsonb_array_length(run_response->'items')=1 and run_response->'items'->0->>'id'<>d->'items'->0->>'id');
 begin perform public.m14_04_recipients(o,u,'{"limit":51}');raise exception 'unbounded roster accepted';exception when invalid_parameter_value then null;end;
 c:=jsonb_build_object('title','Products','report',jsonb_build_object('kind','list','source','products.registry','format','csv','context','{}'::jsonb,'filters','{}'::jsonb),'schedule',jsonb_build_object('frequency','daily','timezone','UTC','localTime','09:00'),'dateWindow',jsonb_build_object('kind','fixed'),'recipientUserIds',jsonb_build_array(u,v),'emailEnabled',false);
 schema_digest:=public.m14_04_digest(public.m14_03_source_policy('products.registry'));
 d:=public.m14_04_create_definition(o,u,jsonb_build_object('config',c,'idempotencyKey',key),schema_digest);did:=(d->'data'->>'id')::uuid;
 run_response:=public.m14_04_preview(o,u,did,jsonb_build_object('expectedVersion',1,'idempotencyKey',gen_random_uuid()));
 select * into r from public.report_runs where organization_id=o and id=(run_response->'run'->>'id')::uuid;
 select * into q from public.report_run_recipients where organization_id=o and run_id=r.id;
 -- A deterministic local lease avoids claiming unrelated tenants' live work.
 update public.report_run_recipients set generation_state='running',worker_id='m14-04-fixture',lease_expires_at=clock_timestamp()+interval '120 seconds' where organization_id=o and id=q.id;
 j:=public.m14_04_admit_export(o,q.id,'m14-04-fixture',q.version,jsonb_build_object('_sourceSchemaDigest',schema_digest));
 perform pg_temp.check('background has no invented session',exists(select 1 from public.export_jobs where organization_id=o and id=(j->'publicJob'->>'id')::uuid and subject_kind='scheduled' and session_id is null and report_recipient_id=q.id));
 perform pg_temp.check('admission stable export identity',public.m14_04_admit_export(o,q.id,'m14-04-fixture',q.version,jsonb_build_object('_sourceSchemaDigest',schema_digest))->'publicJob'->>'id'=j->'publicJob'->>'id');
 begin perform public.m14_04_admit_export(o,q.id,'stale-worker',q.version,jsonb_build_object('_sourceSchemaDigest',schema_digest));raise exception 'stale worker admitted';exception when serialization_failure or raise_exception then if sqlerrm not like 'report_%' then raise;end if;end;
 begin perform public.m14_04_admit_export(gen_random_uuid(),q.id,'m14-04-fixture',q.version,jsonb_build_object('_sourceSchemaDigest',schema_digest));raise exception 'foreign recipient admitted';exception when serialization_failure or raise_exception then if sqlerrm not like 'report_%' then raise;end if;end;
 select s.id into strict fixture_session from auth.sessions s join public.users actor on actor.auth_user_id=s.user_id where actor.id=u order by s.created_at desc limit 1;
 insert into public.organizations(id,name,slug) values(other_org,'Report fairness rollback fixture','m14-04-fair-'||other_org);
 insert into public.organization_members(organization_id,user_id,role) values(other_org,u,'owner');
 insert into public.export_jobs(organization_id,subject_kind,requester_id,session_id,source,format,scope,filters,context,columns,idempotency_key,request_digest,permission_version)
 select o,'member',u,fixture_session,source,format,scope,filters,context,columns,gen_random_uuid(),request_digest,permission_version from public.export_jobs where organization_id=o and id=(j->'publicJob'->>'id')::uuid returning id into manual_id;
 perform pg_temp.check('same tenant manual queue has priority',public.m14_04_claim_export('m14-04-render') is null);
 update public.export_jobs set state='cancelled' where organization_id=o and id=manual_id;
 insert into public.export_jobs(organization_id,subject_kind,requester_id,session_id,source,format,scope,filters,context,columns,idempotency_key,request_digest,permission_version)
 select other_org,'member',u,fixture_session,source,format,scope,filters,context,columns,gen_random_uuid(),request_digest,permission_version from public.export_jobs where organization_id=o and id=(j->'publicJob'->>'id')::uuid;
 claim:=public.m14_04_claim_export('m14-04-render');
 perform pg_temp.check('other tenant manual queue cannot starve scheduled',claim->'publicJob'->>'id'=j->'publicJob'->>'id');j:=claim;
 update public.export_jobs set state='capturing',worker_id='m14-04-render',lease_expires_at=clock_timestamp()+interval '120 seconds' where organization_id=o and id=(j->'publicJob'->>'id')::uuid;
 claim:=public.m14_03_capture_export(o,(j->'publicJob'->>'id')::uuid,'m14-04-render',(j->>'version')::int);
 perform pg_temp.check('scheduled capture uses frozen engine',claim->'publicJob'->>'state'='audit_pending' and claim->>'snapshotAsOf' is not null);
 perform pg_temp.check('manual claimant explicitly excludes scheduled',position('subject_kind <> ''scheduled''' in pg_get_functiondef('public.m14_03_claim_export(text)'::regprocedure))>0 or position('subject_kind<>''scheduled''' in pg_get_functiondef('public.m14_03_claim_export(text)'::regprocedure))>0);
 -- Complete the canonical zero-row export with fixture metadata; no storage
 -- provider or existing source data is modified by this rollback transaction.
 claim:=public.m14_03_publish_capture(o,(j->'publicJob'->>'id')::uuid,'m14-04-render',(claim->>'version')::int);
 claim:=public.m14_03_checkpoint_export(o,(j->'publicJob'->>'id')::uuid,'m14-04-render',(claim->>'version')::int,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','fixture.csv','mediaType','text/csv','byteLength',0,'sha256',repeat('a',64),'rowCount',0,'objectPath',o||'/'||(j->'publicJob'->>'id')||'/fixture.csv','startOrdinal',1,'endOrdinal',0)),0);
 claim:=public.m14_03_complete_export(o,(j->'publicJob'->>'id')::uuid,'m14-04-render',(claim->>'version')::int,jsonb_build_object('version','m14_03_v1','jobId',j->'publicJob'->>'id','source','products.registry','requestedAt',claim->>'requestedAt','snapshotAsOf',claim->>'snapshotAsOf','scope','all_filtered','requestDigest',claim->>'requestDigest','rowCount',0,'columns',claim->'columns','artifacts',claim->'publicJob'->'artifacts','sourceVersionsDigest',claim->>'sourceVersionsDigest','documentationReadinessOnly',false));
 perform public.m14_04_publish_recipient(o,q.id,'m14-04-fixture',q.version,'{}');
 perform pg_temp.check('preview provenance published without email',(select generation_state='ready' and email_state='off' and manifest->>'configDigest'=r.config_digest and manifest->'exportManifest'->>'jobId'=j->'publicJob'->>'id' from public.report_run_recipients where organization_id=o and id=q.id));
 perform pg_temp.check('owner can read own published artifact',public.m14_04_authorize_recipient(o,u,r.id,q.id));
 begin
 update public.report_definitions set state='paused' where organization_id=o and id=did;
 perform pg_temp.check('pause retains published artifact reads',public.m14_04_authorize_recipient(o,u,r.id,q.id));
 raise exception using errcode='P0002',message='pause fixture rollback';exception when no_data_found then null;end;
 d:=public.m14_04_mutate_definition(o,u,did,'activate',jsonb_build_object('expectedVersion',2,'idempotencyKey',gen_random_uuid(),'previewRunId',r.id));
 perform pg_temp.check('activation requires correct preview config',d->'data'->>'state'='active');
 update public.report_definitions set next_due_at=clock_timestamp()-interval '40 days' where organization_id=o and id=did;
 perform public.m14_04_schedule_due('m14-04-fixture',1);
 perform pg_temp.check('catchup bounded to latest24h',(select count(*)<=1 and bool_and(scheduled_for>clock_timestamp()-interval '24 hours') from public.report_runs where organization_id=o and definition_id=did and kind='scheduled'));
 perform public.m14_04_schedule_due('m14-04-fixture',1);
 perform pg_temp.check('repeated scheduler cannot duplicate occurrence',(select count(*)<=1 from public.report_runs where organization_id=o and definition_id=did and kind='scheduled'));
 -- Simulate an eligible occurrence for each recipient if daily slot is future.
 select * into r from public.report_runs where organization_id=o and definition_id=did and kind='scheduled';
 if r.id is not null then
 delete from public.organization_members where organization_id=o and user_id=v;
 insert into public.organization_members(organization_id,user_id,role) values(o,v,'owner');
 perform pg_temp.check('membership removal remains revoked after rejoin',(select bool_and(generation_state='revoked') from public.report_run_recipients where organization_id=o and run_id=r.id and user_id=v));
 begin update public.report_run_recipients set generation_state='ready' where organization_id=o and run_id=r.id and user_id=v;raise exception 'revocation undone';exception when object_not_in_prerequisite_state then null;end;
 end if;
 select * into drow from public.report_definitions where organization_id=o and id=did;
 d:=public.m14_04_admin_pause(o,v,did,jsonb_build_object('expectedVersion',drow.version,'idempotencyKey',gen_random_uuid()));
 perform pg_temp.check('admin pause reveals minimal metadata',(d->'data')-array['id','ownerUserId','state','version']='{}'::jsonb and d->'data'->>'state'='paused');
 begin perform public.m14_04_get_definition(o,v,did);raise exception 'admin read anotherowner configuration';exception when insufficient_privilege then null;end;
end $$;
rollback;
