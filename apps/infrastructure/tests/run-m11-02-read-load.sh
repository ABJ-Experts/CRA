#!/usr/bin/env bash
# Local CRA only. Seed/status/cleanup one correlation-scoped synthetic dataset.
# This never changes connector configuration, credentials, cursors or worker jobs.
# Seed intentionally persists until explicit cleanup after browser/API measurement.
set -euo pipefail
mode=${1:-status}
load_org=${CRA_M11_READ_LOAD_ORG_ID:-}
load_connector=${CRA_M11_READ_LOAD_CONNECTOR_ID:-}
load_batch=${CRA_M11_READ_LOAD_BATCH_ID:-}
uuid_pattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
[[ $load_org =~ $uuid_pattern && $load_connector =~ $uuid_pattern ]] || { echo 'Set valid fixture organization and connector UUIDs.' >&2; exit 1; }
case "$mode" in
  seed) [[ ${CRA_RUN_M11_READ_LOAD:-} == 1 ]] || { echo 'Set CRA_RUN_M11_READ_LOAD=1 for synthetic fixture writes.' >&2; exit 1; }; [[ -n $load_batch ]] || load_batch=$(uuidgen | tr '[:upper:]' '[:lower:]');;
  cleanup) [[ ${CRA_RUN_M11_READ_LOAD:-} == 1 ]] || { echo 'Set CRA_RUN_M11_READ_LOAD=1 for exact fixture cleanup.' >&2; exit 1; };;
  status) :;;
  *) echo 'Usage: run-m11-02-read-load.sh seed|status|cleanup' >&2; exit 1;;
esac
[[ $load_batch =~ $uuid_pattern ]] || { echo 'Set the exact fixture correlation UUID.' >&2; exit 1; }
run_psql() { docker exec -i supabase_db_cra psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -v load_org="$load_org" -v load_connector="$load_connector" -v load_batch="$load_batch"; }
if [[ $mode == seed ]]; then
  run_psql <<'SQL'
begin;
select set_config('cra.m11_load_org',:'load_org',true),set_config('cra.m11_load_connector',:'load_connector',true),set_config('cra.m11_load_batch',:'load_batch',true) \g /dev/null
do $$
declare v_org uuid:=current_setting('cra.m11_load_org')::uuid; v_connector uuid:=current_setting('cra.m11_load_connector')::uuid;
 v_batch uuid:=current_setting('cra.m11_load_batch')::uuid; v_actor uuid;
