#!/usr/bin/env bash
set -euo pipefail
# Run-specific, clearly synthetic finding in the isolated clone only. The
# append-only test facts are retained in that disposable clone: never disable
# immutability to clean up, and never run this against development.
database="${M14_TRENDS_DATABASE:-cra_m14_benchmark}"
[[ "$database" == cra_m14_benchmark ]] || { echo 'Facade concurrency requires isolated clone' >&2; exit 1; }
finding="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
owned_dir="$(mktemp -d)"
writer_pid=""
query() { docker exec -i supabase_db_cra psql -X -q -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v finding="$finding" "$@"; }
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$writer_pid" ]]; then wait "$writer_pid" || status=1; fi
  rm -rf "$owned_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
query <<'SQL'
begin;
do $$begin if current_database()<>'cra_m14_benchmark' then raise exception 'Synthetic clone only';end if;end$$;
insert into public.vulnerability_findings
select(jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',:'finding'::uuid,'component_identity','synthetic-concurrent-'||:'finding','first_detected_at',clock_timestamp()-interval'1 hour'))).*
from public.vulnerability_findings f where id='00000000-0000-4000-8000-0000000000d5';
commit;
SQL
query > "$owned_dir/writer.log" 2>&1 <<'SQL' &
begin;
savepoint child;
insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance)
select organization_id,product_id,release_id,finding_id,'observation',sequence,payload||jsonb_build_object('triagedAt',clock_timestamp()),'synthetic_concurrency'
from public.vulnerability_finding_lifecycle_facts where finding_id=:'finding'::uuid order by sequence desc limit 1;
release savepoint child;
\echo WRITER_READY
select pg_sleep(4);
commit;
SQL
writer_pid=$!
for attempt in {1..100}; do
  if rg -q WRITER_READY "$owned_dir/writer.log"; then break; fi
  if ! kill -0 "$writer_pid" 2>/dev/null; then cat "$owned_dir/writer.log"; exit 1; fi
  sleep .05
done
rg -q WRITER_READY "$owned_dir/writer.log" || { echo 'Writer handshake expired' >&2; exit 1; }
# A second writer commits a higher sequence. The first pin's bound therefore
# includes the lower uncommitted sequence; MVCC visibility must exclude it.
query <<'SQL'
insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance)
select organization_id,product_id,release_id,finding_id,'observation',sequence,payload,'synthetic_concurrency_watermark'
from public.vulnerability_finding_lifecycle_facts where finding_id='00000000-0000-4000-8000-0000000000d5'order by sequence desc limit 1;
SQL
query <<'SQL'
create temporary table request_scope as select
 '00000000-0000-4000-8000-0000000000ca'::uuid org,
 '00000000-0000-4000-8000-0000000000cb'::uuid actor,
 jsonb_build_object('from',current_date::text,'to',current_date::text,'timezone','UTC','bucket','day','productId','00000000-0000-4000-8000-0000000000cd')filters;
create temporary table original_dataset as select public.get_dashboard_trends(org,actor,filters,null)j from request_scope;
do $$begin if(select j->>'outcome'from original_dataset)<>'found'then raise exception 'Initial facade failed';end if;end$$;
select pg_sleep(5);
create temporary table replay_dataset as select public.get_dashboard_trends(org,actor,filters,(select j->'snapshot'from original_dataset))j from request_scope;
create temporary table fresh_dataset as select public.get_dashboard_trends(org,actor,filters,null)j from request_scope;
do $$declare prior jsonb; replay jsonb;fresh jsonb;a bigint;b bigint;begin
 select j into prior from original_dataset;select j into replay from replay_dataset;select j into fresh from fresh_dataset;
 if ((prior->'result')-'generatedAt')is distinct from((replay->'result')-'generatedAt')then raise exception 'Late commit changed pinned facade';end if;
 select coalesce(sum((p->>'sampleCount')::bigint),0)into a from jsonb_array_elements(prior#>'{result,series,triage,buckets}')p;
 select coalesce(sum((p->>'sampleCount')::bigint),0)into b from jsonb_array_elements(fresh#>'{result,series,triage,buckets}')p;
 if b<>a+1 then raise exception 'Fresh facade missed committed triage: before %,after %',a,b;end if;
end$$;
SQL
wait "$writer_pid"
writer_pid=""
echo "M14-02 pinned/fresh facade late-commit proof PASS (synthetic finding retained in clone: $finding)"
