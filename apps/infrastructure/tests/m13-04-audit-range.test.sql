begin;
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('one range workflow table exists',to_regclass('public.audit_verification_jobs') is not null);
select pg_temp.check('nonforced RLS',(select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.audit_verification_jobs'::regclass));
select pg_temp.check('no browser grants',not has_table_privilege('authenticated','public.audit_verification_jobs','SELECT') and not has_table_privilege('anon','public.audit_verification_jobs','SELECT'));
select pg_temp.check('private function grants',not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'm13_04_%' and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))));
select pg_temp.check('pinned search paths',not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'm13_04_%' and not coalesce(p.proconfig @> array['search_path=pg_catalog, public'],false)));
select pg_temp.check('source registry installed',not exists(select 1 from unnest(public.m13_04_scope_dependencies()) dependency where to_regclass('public.'||dependency) is not null and not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||dependency) and tgname='m13_04_scope_changed' and tgenabled='O')));
select pg_temp.check('predicate dependency fingerprint parity',not exists(select 1 from jsonb_each_text(public.m13_04_dependency_fingerprints()) expected where md5(pg_get_functiondef(('public.'||expected.key)::regprocedure))<>expected.value));
select pg_temp.check('dataset markers excluded from portable tenant projection',public.m1_export_redact_jsonb('{"name":"Tenant name","audit_dataset_epoch":"00000000-0000-4000-8000-000000000001","audit_dataset_context":"restored","password":"removed","ordinary":{"enabled":true}}'::jsonb)='{"name":"Tenant name","ordinary":{"enabled":true}}'::jsonb);
select pg_temp.check('nested private markers excluded only by exact name',public.m1_export_redact_jsonb('[{"audit_dataset_epoch":"private","audit_dataset_context":"private","audit_dataset_context_note":"preserved","ordinary":[1,true,null]}]'::jsonb)='[{"audit_dataset_context_note":"preserved","ordinary":[1,true,null]}]'::jsonb);
savepoint m13_04_unit_fixture;
do $$ declare v_org uuid:=gen_random_uuid(); v_user uuid:=gen_random_uuid(); v_request uuid:=gen_random_uuid(); v_job jsonb; v_claim jsonb; v_auth jsonb; v_cancel jsonb; v_resume jsonb; v_id uuid; v_lease uuid; v_version integer; v_epoch uuid; v_rotation jsonb; begin
 insert into public.organizations(id,name,slug) values(v_org,'M13 range rollback fixture','m13-range-'||v_org);
 insert into public.users(id,email) values(v_user,'m13-range-'||v_user||'@cra.test');
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 insert into public.audit_logs(organization_id,action,entity_type,entity_id) select v_org,'organization.range_fixture','organization',v_org::text from generate_series(1,260);
 set constraints m13_02_finalize_audit_chain immediate;
 v_job:=public.m13_04_create_verification(v_org,v_user,v_request,'1',null,null,repeat('a',64)); v_id:=(v_job->>'id')::uuid;
 perform pg_temp.check('queued has no progress',v_job->>'status'='queued' and v_job->'result'='null'::jsonb);
 perform pg_temp.check('idempotent create',public.m13_04_create_verification(v_org,v_user,v_request,'1',null,null,repeat('a',64))=v_job);
 begin perform public.m13_04_create_verification(v_org,v_user,v_request,'1',null,null,repeat('b',64)); raise exception 'changed digest accepted'; exception when unique_violation then null; end;
 begin perform public.m13_04_create_verification(gen_random_uuid(),v_user,gen_random_uuid(),'1',null,null,repeat('a',64)); raise exception 'forged tenant accepted'; exception when insufficient_privilege then null; end;
 update public.audit_verification_jobs set scheduled_at='1900-01-01' where id=v_id;
 v_claim:=public.m13_04_claim_verification('range-test'); v_lease:=(v_claim->>'lease_token')::uuid; v_version:=(v_claim->>'version')::integer;
 perform pg_temp.check('claim bound to tenant',(v_claim->>'id')::uuid=v_id and v_claim->'predecessor'='null'::jsonb);
 begin perform public.m13_04_page_verification(v_org,v_id,'range-test',v_lease,v_version,'0',v_claim->>'to_sequence',250,16777216); raise exception 'canonical disclosed before authorization'; exception when insufficient_privilege then null; end;
 v_auth:=public.m13_04_authorize_verification(v_org,v_id,'range-test',v_lease,v_version,250,16777216); v_version:=(v_auth->'job'->>'version')::integer;
 perform pg_temp.check('bounded authorization phase',not (v_auth->>'complete')::boolean and (v_auth->'job'->>'authorization_count')::integer=250);
 v_auth:=public.m13_04_authorize_verification(v_org,v_id,'range-test',v_lease,v_version,250,16777216); v_version:=(v_auth->'job'->>'version')::integer;
 perform pg_temp.check('source authorization completes',(v_auth->>'complete')::boolean and (v_auth->>'scopeAvailable')::boolean);
 perform pg_temp.check('page bounded',(select jsonb_array_length(public.m13_04_page_verification(v_org,v_id,'range-test',v_lease,v_version,'0',v_claim->>'to_sequence',250,16777216)->'rows'))=250);
 v_cancel:=public.m13_04_control_verification(v_org,v_user,v_id,gen_random_uuid(),v_version,'cancel');
 perform pg_temp.check('cancel fences lease',v_cancel->>'status'='cancelled');
 begin perform public.m13_04_checkpoint_verification(v_org,v_id,'range-test',v_lease,v_version,null,null); raise exception 'old lease accepted'; exception when unique_violation then null; end;
 v_request:=gen_random_uuid(); v_resume:=public.m13_04_control_verification(v_org,v_user,v_id,v_request,(v_cancel->>'version')::integer,'resume');
 perform pg_temp.check('resume keeps original boundary',v_resume->>'status'='queued' and (select high_water_sequence=260 from public.audit_verification_jobs where id=v_id));
 perform pg_temp.check('operation replay',public.m13_04_control_verification(v_org,v_user,v_id,v_request,(v_cancel->>'version')::integer,'resume')=v_resume);
 select audit_dataset_epoch into v_epoch from public.organizations where id=v_org;
 v_request:=gen_random_uuid(); v_rotation:=public.m13_04_rotate_dataset_marker(v_org,v_request,v_epoch,'restored');
 perform pg_temp.check('operator rotation fresh',(v_rotation->>'epoch')::uuid<>v_epoch);
 perform public.m13_04_rotate_dataset_marker(v_org,gen_random_uuid(),(v_rotation->>'epoch')::uuid,'live');
 perform pg_temp.check('operator rotation replay after later rotation',public.m13_04_rotate_dataset_marker(v_org,v_request,v_epoch,'restored')->>'epoch'=v_rotation->>'epoch');
 perform pg_temp.check('restore marks cached result unavailable',public.m13_04_read_verification(v_org,v_user,v_id,gen_random_uuid())->'result'->>'outcome'='scope_unavailable');
 perform pg_temp.check('restore marks create replay unavailable',public.m13_04_create_verification(v_org,v_user,(select request_id from public.audit_verification_jobs where id=v_id),'1',null,null,repeat('a',64))->>'status'='stale');
 perform pg_temp.check('receipts never join checked chain',not exists(select 1 from public.audit_logs where entity_type='audit_verification' and (organization_id is not null or chain_sequence is not null)));
