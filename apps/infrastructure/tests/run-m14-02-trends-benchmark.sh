#!/usr/bin/env bash
set -euo pipefail
database="${M14_TRENDS_DATABASE:-cra_m14_benchmark}"
[[ "$database" == cra_m14_benchmark ]] || { echo 'Trends benchmark requires isolated cra_m14_benchmark' >&2; exit 1; }
samples="${M14_TRENDS_SAMPLES:-200}"
facts="${M14_TRENDS_FACTS:-}"
cohorts="${M14_TRENDS_COHORTS:-1000}"
[[ "$cohorts" =~ ^[1-9][0-9]{0,5}$ ]] && (( cohorts >= 1000 && cohorts <= 100000 )) || { echo 'Cohorts must be 1000..100000' >&2; exit 1; }
mode="${M14_TRENDS_MODE:-rollback}"
skip_timing="${M14_TRENDS_SKIP_SQL_TIMING:-false}"
[[ "$skip_timing" == true || "$skip_timing" == false ]] || { echo "Skip timing flag must be true or false" >&2; exit 1; }
vacuum="${M14_TRENDS_VACUUM_BEFORE_TIMING:-false}"
[[ "$vacuum" == true || "$vacuum" == false ]] || { echo "Vacuum flag must be true or false" >&2; exit 1; }
hold_seconds="${M14_TRENDS_HOLD_SECONDS:-0}"
[[ "$mode" == rollback || "$mode" == committed ]] || { echo 'Mode must be rollback or committed' >&2; exit 1; }
[[ "$hold_seconds" =~ ^(0|[1-9][0-9]{0,2})$ ]] && (( hold_seconds <= 600 )) || { echo 'Hold must be 0..600 seconds' >&2; exit 1; }
[[ "$vacuum" == false || "$mode" == committed ]] || { echo "Vacuum timing requires committed synthetic clone history" >&2; exit 1; }
[[ "$skip_timing" == false || "$mode" == committed ]] || { echo "Skip timing requires retained committed synthetic clone history" >&2; exit 1; }
committed=false
[[ "$mode" != committed ]] || committed=true
if [[ "$mode" == committed && -z "$facts" ]]; then echo 'Committed mode requires one explicit fact scale' >&2; exit 1; fi
[[ "$samples" =~ ^[1-9][0-9]{0,2}$ ]] && (( samples >= 2 && samples <= 500 )) || { echo 'Samples must be 2..500' >&2; exit 1; }
[[ -z "$facts" || "$facts" == 10000 || "$facts" == 100000 || "$facts" == 1000000 ]] || { echo 'Facts must be 10000,100000,1000000' >&2; exit 1; }
scales=(10000 100000 1000000)
[[ -z "$facts" ]] || scales=("$facts")
script_dir="$(cd "$(dirname "$0")" && pwd)"
run_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
for scale in "${scales[@]}"; do
  (( cohorts <= scale )) || { echo 'Cohorts cannot exceed facts' >&2; exit 1; }
  echo "M14-02 SQL benchmark: $scale facts, $cohorts cohorts, $samples samples; $mode; run $run_id"
  docker exec -e PGAPPNAME="m14_trends_${run_id}_${scale}" -i supabase_db_cra psql -X -q -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v facts="$scale" -v samples="$samples" -v cohorts="$cohorts" -v committed="$committed" -v vacuum="$vacuum" -v skip_timing="$skip_timing" -v hold_seconds="$hold_seconds" < "$script_dir/m14-02-trends-benchmark.fixture.sql"
done
