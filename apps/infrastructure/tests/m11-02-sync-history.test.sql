-- Rollback-only M11-02 durable history / lease / mapping security checks.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;
select pg_temp.check('M11-02 durable attempt history exists',to_regclass('public.sync_run_attempts') is not null);
select pg_temp.check('attempt history has non-forced RLS and no browser access',
 (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.sync_run_attempts'::regclass)
 and not has_table_privilege('authenticated','public.sync_run_attempts','select')
 and not has_table_privilege('anon','public.sync_run_attempts','select'));
select pg_temp.check('M11-02 RPCs use pinned paths and deny browsers',not exists(
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'm1102_%'
 and (p.proconfig is null or not('search_path=public, pg_temp'=any(p.proconfig))
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))));
do $$
declare v_org uuid; v_actor uuid; v_connector uuid; v_epoch bigint; v_result record; v_run uuid; v_claim record; v_attempt uuid; v_preview jsonb; v_saved jsonb; v_child uuid; v_key uuid:=gen_random_uuid(); v_version integer;
begin
 insert into public.users(email) values('m1102-'||gen_random_uuid()||'@cra.test') returning id into v_actor;
 insert into public.organizations(name,slug) values('M1102 fixture','m1102-'||gen_random_uuid()) returning id into v_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner');
 select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
 select * into v_result from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,gen_random_uuid(),'reference_conformance','M1102','1.0.0','v1','{}','manual');
 v_connector:=(v_result.connector->>'id')::uuid;
 select * into v_result from public.m11_begin_sync_run_atomic(v_org,v_connector,v_actor,v_epoch,'incremental',gen_random_uuid(),gen_random_uuid());
 v_run:=(v_result.run->>'id')::uuid;
 select * into v_claim from public.m1102_claim_sync_run(v_org,'worker-a',60);
 perform pg_temp.check('claim records generation and starts attempt',v_claim.outcome='claimed' and (v_claim.run->>'leaseGeneration')::integer=1
 and exists(select 1 from public.sync_run_attempts where organization_id=v_org and sync_run_id=v_run and lease_generation=1 and finished_at is null));
 select id into v_attempt from public.sync_run_attempts where organization_id=v_org and sync_run_id=v_run;
 select * into v_result from public.m1102_fail_sync_run_atomic(v_org,v_run,'worker-a',0,'provider_unavailable',true,null);
 perform pg_temp.check('stale generation cannot fail active run',v_result.outcome='lease_lost');
 update public.sync_runs set lease_expires_at=clock_timestamp()-interval '1 second' where organization_id=v_org and id=v_run;
 select * into v_claim from public.m1102_claim_sync_run(v_org,'worker-b',60);
 perform pg_temp.check('expired lease recovered with new generation',v_claim.outcome='claimed' and (v_claim.run->>'leaseGeneration')::integer=2);
 perform pg_temp.check('abandoned attempt closed interrupted',(select outcome='interrupted' and finished_at is not null from public.sync_run_attempts where id=v_attempt));
 select * into v_result from public.m1102_fail_sync_run_atomic(v_org,v_run,'worker-a',1,'provider_unavailable',true,null);
 perform pg_temp.check('late worker cannot overwrite recovered work',v_result.outcome='lease_lost');
 perform pg_temp.check('expired old generation cannot renew',not public.m1102_renew_sync_run_lease(v_org,v_run,'worker-a',1,60));
 perform pg_temp.check('active generation may renew',public.m1102_renew_sync_run_lease(v_org,v_run,'worker-b',2,60));
 select * into v_result from public.m1102_fail_sync_run_atomic(v_org,v_run,'worker-b',2,'auth_failed',false,null);
 perform pg_temp.check('invalid authentication never retries',v_result.outcome='failed' and (select retry_count=0 from public.sync_runs where id=v_run));
 perform pg_temp.check('terminal run has an end timestamp',(select finished_at is not null from public.sync_runs where id=v_run));
 begin
  update public.sync_run_attempts set worker_id='changed' where id=v_attempt;
  raise exception 'attempt identity could be rewritten';
 exception when check_violation then perform pg_temp.check('attempt identity immutable',true); end;
 select * into v_result from public.m11_begin_sync_run_atomic(v_org,v_connector,v_actor,v_epoch,'incremental',gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('failed unresolved batch blocks ordinary new sync',v_result.outcome='blocked_by_dead_letter');
 begin
  perform public.m1102_save_field_mapping(v_org,v_actor,v_connector,v_epoch,1,0,gen_random_uuid(),repeat('a',64),'test-key',repeat('b',64),
  '[{"entityType":"product","sourceField":"approval","targetField":"responsibleOwnerId","transform":"identity"}]');
  raise exception 'protected target mapping accepted';
 exception when raise_exception then perform pg_temp.check('protected target mapping rejected',sqlerrm='invalid_request'); end;
 v_saved:=public.m1102_save_field_mapping(v_org,v_actor,v_connector,v_epoch,1,0,v_key,repeat('c',64),'test-key',repeat('b',64),
 '[{"entityType":"product","sourceField":"title","targetField":"name","transform":"identity"}]');
 perform pg_temp.check('mapping revision independent from connection revision',(v_saved->>'revision')::integer=1
 and(select field_mapping_revision=1 and connection_revision=1 and version=2 from public.connectors where id=v_connector));
 perform pg_temp.check('mapping command replay durable',public.m1102_save_field_mapping(v_org,v_actor,v_connector,v_epoch,1,0,v_key,repeat('c',64),'test-key',repeat('b',64),
 '[{"entityType":"product","sourceField":"title","targetField":"name","transform":"identity"}]')=v_saved);
 select version into v_version from public.sync_runs where id=v_run;
 v_preview:=public.m1102_replay_preview(v_org,v_actor,v_connector,v_run,v_epoch,v_version,'preserve','retained');
 perform pg_temp.check('missing retained schema requires explicit refetch',not(v_preview->>'canReplay')::boolean);
 v_preview:=public.m1102_replay_preview(v_org,v_actor,v_connector,v_run,v_epoch,v_version,'rebase','refetch');
 perform pg_temp.check('explicit rebase refetch preview binds current mapping',(v_preview->>'canReplay')::boolean and (v_preview->>'mappingRevision')::integer=1);
 select * into v_result from public.m1102_replay_sync_run(v_org,v_actor,v_connector,v_run,v_epoch,v_version,'rebase','refetch',gen_random_uuid(),repeat('d',64),'test-key',repeat('0',64),'Repair source');
 perform pg_temp.check('changed preview digest conflicts',v_result.outcome='conflict');
 v_key:=gen_random_uuid();
 select * into v_result from public.m1102_replay_sync_run(v_org,v_actor,v_connector,v_run,v_epoch,v_version,'rebase','refetch',v_key,repeat('e',64),'test-key',v_preview->>'previewDigest','Repair source');
 v_child:=(v_result.run->>'id')::uuid;
 perform pg_temp.check('replay creates child and preserves failed parent',v_result.outcome='queued' and v_child<>v_run
 and(select status='failed' from public.sync_runs where id=v_run)
 and(select replay_parent_run_id=v_run and mapping_snapshot=v_saved->'fields' from public.sync_runs where id=v_child));
 select * into v_result from public.m1102_replay_sync_run(v_org,v_actor,v_connector,v_run,v_epoch,v_version,'rebase','refetch',v_key,repeat('e',64),'test-key',v_preview->>'previewDigest','Repair source');
 perform pg_temp.check('replay idempotency does not duplicate child',v_result.outcome='replayed' and(v_result.run->>'id')::uuid=v_child);
 select * into v_claim from public.m1102_claim_sync_run(v_org,'worker-c',60);
 select * into v_result from public.m1102_fail_sync_run_atomic(v_org,v_child,'worker-c',(v_claim.run->>'leaseGeneration')::integer,'rate_limited',true,120);
 perform pg_temp.check('Retry-After never retried early',v_result.outcome='retrying' and(select next_attempt_at>=clock_timestamp()+interval '119 seconds' and retry_count=1 from public.sync_runs where id=v_child));
 perform pg_temp.check('attempt error category is fixed',(select error_category='rate_limit' from public.sync_run_attempts where sync_run_id=v_child));
 perform pg_temp.check('replay source never enters export',not public.m1_export_business_record_jsonb('sync_run_plan_items','{"id":"safe","source_snapshot":{"fields":{"name":"canary"}}}'::jsonb)?'source_snapshot');
 perform pg_temp.check('attempts registered for tenant export',exists(select 1 from public.organization_export_source_tables where source_id='connector_sync' and table_name='sync_run_attempts'));

 update public.sync_runs set next_attempt_at=clock_timestamp()-interval '1 second' where organization_id=v_org and id=v_child;
 select * into v_claim from public.m1102_claim_sync_run(v_org,'worker-d',60);
 select * into v_result from public.m1102_save_sync_run_plan_atomic(v_org,v_child,'worker-d',(v_claim.run->>'leaseGeneration')::integer,
 'unapplied-cursor',repeat('f',64),'[
 {"entityType":"product","externalId":"good","proposedAction":"unchanged","fieldDiffs":{},"issues":[],"sourceSnapshot":{"fields":{"title":"Good"}}},
 {"entityType":"product","externalId":"bad","proposedAction":"rejected","fieldDiffs":{},"issues":[],"sourceSnapshot":{"fields":{"title":null}}}
 ]'::jsonb,'[]'::jsonb,'{"adapterVersion":"1.0.0"}'::jsonb);
 perform pg_temp.check('poison record terminalizes whole batch without skipping failure',v_result.outcome='saved'
 and(select status='failed' and row_count=2 and processed_count=2 and failed_count=1 and skipped_count=1 and pending_count=0 and skip_count=0 from public.sync_runs where id=v_child));
 perform pg_temp.check('poison batch leaves cursor unchanged',(select cursor is null from public.sync_connector_cursors where connector_id=v_connector));
 perform pg_temp.check('poison row is a safe visible dead letter',(select record_outcome='failed' and error_code='invalid_record' and dead_lettered_at is not null from public.sync_run_plan_items where sync_run_id=v_child and external_id='bad'));
 perform pg_temp.check('attempt retains offending record identity',(select cardinality(affected_record_ids)=1 and error_category='invalid_data' from public.sync_run_attempts where sync_run_id=v_child and lease_generation=(v_claim.run->>'leaseGeneration')::integer));
 select version into v_version from public.sync_runs where id=v_child;
 v_preview:=public.m1102_replay_preview(v_org,v_actor,v_connector,v_child,v_epoch,v_version,'preserve','retained');
 perform pg_temp.check('retained replay requires preview and preserves pinned map',(v_preview->>'canReplay')::boolean and(v_preview->>'mappingRevision')::integer=1);
 update public.sync_connector_cursors set cursor='new-cursor' where organization_id=v_org and connector_id=v_connector;
 v_preview:=public.m1102_replay_preview(v_org,v_actor,v_connector,v_child,v_epoch,v_version,'preserve','retained');
 perform pg_temp.check('cursor drift blocks retained replay',not(v_preview->>'canReplay')::boolean and v_preview->'issues'->0->>'code'='cursor_changed');
 v_preview:=public.m1102_replay_preview(v_org,v_actor,v_connector,v_child,v_epoch,v_version,'rebase','refetch');
 perform pg_temp.check('cursor drift requires explicitly refetched reconciliation',(v_preview->>'canReplay')::boolean);
 select * into v_result from public.m1102_replay_sync_run(v_org,v_actor,v_connector,v_child,v_epoch,v_version,'rebase','refetch',gen_random_uuid(),repeat('f',64),'test-key',v_preview->>'previewDigest','Reconcile cursor');
 perform pg_temp.check('drift recovery is full and fresh manual dry run',v_result.outcome='queued' and v_result.run->>'reconciliationKind'='full' and v_result.run->>'cursorFrom' is null);
 perform pg_temp.check('replay batch root is flat across generations',(select replay_root_run_id=v_run from public.sync_runs where id=(v_result.run->>'id')::uuid));
 set constraints m1102_record_counts_check immediate;
 delete from public.organizations where id=v_org;
 set constraints all immediate;
 perform pg_temp.check('tenant purge cascades across replay lineage and attempts',not exists(select 1 from public.sync_runs where organization_id=v_org)
 and not exists(select 1 from public.sync_run_attempts where organization_id=v_org));

end $$;
rollback;