end $$;
rollback to m13_04_unit_fixture;
savepoint m13_04_unit_fixture;
do $$ declare v_org uuid:=gen_random_uuid(); v_user uuid:=gen_random_uuid(); v_job jsonb; v_status jsonb; v_resume jsonb; begin
 insert into public.organizations(id,name,slug) values(v_org,'M13 stale completed fixture','m13-stale-'||v_org);
 insert into public.users(id,email) values(v_user,'m13-stale-'||v_user||'@cra.test');
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 v_job:=public.m13_04_create_verification(v_org,v_user,gen_random_uuid(),'1',null,null,repeat('d',64));
 -- Only a newly owned rollback fixture is set up as terminal/incomplete.
 update public.audit_verification_jobs j set state='completed',result=public.m13_04_unavailable_result(j,'incomplete') where id=(v_job->>'id')::uuid;
 update public.organization_permissions_version set version=version+1 where organization_id=v_org;
 v_status:=public.m13_04_read_verification(v_org,v_user,(v_job->>'id')::uuid,gen_random_uuid());
 perform pg_temp.check('completed source change exposes stale safely',v_status->>'status'='stale' and v_status->'result'->>'outcome'='scope_unavailable');
 v_resume:=public.m13_04_control_verification(v_org,v_user,(v_job->>'id')::uuid,gen_random_uuid(),(v_job->>'version')::integer,'resume');
 perform pg_temp.check('logical stale completed job resumes',v_resume->>'status'='queued' and v_resume->'result'='null'::jsonb);
 perform pg_temp.check('resume reruns full source authorization',(select not authorization_complete and phase='authorization' from public.audit_verification_jobs where id=(v_job->>'id')::uuid));
