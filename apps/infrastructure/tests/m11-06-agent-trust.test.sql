\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;

select pg_temp.check('Agent tables use non-forced RLS',not exists(select 1 from pg_class
 where oid in ('public.connector_agents'::regclass,'public.connector_agent_nonces'::regclass,'public.connector_agent_batches'::regclass)
 and (not relrowsecurity or relforcerowsecurity)));
select pg_temp.check('Agent updated_at uses the shared trigger',exists(select 1 from pg_trigger
 where tgrelid='public.connector_agents'::regclass and not tgisinternal
 and tgfoid='public.set_updated_at'::regproc and tgtype & 2=2));
select pg_temp.check('Browser roles cannot read agent secrets',not has_table_privilege('authenticated','public.connector_agents','select')
 and not has_table_privilege('anon','public.connector_agents','select'));
select pg_temp.check('Service role cannot bypass atomic agent writes',not has_table_privilege('service_role','public.connector_agents','insert')
 and not has_table_privilege('service_role','public.connector_agent_nonces','insert')
 and not has_table_privilege('service_role','public.connector_agent_batches','insert'));
select pg_temp.check('Agent RPCs pin search path',not exists(select 1 from pg_proc
 where proname like 'm1106_%' and proconfig is distinct from array['search_path=public, pg_temp']));
select pg_temp.check('Malformed and null envelopes are rejected',not public.m1106_valid_envelope(null)
 and not public.m1106_valid_envelope('{}'::jsonb)
 and not public.m1106_valid_envelope('{"format":"aes-256-gcm-v1"}'::jsonb));

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_owner uuid; v_epoch bigint;
 v_connector uuid; v_agent uuid; v_issue uuid:=gen_random_uuid(); v_second uuid:=gen_random_uuid();
 v_batch uuid:=gen_random_uuid(); v_nonce text:=gen_random_uuid()::text; v_rotation uuid:=gen_random_uuid();
 v_env jsonb:='{"format":"aes-256-gcm-v1","keyId":"fixture","ciphertext":"YWJj","nonce":"AAAAAAAAAAAAAAAA","authTag":"AAAAAAAAAAAAAAAAAAAAAA=="}'::jsonb;
 v_cert text:='-----BEGIN CERTIFICATE-----'||repeat('A',70)||'-----END CERTIFICATE-----';
 v_result record; v_stage record; v_now timestamptz;
