-- All data belongs to generated fixtures and the whole suite is rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;
do $$
declare v_org uuid; v_other_org uuid; v_actor uuid; v_entity uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid();
 v_connector uuid; v_other_connector uuid; v_run uuid; v_other_run uuid; v_generation integer; v_epoch bigint; v_result record; v_claim record;
 v_good uuid; v_bad uuid; v_audit_before integer;
begin
 insert into public.users(email) values('m1102-atomic-'||gen_random_uuid()||'@cra.test') returning id into v_actor;
 insert into public.organizations(name,slug) values('M1102 atomic fixture','m1102-atomic-'||gen_random_uuid()) returning id into v_org;
 insert into public.organizations(name,slug) values('M1102 isolation fixture','m1102-other-'||gen_random_uuid()) returning id into v_other_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner'),(v_other_org,v_actor,'owner');
 select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)
 values(v_entity,v_org,'fixture','M1102 atomic fixture','needs_completion','inactive',v_actor,v_actor);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 values(v_product,v_org,v_entity,0,'{}','Original name','M1102-ATOMIC','standalone_software',v_actor,v_actor,v_actor);
 select * into v_result from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,gen_random_uuid(),'reference_conformance','Atomic','1.0.0','v1','{}','manual');
 v_connector:=(v_result.connector->>'id')::uuid;
 select * into v_result from public.m11_begin_sync_run_atomic(v_org,v_connector,v_actor,v_epoch,'incremental',gen_random_uuid(),gen_random_uuid());
 v_run:=(v_result.run->>'id')::uuid;
 select * into v_claim from public.m1102_claim_sync_run(v_org,'atomic-worker',60); v_generation:=(v_claim.run->>'leaseGeneration')::integer;
 select * into v_result from public.m1102_save_sync_run_plan_atomic(v_other_org,v_run,'atomic-worker',v_generation,'cursor-never-apply',repeat('a',64),'[]','[]','{}');
 perform pg_temp.check('tenant substitution cannot persist a plan',v_result.outcome='lease_lost');
 select * into v_result from public.m1102_save_sync_run_plan_atomic(v_org,v_run,'atomic-worker',v_generation,'cursor-never-apply',repeat('a',64),
 '[{"entityType":"product","externalId":"duplicate","proposedAction":"unchanged","fieldDiffs":{},"issues":[],"sourceSnapshot":{"fields":{"name":"First"}}},
 {"entityType":"product","externalId":"duplicate","proposedAction":"unchanged","fieldDiffs":{},"issues":[],"sourceSnapshot":{"fields":{"name":"Second"}}}]'::jsonb,'[]','{}');
 perform pg_temp.check('duplicate source identity rejected before any persistence',v_result.outcome='invalid_data'
 and not exists(select 1 from public.sync_run_plan_items where organization_id=v_org and sync_run_id=v_run)
 and(select status='running' from public.sync_runs where id=v_run));
 select * into v_result from public.m1102_save_sync_run_plan_atomic(v_org,v_run,'atomic-worker',v_generation,'cursor-never-apply',repeat('a',64),
 jsonb_build_array(
 jsonb_build_object('externalId','good','entityType','product','proposedAction','update','craProductId',v_product,'expectedVersion',0,
 'fieldDiffs',jsonb_build_object('name',jsonb_build_object('field','name','craValue','Original name','externalValue','Updated name','authorityPolicyId',null,'permittedActions','[]'::jsonb)),'issues','[]'::jsonb,'sourceSnapshot',jsonb_build_object('fields',jsonb_build_object('name','Updated name'))),
 jsonb_build_object('externalId','bad','entityType','product','proposedAction','update','craProductId',gen_random_uuid(),'expectedVersion',0,
 'fieldDiffs',jsonb_build_object('name',jsonb_build_object('field','name','craValue',null,'externalValue','Never applies','authorityPolicyId',null,'permittedActions','[]'::jsonb)),'issues','[]'::jsonb,'sourceSnapshot',jsonb_build_object('fields',jsonb_build_object('name','Never applies')))
 ),'[]','{}');
 perform pg_temp.check('valid plan waits for approval',v_result.outcome='saved' and v_result.run->>'status'='waiting_for_review');
 select id into v_good from public.sync_run_plan_items where sync_run_id=v_run and external_id='good';
 select id into v_bad from public.sync_run_plan_items where sync_run_id=v_run and external_id='bad';
 -- Ensure the valid record executes before the injected stale target.
 update public.sync_run_plan_items set created_at=clock_timestamp()-interval '1 second' where id=v_good;
 update public.sync_run_plan_items set created_at=clock_timestamp() where id=v_bad;
 select * into v_result from public.m11_request_sync_run_commit_atomic(v_org,v_run,v_actor,v_epoch,2);
 perform pg_temp.check('approval records current approver',v_result.outcome='queued' and(select commit_actor_user_id=v_actor from public.sync_runs where id=v_run));
 select * into v_claim from public.m1102_claim_sync_run(v_org,'atomic-worker',60); v_generation:=(v_claim.run->>'leaseGeneration')::integer;
 select count(*) into v_audit_before from public.audit_logs where organization_id=v_org and action='product.updated';
 select * into v_result from public.m1102_commit_sync_run_atomic(v_org,v_run,v_actor,'atomic-worker',v_generation,repeat('a',64),gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('invalid commit is terminal without blanket retry',v_result.outcome='failed' and(select retry_count=0 and error_code='commit_apply_failed' from public.sync_runs where id=v_run));
 perform pg_temp.check('valid earlier product mutation rolled back',(select name='Original name' and version=0 from public.products where id=v_product));
 perform pg_temp.check('domain audit rolled back atomically',(select count(*)=v_audit_before from public.audit_logs where organization_id=v_org and action='product.updated'));
 perform pg_temp.check('no applied marker survives rollback',not exists(select 1 from public.sync_run_plan_items where sync_run_id=v_run and applied_at is not null));
 perform pg_temp.check('cursor remains pinned at failed batch',(select cursor is null from public.sync_connector_cursors where connector_id=v_connector));
 perform pg_temp.check('failed record distinguished from withheld valid record',
 (select record_outcome='failed' and error_category='invalid_data' and error_code='commit_apply_failed' from public.sync_run_plan_items where id=v_bad)
 and(select record_outcome='withheld' from public.sync_run_plan_items where id=v_good)
 and(select row_count=2 and failed_count=1 and pending_count=1 and succeeded_count=0 from public.sync_runs where id=v_run));
 perform pg_temp.check('commit attempt safely closes with failed record identity',(select outcome='failed' and affected_record_ids=array[v_bad] from public.sync_run_attempts where sync_run_id=v_run and lease_generation=v_generation));
 select * into v_result from public.retry_sync_run_atomic(v_org,v_run,v_actor);
 perform pg_temp.check('legacy empty retry cannot bypass preview',v_result.outcome='preview_required' and(select status='failed' from public.sync_runs where id=v_run));

 select * into v_result from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,gen_random_uuid(),'reference_conformance','Full baseline','1.0.0','v1','{}','manual');
 v_other_connector:=(v_result.connector->>'id')::uuid;
 select * into v_result from public.m11_begin_sync_run_atomic(v_org,v_other_connector,v_actor,v_epoch,'full',gen_random_uuid(),gen_random_uuid());
 v_other_run:=(v_result.run->>'id')::uuid;
 select * into v_claim from public.m1102_claim_sync_run(v_org,'baseline-worker',60); v_generation:=(v_claim.run->>'leaseGeneration')::integer;
 select * into v_result from public.m1102_save_sync_run_plan_atomic(v_org,v_other_run,'baseline-worker',v_generation,'new-full-cursor',repeat('b',64),'[]','[]','{}');
 perform public.m11_request_sync_run_commit_atomic(v_org,v_other_run,v_actor,v_epoch,0);
 select * into v_claim from public.m1102_claim_sync_run(v_org,'baseline-worker',60); v_generation:=(v_claim.run->>'leaseGeneration')::integer;
 update public.sync_connector_cursors set cursor='concurrent-cursor' where organization_id=v_org and connector_id=v_other_connector;
 select * into v_result from public.m1102_commit_sync_run_atomic(v_org,v_other_run,v_actor,'baseline-worker',v_generation,repeat('b',64),gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('full reconciliation compares database cursor baseline',v_result.outcome='cursor_drifted'
 and(select cursor='concurrent-cursor' from public.sync_connector_cursors where connector_id=v_other_connector));
 select * into v_result from public.m1102_fail_sync_run_atomic(v_org,v_other_run,'baseline-worker',v_generation,'stale_preview',false,null);
 perform pg_temp.check('stale baseline never auto retries',v_result.outcome='failed' and(select error_category='stale_preview' from public.sync_run_attempts where sync_run_id=v_other_run and lease_generation=v_generation));
 set constraints m1102_record_counts_check immediate;
end $$;
rollback;
