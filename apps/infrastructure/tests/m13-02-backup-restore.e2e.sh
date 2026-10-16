#!/usr/bin/env bash
set -euo pipefail
# Restore exclusively into a new disposable database; never reset development.
audit_restore_database="${M13_TEST_DATABASE:?Set a fresh m13_test_* database name}"
[[ "$audit_restore_database" =~ ^m13_test_[a-z0-9_]+$ ]] || { echo 'Refusing a non-test database' >&2; exit 1; }
audit_container="supabase_db_cra"
if [[ $(docker exec "$audit_container" psql -U postgres -d postgres -At -c "select count(*) from pg_database where datname='$audit_restore_database'") != 0 ]]; then
  echo 'Refusing to overwrite an existing database' >&2
  exit 1
fi
docker exec "$audit_container" createdb -U postgres "$audit_restore_database"
docker exec "$audit_container" psql -U supabase_admin -d "$audit_restore_database" -v ON_ERROR_STOP=1 -q -c "drop schema public cascade"
# Pipe the archive directly: no dump containing application data is persisted.
# The audit verification restore only needs tenant data and pgcrypto helpers;
# Supabase-managed schemas such as realtime carry owner/SU settings that are
# not needed for ledger verification. Preserve owners and ACLs using the local
# deployment administrator; no-owner/no-acl would invalidate ledger guards.
docker exec "$audit_container" pg_dump -U postgres -d postgres -Fc -n auth -n public -n extensions \
  | docker exec -i "$audit_container" pg_restore -U supabase_admin -d "$audit_restore_database" --exit-on-error
docker exec "$audit_container" psql -U supabase_admin -d "$audit_restore_database" -v ON_ERROR_STOP=1 -q -c "create extension if not exists pgcrypto with schema extensions"
audit_source=$(docker exec "$audit_container" psql -U postgres -d postgres -At -c "select count(*)||':'||coalesce(encode(extensions.digest(convert_to(string_agg(canonical_content||content_hash,E'\\n' order by organization_id,chain_sequence),'UTF8'),'sha256'),'hex'),'empty') from public.audit_logs where chain_sequence is not null")
audit_restored=$(docker exec "$audit_container" psql -U postgres -d "$audit_restore_database" -At -c "select count(*)||':'||coalesce(encode(extensions.digest(convert_to(string_agg(canonical_content||content_hash,E'\\n' order by organization_id,chain_sequence),'UTF8'),'sha256'),'hex'),'empty') from public.audit_logs where chain_sequence is not null")
[[ "$audit_source" == "$audit_restored" ]] || { echo 'Restored canonical bytes differ' >&2; exit 1; }
docker exec -i "$audit_container" psql -U postgres -d "$audit_restore_database" -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
 if exists(select 1 from public.audit_logs a where chain_sequence is not null
  and (canonical_content is distinct from public.m13_02_canonical_content(a,chain_sequence)
   or content_hash is distinct from encode(extensions.digest(decode(previous_hash,'hex')||convert_to(canonical_content,'UTF8'),'sha256'),'hex'))) then
  raise exception 'restored canonical/hash mismatch';
 end if;
 if exists(select 1 from (select chain_sequence,previous_hash,
  row_number() over(partition by organization_id order by chain_sequence) expected_sequence,
  lag(content_hash,1,repeat('0',64)) over(partition by organization_id order by chain_sequence) expected_previous
  from public.audit_logs where chain_sequence is not null) x
  where chain_sequence<>expected_sequence or previous_hash<>expected_previous) then
  raise exception 'restored sequence/link mismatch';
 end if;
 perform public.m13_02_audit_chain_snapshot(organization_id) from public.audit_chain_heads;
end $$;
SQL
echo "PASS: isolated restore preserves canonical bytes, links, sequences and heads ($audit_restore_database)"
# Leave the database for concurrency/load validation. The parent removes only
# this explicitly named disposable database after all evidence is recorded.
