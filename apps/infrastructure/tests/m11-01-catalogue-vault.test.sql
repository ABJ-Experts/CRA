-- Rollback-only integration/security fixtures; no development rows are retained.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;
select pg_temp.check('durable connector command ledger exists',to_regclass('public.connector_commands') is not null);
select pg_temp.check('command ledger is service-only, RLS enabled, not forced',
 (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.connector_commands'::regclass)
 and not has_table_privilege('anon','public.connector_commands','select')
 and not has_table_privilege('authenticated','public.connector_commands','select'));
select pg_temp.check('vault envelope table remains unreadable to browser roles',
 not has_table_privilege('anon','public.connector_secrets','select')
 and not has_table_privilege('authenticated','public.connector_secrets','select'));
select pg_temp.check('credential and command tables never enter tenant exports',not exists(
 select 1 from public.organization_export_source_tables where table_name in ('connector_secrets','connector_commands')));

select pg_temp.check('M11 RPCs are service-only with pinned search paths',not exists(
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'm11_%'
 and (not p.prosecdef and p.proname not in ('m11_connector_command_json','m11_valid_connector_scope_assessment')
 or p.proconfig is null or not ('search_path=public, pg_temp'=any(p.proconfig))
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))));
-- Positive cutover is transaction-scoped: it never changes another test's
-- deployed ACL state. A real deployment with remaining PGP credentials safely
-- takes the negative guard branch instead of modifying those credentials.
do $$
begin
 if not exists(select 1 from public.connectors c join public.connector_secrets s on s.organization_id=c.organization_id and s.connector_id=c.id and s.id=c.secret_ref
  where s.revoked_at is null and s.encryption_scheme='legacy_pgp') then
  perform pg_temp.check('verified zero-legacy cutover retires read and write grants',public.m11_retire_legacy_connector_secret_rpc()
   and not has_function_privilege('service_role','public.resolve_connector_secret(uuid,uuid,text)','execute')
   and not has_function_privilege('service_role','public.set_connector_secret_atomic(uuid,uuid,uuid,text,text)','execute'));
 end if;
end $$;

do $$
declare
 v_org uuid; v_other_org uuid; v_actor uuid; v_admin uuid; v_epoch bigint; v_conn uuid; v_other_conn uuid;
 v_result record; v_begin record; v_cmd uuid; v_completed_cmd uuid; v_key uuid:=gen_random_uuid(); v_test_key uuid:=gen_random_uuid();
 v_payload jsonb; v_secret uuid:=gen_random_uuid(); v_scope jsonb; v_test jsonb; v_count integer; v_version integer;
 v_run record; v_run_id uuid; v_legacy_resolver_grant boolean; v_legacy_writer_grant boolean;