begin
 select id into v_owner from public.users where email='owner@cra.test';
 select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
 perform pg_temp.check('Seeded owner available',v_owner is not null and v_epoch is not null);
 select * into v_result from public.m11_create_connector_atomic(v_org,v_owner,v_epoch,gen_random_uuid(),
  'on_prem_agent','M11-06 rollback fixture','1.0.0','on-prem-agent-v1','{}'::jsonb,'manual');
 v_connector:=(v_result.connector->>'id')::uuid;
 perform pg_temp.check('Owner creates manual agent connector',v_result.outcome='created' and v_connector is not null);
 perform pg_temp.check('Pending enrollment is not reported as connected',
  (select not active_agent from public.m1106_agent_connection_summaries(v_org,array[v_connector])));
 select * into v_result from public.m11_create_connector_atomic(v_org,v_owner,v_epoch,gen_random_uuid(),
  'on_prem_agent','Rejected auto','1.0.0','on-prem-agent-v1','{}'::jsonb,'auto');
 perform pg_temp.check('Agent connector cannot auto commit',v_result.outcome='invalid_request');
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,v_issue,null,v_env);
 perform pg_temp.check('Null token hash is rejected',v_result.outcome='invalid_request');
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,v_issue,repeat('a',64),v_env);
 v_agent:=(v_result.agent->>'id')::uuid;
 perform pg_temp.check('Enrollment is scoped to connector and idempotency identity',v_result.outcome='issued' and v_agent=v_issue);
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,v_issue,repeat('b',64),v_env);
 perform pg_temp.check('Issue retry returns original encrypted token',v_result.outcome='replayed' and v_result.agent->>'enrollment_token_hash'=repeat('a',64));
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,v_second,repeat('b',64),v_env);
 perform pg_temp.check('Only one pending or active agent per connector',v_result.outcome='conflict');
 select * into v_result from public.m1106_redeem_agent_enrollment(repeat('a',64),null,'a1',repeat('c',64),v_cert,'key-1',v_env);
 perform pg_temp.check('Null CSR digest is rejected',v_result.outcome='invalid_request');
 select * into v_result from public.m1106_redeem_agent_enrollment(repeat('a',64),repeat('d',64),'a1',repeat('c',64),v_cert,'key-1',v_env);
 perform pg_temp.check('Enrollment consumes token into active identity',v_result.outcome='enrolled' and v_result.agent->>'status'='active');
 perform pg_temp.check('Active agent is reported as connected',
  (select active_agent from public.m1106_agent_connection_summaries(v_org,array[v_connector])));
 update public.connector_agents set current_expires_at=now()-interval '1 second' where id=v_agent;
 perform pg_temp.check('Expired certificate is reported disconnected',
  (select not active_agent from public.m1106_agent_connection_summaries(v_org,array[v_connector])));
 update public.connector_agents set current_expires_at=clock_timestamp()+interval '90 days' where id=v_agent;
 select * into v_result from public.m1106_record_agent_health(v_org,v_connector,v_agent,'1.0.0','["canonical_file"]'::jsonb,1,128,'backpressure');
 perform pg_temp.check('Backpressure is a safe explicit health state',v_result.outcome='accepted'
  and (select last_error_code='backpressure' from public.connector_agents where id=v_agent));
 select * into v_result from public.m1106_redeem_agent_enrollment(repeat('a',64),repeat('d',64),'a1',repeat('c',64),v_cert,'key-1',v_env);
 perform pg_temp.check('Lost same-CSR enrollment response replays',v_result.outcome='replayed');
 select * into v_result from public.m1106_redeem_agent_enrollment(repeat('a',64),repeat('e',64),'a2',repeat('f',64),v_cert,'key-2',v_env);
 perform pg_temp.check('Token cannot enroll a second CSR',v_result.outcome='token_consumed');
 select * into v_result from public.m1106_consume_agent_nonce(v_org,v_connector,v_agent,repeat('c',64),'key-1',v_nonce,clock_timestamp()+interval '3 minutes');
 perform pg_temp.check('Bound certificate and key accept a nonce',v_result.outcome='accepted');
 select * into v_result from public.m1106_consume_agent_nonce(v_org,v_connector,v_agent,repeat('c',64),'key-1',v_nonce,clock_timestamp()+interval '3 minutes');
 perform pg_temp.check('Duplicate nonce is atomically rejected',v_result.outcome='replay');
 select * into v_result from public.m1106_consume_agent_nonce(v_org,v_connector,v_agent,repeat('c',64),'wrong-key',gen_random_uuid()::text,clock_timestamp()+interval '3 minutes');
 perform pg_temp.check('Certificate and key pairing is enforced',v_result.outcome='key_expired');
 select * into v_result from public.m1106_consume_agent_nonce(gen_random_uuid(),v_connector,v_agent,repeat('c',64),'key-1',gen_random_uuid()::text,clock_timestamp()+interval '3 minutes');
 perform pg_temp.check('Tenant substitution fails',v_result.outcome='invalid_state');
 select * into v_result from public.m1106_rotate_agent_credential(v_org,v_connector,v_agent,v_rotation,repeat('e',64),
  'a2',repeat('f',64),v_cert,'key-2',v_env);
 perform pg_temp.check('Rotation retains previous credential for bounded overlap',v_result.outcome='rotated'
  and v_result.agent->>'previous_signing_key_id'='key-1');
 select * into v_result from public.m1106_rotate_agent_credential(v_org,v_connector,v_agent,v_rotation,repeat('e',64),
  'a2',repeat('f',64),v_cert,'key-2',v_env);
 perform pg_temp.check('Same rotation retry returns stored response',v_result.outcome='replayed');
 select * into v_result from public.m1106_rotate_agent_credential(v_org,v_connector,v_agent,gen_random_uuid(),repeat('e',64),
  'a3',repeat('e',64),v_cert,'key-3',v_env);
 perform pg_temp.check('Second rotation waits for overlap',v_result.outcome='rotation_in_progress');
 select * into v_result from public.m1106_record_agent_health(v_org,v_connector,v_agent,'1.0.0','["canonical_file"]'::jsonb,1,128,'rotation_in_progress');
 perform pg_temp.check('Rotation overlap is an explicit safe health state',v_result.outcome='accepted'
  and (select last_error_code='rotation_in_progress' from public.connector_agents where id=v_agent));
 select * into v_result from public.m1106_consume_agent_nonce(v_org,v_connector,v_agent,repeat('c',64),'key-1',gen_random_uuid()::text,clock_timestamp()+interval '3 minutes');
 perform pg_temp.check('Previous credential works only during overlap',v_result.outcome='accepted');
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,v_batch,1,'fixture',null,'file:1','[]'::jsonb,0,0);
 perform pg_temp.check('First durable batch is acknowledged',v_stage.outcome='accepted' and v_stage.accepted_at is not null);
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,v_batch,1,'fixture',null,'file:1','[]'::jsonb,0,0);
 perform pg_temp.check('Same batch replays durable ACK',v_stage.outcome='replayed');
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,v_batch,1,'fixture',null,'file:2','[]'::jsonb,0,0);
 perform pg_temp.check('Same batch ID cannot change cursor',v_stage.outcome='idempotency_conflict');
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,gen_random_uuid(),3,'fixture','file:1','file:3','[]'::jsonb,0,0);
 perform pg_temp.check('Sequence gap is rejected',v_stage.outcome='sequence_conflict');
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,gen_random_uuid(),2,'fixture','wrong','file:2','[]'::jsonb,0,0);
 perform pg_temp.check('Source checkpoint gap is rejected',v_stage.outcome='sequence_conflict');
 insert into public.connector_agent_batches(organization_id,connector_id,agent_id,batch_id,sequence,source_id,cursor_from,cursor_to,
  content_hash,records,record_count,payload_bytes)
 select v_org,v_connector,v_agent,gen_random_uuid(),n,'fixture',null,'fixture:'||n,
  repeat('a',64),'[]'::jsonb,0,2 from generate_series(100,1098) n;
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,v_batch,1,'fixture',null,'file:1','[]'::jsonb,0,0);
 perform pg_temp.check('Previously ACKed batch replays despite full staged queue',v_stage.outcome='replayed');
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,gen_random_uuid(),2,'fixture','file:1','file:2','[]'::jsonb,0,0);
 perform pg_temp.check('Staged quota backpressures before new ACK',v_stage.outcome='backpressure');
 update public.sync_connector_cursors set cursor='agent:1' where organization_id=v_org and connector_id=v_connector;
 perform pg_temp.check('Committed cursor marks exactly prior batch',
  (select status='committed' from public.connector_agent_batches where organization_id=v_org and connector_id=v_connector and sequence=1));
 select * into v_result from public.m1106_revoke_agent(v_org,v_connector,v_agent,v_owner,v_epoch,gen_random_uuid());
 perform pg_temp.check('Owner revocation disables connector in same transaction',v_result.outcome='revoked'
  and (select not enabled from public.connectors where organization_id=v_org and id=v_connector));
 perform pg_temp.check('Revoked agent is reported disconnected',
  (select not active_agent from public.m1106_agent_connection_summaries(v_org,array[v_connector])));
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,gen_random_uuid(),repeat('b',64),v_env);
 perform pg_temp.check('Revoked connector cannot reset acknowledged source sequence',v_result.outcome='replacement_requires_new_connector');
 select * into v_stage from public.m1106_stage_agent_batch(v_org,v_connector,v_agent,gen_random_uuid(),2,'fixture','file:1','file:2','[]'::jsonb,0,0);
 perform pg_temp.check('Revoked agent cannot stage work',v_stage.outcome='invalid_state');
 select * into v_result from public.m11_create_connector_atomic(v_org,v_owner,v_epoch,gen_random_uuid(),
  'on_prem_agent','Pending revocation fixture','1.0.0','on-prem-agent-v1','{}'::jsonb,'manual');
 v_connector:=(v_result.connector->>'id')::uuid;
 v_issue:=gen_random_uuid();
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,v_issue,repeat('6',64),v_env);
 v_agent:=(v_result.agent->>'id')::uuid;
 perform pg_temp.check('Pending identity can be issued before revocation',v_result.outcome='issued');
 select * into v_result from public.m1106_revoke_agent(v_org,v_connector,v_agent,v_owner,v_epoch,gen_random_uuid());
 perform pg_temp.check('Owner can revoke a pending identity',v_result.outcome='revoked');
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,v_issue,repeat('6',64),v_env);
 perform pg_temp.check('Revoked pending identity cannot replay enrollment',v_result.outcome='replacement_requires_new_connector');
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,gen_random_uuid(),repeat('7',64),v_env);
 perform pg_temp.check('Revoked pending identity cannot get a fresh token',v_result.outcome='replacement_requires_new_connector');
 select * into v_result from public.m11_create_connector_atomic(v_org,v_owner,v_epoch,gen_random_uuid(),
  'on_prem_agent','Expired token fixture','1.0.0','on-prem-agent-v1','{}'::jsonb,'manual');
 v_connector:=(v_result.connector->>'id')::uuid;
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,gen_random_uuid(),repeat('8',64),v_env);
 v_agent:=(v_result.agent->>'id')::uuid;
 update public.connector_agents set enrollment_expires_at=now()-interval '1 second' where id=v_agent;
 select * into v_result from public.m1106_issue_agent_enrollment(v_org,v_connector,v_owner,v_epoch,gen_random_uuid(),repeat('9',64),v_env);
 perform pg_temp.check('Naturally expired pending token can be reissued',v_result.outcome='issued');
end $$;
rollback;
