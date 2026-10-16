#!/usr/bin/env bash
set -euo pipefail
container_name="supabase_db_cra"
fixture_group=$(uuidgen | tr '[:upper:]' '[:lower:]')
owner_member_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
admin_member_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
route_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
first_claim_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
second_claim_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
run_directory=$(mktemp -d)
run_psql() { docker exec -i "$container_name" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local original_status=$?
  local cleanup_status=0
  run_psql -q -v fixture_group="$fixture_group" -v owner_member_key="$owner_member_key" \
    -v admin_member_key="$admin_member_key" -v route_key="$route_key" \
    -v first_claim_key="$first_claim_key" -v second_claim_key="$second_claim_key" <<'SQL' >/dev/null || cleanup_status=$?
begin;
delete from public.workflow_task_routes where group_id=:'fixture_group'::uuid;
delete from public.workflow_task_group_members where group_id=:'fixture_group'::uuid;
delete from public.workflow_task_groups where id=:'fixture_group'::uuid and name='M12 claim fixture';
delete from public.workflow_task_commands where idempotency_key in
 (:'fixture_group'::uuid,:'owner_member_key'::uuid,:'admin_member_key'::uuid,
  :'route_key'::uuid,:'first_claim_key'::uuid,:'second_claim_key'::uuid);
delete from public.audit_logs where changes->>'idempotencyKey' in
 (:'fixture_group',:'owner_member_key',:'admin_member_key',
  :'route_key',:'first_claim_key',:'second_claim_key');
commit;
SQL
  rm -rf "$run_directory"
  if [[ $cleanup_status -ne 0 ]]; then echo 'M12 claim fixture cleanup failed' >&2; exit "$cleanup_status"; fi
  exit "$original_status"
}
trap cleanup EXIT
fixture_row=$(run_psql -qAt <<'SQL'
select f.organization_id||'|'||f.id||'|'||owner.id||'|'||admin.id
from public.vulnerability_findings f
join public.users owner on owner.email='owner@cra.test'
join public.users admin on admin.email='admin@cra.test'
where f.organization_id='00000000-0000-4000-8000-0000000000ca'
 and f.canonical_advisory_id='CVE-2026-99001'
 and f.status='active' and not exists(select 1 from public.workflow_task_routes r
  where r.organization_id=f.organization_id and r.task_type='finding_triage' and r.source_id=f.id)
limit 1;
SQL
)
[[ -n "$fixture_row" ]] || { echo 'No unused local seeded finding for claim fixture' >&2; exit 1; }
IFS='|' read -r fixture_org fixture_finding owner_id admin_id <<<"$fixture_row"
run_psql -q -v fixture_org="$fixture_org" -v fixture_finding="$fixture_finding" \
  -v owner_id="$owner_id" -v admin_id="$admin_id" -v fixture_group="$fixture_group" \
  -v owner_member_key="$owner_member_key" -v admin_member_key="$admin_member_key" \
  -v route_key="$route_key" <<'SQL'
begin;
select set_config('m12.org',:'fixture_org',true);
select set_config('m12.finding',:'fixture_finding',true);
select set_config('m12.owner',:'owner_id',true);
select set_config('m12.admin',:'admin_id',true);
select set_config('m12.group',:'fixture_group',true);
select set_config('m12.owner_member_key',:'owner_member_key',true);
select set_config('m12.admin_member_key',:'admin_member_key',true);
select set_config('m12.route_key',:'route_key',true);
do $do$
declare v_org uuid:=current_setting('m12.org')::uuid; v_finding uuid:=current_setting('m12.finding')::uuid;
 v_owner uuid:=current_setting('m12.owner')::uuid; v_admin uuid:=current_setting('m12.admin')::uuid;
 v_group uuid:=current_setting('m12.group')::uuid; v_result record; v_task jsonb;
