begin;
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('export jobs share updated_at invariant',exists(select 1 from pg_trigger where tgrelid='public.audit_export_jobs'::regclass and not tgisinternal and tgenabled='O' and tgfoid='public.set_updated_at'::regproc));
select pg_temp.check('one persistent table exists',to_regclass('public.audit_export_jobs') is not null);
select pg_temp.check('nonforced RLS',(select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.audit_export_jobs'::regclass));
select pg_temp.check('no browser grants',not has_table_privilege('authenticated','public.audit_export_jobs','SELECT') and not has_table_privilege('anon','public.audit_export_jobs','SELECT'));
do $$ declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_user uuid; v_request uuid:=gen_random_uuid(); v_first jsonb; v_replay jsonb; v_head bigint; begin
 select user_id into strict v_user from public.organization_members where organization_id=v_org and role='owner' limit 1;
 select last_sequence into v_head from public.audit_chain_heads where organization_id=v_org;
 v_first:=public.m13_03_create_snapshot(v_org,v_user,v_request,repeat('a',64),repeat('b',64));
 perform pg_temp.check('snapshot freezes before receipt',(v_first->>'highWaterSequence')::bigint=v_head);
 set constraints m13_02_finalize_audit_chain immediate;
 perform pg_temp.check('receipt excluded from snapshot',(select chain_sequence>v_head from public.audit_logs where id=(v_first->>'receiptId')::uuid));
 v_replay:=public.m13_03_create_snapshot(v_org,v_user,v_request,repeat('a',64),repeat('b',64));
 perform pg_temp.check('retry reuses receipt',v_replay=v_first);
 begin perform public.m13_03_create_snapshot(v_org,v_user,v_request,repeat('c',64),repeat('b',64)); raise exception 'changed request accepted'; exception when unique_violation then null; end;
 begin perform public.m13_03_create_snapshot(gen_random_uuid(),v_user,gen_random_uuid(),repeat('a',64),repeat('b',64)); raise exception 'tenant forgery accepted'; exception when insufficient_privilege then null; end;
 perform pg_temp.check('one receipt',(select count(*)=1 from public.audit_logs where organization_id=v_org and event_key='audit.search:'||v_request::text));
end $$;
select pg_temp.check('helper not publicly executable',not has_function_privilege('authenticated','public.m13_03_create_snapshot(uuid,uuid,uuid,text,text)','EXECUTE'));
savepoint export_fixture;
do $$ declare v_org uuid:=gen_random_uuid(); v_user uuid; v_request uuid:=gen_random_uuid(); v_snapshot jsonb; v_job jsonb; v_claim jsonb; v_ready jsonb; v_job_id uuid; v_digest text:=repeat('c',64); v_session uuid:=gen_random_uuid(); v_filters jsonb:='{"from":"2026-09-07T00:00:00Z","to":"2026-10-07T00:00:00Z"}'; v_filter_digest text; v_selected uuid[]; v_retry jsonb; v_retry_id uuid; begin
 select user_id into strict v_user from public.organization_members where organization_id='00000000-0000-4000-8000-0000000000ca' and role='owner' limit 1;
 insert into public.organizations(id,name,slug) values(v_org,'M13 SQL export fixture','m13-test-'||v_org::text);
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 v_filter_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(v_filters),'UTF8'),'sha256'),'hex');
 v_snapshot:=public.m13_03_create_snapshot(v_org,v_user,gen_random_uuid(),v_filter_digest,repeat('b',64));
 v_job:=public.m13_03_create_export(v_org,v_user,v_request,(v_snapshot->>'receiptId')::uuid,v_filters,v_filter_digest,repeat('b',64),'json');
 v_job_id:=(v_job->>'id')::uuid;
 perform pg_temp.check('queued export',v_job->>'state'='queued');
 perform pg_temp.check('bigint serialized',jsonb_typeof(v_job->'high_water_sequence')='string');
 perform pg_temp.check('same request same export',public.m13_03_create_export(v_org,v_user,v_request,(v_snapshot->>'receiptId')::uuid,v_filters,v_filter_digest,repeat('b',64),'json')->>'id'=v_job->>'id');
 -- Only transient fixture jobs receive deterministic priority; retained development jobs remain untouched.
 -- Disable only this timestamp trigger while arranging rollback-only fixture priority.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity',created_at='1970-01-01' where organization_id=v_org;
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_claim:=public.m13_03_claim_export('m13-03-test');
 select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_selected from jsonb_array_elements_text(v_claim->'selected_event_ids');
 perform pg_temp.check('worker claimed',v_claim->>'id'=v_job->>'id' and v_claim->>'state'='processing' and (v_claim->>'attempts')::int=1);
 begin perform public.m13_03_transition_export(v_org,v_job_id,'different-worker',(v_claim->>'version')::int,'ready',v_selected,jsonb_build_object('sha256',v_digest,'bytes',100,'objectPath',v_org::text||'/'||v_job_id::text||'/'||v_digest||'.zip'),null); raise exception 'forged worker accepted'; exception when serialization_failure then null; end;
 v_ready:=public.m13_03_transition_export(v_org,v_job_id,'m13-03-test',(v_claim->>'version')::int,'ready',v_selected,jsonb_build_object('sha256',v_digest,'bytes',100,'objectPath',v_org::text||'/'||v_job_id::text||'/'||v_digest||'.zip'),null);
 perform pg_temp.check('ready evidence',(select count(*)=1 from public.audit_logs where organization_id=v_org and entity_id=v_job_id::text and action='audit.export.ready'));
 perform public.m13_03_issue_download_grant(v_org,v_user,v_job_id,v_session,v_digest,gen_random_uuid());
 begin perform public.m13_03_redeem_download_grant(v_org,v_user,v_job_id,gen_random_uuid(),v_digest,gen_random_uuid()); raise exception 'wrong session accepted'; exception when insufficient_privilege then null; end;
 perform public.m13_03_redeem_download_grant(v_org,v_user,v_job_id,v_session,v_digest,gen_random_uuid());
 begin perform public.m13_03_redeem_download_grant(v_org,v_user,v_job_id,v_session,v_digest,gen_random_uuid()); raise exception 'reused grant accepted'; exception when insufficient_privilege then null; end;
 perform pg_temp.check('download evidence',(select count(*)=1 from public.audit_logs where organization_id=v_org and entity_id=v_job_id::text and action='audit.export.download_started'));
 v_retry:=public.m13_03_create_export(v_org,v_user,gen_random_uuid(),(v_snapshot->>'receiptId')::uuid,v_filters,v_filter_digest,repeat('b',64),'csv'); v_retry_id:=(v_retry->>'id')::uuid;
 -- Disable only this timestamp trigger while arranging rollback-only fixture priority.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity',created_at='1970-01-01' where organization_id=v_org;
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_retry:=public.m13_03_claim_export('m13-retry-test');
 perform pg_temp.check('retry job claimed',v_retry->>'id'=v_retry_id::text);
 v_retry:=public.m13_03_transition_export(v_org,v_retry_id,'m13-retry-test',(v_retry->>'version')::int,'queued',null,null,'storage_unavailable');
 perform pg_temp.check('transient failure requeued',v_retry->>'state'='queued');
 -- Disable only this timestamp trigger while arranging rollback-only fixture priority.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity',created_at='1970-01-01' where organization_id=v_org;
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_retry:=public.m13_03_claim_export('m13-retry-test');
 perform pg_temp.check('retry preserves frozen selection',(v_retry->>'attempts')::int=2 and v_retry->'selected_event_ids'=to_jsonb(v_selected));
 v_retry:=public.m13_03_transition_export(v_org,v_retry_id,'m13-retry-test',(v_retry->>'version')::int,'queued',null,null,'generation_failed');
 -- Disable only this timestamp trigger while arranging rollback-only fixture priority.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity',created_at='1970-01-01' where organization_id=v_org;
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_retry:=public.m13_03_claim_export('m13-retry-test');
 v_retry:=public.m13_03_transition_export(v_org,v_retry_id,'m13-retry-test',(v_retry->>'version')::int,'queued',null,null,'generation_failed');
 perform pg_temp.check('third failure terminal',v_retry->>'state'='failed' and (v_retry->>'attempts')::int=3);

