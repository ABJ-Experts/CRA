#!/usr/bin/env bash
# Reproduce a role writer that already owns the tenant audit lock. Both real
# connections roll back, including role version bumps and snapshot receipts.
set -euo pipefail
container_name="supabase_db_cra"
organization_id="00000000-0000-4000-8000-0000000000ca"
actor_id=$(docker exec "$container_name" psql -U postgres -d postgres -Atc "select user_id from public.organization_members where organization_id='$organization_id' and role='owner' limit 1")
[[ "$actor_id" =~ ^[a-f0-9-]{36}$ ]]
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
source_name="m13_permission_writer_$$"
search_name="m13_permission_search_$$"
retained_fingerprint() {
 docker exec "$container_name" psql -U postgres -d postgres -Atc "select md5((select to_jsonb(v)::text from public.organization_permissions_version v where organization_id='$organization_id')||(select to_jsonb(m)::text from public.organization_members m where organization_id='$organization_id' and user_id='$actor_id'));"
}
before_hash=$(retained_fingerprint)
cat > "$fixture_dir/source.sql" <<SQL
begin;
set local application_name='$source_name';
set local statement_timeout='10s';
select pg_advisory_xact_lock(public.m13_02_audit_lock_key('$organization_id'));
select pg_sleep(2);
-- The existing RBAC trigger bumps organization_permissions_version even when
-- assigning the existing role; the enclosing rollback preserves current grants.
update public.organization_members set role=role where organization_id='$organization_id' and user_id='$actor_id';
rollback;
SQL
cat > "$fixture_dir/search.sql" <<SQL
begin;
set local application_name='$search_name';
set local statement_timeout='10s';
select public.m13_03_create_snapshot('$organization_id','$actor_id',gen_random_uuid(),repeat('a',64),repeat('b',64))->>'receiptId';
rollback;
SQL
docker exec -i "$container_name" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -f - < "$fixture_dir/source.sql" > "$fixture_dir/source.log" 2>&1 &
source_pid=$!
writer_ready=0
for _ in {1..40}; do
 if [[ $(docker exec "$container_name" psql -U postgres -d postgres -Atc "select count(*) from pg_stat_activity where application_name='$source_name' and wait_event='PgSleep'") == 1 ]]; then writer_ready=1; break; fi
 sleep 0.05
done
[[ "$writer_ready" == 1 ]]
docker exec -i "$container_name" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -f - < "$fixture_dir/search.sql" > "$fixture_dir/search.log" 2>&1 &
search_pid=$!
source_status=0; search_status=0
wait "$source_pid" || source_status=$?
wait "$search_pid" || search_status=$?
after_hash=$(retained_fingerprint)
[[ "$before_hash" == "$after_hash" ]]
if [[ "$source_status" != 0 || "$search_status" != 0 ]]; then
 rg 'ERROR:|DETAIL:|CONTEXT:.*m13_03|deadlock detected' "$fixture_dir/source.log" "$fixture_dir/search.log" >&2 || true
 exit 1
fi
printf 'PASS: snapshot and role writer finish without deadlock; permission state preserved\n'