begin
 select * into v_result from public.m1201_manage_group(v_org,v_owner,'create',null,'M12 claim fixture',null,null,v_group);
 if v_result.outcome<>'updated' then raise exception 'group setup: %',v_result.outcome; end if;
 select * into v_result from public.m1201_manage_group(v_org,v_owner,'add_member',v_group,null,v_owner,1,
  current_setting('m12.owner_member_key')::uuid);
 if v_result.outcome<>'updated' then raise exception 'owner member setup: %',v_result.outcome; end if;
 select * into v_result from public.m1201_manage_group(v_org,v_owner,'add_member',v_group,null,v_admin,2,
  current_setting('m12.admin_member_key')::uuid);
 if v_result.outcome<>'updated' then raise exception 'admin member setup: %',v_result.outcome; end if;
 select * into v_result from public.m1201_get_task(v_org,v_owner,'finding_triage',v_finding);
 v_task:=v_result.task;
 select * into v_result from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',null,v_group,
  (v_task->>'routeVersion')::bigint,v_task->>'sourceRevision',current_setting('m12.route_key')::uuid,null);
 if v_result.outcome<>'updated' then raise exception 'route setup: %',v_result.outcome; end if;
end $do$;
commit;
SQL
snapshot=$(run_psql -qAt -v fixture_org="$fixture_org" -v fixture_finding="$fixture_finding" -v owner_id="$owner_id" <<'SQL'
select (task->>'routeVersion')||'|'||(task->>'sourceRevision')
from public.m1201_get_task(:'fixture_org'::uuid,:'owner_id'::uuid,'finding_triage',:'fixture_finding'::uuid);
SQL
)
IFS='|' read -r route_version source_revision <<<"$snapshot"
[[ "$route_version" == "1" && -n "$source_revision" ]] || { echo 'Unexpected claim snapshot' >&2; exit 1; }
run_psql -qAt -v fixture_org="$fixture_org" -v fixture_finding="$fixture_finding" \
 -v owner_id="$owner_id" -v route_version="$route_version" -v source_revision="$source_revision" \
 -v first_claim_key="$first_claim_key" <<'SQL' >"$run_directory/first" 2>&1 &
begin;
select set_config('application_name','m12-claim-'||:'fixture_finding',true);
select outcome from public.m1201_route_task(:'fixture_org'::uuid,:'owner_id'::uuid,'finding_triage',
 :'fixture_finding'::uuid,'claim',null,null,:'route_version'::bigint,:'source_revision',:'first_claim_key'::uuid,null);
select pg_sleep(2);
commit;
SQL
first_pid=$!
sleeping=f
for attempt in $(seq 1 60); do
  sleeping=$(run_psql -qAt -v fixture_finding="$fixture_finding" <<'SQL'
select exists(select 1 from pg_stat_activity where application_name='m12-claim-'||:'fixture_finding'
 and query='select pg_sleep(2);' and state='active');
SQL
)
  [[ "$sleeping" == "t" ]] && break
  sleep 0.05
done
[[ "$sleeping" == "t" ]] || { echo 'First claimant did not reach commit boundary' >&2; exit 1; }
run_psql -qAt -v fixture_org="$fixture_org" -v fixture_finding="$fixture_finding" \
 -v admin_id="$admin_id" -v route_version="$route_version" -v source_revision="$source_revision" \
 -v second_claim_key="$second_claim_key" <<'SQL' >"$run_directory/second" 2>&1
select outcome from public.m1201_route_task(:'fixture_org'::uuid,:'admin_id'::uuid,'finding_triage',
 :'fixture_finding'::uuid,'claim',null,null,:'route_version'::bigint,:'source_revision',:'second_claim_key'::uuid,null);
SQL
wait "$first_pid"
grep -qx 'updated' "$run_directory/first" || { cat "$run_directory/first"; exit 1; }
grep -qx 'conflict' "$run_directory/second" || { cat "$run_directory/second"; exit 1; }
echo 'PASS two independent claim connections: one updated, one conflict; test-owned routing is cleaned up'