end $$;
rollback to export_fixture;
do $$ declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_viewer uuid; v_role uuid:=gen_random_uuid(); v_owner uuid; v_product uuid; v_event public.audit_logs; begin
 select user_id into strict v_viewer from public.organization_members where organization_id=v_org and role='viewer' limit 1;
 select user_id into strict v_owner from public.organization_members where organization_id=v_org and role='owner' limit 1;
 insert into public.custom_roles(id,organization_id,name,base_role,permissions) values(v_role,v_org,'M13 SQL scope fixture','owner','{"can_manage_suppliers":true,"can_create_suppliers":true}');
 insert into public.user_role_assignments(organization_id,user_id,role_id) values(v_org,v_viewer,v_role);
 perform pg_temp.check('custom base role is label',not public.m13_03_actor_can(v_org,v_viewer,'can_view_audit'));
 perform pg_temp.check('manage does not imply view',not public.m13_03_actor_can(v_org,v_viewer,'can_view_suppliers'));
 perform pg_temp.check('unknown permission cannot imply view',not public.m13_03_actor_can(v_org,v_viewer,'can_view_suppliers'));
 update public.custom_roles set permissions='{"can_export_audit":true}' where id=v_role;
 perform pg_temp.check('export implies view',public.m13_03_actor_can(v_org,v_viewer,'can_view_audit'));
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_org,'viewer','{"can_view_audit":false}') on conflict(organization_id,base_role) do update set permissions=public.base_role_permission_overrides.permissions||excluded.permissions;
 perform pg_temp.check('hard override last',not public.m13_03_actor_can(v_org,v_viewer,'can_view_audit') and public.m13_03_actor_can(v_org,v_viewer,'can_export_audit'));
 select id into v_product from public.products where organization_id=v_org limit 1;
 v_event:=jsonb_populate_record(null::public.audit_logs,jsonb_build_object('organization_id',v_org,'entity_type','product','entity_id',v_product));
 perform pg_temp.check('source permission allows own product',public.m13_03_event_visible(v_org,v_owner,v_event));
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_org,'owner','{"can_view_products":false}') on conflict(organization_id,base_role) do update set permissions=public.base_role_permission_overrides.permissions||excluded.permissions;
 perform pg_temp.check('audit grant does not override source restriction',not public.m13_03_event_visible(v_org,v_owner,v_event));
 perform pg_temp.check('denial without audit grant durable',public.m13_03_record_denial(v_org,v_viewer,gen_random_uuid(),repeat('d',64))->>'replayed'='false');
 v_event.entity_type:='unknown_source';
 perform pg_temp.check('unknown source denied',not public.m13_03_event_visible(v_org,v_owner,v_event));
end $$;
select pg_temp.check('private export bucket',(select not public from storage.buckets where id='audit-exports'));
select pg_temp.check('all function search paths pinned',not exists(select 1 from pg_proc where proname like 'm13_03_%' and not coalesce(proconfig::text[] @> array['search_path=pg_catalog, public'],false)));
rollback;
