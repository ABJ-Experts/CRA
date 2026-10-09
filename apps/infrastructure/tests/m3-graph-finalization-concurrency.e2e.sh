#!/usr/bin/env bash
set -euo pipefail
container_name="supabase_db_cra"
fixture_org=$(uuidgen | tr '[:upper:]' '[:lower:]')
run_directory=$(mktemp -d)
run_psql() { docker exec -i "$container_name" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local original_status=$?
  local cleanup_status=0
  run_psql -q -v fixture_org="$fixture_org" <<'SQL' >/dev/null || cleanup_status=$?
delete from public.organizations where id=:'fixture_org'::uuid and slug='m3-graph-'||:'fixture_org';
SQL
  rm -rf "$run_directory"
  if [[ $cleanup_status -ne 0 ]]; then echo 'Graph concurrency fixture cleanup failed' >&2; exit "$cleanup_status"; fi
  exit "$original_status"
}
trap cleanup EXIT
{
  cat <<'SQL'
begin;
select set_config('m3_test.fixture_org',:'fixture_org',false) as ignored \gset
insert into public.organizations(id,name,slug) values(:'fixture_org'::uuid,'M3 graph concurrency '||:'fixture_org','m3-graph-'||:'fixture_org');
SQL
  cat tests/m3-graph-concurrency-fixture.sql
  echo 'commit;'
} | run_psql -q -v fixture_org="$fixture_org"
run_psql -q -v fixture_org="$fixture_org" <<'SQL' > "$run_directory/finalize" 2>&1 &
begin;
set local role service_role;
set local statement_timeout='15s';
select set_config('application_name','m3-graph-'||:'fixture_org',true);
select outcome from public.finalize_sbom_document_normalization_atomic(:'fixture_org'::uuid,
 (select ingest_job_id from public.sbom_documents where organization_id=:'fixture_org'::uuid),
 'normalizer-replay-worker-one',(select id from public.sbom_documents where organization_id=:'fixture_org'::uuid));
select pg_sleep(2);
commit;
SQL
finalize_pid=$!
# Wait for finalization to hold its document lock, not a guessed sleep alone.
for attempt in $(seq 1 60); do
  sleeping=$(run_psql -qAt -v fixture_org="$fixture_org" <<'SQL'
select exists(select 1 from pg_stat_activity where application_name='m3-graph-'||:'fixture_org' and query='select pg_sleep(2);' and state='active');
SQL
)
  [[ "$sleeping" == 't' ]] && break
  sleep 0.05
done
[[ "$sleeping" == 't' ]] || { echo 'Finalizer never reached its commit boundary' >&2; exit 1; }
set +e
run_psql -q -v fixture_org="$fixture_org" <<'SQL' > "$run_directory/mutation" 2>&1
\set VERBOSITY verbose
begin;
set local role service_role;
set local statement_timeout='15s';
update public.sbom_components set normalized_name='concurrent-tamper' where organization_id=:'fixture_org'::uuid;
commit;
SQL
mutation_status=$?
set -e
wait "$finalize_pid"
[[ "$mutation_status" -ne 0 ]] && grep -q '55000' "$run_directory/mutation" || { cat "$run_directory/mutation"; echo 'Concurrent mutation was not rejected'; exit 1; }
grep -q 'completed' "$run_directory/finalize"
run_psql -qAt -v fixture_org="$fixture_org" <<'SQL' | grep -qx t
select state='completed' and not exists(select 1 from public.sbom_components c where c.document_id=d.id and c.normalized_name='concurrent-tamper') from public.sbom_documents d where organization_id=:'fixture_org'::uuid;
SQL
echo 'PASS finalization commit blocks a simultaneous service-role graph edit; exact tenant purge cleanup succeeds'
