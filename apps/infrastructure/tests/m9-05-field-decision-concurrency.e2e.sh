#!/usr/bin/env bash
set -euo pipefail

# Live local-only race test. Both decisions run in explicit transactions that
# roll back, so neither the field nor audit history is changed by this test.
container_name=supabase_db_cra
temporary_directory=$(mktemp -d)
result_one="$temporary_directory/first-session"
result_two="$temporary_directory/second-session"
trap 'rm -f "$result_one" "$result_two"; rmdir "$temporary_directory"' EXIT

run_psql() {
  docker exec -i "$container_name" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

fixture=$(run_psql -F '|' <<'SQL'
select f.organization_id,f.id,s.id,q.id,q.product_id,q.version,s.updated_at,
  f.evidence_version_id,f.evidence_sha256,f.version
from public.supplier_document_fields f
join public.supplier_evidence_submissions s on s.organization_id=f.organization_id
  and s.id=f.submission_id and s.state='accepted'
join public.supplier_evidence_requests q on q.organization_id=s.organization_id and q.id=s.request_id
join public.evidence_documents d on d.organization_id=s.organization_id
  and d.id=s.evidence_document_id and d.current_version_id=f.evidence_version_id
where f.status='pending' and f.run_id is not null and f.confidence>=0.8
  and f.evidence_version_id=s.evidence_version_id and f.evidence_sha256=s.declared_sha256
  and exists(select 1 from public.supplier_evidence_submission_reviews r
    where r.organization_id=s.organization_id and r.submission_id=s.id and r.decision='accepted')
order by f.created_at limit 1;
SQL
)
[[ -n $fixture ]] || {
  echo 'Requires an accepted pending M9-05 AI field with confidence >= 0.8' >&2
  exit 1
}
IFS='|' read -r organization_id field_id submission_id request_id product_id request_version \
  submission_updated_at evidence_version_id evidence_sha256 field_version <<<"$fixture"
actor_id=$(run_psql -v organization_id="$organization_id" -v submission_id="$submission_id" <<'SQL'
select r.reviewer_user_id from public.supplier_evidence_submission_reviews r
where r.organization_id=:'organization_id'::uuid and r.submission_id=:'submission_id'::uuid
  and r.decision='accepted' limit 1;
SQL
)
idempotency_key=$(uuidgen | tr '[:upper:]' '[:lower:]')

decision_session() {
  local hold_seconds=$1
  run_psql -v organization_id="$organization_id" -v actor_id="$actor_id" \
    -v product_id="$product_id" -v request_id="$request_id" \
    -v submission_id="$submission_id" -v request_version="$request_version" \
    -v submission_updated_at="$submission_updated_at" \
    -v evidence_version_id="$evidence_version_id" -v evidence_sha256="$evidence_sha256" \
    -v field_id="$field_id" -v field_version="$field_version" \
    -v idempotency_key="$idempotency_key" -v hold_seconds="$hold_seconds" <<'SQL'
begin;
select 'first='||outcome from public.decide_supplier_document_field_atomic(
  :'organization_id'::uuid,:'actor_id'::uuid,:'product_id'::uuid,:'request_id'::uuid,
  :'submission_id'::uuid,:'request_version'::integer,:'submission_updated_at'::timestamptz,
  :'evidence_version_id'::uuid,:'evidence_sha256',:'field_id'::uuid,:'field_version'::integer,
  'confirmed','Concurrency test correction',:'idempotency_key'::uuid);
select 'state='||status||':'||coalesce(idempotency_key::text,'null')
  from public.supplier_document_fields where id=:'field_id'::uuid;
select 'retry='||outcome from public.decide_supplier_document_field_atomic(
  :'organization_id'::uuid,:'actor_id'::uuid,:'product_id'::uuid,:'request_id'::uuid,
  :'submission_id'::uuid,:'request_version'::integer,:'submission_updated_at'::timestamptz,
  :'evidence_version_id'::uuid,:'evidence_sha256',:'field_id'::uuid,:'field_version'::integer,
  'confirmed','Concurrency test correction',:'idempotency_key'::uuid);
select 'audit='||count(*) from public.audit_logs where organization_id=:'organization_id'::uuid
  and entity_type='supplier_document_field' and entity_id=:'field_id'
  and changes->>'idempotencyKey'=:'idempotency_key';
select pg_sleep(:'hold_seconds'::integer);
rollback;
SQL
}

decision_session 3 >"$result_one" &
first_pid=$!
for attempt in {1..100}; do
  if rg -q '^first=confirmed$' "$result_one"; then break; fi
  sleep 0.05
done
if ! rg -q '^first=confirmed$' "$result_one"; then
  wait "$first_pid" || true
  echo 'First decision did not reach the lock-holding state' >&2
  exit 1
fi

decision_session 0 >"$result_two" &
second_pid=$!
sleep 0.25
if ! kill -0 "$second_pid" 2>/dev/null; then
  echo 'Second decision unexpectedly finished before the first released its row lock' >&2
  exit 1
fi
wait "$first_pid"
wait "$second_pid"

for result in "$result_one" "$result_two"; do
  if ! rg -q '^first=confirmed$' "$result" || ! rg -q '^retry=replayed$' "$result" \
    || ! rg -q "^state=confirmed:$idempotency_key$" "$result" \
    || ! rg -q '^audit=1$' "$result"; then
    echo "Unexpected decision/retry result in $result" >&2
    sed -n '1,20p' "$result" >&2
    exit 1
  fi
done

post_state=$(run_psql -v organization_id="$organization_id" -v field_id="$field_id" \
  -v field_version="$field_version" <<'SQL'
select f.status||':'||f.version||':'||(
  select count(*) from public.audit_logs a where a.organization_id=f.organization_id
    and a.entity_type='supplier_document_field' and a.entity_id=f.id::text
    and a.changes->>'idempotencyKey' is not null)
from public.supplier_document_fields f
where f.organization_id=:'organization_id'::uuid and f.id=:'field_id'::uuid
  and f.version=:'field_version'::integer;
SQL
)
[[ $post_state == pending:"$field_version":0 ]] || {
  echo "Rollback left a changed field or audit row: $post_state" >&2
  exit 1
}

# Temporarily grant SELECT only inside a rolled-back transaction. A normal
# authenticated role still observes zero rows through non-forced RLS, whereas
# the service role can see the scoped tables. RPC grants remain service-only.
boundary=$(run_psql -v organization_id="$organization_id" <<'SQL'
begin;
select 'grant='||(
  not has_table_privilege('authenticated','public.supplier_document_fields','select')
  and not has_function_privilege('authenticated',
    'public.decide_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid)',
    'execute')
  and not has_function_privilege('service_role',
    'public.m9_05_decide_supplier_document_field_core(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid)',
    'execute')
  and not has_function_privilege('authenticated','public.m9_04_reminder_offsets_valid(integer[])','execute'));
grant select on public.supplier_document_fields,public.ai_inference_runs to authenticated;
set local role authenticated;
select 'rls='||(select count(*) from public.supplier_document_fields)::text||':'||
  (select count(*) from public.ai_inference_runs)::text;
reset role;
set local role service_role;
select 'service='||(select count(*)>0 from public.supplier_document_fields)::text;
update public.organization_settings set supplier_document_ai_provider='ollama_local'
  where organization_id=:'organization_id'::uuid;
select 'setting='||supplier_document_ai_provider from public.organization_settings
  where organization_id=:'organization_id'::uuid;
rollback;
SQL
)
rg -q '^grant=true$' <<<"$boundary" || { echo 'Direct RPC/table grants are too broad' >&2; exit 1; }
rg -q '^rls=0:0$' <<<"$boundary" || { echo 'Authenticated RLS read was not denied' >&2; exit 1; }
rg -q '^service=true$' <<<"$boundary" || { echo 'Service role could not read scoped rows' >&2; exit 1; }
rg -q '^setting=ollama_local$' <<<"$boundary" || { echo 'Service role could not configure local AI policy' >&2; exit 1; }
echo 'M9-05 two-session decision serialization, idempotent retry, RLS, grants and local AI setting: PASS (all writes rolled back)'
