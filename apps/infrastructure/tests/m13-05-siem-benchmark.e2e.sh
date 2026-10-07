#!/usr/bin/env bash
set -euo pipefail
# Own a schema-only scratch DB. Never tamper with or clone retained CRA rows.
container=supabase_db_cra
scratch="cra_siem_benchmark_$(date +%s)_$$"
schema_file=$(mktemp)
cleanup() { rm -f "$schema_file"; docker exec "$container" dropdb -U postgres --if-exists "$scratch" >/dev/null; }
trap cleanup EXIT
docker exec "$container" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges > "$schema_file"
docker exec "$container" createdb -U postgres "$scratch"
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 -q -f - < "$schema_file" >/dev/null
# Disabling triggers is restricted to this disposable synthetic database.
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 -q -f - <<'SQL'
alter table public.audit_logs disable trigger all;
alter table public.audit_chain_heads disable trigger all;
create table public.siem_benchmark_results(size integer,scan_ms numeric,batches integer,read_p95_ms numeric,read_p99_ms numeric,backpressure boolean);
do $$ declare n integer;o uuid;u uuid;d uuid;t timestamptz;elapsed numeric;b integer;j jsonb;reads numeric[];rt timestamptz;i integer;begin
 foreach n in array array[10000,100000,1000000] loop
  o:=gen_random_uuid();u:=gen_random_uuid();d:=gen_random_uuid();
  insert into public.organizations(id,name,slug) values(o,'Synthetic SIEM scale','siem-bench-'||o);
  insert into public.users(id,email) values(u,'siem-bench-'||u||'@cra.test');
  insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner');

  insert into public.audit_logs(organization_id,action,entity_type,entity_id,chain_sequence,chain_version,previous_hash,content_hash,canonical_content) select o,'organization.benchmark_excluded','organization',o::text,s,1,repeat('0',64),repeat('0',64),'{}' from generate_series(1,n) s;
  insert into public.audit_chain_heads(organization_id,legacy_count,last_sequence,last_event_id) select o,0,n,id from public.audit_logs where organization_id=o and chain_sequence=n on conflict(organization_id) do update set last_sequence=n,last_event_id=excluded.last_event_id;
  insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,authority_user_id,dataset_epoch,database_identity,state,credentials) select d,o,'Synthetic','https','json','https://collector.example.test',array['organization'],u,audit_dataset_epoch,public.m13_04_database_identity(),'enabled','{}'::jsonb from public.organizations where id=o;
  analyze public.audit_logs;analyze public.audit_chain_heads;analyze public.siem_destinations;
  -- Only this tenant is enabled while measuring the bounded real staging RPC.
  update public.siem_destinations set state='disabled' where id<>d;
  t:=clock_timestamp();b:=0;
  loop
   perform public.m13_05_siem_stage('benchmark');b:=b+1;
   exit when (select scan_sequence>=n from public.siem_destinations where id=d);
  end loop;
  elapsed:=extract(epoch from clock_timestamp()-t)*1000;
  reads:='{}';
  for i in 1..100 loop rt:=clock_timestamp();perform public.m13_05_siem_command(o,u,'read',gen_random_uuid(),null,d,'{}');reads:=array_append(reads,extract(epoch from clock_timestamp()-rt)*1000);end loop;
  raise notice 'Completed % events, % ms, % batches',n,elapsed,b;
  insert into public.siem_benchmark_results select n,elapsed,b,percentile_cont(0.95) within group(order by value),percentile_cont(0.99) within group(order by value),false from unnest(reads) value;
 end loop;
end $$;
select size,round(scan_ms,2) scan_ms,batches,round(read_p95_ms,2) read_p95_ms,round(read_p99_ms,2) read_p99_ms from public.siem_benchmark_results order by size;

