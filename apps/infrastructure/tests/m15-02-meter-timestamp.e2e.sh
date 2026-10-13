#!/usr/bin/env bash
# Actual migration replay, fresh-trigger creation and conflict rejection; rollback only.
set -euo pipefail
DB_CONTAINER="${M15_02_DB_CONTAINER:-supabase_db_cra}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TEST_SQL="$(mktemp)"
trap 'rm -f "$TEST_SQL"' EXIT
python3 - "$REPO_ROOT" "$TEST_SQL" <<'PYSQL'
from pathlib import Path
import sys
root=Path(sys.argv[1]); output=Path(sys.argv[2])
migration=(root/'apps/infrastructure/supabase/migrations/20261013123855_m15_02_meter_timestamp_maintenance.sql').read_text()
output.write_text('begin;\ndrop trigger organization_usage_meters_set_updated_at on public.organization_usage_meters;\n'+migration+migration+"""drop trigger organization_usage_meters_set_updated_at on public.organization_usage_meters;
create trigger organization_usage_meters_set_updated_at after update on public.organization_usage_meters for each row execute function public.set_updated_at();
do $test$
begin
 begin
 execute $migration$"""+migration+"""$migration$;
 raise exception 'Conflicting trigger accepted';
 exception when raise_exception then
  if SQLERRM <> 'Conflicting organization usage meter timestamp trigger' then raise; end if;
 end;
end $test$;
rollback;
""")
PYSQL
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$TEST_SQL"
printf '%s\n' 'M15-02 timestamp creation/replay/conflict passed; all changes rolled back.'