begin
 v_legacy_resolver_grant:=has_function_privilege('service_role','public.resolve_connector_secret(uuid,uuid,text)','execute');
 v_legacy_writer_grant:=has_function_privilege('service_role','public.set_connector_secret_atomic(uuid,uuid,uuid,text,text)','execute');
 insert into public.users(email) values('m11-owner-'||gen_random_uuid()::text||'@cra.test') returning id into v_actor;
 insert into public.users(email) values('m11-admin-'||gen_random_uuid()::text||'@cra.test') returning id into v_admin;
 insert into public.organizations(name,slug) values('M11 transaction fixture','m11-'||gen_random_uuid()::text) returning id into v_org;
 insert into public.organizations(name,slug) values('M11 other fixture','m11-other-'||gen_random_uuid()::text) returning id into v_other_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner'),(v_org,v_admin,'admin'),(v_other_org,v_actor,'owner');
 select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
 select * into v_result from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,gen_random_uuid(),'reference_conformance','M11 fixture','1.0.0','v1','{}','manual');
 perform pg_temp.check('create locks verified epoch',v_result.outcome='created'); v_conn:=(v_result.connector->>'id')::uuid;
 select * into v_result from public.m11_create_connector_atomic(v_org,v_actor,v_epoch-1,gen_random_uuid(),'reference_conformance','Stale','1.0.0','v1','{}','manual');
 perform pg_temp.check('stale authorization rejects create',v_result.outcome='forbidden');
 perform pg_temp.check('missing epoch fails closed',public.m11_lock_connector_authorization(v_org,v_actor,null)=false);
 perform pg_temp.check('malformed scope array fails safely',public.m11_valid_connector_scope_assessment('{"status":"unknown","policyVersion":"v1","grantedScopes":{}}'::jsonb)=false);
 perform pg_temp.check('inconsistent compliant scope verdict fails closed',not public.m11_valid_connector_scope_assessment('{"status":"compliant","policyVersion":"v1","grantedScopes":[],"missingScopes":["required.read"],"excessScopes":[]}'::jsonb));
 perform pg_temp.check('excess verdict cannot hide missing required scopes',not public.m11_valid_connector_scope_assessment('{"status":"excess","policyVersion":"v1","grantedScopes":[],"missingScopes":["required.read"],"excessScopes":["admin.write"]}'::jsonb));
 select * into v_result from public.create_connector_atomic(v_other_org,v_actor,gen_random_uuid(),'reference_conformance','Other','1.0.0','v1','{}','manual');
 v_other_conn:=(v_result.connector->>'id')::uuid;
 v_payload:=jsonb_build_object('secretId',v_secret,'credentialRevision',1,'format','aes-256-gcm-v1','keyId','test-key',
 'ciphertext',encode(decode(repeat('ab',100),'hex'),'base64'),'nonce',encode(decode(repeat('01',12),'hex'),'base64'),'authTag',encode(decode(repeat('02',16),'hex'),'base64'));
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_admin,'replace_secret',1,gen_random_uuid(),repeat('a',64),'test-key',v_epoch,v_payload);
 perform pg_temp.check('credential commands remain owner-only',v_result.outcome='forbidden');
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_other_conn,v_actor,'replace_secret',1,gen_random_uuid(),repeat('a',64),'test-key',v_epoch,v_payload);
 perform pg_temp.check('cross tenant connector substitution is not found',v_result.outcome='not_found');
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'replace_secret',1,v_key,repeat('a',64),'test-key',v_epoch,v_payload);
 perform pg_temp.check('AES ciphertext replaces credential',v_result.outcome='updated' and (v_result.connector->>'version')::integer=2 and not(v_result.connector ? 'secretRef'));
 perform pg_temp.check('replacement increments connection revision exactly once',(select connection_revision=2 and credential_revision=1 from public.connectors where id=v_conn));
 select count(*) into v_count from public.connector_secrets where organization_id=v_org and connector_id=v_conn;
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'replace_secret',1,v_key,repeat('a',64),'test-key',v_epoch,v_payload);
 perform pg_temp.check('identical retry replays without new credential',v_result.outcome='replayed' and (select count(*)=v_count from public.connector_secrets where organization_id=v_org and connector_id=v_conn));
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'replace_secret',1,v_key,repeat('b',64),'test-key',v_epoch,v_payload);
 perform pg_temp.check('changed idempotent request conflicts',v_result.outcome='idempotency_conflict');
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'disconnect',1,gen_random_uuid(),repeat('c',64),'test-key',v_epoch,'{}');
 perform pg_temp.check('stale configuration version conflicts',v_result.outcome='conflict');
 perform pg_temp.check('command and audit never contain ciphertext',(select bool_and(result::text not like '%'||replace(v_payload->>'ciphertext',chr(10),'')||'%') from public.connector_commands where organization_id=v_org)
 and not exists(select 1 from public.audit_logs where organization_id=v_org and changes::text like '%ciphertext%'));
 begin
  update public.connectors set secret_ref=v_secret where organization_id=v_other_org and id=v_other_conn;
  set constraints connectors_secret_ref_fkey immediate;
  raise exception 'cross connector credential reference was accepted';
 exception when foreign_key_violation then perform pg_temp.check('credential reference enforces tenant and connector',true); end;
 set constraints connectors_secret_ref_fkey deferred;
 select * into v_begin from public.m11_begin_connector_test_atomic(v_org,v_conn,v_actor,2,v_test_key,repeat('d',64),'test-key',v_epoch);
 perform pg_temp.check('test reserves durable running command',v_begin.outcome='started'); v_cmd:=(v_begin.command->>'id')::uuid;
 select * into v_result from public.m11_begin_connector_test_atomic(v_org,v_conn,v_actor,2,gen_random_uuid(),repeat('e',64),'test-key',v_epoch);
 perform pg_temp.check('only one test can run per connector',v_result.outcome='in_progress');
 v_scope:='{"status":"not_applicable","policyVersion":"reference-v1","grantedScopes":[],"missingScopes":[],"excessScopes":[]}'::jsonb;
 v_test:=jsonb_build_object('outcome','success','errorCode',null,'latencyMs',10,'scope',v_scope);
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_cmd,v_actor,v_epoch,2,1,v_test||'{"message":"secret-canary"}'::jsonb);
 perform pg_temp.check('provider payload cannot enter result ledger',v_result.outcome='invalid_request');
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_cmd,v_actor,v_epoch,2,1,v_test);
 perform pg_temp.check('successful test atomically binds health to connection revision',v_result.outcome='tested' and (select last_test_connection_revision=2 from public.connectors where id=v_conn));
 v_completed_cmd:=v_cmd;
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_cmd,v_actor,v_epoch,2,1,v_test);
 perform pg_temp.check('duplicate finalized test replays',v_result.outcome='replayed');
 select * into v_begin from public.m11_begin_connector_test_atomic(v_org,v_conn,v_actor,2,gen_random_uuid(),repeat('f',64),'test-key',v_epoch);
 v_cmd:=(v_begin.command->>'id')::uuid;
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'disconnect',2,gen_random_uuid(),repeat('0',64),'test-key',v_epoch,'{"reason":"secret-canary"}');
 perform pg_temp.check('disconnect invalidates running test and current health',v_result.outcome='updated' and (select last_test_connection_revision is null and not enabled from public.connectors where id=v_conn));
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_cmd,v_actor,v_epoch,2,1,v_test);
 perform pg_temp.check('late test cannot resurrect disconnected health',v_result.outcome='interrupted');
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'replace_secret',1,v_key,repeat('a',64),'test-key',v_epoch,v_payload);
 perform pg_temp.check('completed retry returns its recorded successful connector projection',(v_result.connector->>'version')::integer=2);
 select * into v_result from public.m11_begin_connector_test_atomic(v_org,v_conn,v_actor,2,v_test_key,repeat('d',64),'test-key',v_epoch);
 perform pg_temp.check('completed test reservation replay preserves original connector response',v_result.outcome='replayed' and (v_result.connector->>'version')::integer=2);
 update public.connector_commands set deadline_at=clock_timestamp()-interval '1 second' where id=v_completed_cmd;
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_completed_cmd,v_actor,v_epoch,2,1,v_test);
 perform pg_temp.check('completed test replay survives elapsed deadline without overwriting current health',v_result.outcome='replayed' and (v_result.connector->>'version')::integer=2 and (select not enabled and last_test_connection_revision is null from public.connectors where id=v_conn));
 select * into v_result from public.m11_begin_connector_test_atomic(v_org,v_conn,v_actor,3,gen_random_uuid(),repeat('1',64),'test-key',v_epoch);
 perform pg_temp.check('disconnected connection allows a safe reconnect preflight',v_result.outcome='started');
 v_cmd:=(v_result.command->>'id')::uuid;
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_cmd,v_actor,v_epoch,3,1,v_test);
 perform pg_temp.check('preflight records fresh health without enabling connection',v_result.outcome='tested' and (select not enabled from public.connectors where id=v_conn));
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'reconnect',3,gen_random_uuid(),repeat('2',64),'test-key',v_epoch,'{}');
 perform pg_temp.check('reconnect carries the validated preflight into the enabled revision',v_result.outcome='updated' and (select enabled and last_test_connection_revision=connection_revision from public.connectors where id=v_conn));
 select * into v_begin from public.m11_begin_connector_test_atomic(v_org,v_conn,v_actor,4,gen_random_uuid(),repeat('3',64),'test-key',v_epoch);
 v_cmd:=(v_begin.command->>'id')::uuid;
 update public.connector_commands set deadline_at=clock_timestamp()-interval '1 second' where id=v_cmd;
 select * into v_result from public.m11_finalize_connector_test_atomic(v_org,v_cmd,v_actor,v_epoch,4,1,v_test);
 perform pg_temp.check('restart/timeout abandons test safely',v_result.outcome='interrupted');
 select * into v_result from public.m11_rewrap_connector_secret_atomic(v_org,v_conn,v_secret,'wrong-key',replace(v_payload->>'ciphertext',chr(10),''),jsonb_build_object('keyId','new-key','ciphertext',v_payload->>'ciphertext','nonce',v_payload->>'nonce','authTag',v_payload->>'authTag'));
 perform pg_temp.check('rotation compares old envelope identity',v_result.outcome='conflict');
 select * into v_result from public.m11_rewrap_connector_secret_atomic(v_org,v_conn,v_secret,'test-key',replace(v_payload->>'ciphertext',chr(10),''),jsonb_build_object('keyId','new-key','ciphertext',v_payload->>'ciphertext','nonce',v_payload->>'nonce','authTag',v_payload->>'authTag'));
 perform pg_temp.check('rotation changes key without connection revision',v_result.outcome='updated' and (select connection_revision=4 and credential_revision=1 from public.connectors where id=v_conn));
 perform pg_temp.check('retirement readiness retains old fingerprint keys after ciphertext rotation',(public.m11_connector_key_references(v_org)->'envelopeKeyReferences'->>'new-key')::integer=1 and (public.m11_connector_key_references(v_org)->'commandKeyReferences'->>'test-key')::integer>0 and not(public.m11_connector_key_references(v_org)->>'hasMoreKeys')::boolean);
 perform pg_temp.check('maintenance list is scoped and canonical base64',jsonb_array_length(public.m11_list_connector_secret_envelopes(v_other_org,null,100))=0
 and public.m11_list_connector_secret_envelopes(v_org,null,100)::text not like '%'||chr(10)||'%');
 select * into v_run from public.m11_begin_sync_run_atomic(v_org,v_conn,v_actor,v_epoch,'incremental',gen_random_uuid(),gen_random_uuid());
 v_run_id:=(v_run.run->>'id')::uuid;
 perform pg_temp.check('sync run starts with recorded revisions',v_run.outcome='queued' and (select connection_revision=4 and credential_revision=1 from public.sync_runs where id=v_run_id));
 select * into v_result from public.claim_sync_run(v_org,'m11-fixture-worker',30);
 perform pg_temp.check('claimed internal run exposes original actor and revision basis',v_result.outcome='claimed' and v_result.run->>'actorId'=v_actor::text and (v_result.run->>'connectionRevision')::integer=4);
 select * into v_result from public.save_sync_run_plan_atomic(v_org,v_run_id,'m11-fixture-worker','fixture-cursor',repeat('5',64),'[]','[]');
 perform pg_temp.check('valid dry-run plan remains reviewable',v_result.outcome='saved');
 select * into v_result from public.m11_request_sync_run_commit_atomic(v_org,v_run_id,v_admin,v_epoch,0);
 perform pg_temp.check('approval records the actual approving actor',(select commit_actor_user_id=v_admin from public.sync_runs where id=v_run_id));
 select * into v_result from public.claim_sync_run(v_org,'m11-fixture-worker',30);
 perform pg_temp.check('commit claim preserves approving actor',v_result.outcome='claimed' and v_result.run->>'commitActorId'=v_admin::text);
 update public.users set is_active=false where id=v_actor;
 select * into v_result from public.commit_sync_run_atomic(v_org,v_run_id,v_admin,repeat('5',64),gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('initiator deactivation after approval blocks an otherwise active approver',v_result.outcome='invalid_state');
 update public.users set is_active=true where id=v_actor;
 select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
 update public.sync_runs set status='waiting_for_review',work_kind='dry_run',lease_owner=null,lease_expires_at=null where id=v_run_id;
 perform public.m11_request_sync_run_commit_atomic(v_org,v_run_id,v_admin,v_epoch,0);
 perform public.claim_sync_run(v_org,'m11-fixture-worker',30);
 select * into v_result from public.commit_sync_run_atomic(v_org,v_run_id,v_actor,repeat('5',64),gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('worker cannot substitute owner for approving actor',v_result.outcome='invalid_state');
 select * into v_result from public.commit_sync_run_atomic(v_org,v_run_id,v_admin,repeat('5',64),gen_random_uuid(),gen_random_uuid());
 perform pg_temp.check('recorded approver can commit valid plan',v_result.outcome='completed');
 select * into v_run from public.m11_begin_sync_run_atomic(v_org,v_conn,v_actor,v_epoch,'incremental',gen_random_uuid(),gen_random_uuid());
 v_run_id:=(v_run.run->>'id')::uuid;
 insert into public.sync_run_plan_items(organization_id,sync_run_id,external_id,entity_type,proposed_action,field_diffs)
 select v_org,v_run_id,'large-plan-'||n::text,'product',case when n=201 then 'update' else 'unchanged' end,'{}'::jsonb from generate_series(1,201) n;
 perform pg_temp.check('required actions include records beyond first page',public.m11_sync_run_required_product_actions(v_org,v_run_id) @> '["update"]'::jsonb
 and public.m11_sync_run_required_product_actions(v_other_org,v_run_id)='[]'::jsonb);
 update public.organization_permissions_version set version=version+1 where organization_id=v_org;
 select * into v_result from public.claim_sync_run(v_org,'m11-fixture-worker',30);
 perform pg_temp.check('permission changes invalidate queued work',v_result.outcome='invalid_state' and (select status='canceled' from public.sync_runs where id=v_run_id));
 select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
 select * into v_result from public.m11_execute_connector_command_atomic(v_org,v_conn,v_actor,'revoke_secret',4,gen_random_uuid(),repeat('4',64),'test-key',v_epoch,'{"reason":"Revoke fixture"}');
 perform pg_temp.check('revoke clears ref and disables future work',v_result.outcome='updated' and (select secret_ref is null and not enabled and credential_revision=2 from public.connectors where id=v_conn)
 and (select revoked_at is not null from public.connector_secrets where id=v_secret));
 perform pg_temp.check('freeform reason canary never enters durable audit',not exists(select 1 from public.audit_logs where organization_id=v_org and changes::text like '%secret-canary%'));
 v_secret:=gen_random_uuid();
 insert into public.connector_secrets(id,organization_id,connector_id,ciphertext,rotated_by) values(v_secret,v_other_org,v_other_conn,decode('abcd','hex'),v_actor);
 update public.connectors set secret_ref=v_secret where organization_id=v_other_org and id=v_other_conn;
 perform pg_temp.check('legacy retirement refuses to orphan any configured credential',not public.m11_retire_legacy_connector_secret_rpc()
  and has_function_privilege('service_role','public.resolve_connector_secret(uuid,uuid,text)','execute')=v_legacy_resolver_grant
  and has_function_privilege('service_role','public.set_connector_secret_atomic(uuid,uuid,uuid,text,text)','execute')=v_legacy_writer_grant);
 perform pg_temp.check('key readiness exposes legacy dependencies without exposing envelopes',(public.m11_connector_key_references(v_other_org)->>'legacyEnvelopeCount')::integer=1);
end $$;
rollback;
