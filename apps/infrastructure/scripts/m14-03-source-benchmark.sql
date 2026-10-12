-- Synthetic bounded-snapshot benchmark. Temporary tables only; transaction rolls back.
-- Does not measure native feature capture or production API latency.
begin;
set local statement_timeout='30s';
create temporary table m14_benchmark_source(id bigint primary key,tenant integer not null,name text,updated_at timestamptz) on commit drop;
insert into m14_benchmark_source select n,case when n%10=0 then 2 else 1 end,'Product '||n||' café Ω', '2026-10-09T00:00:00Z'::timestamptz from generate_series(1,1000000)n;
create index on m14_benchmark_source(tenant,id);
analyze m14_benchmark_source;
create temporary table m14_benchmark_frozen(ordinal bigint,values jsonb) on commit drop;
do $$ declare n integer;s timestamptz;t numeric;c integer;b bigint;begin
 foreach n in array array[10000,100000,1000000] loop
  truncate m14_benchmark_frozen;s:=clock_timestamp();
  insert into m14_benchmark_frozen select row_number()over(),jsonb_build_object('id',id,'name',name,'updatedAt',updated_at) from(select * from m14_benchmark_source where tenant=1 and id<=n order by id limit 100001)x;
  t:=extract(epoch from clock_timestamp()-s)*1000;select count(*),sum(octet_length(values::text))into c,b from m14_benchmark_frozen;
  raise notice 'source=% rows=% capture_ms=% payload_bytes=% limit_rejected=%',n,c,round(t),b,c>100000;
 end loop;
end $$;
rollback;
