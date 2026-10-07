#!/usr/bin/env bash
# Local-only bounded synthetic workload. All fixture rows/read receipts roll
# back; table statistics are refreshed again against retained data afterward.
set -euo pipefail
container_name="supabase_db_cra"
load_rows="${1:-10000}"
[[ "$load_rows" =~ ^[0-9]+$ && "$load_rows" -ge 1 && "$load_rows" -le 100000 ]]
fixture_sql=$(mktemp)
trap 'rm -f "$fixture_sql"' EXIT
cat > "$fixture_sql" <<'SQL'
begin;
set local statement_timeout='120s';
SQL
printf "insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) select '00000000-0000-4000-8000-0000000000ca','audit.load.fixture','organization','00000000-0000-4000-8000-0000000000ca',jsonb_build_object('count',i) from generate_series(1,%s) i;\n" "$load_rows" >> "$fixture_sql"
cat >> "$fixture_sql" <<'SQL'
set constraints m13_02_finalize_audit_chain immediate;
analyze public.audit_logs;
create temporary table audit_read_timings(ms double precision,append_ms double precision,page_ms double precision) on commit drop;
do $$ declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_user uuid; v_filters jsonb; v_digest text; v_snapshot jsonb; v_start timestamptz; v_after_append timestamptz; v_rows jsonb; v_types text[]; i integer; begin
 select user_id into strict v_user from public.organization_members where organization_id=v_org and role='owner' limit 1;
 select array_agg(distinct entity_type) into v_types from public.audit_logs where organization_id=v_org;
 v_filters:=jsonb_build_object('from',to_char((clock_timestamp()-interval '365 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'to',to_char((clock_timestamp()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(v_filters),'UTF8'),'sha256'),'hex');
 v_snapshot:=public.m13_03_create_snapshot(v_org,v_user,gen_random_uuid(),v_digest,repeat('b',64));
 for i in 1..100 loop
  v_start:=clock_timestamp();
  perform public.m13_03_record_access(v_org,v_user,gen_random_uuid(),'audit.search.page',(v_snapshot->>'receiptId')::uuid,repeat('c',64));
  v_after_append:=clock_timestamp();
  v_rows:=public.m13_03_read_page(v_org,v_user,(v_snapshot->>'receiptId')::uuid,v_digest,repeat('b',64),v_filters,v_types,null,null,null,50);
  if jsonb_array_length(v_rows)<>50 then raise exception 'load page unexpectedly incomplete'; end if;
  insert into audit_read_timings values(extract(epoch from clock_timestamp()-v_start)*1000,extract(epoch from v_after_append-v_start)*1000,extract(epoch from clock_timestamp()-v_after_append)*1000);
 end loop;
end $$;
select count(*) as samples,round(percentile_cont(0.95) within group(order by ms)::numeric,2) as p95_ms,round(percentile_cont(0.99) within group(order by ms)::numeric,2) as p99_ms,round(max(ms)::numeric,2) as max_ms,round(avg(append_ms)::numeric,2) as append_avg_ms,round(avg(page_ms)::numeric,2) as page_avg_ms from audit_read_timings;
rollback;
analyze public.audit_logs;
SQL
if ! docker exec -i "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$fixture_sql"; then
 docker exec "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'analyze public.audit_logs'
 exit 1
fi
