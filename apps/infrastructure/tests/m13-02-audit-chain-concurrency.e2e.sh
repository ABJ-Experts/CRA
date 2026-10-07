#!/usr/bin/env bash
set -euo pipefail
# Run only in a disposable restored CRA database. Append-only fixtures cannot be
# cleaned up in place; remove the disposable database after recording evidence.
container_name="supabase_db_cra"
audit_test_database="${M13_TEST_DATABASE:?Set M13_TEST_DATABASE to a disposable m13_test_* database}"
[[ "$audit_test_database" =~ ^m13_test_[a-z0-9_]+$ ]] || { echo 'Refusing a non-test database' >&2; exit 1; }
audit_fixture_org=$(uuidgen | tr '[:upper:]' '[:lower:]')
audit_second_org=$(uuidgen | tr '[:upper:]' '[:lower:]')
audit_test_output=$(mktemp -d)
trap 'rm -rf "$audit_test_output"' EXIT
run_psql() { docker exec -i "$container_name" psql -U postgres -d "$audit_test_database" -X -v ON_ERROR_STOP=1 "$@"; }
wait_for_log() {
 local audit_pid="$1"
 local audit_log="$2"
 if ! wait "$audit_pid"; then
  cat "$audit_log" >&2
  exit 1
 fi
}
run_psql -q -v org="$audit_fixture_org" -v second="$audit_second_org" <<'SQL'
insert into public.organizations(id,name,slug) values(:'org','M13 isolated concurrency','m13-chain-'||:'org'),(:'second','M13 isolated concurrency second','m13-chain-'||:'second');
SQL
append_batch() {
 run_psql -q -v org="$1" -v batch="$2" <<'SQL'
begin;
set local statement_timeout='20s';
insert into public.audit_logs(organization_id,action,changes)
select :'org'::uuid,'test.chain.concurrent',jsonb_build_object('batch',:'batch','counter',counter) from generate_series(1,10) counter;
commit;
SQL
}
audit_pids=()
for audit_index in $(seq 1 12); do
 append_batch "$audit_fixture_org" "$audit_index" >"$audit_test_output/$audit_index" 2>&1 & audit_pids+=("$!")
done
for audit_index in "${!audit_pids[@]}"; do
 wait_for_log "${audit_pids[$audit_index]}" "$audit_test_output/$((audit_index+1))"
done
run_psql -q -v org="$audit_fixture_org" <<'SQL'
select set_config('m13_test.org',:'org',false) \gset
do $$ declare v_org uuid:=current_setting('m13_test.org')::uuid; begin
 if (select count(*) from public.audit_logs where organization_id=v_org)<>120 then raise exception 'missing concurrent events'; end if;
 if (select last_sequence from public.audit_chain_heads where organization_id=v_org)<>120 then raise exception 'sequence gap'; end if;
 if exists(select 1 from(select chain_sequence,previous_hash,content_hash,canonical_content,lag(content_hash,1,repeat('0',64)) over(order by chain_sequence) expected_previous,row_number() over(order by chain_sequence) expected_sequence from public.audit_logs where organization_id=v_org) a where chain_sequence<>expected_sequence or previous_hash<>expected_previous or content_hash<>encode(extensions.digest(decode(previous_hash,'hex')||convert_to(canonical_content,'UTF8'),'sha256'),'hex')) then raise exception 'invalid concurrent chain'; end if;
end $$;
SQL
# Holding one tenant lock must not prevent the other tenant from committing.
run_psql -q -v org="$audit_fixture_org" <<'SQL' >"$audit_test_output/lock" 2>&1 &
begin;
select pg_advisory_xact_lock(public.m13_02_audit_lock_key(:'org'));
select pg_sleep(3);
rollback;
SQL
audit_lock_pid=$!
sleep 0.5
run_psql -q -v org="$audit_second_org" <<'SQL'
begin;
set local statement_timeout='1500ms';
insert into public.audit_logs(organization_id,action) values(:'org','test.chain.independent');
commit;
SQL
wait "$audit_lock_pid"
# Opposite input order in two multi-tenant transactions must not deadlock.
for audit_direction in forward reverse; do
 run_psql -q -v org="$audit_fixture_org" -v second="$audit_second_org" -v direction="$audit_direction" <<'SQL' >"$audit_test_output/$audit_direction" 2>&1 &
begin;
set local statement_timeout='10s';
insert into public.audit_logs(organization_id,action)
select org,'test.chain.mixed' from (values(:'org'::uuid),(:'second'::uuid)) x(org) order by case when :'direction'='forward' then org::text end asc,org desc;
commit;
SQL
 audit_pids+=("$!")
done
wait_for_log "${audit_pids[12]}" "$audit_test_output/forward"
wait_for_log "${audit_pids[13]}" "$audit_test_output/reverse"
echo 'PASS: 120 concurrent events form a contiguous valid chain; independent tenants and opposite-order mixed batches commit'
