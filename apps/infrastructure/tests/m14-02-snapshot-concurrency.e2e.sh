#!/usr/bin/env bash
set -euo pipefail
# PostgreSQL top-level transaction visibility proof, using only a fresh owned
# schema in the isolated synthetic clone. This does not disable source guards.
database="${M14_TRENDS_DATABASE:-cra_m14_benchmark}"
[[ "$database" == cra_m14_benchmark ]] || { echo 'Snapshot test requires isolated cra_m14_benchmark' >&2; exit 1; }
container=supabase_db_cra
owned_schema="m14_mvcc_$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
owned_dir="$(mktemp -d)"
writer_pid=""
query() { docker exec -i "$container" psql -X -q -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v schema="$owned_schema" "$@"; }
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$writer_pid" ]]; then wait "$writer_pid" || status=1; fi
  query <<'SQL' || status=1
select format('drop schema if exists %I cascade', :'schema') \gexec
SQL
  rm -rf "$owned_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
query <<'SQL'
do $$begin if current_database()<>'cra_m14_benchmark' then raise exception 'Synthetic clone only';end if;end$$;
select format('create schema %I', :'schema') \gexec
select format('create table %I.facts (sequence bigint generated always as identity, event_key text unique, recorded_transaction_id xid8 not null default pg_current_xact_id())', :'schema') \gexec
SQL
query > "$owned_dir/writer.log" 2>&1 <<'SQL' &
begin;
select format('insert into %I.facts(event_key)values(''top-level'')', :'schema') \gexec
savepoint child;
select format('insert into %I.facts(event_key)values(''subtransaction'')', :'schema') \gexec
release savepoint child;
\echo WRITER_READY
select pg_sleep(3);
commit;
SQL
writer_pid=$!
for attempt in {1..100}; do
  if rg -q WRITER_READY "$owned_dir/writer.log"; then break; fi
  if ! kill -0 "$writer_pid" 2>/dev/null; then cat "$owned_dir/writer.log"; exit 1; fi
  sleep .05
done
rg -q WRITER_READY "$owned_dir/writer.log" || { echo 'Writer handshake expired' >&2; exit 1; }
pinned_snapshot="$(query -Atc 'select pg_current_snapshot()')"
wait "$writer_pid"
writer_pid=""
query -v pin="$pinned_snapshot" <<'SQL'
select format('create temporary table visible_facts as select * from %I.facts', :'schema') \gexec
create temporary table replay_scope as select :'pin'::pg_snapshot pinned;
do $$begin
  if (select count(*)from visible_facts)<>2 then raise exception 'Writer did not commit';end if;
  if (select count(distinct recorded_transaction_id)from visible_facts)<>1 then raise exception 'Subtransaction did not record top-level xid';end if;
  if exists(select 1 from visible_facts,replay_scope where pg_visible_in_snapshot(recorded_transaction_id,pinned))then raise exception 'Late commit leaked into pinned snapshot';end if;
  if (select count(*)from visible_facts where pg_visible_in_snapshot(recorded_transaction_id,pg_current_snapshot()))<>2 then raise exception 'Fresh snapshot missed committed facts';end if;
end$$;
begin;
select format('insert into %I.facts(event_key)values(''rolled-back'')', :'schema') \gexec
rollback;
select format('insert into %I.facts(event_key)values(''top-level'')on conflict(event_key)do nothing', :'schema') \gexec
select format('create temporary table final_facts as select *from %I.facts', :'schema') \gexec
do $$begin if(select count(*)from final_facts)<>2 then raise exception 'Rollback or duplicate produced a fact';end if;end$$;
SQL
echo 'M14-02 late commit, fresh snapshot, top-level/subtransaction xid, rollback and duplicate proof PASS'
