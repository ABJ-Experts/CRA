#!/usr/bin/env bash
# Local CRA only. Creates one random tenant; cleanup removes exactly that fixture.
set -euo pipefail
container_name=supabase_db_cra
temporary_directory=$(mktemp -d)
fixture_org=$(uuidgen | tr '[:upper:]' '[:lower:]')
run_psql() { docker exec -i "$container_name" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local status=$?
  run_psql -v fixture_org="$fixture_org" <<'SQL' >/dev/null || status=1
begin;
delete from public.organizations where id=:'fixture_org'::uuid and slug='m1102-claims-'||:'fixture_org';
commit;
SQL
  rm -rf "$temporary_directory"
  exit "$status"
}
trap cleanup EXIT
run_psql -v fixture_org="$fixture_org" <<'SQL' >/dev/null
begin;
insert into public.organizations(id,name,slug) values(:'fixture_org'::uuid,'M1102 concurrent fixture','m1102-claims-'||:'fixture_org');
insert into public.organization_members(organization_id,user_id,role)
select :'fixture_org'::uuid,id,'owner' from public.users where email in ('owner@cra.test','admin@cra.test');
select outcome from public.m11_create_connector_atomic(:'fixture_org'::uuid,(select id from public.users where email='owner@cra.test'),
(select version from public.organization_permissions_version where organization_id=:'fixture_org'::uuid),gen_random_uuid(),'reference_conformance','Concurrent fixture','1.0.0','v1','{}','manual');
select outcome from public.m11_begin_sync_run_atomic(:'fixture_org'::uuid,(select id from public.connectors where organization_id=:'fixture_org'::uuid),
(select id from public.users where email='owner@cra.test'),(select version from public.organization_permissions_version where organization_id=:'fixture_org'::uuid),
'incremental',gen_random_uuid(),gen_random_uuid());
commit;
SQL
for generation in 1 2; do
  pids=()
  for request in $(seq 1 16); do
    run_psql -v fixture_org="$fixture_org" -v worker_id="claims-$generation-$request" <<'SQL' >"$temporary_directory/$request" 2>&1 &
select outcome from public.m1102_claim_sync_run(:'fixture_org'::uuid,:'worker_id',60);
SQL
    pids+=("$!")
  done
  failed=0
  for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
  [[ $failed == 0 ]] || { cat "$temporary_directory/"*; echo 'FAIL parallel claim execution'; exit 1; }
  claimed=0
  for request in $(seq 1 16); do
    result=$(cat "$temporary_directory/$request")
    case "$result" in claimed) claimed=$((claimed+1));; not_found) :;; *) echo "FAIL unexpected claim outcome $result"; exit 1;; esac
  done
  [[ $claimed == 1 ]] || { echo "FAIL generation $generation has $claimed winners"; exit 1; }
  actual=$(run_psql -v fixture_org="$fixture_org" <<'SQL'
select lease_generation from public.sync_runs where organization_id=:'fixture_org'::uuid;
SQL
)
  [[ $actual == "$generation" ]] || { echo 'FAIL generation fencing'; exit 1; }
  if [[ $generation == 1 ]]; then
    run_psql -v fixture_org="$fixture_org" <<'SQL' >/dev/null
update public.sync_runs set lease_expires_at=clock_timestamp()-interval '1 second' where organization_id=:'fixture_org'::uuid;
SQL
  fi
done
actual=$(run_psql -v fixture_org="$fixture_org" <<'SQL'
select count(*)||':'||count(*) filter(where outcome='interrupted')||':'||count(*) filter(where finished_at is null)
from public.sync_run_attempts where organization_id=:'fixture_org'::uuid;
SQL
)
[[ $actual == 2:1:1 ]] || { echo 'FAIL expired lease attempt history'; exit 1; }
late=$(run_psql -v fixture_org="$fixture_org" <<'SQL'
select outcome from public.m1102_fail_sync_run_atomic(:'fixture_org'::uuid,(select id from public.sync_runs where organization_id=:'fixture_org'::uuid),'claims-1-1',1,'timeout',true,null);
SQL
)
[[ $late == lease_lost ]] || { echo 'FAIL stale worker changed recovered run'; exit 1; }
# Revoke only the generated tenant membership, never the seeded user's identity.
run_psql -v fixture_org="$fixture_org" <<'SQL' >/dev/null
begin;
delete from public.organization_members where organization_id=:'fixture_org'::uuid and user_id=(select id from public.users where email='owner@cra.test');
update public.sync_runs set lease_expires_at=clock_timestamp()-interval '1 second' where organization_id=:'fixture_org'::uuid;
commit;
SQL
revoked=$(run_psql -v fixture_org="$fixture_org" <<'SQL'
select outcome from public.m1102_claim_sync_run(:'fixture_org'::uuid,'revoked-worker',60);
SQL
)
[[ $revoked == invalid_state ]] || { echo 'FAIL revoked tenant membership accepted'; exit 1; }
actual=$(run_psql -v fixture_org="$fixture_org" <<'SQL'
select status from public.sync_runs where organization_id=:'fixture_org'::uuid;
SQL
)
[[ $actual == canceled ]] || { echo 'FAIL revoked work was not stopped'; exit 1; }
echo 'PASS 32 parallel claims: one winner per generation; stale leases and revoked access fenced'
