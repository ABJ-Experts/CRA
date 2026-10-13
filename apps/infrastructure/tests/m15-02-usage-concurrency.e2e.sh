#!/usr/bin/env bash
# Run after root has applied the additive candidate. All mutations roll back.
set -euo pipefail
DB_CONTAINER="${M15_02_DB_CONTAINER:-supabase_db_cra}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LOCK_LOG="$(mktemp)"
RESULT_LOG="$(mktemp)"
CANDIDATE_SQL="$(mktemp)"
trap 'rm -f "$LOCK_LOG" "$RESULT_LOG" "$CANDIDATE_SQL"' EXIT
sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
# Session A holds the incumbent tenant lock. B must respond busy without waiting.
sql -At > "$LOCK_LOG" <<'SQL' &
begin;
select public.m15_01_lock('00000000-0000-4000-8000-0000000000ca');
select 'LOCK_READY';
select pg_sleep(4);
rollback;
SQL
LOCK_PID=$!
for attempt in {1..40}; do
 if rg -q 'LOCK_READY' "$LOCK_LOG"; then break;fi
 sleep 0.1
done
rg -q 'LOCK_READY' "$LOCK_LOG"
printf '%s\n' 'begin;' > "$CANDIDATE_SQL"
if [[ "${M15_02_VALIDATE_CANDIDATE:-0}" == "1" ]]; then
 python3 - "$REPO_ROOT" "$CANDIDATE_SQL" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]);output=Path(sys.argv[2])
with output.open('a') as handle:
 for migration in sorted((root/'apps/infrastructure/supabase/migrations').glob('*m15_02*.sql')):
  handle.write(migration.read_text().replace('select public.m15_02_rebuild_meter(id,true) from public.organizations order by id;','-- Initial backfill omitted only for rollback busy-path proof.'))
  handle.write('\n')
PY
fi
cat >> "$CANDIDATE_SQL" <<'SQL'
set local statement_timeout='2s';
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;r jsonb;outcome text;
begin
 select id into a from public.users where email='owner@cra.test';
 select public.m15_02_reconcile_usage(o,a,0,0,gen_random_uuid(),repeat('a',64))->>'outcome' into outcome;
 if outcome<>'busy' then raise exception 'expected busy, got %',outcome;end if;
end $$;
select 'M15-02 concurrent tenant repair returned busy';
rollback;
SQL
sql -At < "$CANDIDATE_SQL" > "$RESULT_LOG"
wait "$LOCK_PID"
rg -q 'M15-02 concurrent tenant repair returned busy' "$RESULT_LOG"
printf '%s\n' 'M15-02 concurrent tenant repair passed; both sessions rolled back.'