begin
 select c.created_by into v_actor from public.connectors c where c.organization_id=v_org and c.id=v_connector and c.archived_at is null;
 if not found then raise exception 'fixture_connector_not_found'; end if;
 if exists(select 1 from public.sync_runs where organization_id=v_org and connector_id=v_connector and correlation_id=v_batch) then raise exception 'load_batch_already_exists'; end if;
 insert into public.sync_runs(organization_id,connector_id,reconciliation_kind,work_kind,status,actor_kind,actor_user_id,trigger_idempotency_key,
 trigger_request_digest,commit_idempotency_key,commit_actor_user_id,commit_request_digest,adapter_version,mapping_version,correlation_id,row_count,processed_count,
 started_at,finished_at,created_at,committed_at,succeeded_count,failed_count,pending_count,error_code,lease_generation)
 select v_org,v_connector,'incremental',case when n<=500 then 'commit' else 'dry_run' end,case when n<=500 then 'completed' else 'failed' end,
 'user',v_actor,gen_random_uuid(),repeat('a',64),case when n<=500 then gen_random_uuid() end,case when n<=500 then v_actor end,
 case when n<=500 then repeat('b',64) end,c.adapter_version,c.mapping_version,v_batch,3,3,
 clock_timestamp()-make_interval(secs=>n+1),clock_timestamp()-make_interval(secs=>n),clock_timestamp()-make_interval(secs=>n+2),
 case when n<=500 then clock_timestamp()-make_interval(secs=>n) end,case when n<=500 then 3 else 0 end,
 case when n<=500 then 0 else 1 end,case when n<=500 then 0 else 2 end,case when n>500 then 'invalid_record' end,1
 from public.connectors c cross join generate_series(1,1000) n where c.organization_id=v_org and c.id=v_connector;
 insert into public.sync_run_plan_items(organization_id,sync_run_id,external_id,entity_type,proposed_action,field_diffs,issues,record_outcome,
 error_category,error_code,dead_lettered_at,applied_at)
 select v_org,r.id,'read-load-'||v_batch::text||'-'||r.id::text||'-'||n::text,'product','update','{}','[]',
 case when r.status='completed' then 'succeeded' when n=1 then 'failed' else 'withheld' end,
 case when r.status='failed' and n=1 then 'invalid_data' end,case when r.status='failed' and n=1 then 'invalid_record' end,
 case when r.status='failed' and n=1 then r.finished_at end,case when r.status='completed' then r.committed_at end
 from public.sync_runs r cross join generate_series(1,3) n where r.organization_id=v_org and r.connector_id=v_connector and r.correlation_id=v_batch;
 insert into public.sync_run_attempts(organization_id,sync_run_id,lease_generation,worker_id,phase,started_at,finished_at,outcome,error_category,error_code,affected_record_ids)
 select v_org,r.id,1,'m11-read-load-fixture',r.work_kind,r.started_at,r.finished_at,case when r.status='completed' then 'succeeded' else 'failed' end,
 case when r.status='failed' then 'invalid_data' end,case when r.status='failed' then 'invalid_record' end,
 coalesce((select array_agg(i.id) from public.sync_run_plan_items i where i.organization_id=v_org and i.sync_run_id=r.id and i.record_outcome='failed'),'{}'::uuid[])
 from public.sync_runs r where r.organization_id=v_org and r.connector_id=v_connector and r.correlation_id=v_batch;
end $$;
set constraints all immediate;
commit;
SQL
fi
if [[ $mode == cleanup ]]; then
  run_psql <<'SQL'
begin;
-- Remove only records identified by this generated batch, never connector/org data.
delete from public.sync_runs r where r.organization_id=:'load_org'::uuid and r.connector_id=:'load_connector'::uuid and r.correlation_id=:'load_batch'::uuid
 and exists(select 1 from public.sync_run_attempts a where a.organization_id=r.organization_id and a.sync_run_id=r.id and a.worker_id='m11-read-load-fixture')
 and not exists(select 1 from public.sync_run_plan_items i where i.organization_id=r.organization_id and i.sync_run_id=r.id
 and (i.external_id not like 'read-load-'||:'load_batch'||'-%' or i.source_snapshot is not null));
set constraints all immediate;
commit;
SQL
fi
run_psql <<'SQL'
select jsonb_build_object('organizationId',:'load_org','connectorId',:'load_connector','batchId',:'load_batch',
 'runs',(select count(*) from public.sync_runs where organization_id=:'load_org'::uuid and connector_id=:'load_connector'::uuid and correlation_id=:'load_batch'::uuid),
 'records',(select count(*) from public.sync_run_plan_items i join public.sync_runs r on r.organization_id=i.organization_id and r.id=i.sync_run_id where r.organization_id=:'load_org'::uuid and r.connector_id=:'load_connector'::uuid and r.correlation_id=:'load_batch'::uuid),
 'attempts',(select count(*) from public.sync_run_attempts a join public.sync_runs r on r.organization_id=a.organization_id and r.id=a.sync_run_id where r.organization_id=:'load_org'::uuid and r.connector_id=:'load_connector'::uuid and r.correlation_id=:'load_batch'::uuid),
 'deadLetters',(select count(*) from public.sync_run_plan_items i join public.sync_runs r on r.organization_id=i.organization_id and r.id=i.sync_run_id where r.organization_id=:'load_org'::uuid and r.connector_id=:'load_connector'::uuid and r.correlation_id=:'load_batch'::uuid and i.dead_lettered_at is not null and i.dead_letter_resolved_at is null),
 'detailRunId',(select id from public.sync_runs where organization_id=:'load_org'::uuid and connector_id=:'load_connector'::uuid and correlation_id=:'load_batch'::uuid and status='failed' order by id limit 1));
SQL