create table public.siem_benchmark_queue_result(selected_count integer,stage_ms numeric,health_p95_ms numeric,health_p99_ms numeric,backpressure boolean,mixed_tenant_slots boolean,global_slots_bounded boolean);
create table public.siem_benchmark_fence_fixture(org_id uuid,user_id uuid,destination_id uuid,claim jsonb);
do $$ declare o uuid:=gen_random_uuid();u uuid:=gen_random_uuid();d uuid:=gen_random_uuid();o2 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();t timestamptz;stage_ms numeric;reads numeric[]:='{}';i integer;j jsonb;c1 jsonb;c2 jsonb;c3 jsonb;cap boolean;begin
 insert into public.organizations(id,name,slug) values(o,'Synthetic selected SIEM','siem-selected-'||o),(o2,'Synthetic second tenant','siem-second-'||o2);
 insert into public.users(id,email) values(u,'siem-selected-'||u||'@cra.test'),(u2,'siem-second-'||u2||'@cra.test');
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner'),(o2,u2,'owner');
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,chain_sequence,chain_version,previous_hash,content_hash,canonical_content) select o,'organization.created','organization',o::text,n,1,repeat('0',64),repeat('0',64),'{}' from generate_series(1,12001) n;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,chain_sequence,chain_version,previous_hash,content_hash,canonical_content) select o2,'organization.created','organization',o2::text,n,1,repeat('0',64),repeat('0',64),'{}' from generate_series(1,3) n;
 insert into public.audit_chain_heads(organization_id,legacy_count,last_sequence,last_event_id) select o,0,12001,id from public.audit_logs where organization_id=o and chain_sequence=12001;
 insert into public.audit_chain_heads(organization_id,legacy_count,last_sequence,last_event_id) select o2,0,3,id from public.audit_logs where organization_id=o2 and chain_sequence=3;
 update public.siem_destinations set state='disabled';
 insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,authority_user_id,dataset_epoch,database_identity,state,credentials,credential_id,credential_revision) select d,o,'Synthetic selected','https','json','https://collector.example.test',array['organization'],u,audit_dataset_epoch,public.m13_04_database_identity(),'enabled','{}',gen_random_uuid(),1 from public.organizations where id=o;
 t:=clock_timestamp();for i in 1..40 loop perform public.m13_05_siem_stage('queue-benchmark');end loop;stage_ms:=extract(epoch from clock_timestamp()-t)*1000;
 perform public.m13_05_siem_stage('queue-benchmark');cap:=(select scan_sequence=10000 and failure_code='backpressure' from public.siem_destinations where id=d);
 analyze public.siem_deliveries;
 for i in 1..20 loop t:=clock_timestamp();perform public.m13_05_siem_command(o,u,'read',gen_random_uuid(),null,d,'{}');reads:=array_append(reads,extract(epoch from clock_timestamp()-t)*1000);end loop;
 insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,authority_user_id,dataset_epoch,database_identity,state,credentials,credential_id,credential_revision) select d2,o2,'Synthetic second','https','json','https://collector.example.test',array['organization'],u2,audit_dataset_epoch,public.m13_04_database_identity(),'enabled','{}',gen_random_uuid(),1 from public.organizations where id=o2;
 update public.siem_destinations set scheduled_at='-infinity' where id=d2;perform public.m13_05_siem_stage('queue-benchmark');
 update public.siem_destinations set scheduled_at='-infinity' where id=d;c1:=public.m13_05_siem_claim('queue-benchmark');c2:=public.m13_05_siem_claim('queue-benchmark');c3:=public.m13_05_siem_claim('queue-benchmark');
 insert into public.siem_benchmark_queue_result select 10000,stage_ms,percentile_cont(0.95) within group(order by v),percentile_cont(0.99) within group(order by v),cap,c1->>'organizationId'<>c2->>'organizationId',c3 is null from unnest(reads) v;
 insert into public.siem_benchmark_fence_fixture values(o,u,d,c1);
end $$;
select selected_count,round(stage_ms,2) stage_ms,round(health_p95_ms,2) health_p95_ms,round(health_p99_ms,2) health_p99_ms,backpressure,mixed_tenant_slots,global_slots_bounded from public.siem_benchmark_queue_result;

SQL

# Two connections: lifecycle owns destination before a stale completion attempts its lease.
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 -q -f - <<'SQL' &
begin;
select 1 from public.siem_destinations where id=(select destination_id from public.siem_benchmark_fence_fixture) for update;
select pg_sleep(1);
select public.m13_05_siem_command(org_id,user_id,'disable',gen_random_uuid(),1,destination_id,'{}') is not null from public.siem_benchmark_fence_fixture;
commit;
SQL
fence_pid=$!
sleep 0.2
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 -q -f - <<'SQL'
do $$ declare f record;begin
 select * into f from public.siem_benchmark_fence_fixture;
 begin perform public.m13_05_siem_complete(f.org_id,(f.claim->>'deliveryId')::uuid,'queue-benchmark',(f.claim->>'leaseToken')::uuid,(f.claim->>'version')::integer,'{"state":"accepted","code":"delivered","durationMs":1}');raise exception 'stale completion accepted';exception when unique_violation then raise notice 'Two-connection disable fences stale completion';end;
end $$;
SQL
wait "$fence_pid"
