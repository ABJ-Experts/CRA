#!/usr/bin/env bash
set -euo pipefail
# Local CRA only. Fixtures are a new exact organization; no seed/site data is changed.
container_name="supabase_db_cra"
temporary_directory=$(mktemp -d)
classification_org_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
classification_product_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
classification_entity_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
classification_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
run_psql() { docker exec -i "$container_name" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local original_status=$?
  local cleanup_status=0
  run_psql -q -v fixture_org="$classification_org_id" <<'SQL' >/dev/null || cleanup_status=$?
delete from public.organizations where id=:'fixture_org'::uuid and slug='m2-classification-'||:'fixture_org';
SQL
  rm -rf "$temporary_directory"
  if [[ $cleanup_status -ne 0 ]]; then echo 'Classification concurrency fixture cleanup failed' >&2; exit "$cleanup_status"; fi
  exit "$original_status"
}
trap cleanup EXIT
run_psql -q -v fixture_org="$classification_org_id" -v fixture_product="$classification_product_id" -v fixture_entity="$classification_entity_id" <<'SQL'
insert into public.organizations(id,name,slug) values(:'fixture_org'::uuid,'M2 classification concurrency '||:'fixture_org','m2-classification-'||:'fixture_org');
insert into public.organization_members(organization_id,user_id,role)
select :'fixture_org'::uuid,id,'owner' from public.users where email='owner@cra.test';
insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)
select :'fixture_entity'::uuid,:'fixture_org'::uuid,'test','Classification concurrency fixture','needs_completion','inactive',id,id from public.users where email='owner@cra.test';
insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
select :'fixture_product'::uuid,:'fixture_org'::uuid,:'fixture_entity'::uuid,0,'{}','Classification concurrency fixture','TEST','standalone_software',id,id,id from public.users where email='owner@cra.test';
SQL
save_run() {
  local expected_revision=$1
  local command_key=$2
  run_psql -qAt -v fixture_org="$classification_org_id" -v fixture_product="$classification_product_id" -v expected_revision="$expected_revision" -v command_key="$command_key" <<'SQL'
begin;
set local statement_timeout='15s';
select outcome from public.save_product_classification_atomic(:'fixture_org'::uuid,
  (select id from public.users where email='owner@cra.test'),:'fixture_product'::uuid,0,:'expected_revision'::integer,
  public.m2_classification_policy(),public.m2_classification_policy()->>'hash',
  '{"scope":"in_scope","criticalCoreFunction":"yes","classIICoreFunction":null,"classICoreFunction":null}',
  'Concurrency test declaration',:'command_key'::uuid);
select pg_sleep(0.3);
commit;
SQL
}
save_run 0 "$(uuidgen | tr '[:upper:]' '[:lower:]')" > "$temporary_directory/first" & first_pid=$!
save_run 0 "$(uuidgen | tr '[:upper:]' '[:lower:]')" > "$temporary_directory/second" & second_pid=$!
wait "$first_pid"; wait "$second_pid"
results=$(cat "$temporary_directory/first" "$temporary_directory/second" | sed '/^$/d' | sort | tr '\n' ' ')
[[ "$results" == 'conflict saved ' ]] || { echo "Unexpected concurrent outcomes: $results" >&2; exit 1; }
echo 'PASS simultaneous revisions: one saved, one conflict'
save_run 1 "$classification_key" > "$temporary_directory/first" & first_pid=$!
save_run 1 "$classification_key" > "$temporary_directory/second" & second_pid=$!
wait "$first_pid"; wait "$second_pid"
results=$(cat "$temporary_directory/first" "$temporary_directory/second" | sed '/^$/d' | sort | tr '\n' ' ')
[[ "$results" == 'replayed saved ' ]] || { echo "Unexpected retry outcomes: $results" >&2; exit 1; }
echo 'PASS simultaneous exact retries: one saved, one replayed'
run_psql -qAt -v fixture_org="$classification_org_id" <<'SQL'
select set_config('m2_test.fixture_org',:'fixture_org',false) as ignored \gset
do $$ begin
  if (select count(*) from public.product_classification_runs where organization_id=current_setting('m2_test.fixture_org')::uuid)<>2 then raise exception 'Concurrent writes duplicated history'; end if;
end $$;
SQL