end $$;
rollback to m13_04_unit_fixture;
-- Limit failures use real guarded RPCs; only workflow progress on owned
-- rollback fixtures is prepared. No chain rows or head metadata are altered.
savepoint m13_04_unit_fixture;
do $$ declare v_org uuid:=gen_random_uuid(); v_user uuid:=gen_random_uuid(); v_job jsonb; v_claim jsonb; v_auth jsonb; v_failed jsonb; begin
 insert into public.organizations(id,name,slug) values(v_org,'M13 limits fixture','m13-limits-'||v_org);
 insert into public.users(id,email) values(v_user,'m13-limits-'||v_user||'@cra.test');
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 insert into public.audit_logs(organization_id,action,entity_type,entity_id) select v_org,'organization.limit_fixture','organization',v_org::text from generate_series(1,2);
 set constraints m13_02_finalize_audit_chain immediate;
 v_job:=public.m13_04_create_verification(v_org,v_user,gen_random_uuid(),'1',null,null,repeat('e',64));
 update public.audit_verification_jobs set scheduled_at='-infinity' where id=(v_job->>'id')::uuid;
 v_claim:=public.m13_04_claim_verification('limit-test');
 begin
  perform public.m13_04_authorize_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_claim->>'version')::integer,251,16777216);
  raise exception 'oversized authorization batch accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.m13_04_authorize_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_claim->>'version')::integer,250,1);
  raise exception 'authorization byte overflow accepted';
 exception when program_limit_exceeded then
  perform pg_temp.check('SQL byte limit has stable safe code',sqlerrm='verification byte limit');
 end;
 perform pg_temp.check('byte rejection does not commit progress',(select authorization_count=0 and not authorization_complete from public.audit_verification_jobs where id=(v_job->>'id')::uuid));
 v_failed:=public.m13_04_fail_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_claim->>'version')::integer,'byte_limit',false);
 perform pg_temp.check('byte limit is terminal failed',v_failed->>'state'='failed' and v_failed->>'failure_code'='byte_limit' and v_failed->'result'='null'::jsonb);
 perform pg_temp.check('byte failure is durably audited',exists(select 1 from public.audit_logs where action='audit.range.failed' and entity_id=v_job->>'id' and organization_id is null));
 v_job:=public.m13_04_create_verification(v_org,v_user,gen_random_uuid(),'1',null,null,repeat('f',64));
 update public.audit_verification_jobs set scheduled_at='-infinity',authorization_count=1000000 where id=(v_job->>'id')::uuid;
 v_claim:=public.m13_04_claim_verification('limit-test');
 begin
  perform public.m13_04_authorize_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_claim->>'version')::integer,250,16777216);
  raise exception 'inspection event overflow accepted';
 exception when program_limit_exceeded then
  perform pg_temp.check('SQL event limit has stable safe code',sqlerrm='verification event limit');
 end;
 perform pg_temp.check('event overflow keeps previous progress',(select authorization_count=1000000 and not authorization_complete from public.audit_verification_jobs where id=(v_job->>'id')::uuid));
 v_failed:=public.m13_04_fail_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_claim->>'version')::integer,'event_limit',false);
 perform pg_temp.check('event limit is terminal failed',v_failed->>'state'='failed' and v_failed->>'failure_code'='event_limit' and v_failed->'result'='null'::jsonb);
 perform pg_temp.check('event failure is durably audited',exists(select 1 from public.audit_logs where action='audit.range.failed' and entity_id=v_job->>'id' and organization_id is null));
 v_job:=public.m13_04_create_verification(v_org,v_user,gen_random_uuid(),'1',null,null,repeat('b',64));
 update public.audit_verification_jobs set scheduled_at='-infinity' where id=(v_job->>'id')::uuid;
 v_claim:=public.m13_04_claim_verification('limit-test');
 v_auth:=public.m13_04_authorize_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_claim->>'version')::integer,250,16777216);
 begin
  perform public.m13_04_page_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_auth->'job'->>'version')::integer,'0','2',250,1);
  raise exception 'verification page byte overflow accepted';
 exception when program_limit_exceeded then
  perform pg_temp.check('page SQL byte limit is explicit',sqlerrm='verification byte limit');
 end;
 perform pg_temp.check('page overflow preserves lease and phase',(select state='processing' and authorization_complete and phase='verification' and cursor is null from public.audit_verification_jobs where id=(v_job->>'id')::uuid));
 perform public.m13_04_fail_verification(v_org,(v_job->>'id')::uuid,'limit-test',(v_claim->>'lease_token')::uuid,(v_auth->'job'->>'version')::integer,'byte_limit',false);
end $$;
rollback to m13_04_unit_fixture;
savepoint receipt_failure;
create function public.m13_04_test_receipt_failure() returns trigger language plpgsql as $$ begin
 if new.action='audit.range.created' then raise exception 'injected range receipt failure'; end if; return new;
end $$;
create trigger zz_m13_04_test_receipt_failure before insert on public.audit_logs for each row execute function public.m13_04_test_receipt_failure();
savepoint m13_04_unit_fixture;
do $$ declare v_org uuid:=gen_random_uuid(); v_user uuid:=gen_random_uuid(); v_before bigint; begin
 insert into public.organizations(id,name,slug) values(v_org,'M13 atomic rollback fixture','m13-atomic-'||v_org);
 insert into public.users(id,email) values(v_user,'m13-atomic-'||v_user||'@cra.test');
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 select count(*) into v_before from public.audit_verification_jobs;
 begin
  perform public.m13_04_create_verification(v_org,v_user,gen_random_uuid(),'1',null,null,repeat('a',64));
  raise exception 'receipt failure did not reject create';
 exception when raise_exception then
  if sqlerrm<>'injected range receipt failure' then raise; end if;
 end;
 perform pg_temp.check('failed receipt rolls back critical job',(select count(*) from public.audit_verification_jobs)=v_before);
end $$;
rollback to m13_04_unit_fixture;
rollback to receipt_failure;
rollback;
