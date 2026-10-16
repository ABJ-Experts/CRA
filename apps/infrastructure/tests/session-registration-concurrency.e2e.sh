#!/usr/bin/env bash
# Local CRA only. Every command uses one seeded member and random session IDs;
# cleanup deletes only those exact session IDs, never other site/session data.
set -euo pipefail
container_name=supabase_db_cra
temporary_directory=$(mktemp -d)
sessions=()
run_psql() { docker exec -i "$container_name" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local status=$?
  for session_id in "${sessions[@]}"; do
    run_psql -v session_id="$session_id" <<'SQL' >/dev/null || status=1
delete from public.organization_session_bindings
where organization_id = '00000000-0000-4000-8000-0000000000ca'::uuid
  and session_id = :'session_id'::uuid;
SQL
  done
  rm -rf "$temporary_directory"
  exit "$status"
}
trap cleanup EXIT
for round in $(seq 1 16); do
  session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  sessions+=("$session_id")
  pids=()
  for request in $(seq 1 8); do
    run_psql -v session_id="$session_id" <<'SQL' >"$temporary_directory/$request" 2>&1 &
select outcome from public.register_organization_session_atomic(
  '00000000-0000-4000-8000-0000000000ca',
  (select id from public.users where email='owner@cra.test'),
  :'session_id'::uuid, '2026-09-28T00:00:00Z');
SQL
    pids+=("$!")
  done
  failed=0
  for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
  if [[ $failed -ne 0 ]]; then
    cat "$temporary_directory/"*
    echo "FAIL concurrent verified-session registration round $round" >&2
    exit 1
  fi
  for request in $(seq 1 8); do
    [[ $(cat "$temporary_directory/$request") == registered ]] || { echo 'FAIL registration result'; exit 1; }
  done
  count=$(run_psql -v session_id="$session_id" <<'SQL'
select count(*) from public.organization_session_bindings
where organization_id='00000000-0000-4000-8000-0000000000ca' and session_id=:'session_id'::uuid
and user_id=(select id from public.users where email='owner@cra.test');
SQL
)
  [[ $count == 1 ]] || { echo 'FAIL registration did not preserve a single owner binding'; exit 1; }
done
echo 'PASS 128 parallel registrations: all registered, one exact binding per session'
