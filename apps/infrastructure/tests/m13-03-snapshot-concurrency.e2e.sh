#!/usr/bin/env bash
# Two real connections exercise one durable request identity. Only test access
# receipts are appended; no source rows, site data or audit history are removed.
set -euo pipefail
container_name="supabase_db_cra"
organization_id="00000000-0000-4000-8000-0000000000ca"
request_id=$(docker exec "$container_name" psql -U postgres -d postgres -Atc 'select gen_random_uuid()')
actor_id=$(docker exec "$container_name" psql -U postgres -d postgres -Atc "select user_id from public.organization_members where organization_id='$organization_id' and role='owner' limit 1")
[[ "$request_id" =~ ^[a-f0-9-]{36}$ && "$actor_id" =~ ^[a-f0-9-]{36}$ ]]
receipt_files=$(mktemp -d)
trap 'rm -rf "$receipt_files"' EXIT
snapshot_sql="select public.m13_03_create_snapshot('$organization_id','$actor_id','$request_id',repeat('a',64),repeat('b',64))->>'receiptId';"
{
 printf 'begin;\n%s\nselect pg_sleep(1);\ncommit;\n' "$snapshot_sql"
} | docker exec -i "$container_name" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -f - > "$receipt_files/first" &
first_pid=$!
printf '%s\n' "$snapshot_sql" | docker exec -i "$container_name" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -f - > "$receipt_files/second" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
first_receipt=$(sed -n '/^[a-f0-9-]\{36\}$/p' "$receipt_files/first")
second_receipt=$(sed -n '/^[a-f0-9-]\{36\}$/p' "$receipt_files/second")
[[ "$first_receipt" == "$second_receipt" && "$first_receipt" =~ ^[a-f0-9-]{36}$ ]]
receipt_count=$(docker exec "$container_name" psql -U postgres -d postgres -Atc "select count(*) from public.audit_logs where organization_id='$organization_id' and event_key='audit.search:$request_id'")
[[ "$receipt_count" == "1" ]]
printf 'PASS: concurrent snapshot retries share one durable receipt\n'
