#!/usr/bin/env bash
# Isolated two-session transaction races. Only this script's generated
# organization and connector fixtures are removed; no seed/user data is deleted.
set -euo pipefail
container_name="supabase_db_cra"
work_dir=$(mktemp -d)
fixture_org=""
psql_fixture() {
  docker exec -i "$container_name" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
}
cleanup() {
  if [[ -n "$fixture_org" ]]; then
    psql_fixture <<SQL >/dev/null
begin;
delete from public.connector_commands where organization_id='$fixture_org';
delete from public.sync_conflicts where organization_id='$fixture_org';
delete from public.sync_run_plan_items where organization_id='$fixture_org';
delete from public.sync_runs where organization_id='$fixture_org';
delete from public.sync_connector_cursors where organization_id='$fixture_org';
update public.connectors set secret_ref=null where organization_id='$fixture_org';
delete from public.connector_secrets where organization_id='$fixture_org';
delete from public.connectors where organization_id='$fixture_org';
delete from public.organizations where id='$fixture_org';
commit;
SQL
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT
fixture=$(psql_fixture <<'SQL'
begin;
select gen_random_uuid() as org_id,gen_random_uuid() as secret_id,gen_random_uuid() as second_secret_id \gset
select id as actor_id from public.users where email='owner@cra.test' \gset
insert into public.organizations(id,name,slug) values(:'org_id','M11 concurrency fixture','m11-race-'||:'org_id');
insert into public.organization_members(organization_id,user_id,role) values(:'org_id',:'actor_id','owner');
select version as epoch from public.organization_permissions_version where organization_id=:'org_id' \gset
select connector->>'id' as conn_id from public.m11_create_connector_atomic(:'org_id',:'actor_id',:'epoch',gen_random_uuid(),'reference_conformance','Race replacement','1.0.0','v1','{}','manual') \gset
select outcome as replaced from public.m11_execute_connector_command_atomic(:'org_id',:'conn_id',:'actor_id','replace_secret',1,gen_random_uuid(),repeat('a',64),'fixture-key',:'epoch',
 jsonb_build_object('format','aes-256-gcm-v1','secretId',:'secret_id','credentialRevision',1,'keyId','fixture-key','ciphertext','YWJj','nonce','AAAAAAAAAAAAAAAA','authTag','AAAAAAAAAAAAAAAAAAAAAA==')) \gset
select command->>'id' as command_id from public.m11_begin_connector_test_atomic(:'org_id',:'conn_id',:'actor_id',2,gen_random_uuid(),repeat('b',64),'fixture-key',:'epoch') \gset
select outcome as tested from public.m11_finalize_connector_test_atomic(:'org_id',:'command_id',:'actor_id',:'epoch',2,1,
 '{"outcome":"success","errorCode":null,"latencyMs":1,"scope":{"status":"not_applicable","policyVersion":"fixture-v1","grantedScopes":[],"missingScopes":[],"excessScopes":[]}}') \gset
select connector->>'id' as second_conn_id from public.m11_create_connector_atomic(:'org_id',:'actor_id',:'epoch',gen_random_uuid(),'reference_conformance','Race commit','1.0.0','v1','{}','manual') \gset
select outcome as replaced from public.m11_execute_connector_command_atomic(:'org_id',:'second_conn_id',:'actor_id','replace_secret',1,gen_random_uuid(),repeat('c',64),'fixture-key',:'epoch',
 jsonb_build_object('format','aes-256-gcm-v1','secretId',:'second_secret_id','credentialRevision',1,'keyId','fixture-key','ciphertext','YWJj','nonce','AAAAAAAAAAAAAAAA','authTag','AAAAAAAAAAAAAAAAAAAAAA==')) \gset
select command->>'id' as command_id from public.m11_begin_connector_test_atomic(:'org_id',:'second_conn_id',:'actor_id',2,gen_random_uuid(),repeat('d',64),'fixture-key',:'epoch') \gset
select outcome as tested from public.m11_finalize_connector_test_atomic(:'org_id',:'command_id',:'actor_id',:'epoch',2,1,
 '{"outcome":"success","errorCode":null,"latencyMs":1,"scope":{"status":"not_applicable","policyVersion":"fixture-v1","grantedScopes":[],"missingScopes":[],"excessScopes":[]}}') \gset
select run->>'id' as run_id from public.m11_begin_sync_run_atomic(:'org_id',:'second_conn_id',:'actor_id',:'epoch','incremental',gen_random_uuid(),gen_random_uuid()) \gset
select outcome as claimed from public.claim_sync_run(:'org_id','m11-race-worker',60) \gset
select outcome as saved from public.save_sync_run_plan_atomic(:'org_id',:'run_id','m11-race-worker','race-cursor',repeat('f',64),'[]','[]') \gset
select outcome as requested from public.m11_request_sync_run_commit_atomic(:'org_id',:'run_id',:'actor_id',:'epoch',0) \gset
select outcome as claimed from public.claim_sync_run(:'org_id','m11-race-worker',60) \gset
commit;
select :'org_id'||'|'||:'actor_id'||'|'||:'conn_id'||'|'||:'second_conn_id'||'|'||:'epoch'||'|'||:'run_id';
SQL
)
IFS='|' read -r fixture_org fixture_actor fixture_connector fixture_commit_connector fixture_epoch fixture_run <<< "$fixture"
[[ "$fixture_org" =~ ^[a-f0-9-]{36}$ ]] || { echo 'Invalid generated fixture identity' >&2; exit 1; }
wait_for_marker() {
  local marker="$1" present
  for attempt in $(seq 1 100); do
    present=$(psql_fixture <<SQL
select exists(select 1 from pg_locks where locktype='advisory' and classid=1101 and objid=$marker and granted);
SQL
)
    [[ "$present" == "t" ]] && return 0
    sleep 0.03
  done
  echo "Race session did not acquire marker $marker" >&2
  return 1
}
# Session A holds the connector row after replacing revision 1. Session B waits
# and must see a conflict instead of silently overwriting the new ciphertext.
psql_fixture >"$work_dir/replace-a" <<SQL &
begin;
select outcome from public.m11_execute_connector_command_atomic('$fixture_org','$fixture_connector','$fixture_actor','replace_secret',2,gen_random_uuid(),repeat('1',64),'fixture-key',$fixture_epoch,
 jsonb_build_object('format','aes-256-gcm-v1','secretId',gen_random_uuid(),'credentialRevision',2,'keyId','fixture-key','ciphertext','ZGVm','nonce','AAAAAAAAAAAAAAAA','authTag','AAAAAAAAAAAAAAAAAAAAAA=='));
select pg_advisory_xact_lock(1101,1);
select pg_sleep(3);
commit;
SQL
replace_a_pid=$!
wait_for_marker 1
psql_fixture >"$work_dir/replace-b" <<SQL &
select outcome from public.m11_execute_connector_command_atomic('$fixture_org','$fixture_connector','$fixture_actor','replace_secret',2,gen_random_uuid(),repeat('2',64),'fixture-key',$fixture_epoch,
 jsonb_build_object('format','aes-256-gcm-v1','secretId',gen_random_uuid(),'credentialRevision',2,'keyId','fixture-key','ciphertext','Z2hp','nonce','AAAAAAAAAAAAAAAA','authTag','AAAAAAAAAAAAAAAAAAAAAA=='));
SQL
replace_b_pid=$!
wait "$replace_a_pid"; wait "$replace_b_pid"
[[ $(head -1 "$work_dir/replace-a") == updated && $(head -1 "$work_dir/replace-b") == conflict ]]
echo 'ok concurrent replacement produces one winner and one optimistic conflict'
command_id=$(psql_fixture <<SQL
select command->>'id' from public.m11_begin_connector_test_atomic('$fixture_org','$fixture_connector','$fixture_actor',3,gen_random_uuid(),repeat('3',64),'fixture-key',$fixture_epoch);
SQL
)
# A disconnect commits before a blocked late provider response can finalize.
psql_fixture >"$work_dir/disconnect" <<SQL &
begin;
select outcome from public.m11_execute_connector_command_atomic('$fixture_org','$fixture_connector','$fixture_actor','disconnect',3,gen_random_uuid(),repeat('4',64),'fixture-key',$fixture_epoch,'{}');
select pg_advisory_xact_lock(1101,2);
select pg_sleep(3);
commit;
SQL
disconnect_pid=$!
wait_for_marker 2
psql_fixture >"$work_dir/finalize" <<SQL &
select outcome from public.m11_finalize_connector_test_atomic('$fixture_org','$command_id','$fixture_actor',$fixture_epoch,3,2,
 '{"outcome":"success","errorCode":null,"latencyMs":1,"scope":{"status":"not_applicable","policyVersion":"fixture-v1","grantedScopes":[],"missingScopes":[],"excessScopes":[]}}');
SQL
finalize_pid=$!
wait "$disconnect_pid"; wait "$finalize_pid"
[[ $(head -1 "$work_dir/disconnect") == updated && $(head -1 "$work_dir/finalize") == interrupted ]]
echo 'ok disconnect prevents a concurrent late test from restoring health'
# A commit has already been claimed, but disconnect invalidates its recorded
# basis before the commit can obtain the connector fence. No cursor advances.
psql_fixture >"$work_dir/commit-disconnect" <<SQL &
begin;
select outcome from public.m11_execute_connector_command_atomic('$fixture_org','$fixture_commit_connector','$fixture_actor','disconnect',2,gen_random_uuid(),repeat('5',64),'fixture-key',$fixture_epoch,'{}');
select pg_advisory_xact_lock(1101,3);
select pg_sleep(3);
commit;
SQL
commit_disconnect_pid=$!
wait_for_marker 3
psql_fixture >"$work_dir/commit" <<SQL &
select outcome from public.commit_sync_run_atomic('$fixture_org','$fixture_run','$fixture_actor',repeat('f',64),gen_random_uuid(),gen_random_uuid());
SQL
commit_pid=$!
wait "$commit_disconnect_pid"; wait "$commit_pid"
[[ $(head -1 "$work_dir/commit") == invalid_state ]]
verified=$(psql_fixture <<SQL
select not c.enabled and c.last_test_connection_revision is null and cursors.cursor is null
from public.connectors c join public.sync_connector_cursors cursors on cursors.organization_id=c.organization_id and cursors.connector_id=c.id
where c.organization_id='$fixture_org' and c.id='$fixture_commit_connector';
SQL
)
[[ "$verified" == t ]]
echo 'ok disconnect fences an in-flight commit without deadlock or cursor advance'
