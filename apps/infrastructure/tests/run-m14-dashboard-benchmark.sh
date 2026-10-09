#!/usr/bin/env bash
set -euo pipefail
container="supabase_db_cra"
script_dir="$(cd "$(dirname "$0")" && pwd)"
samples="${M14_BENCHMARK_SAMPLES:-20}"
database="${M14_BENCHMARK_DATABASE:-cra_m14_benchmark}"
mode="${M14_BENCHMARK_MODE:-rollback}"
hold_seconds="${M14_BENCHMARK_HOLD_SECONDS:-0}"
http_actor="${M14_BENCHMARK_HTTP_ACTOR_ID:-}"
source_groups="${M14_BENCHMARK_SOURCE_GROUPS:-1}"
selected_products="${M14_BENCHMARK_PRODUCTS:-}"
assessments="${M14_BENCHMARK_ASSESSMENTS:-0}"
suppressions="${M14_BENCHMARK_SUPPRESSIONS:-0}"
if [[ "$database" != cra_m14_benchmark ]]; then
  echo "Benchmark database must be an isolated cra_m14_benchmark database" >&2; exit 1
fi
recovery_run_id=""
if (( $# > 0 )); then
  if [[ $# != 2 || "$1" != --cleanup-run || ! "$2" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    echo "Expected --cleanup-run with the owned run UUID" >&2; exit 1
  fi
  recovery_run_id="$(printf '%s' "$2" | tr 'A-F' 'a-f')"
fi
if [[ -z "$recovery_run_id" ]]; then
for value in "$assessments" "$suppressions"; do
  if [[ ! "$value" =~ ^(0|[1-9][0-9]{0,4})$ ]] || (( value > 10000 )); then echo "Policy counts must be between 0 and 10000" >&2; exit 1; fi
done
insert_window="${M14_BENCHMARK_INSERT_WINDOW:-50000}"
# Canonical decimal strings avoid Bash octal interpretation and integer overflow.
for value in "$source_groups" "$samples" "$insert_window"; do
  if [[ ! "$value" =~ ^[1-9][0-9]{0,5}$ ]]; then echo "Benchmark integer is invalid" >&2; exit 1; fi
done
if [[ ! "$hold_seconds" =~ ^(0|[1-9][0-9]{0,2})$ ]]; then echo "Hold integer is invalid" >&2; exit 1; fi
if (( insert_window < 1 || insert_window > 100000 )); then echo "Insert window must be between 1 and 100000" >&2; exit 1; fi
if [[ -n "$selected_products" && "$selected_products" != 100 && "$selected_products" != 1000 && "$selected_products" != 10000 ]]; then echo "Products must be 100, 1000, or 10000" >&2; exit 1; fi
scales=(100 1000 10000)
if [[ -n "$selected_products" ]]; then scales=("$selected_products"); fi
if [[ ! "$source_groups" =~ ^[0-9]+$ ]] || (( source_groups < 1 || source_groups > 10000 )); then echo "Source groups must be between 1 and 10000" >&2; exit 1; fi
if [[ "$mode" != rollback && "$mode" != committed ]]; then echo "Benchmark mode must be rollback or committed" >&2; exit 1; fi
if [[ ! "$hold_seconds" =~ ^[0-9]+$ ]] || (( hold_seconds > 600 )); then echo "Hold must be between 0 and 600 seconds" >&2; exit 1; fi
if [[ -n "$http_actor" && ! "$http_actor" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then echo "HTTP actor must be UUID" >&2; exit 1; fi
committed=false
[[ "$mode" == committed ]] && committed=true
if [[ ! "$database" =~ ^cra_m14_benchmark$ ]]; then
  echo "Benchmark database must be an isolated cra_m14_benchmark database" >&2
  exit 1
fi
if [[ ! "$samples" =~ ^[0-9]+$ ]] || (( samples < 2 || samples > 100 )); then
  echo "M14_BENCHMARK_SAMPLES must be between 2 and 100" >&2
  exit 1
fi
fi
cleanup_run() {
  docker exec -i "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v run_id="$1" <<'SQL'
begin;
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception 'Cleanup requires isolated benchmark';end if;end$$;
create temporary table owned_products as select id from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'and internal_code='m14-bench-'||:'run_id'||'-'||id and name like 'M14 disposable benchmark %';
set local session_replication_role=replica;
delete from public.vulnerability_finding_assessments where organization_id='00000000-0000-4000-8000-0000000000ca'and finding_id in(select f.id from public.vulnerability_findings f join public.product_releases r on r.id=f.release_id and r.organization_id=f.organization_id join owned_products p on p.id=r.product_id where f.organization_id='00000000-0000-4000-8000-0000000000ca');
delete from public.vulnerability_finding_suppressions where organization_id='00000000-0000-4000-8000-0000000000ca'and finding_id in(select f.id from public.vulnerability_findings f join public.product_releases r on r.id=f.release_id and r.organization_id=f.organization_id join owned_products p on p.id=r.product_id where f.organization_id='00000000-0000-4000-8000-0000000000ca');
delete from public.vulnerability_findings where organization_id='00000000-0000-4000-8000-0000000000ca'and release_id in(select r.id from public.product_releases r join owned_products p on p.id=r.product_id where r.organization_id='00000000-0000-4000-8000-0000000000ca');
delete from public.product_releases where organization_id='00000000-0000-4000-8000-0000000000ca'and product_id in(select id from owned_products);
delete from public.products where organization_id='00000000-0000-4000-8000-0000000000ca'and id in(select id from owned_products);
create temporary table owned_vulnerabilities as select id from public.vulnerabilities where canonical_id='CVE-M14-BENCH-'||:'run_id'||'-'||id and title='Synthetic M14 benchmark advisory';
delete from public.vulnerability_enrichments where vulnerability_id in(select id from owned_vulnerabilities);
delete from public.vulnerability_affected_ranges where vulnerability_id in(select id from owned_vulnerabilities);
delete from public.vulnerability_source_record_versions where source_record_id in(select id from public.vulnerability_source_records where vulnerability_id in(select id from owned_vulnerabilities));
delete from public.vulnerability_source_records where vulnerability_id in(select id from owned_vulnerabilities);
delete from public.vulnerabilities where id in(select id from owned_vulnerabilities);
set local session_replication_role=origin;
commit;
SQL
}
cancel_run() {
  docker exec -i "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v run_id="$1" <<'SQL'
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception 'Cancellation requires isolated benchmark';end if;end$$;
select pg_cancel_backend(pid) from pg_stat_activity where datname=current_database()and application_name='m14-bench-'||:'run_id'and pid<>pg_backend_pid();
SQL
}
# Manual recovery after SIGKILL/container loss uses exactly the same run-owned deletes.
# Usage: bash run-m14-dashboard-benchmark.sh --cleanup-run <printed-run-UUID>
if [[ -n "$recovery_run_id" ]]; then
  cancel_run "$recovery_run_id"
  cleanup_run "$recovery_run_id"
  exit 0
fi
# Rollback-only prior runs leave dead synthetic tuples. Clean only this guarded
# disposable database so repeated scales do not measure fixture bloat.
docker exec -i "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
do $$begin if current_database()<>'cra_m14_benchmark' then raise exception 'Benchmark cleanup requires isolated database';end if;end$$;
vacuum(full,analyze) public.vulnerability_findings;
vacuum(full,analyze) public.products;
vacuum(full,analyze) public.product_releases;
SQL
if [[ -n "$http_actor" ]]; then
  docker exec -i "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v http_actor="$http_actor" <<'SQL'
begin;
do $$begin if current_database()<>'cra_m14_benchmark' or not exists(select 1 from public.organizations where id='00000000-0000-4000-8000-0000000000ca'and slug='m14-synthetic-disposable')then raise exception 'Synthetic HTTP principal requires isolated bootstrap';end if;end$$;
insert into public.users(id,email,first_name,last_name)values(:'http_actor'::uuid,'m14-http-benchmark-'||:'http_actor'||'@example.invalid','Synthetic','HTTP Principal')on conflict(id)do nothing;
insert into public.organization_members(organization_id,user_id,role)values('00000000-0000-4000-8000-0000000000ca',:'http_actor'::uuid,'owner')on conflict(organization_id,user_id)do nothing;
commit;
SQL
fi
# A committed fixture must not survive an interrupted owned runner. Cancel only
# this run's backend before scoped cleanup; SIGKILL still requires manual cleanup
# using the printed run UUID and the same guarded predicate.
active_run_id=""
cleanup_on_exit() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [[ "$mode" == committed && -n "$active_run_id" ]]; then
    if cancel_run "$active_run_id"; then :; else exit_status=1; fi
    cleanup_run "$active_run_id" || exit_status=1
  fi
  exit "$exit_status"
}
trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for products in "${scales[@]}"; do
  findings=$((products * 100))
  if (( assessments > findings || suppressions > findings )); then echo "Policy count exceeds finding count" >&2; exit 1; fi
  run_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  active_run_id="$run_id"
  echo "M14 benchmark run $run_id ($products products, $findings findings, $mode)"
  scale_hold=0
  if (( products == 10000 )) || [[ -n "$selected_products" ]]; then scale_hold="$hold_seconds"; fi
  if docker exec -i -e PGAPPNAME="m14-bench-$run_id" "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 \
    -v products="$products" -v findings="$findings" -v samples="$samples" -v source_groups="$source_groups" \
    -v assessments="$assessments" -v suppressions="$suppressions" -v insert_window="$insert_window" -v committed="$committed" -v hold_seconds="$scale_hold" -v benchmark_run_id="$run_id" \
    < "$script_dir/m14-dashboard-benchmark.fixture.sql"; then
    if [[ "$mode" == committed ]]; then cleanup_run "$run_id"; fi
    active_run_id=""
  else
    # EXIT cancels this owned backend and cleans this run after a failure.
    exit 1
  fi
done
