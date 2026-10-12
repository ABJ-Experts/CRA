#!/usr/bin/env bash
set -euo pipefail
database="${M14_PORTFOLIO_DATABASE:-cra_m14_05_benchmark}"
[[ "$database" == cra_m14_05_benchmark || "$database" == cra_m14_benchmark ]] || { echo 'Portfolio benchmark requires an isolated clone' >&2; exit 1; }
samples="${M14_PORTFOLIO_SAMPLES:-20}"
scale="${M14_PORTFOLIO_COMPONENTS:-}"
mode="${M14_PORTFOLIO_MODE:-rollback}"
[[ "$samples" =~ ^[1-9][0-9]{0,2}$ ]] && (( samples >= 2 && samples <= 500 )) || { echo 'Samples must be 2..500' >&2; exit 1; }
[[ -z "$scale" || "$scale" == 10000 || "$scale" == 100000 || "$scale" == 1000000 ]] || { echo 'Components must be 10000,100000,1000000' >&2; exit 1; }
[[ "$mode" == rollback || "$mode" == committed ]] || { echo 'Mode must be rollback or committed' >&2; exit 1; }
[[ "$mode" != committed || -n "$scale" ]] || { echo 'Committed mode requires one explicit scale' >&2; exit 1; }
committed=false
[[ "$mode" != committed ]] || committed=true
scales=(10000 100000 1000000)
[[ -z "$scale" ]] || scales=("$scale")
script_dir="$(cd "$(dirname "$0")" && pwd)"
for scale in "${scales[@]}"; do
  echo "M14-05 isolated benchmark: $scale components / 1000 products, $samples samples, $mode"
  docker exec -e PGAPPNAME=m14_05_portfolio_benchmark -i supabase_db_cra psql -X -q -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v components="$scale" -v samples="$samples" -v committed="$committed" < "$script_dir/m14-05-benchmark-fixture.sql"
done
