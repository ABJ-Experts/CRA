-- Rollback-only SQL metadata latency sample, not an HTTP concurrency benchmark.
-- Run as the local database postgres role after applying the M15-04 migration.
-- Requires one real, current verified-user auth session. Never disables guards,
-- changes existing users, creates storage objects, or rewrites persistent stats.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='180s';
set local lock_timeout='5s';

create temporary table diagnostic_load_context (
 tenant text primary key, organization_id uuid not null, actor_id uuid not null,
 session_id uuid not null, other_actor_id uuid not null
) on commit drop;
create temporary table diagnostic_load_jobs (
 tenant text not null, n integer not null, id uuid not null,
 primary key(tenant,n), unique(id)
) on commit drop;
create temporary table diagnostic_load_samples (
 operation text not null, sample integer not null, milliseconds double precision not null,
 response_bytes integer not null
) on commit drop;

-- The second creator represents historical receipts from a former member; no
-- extra seat is admitted and no licence entitlement is fabricated.
-- Use two fresh task-owned organizations. Reuse a live session only as a read
-- authority; new session bindings and organization membership roll back below.
do $$
declare actor uuid;session uuid;other_actor uuid;org uuid;tenant text;authority jsonb;
begin
 select u.id,s.id into actor,session from public.users u
 join auth.sessions s on s.user_id=u.auth_user_id
 where u.is_active and u.email_verified_at is not null
 and (s.not_after is null or s.not_after>clock_timestamp())
 order by s.created_at desc limit 1;
 if actor is null then raise exception 'metadata load requires a current verified auth session';end if;
 select id into other_actor from public.users where id<>actor and is_active limit 1;
 if other_actor is null then raise exception 'metadata load requires a second existing actor for creator-isolation rows';end if;
 foreach tenant in array array['large','small'] loop
  org:=gen_random_uuid();
  insert into public.organizations(id,name,slug) values(org,'M15-04 metadata rollback '||tenant,'m15-04-load-'||org);
  insert into public.organization_members(organization_id,user_id,role) values(org,actor,'owner');
  insert into public.organization_session_bindings(organization_id,session_id,user_id,issued_at,last_seen_at)
   values(org,session,actor,clock_timestamp(),clock_timestamp());
  authority:=public.m15_04_authority(org,actor,session);
  if authority->>'outcome'<>'ok' then raise exception 'metadata fixture lacks live authority: %',tenant;end if;
  insert into diagnostic_load_context values(tenant,org,actor,session,other_actor);
 end loop;
end $$;

-- One small tenant (25 rows) exists before the large-tenant fixture. Historical
-- rows include ready/expired, failed, cancelled, and deleted receipts; none are
-- queued/running, so this cannot enlist an existing background worker.
insert into diagnostic_load_jobs select 'small',n,gen_random_uuid() from generate_series(1,25)n;

create function pg_temp.populate_diagnostic_metadata(p_tenant text) returns void language plpgsql as $$
begin
 insert into public.support_diagnostic_jobs(
  id,organization_id,creator_user_id,session_id,permission_version,idempotency_key,
  preview_digest,selection,selection_digest,consented_at,created_at,completed_at,
  expires_at,state,stage,version,attempts,progress,omissions,artifact,manifest,
  failure_code,cleanup_state
 ) select j.id,c.organization_id,
  case when c.tenant='large' and j.n%5=0 then c.other_actor_id else c.actor_id end,
  c.session_id,pv.version,gen_random_uuid(),repeat('a',64),
  jsonb_build_object('categories',jsonb_build_array('logs','configuration','metrics'),
   'from',public.m7_snapshot_timestamp_utc(clock_timestamp()-(j.n+24)*interval '1 hour'),
   'to',public.m7_snapshot_timestamp_utc(clock_timestamp()-j.n*interval '1 hour')),
  repeat('b',64),clock_timestamp()-j.n*interval '1 hour',clock_timestamp()-j.n*interval '1 hour',
  clock_timestamp()-j.n*interval '1 hour'+interval '45 seconds',
  case when j.n%5=1 then clock_timestamp()+interval '1 hour' else clock_timestamp()-interval '1 day' end,
  case j.n%5 when 0 then 'cancelled' when 1 then 'ready' when 2 then 'ready' when 3 then 'failed' else 'deleted' end,
  case when j.n%5=3 then 'collecting' when j.n%5=4 then 'cleanup' else 'ready' end,
  5,1,'{"completed":4,"total":4}',
  case when j.n%5=3 then '[{"category":"logs","code":"source_unavailable"}]'::jsonb else '[]'::jsonb end,
  case when j.n%5=3 then null else jsonb_build_object('sha256',repeat('c',64),'byteSize',1048576+(j.n%500)*1000,'fileName','support-diagnostics-'||j.id||'.zip') end,
  case when j.n%5=3 then null else jsonb_build_object('version','m15_04_v1','jobId',j.id,
   'generatedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()-j.n*interval '1 hour'+interval '45 seconds'),
   'selection',jsonb_build_object('categories',jsonb_build_array('logs','configuration','metrics'),
    'from',public.m7_snapshot_timestamp_utc(clock_timestamp()-(j.n+24)*interval '1 hour'),
    'to',public.m7_snapshot_timestamp_utc(clock_timestamp()-j.n*interval '1 hour')),
   'entries',jsonb_build_array(
    jsonb_build_object('name','logs.json','sha256',repeat('d',64),'byteSize',1048576),
    jsonb_build_object('name','configuration.json','sha256',repeat('e',64),'byteSize',200),
    jsonb_build_object('name','metrics.json','sha256',repeat('f',64),'byteSize',1500),
    jsonb_build_object('name','omissions.json','sha256',repeat('0',64),'byteSize',2)),
   'omissions','[]'::jsonb) end,
  case when j.n%5=3 then 'source_unavailable' end,
  case when j.n%5=4 then 'deleted' else 'none' end
 from diagnostic_load_jobs j join diagnostic_load_context c on c.tenant=j.tenant
 join public.organization_permissions_version pv on pv.organization_id=c.organization_id
 where j.tenant=p_tenant;
end $$;
select pg_temp.populate_diagnostic_metadata('small');

-- Includes the live authority checks and JSON serialization inside each RPC.
-- Timing excludes saving the sample itself. Warmup samples use negative IDs.
create function pg_temp.sample_diagnostic_metadata(
 p_operation text,p_sample integer,p_tenant text,p_kind text,
 p_job uuid default null,p_cursor uuid default null,p_limit integer default 25,
 p_expected_outcome text default 'ok'
) returns jsonb language plpgsql as $$
declare c diagnostic_load_context;started timestamptz;result jsonb;elapsed double precision;
begin
 select * into strict c from diagnostic_load_context where tenant=p_tenant;
 started:=clock_timestamp();
 if p_kind='list' then
  result:=public.m15_04_list(c.organization_id,c.actor_id,c.session_id,p_cursor,p_limit);
 else
  result:=public.m15_04_get(c.organization_id,c.actor_id,c.session_id,p_job);
 end if;
 elapsed:=1000*extract(epoch from clock_timestamp()-started);
 if result->>'outcome' is distinct from p_expected_outcome then raise exception 'unexpected outcome for %: %',p_operation,result->>'outcome';end if;
 if p_kind='list' and p_expected_outcome='ok' then
  if jsonb_array_length(result->'result'->'items')<>p_limit then raise exception 'short metadata page: %',p_operation;end if;
  if exists(select 1 from jsonb_array_elements(result->'result'->'items') item
   where item->>'organizationId'<>c.organization_id::text or item ?| array['creatorUserId','sessionId','objectPath','grantDigest']) then
   raise exception 'metadata scope/private-field violation: %',p_operation;
  end if;
 end if;
 if p_sample>0 then
  insert into diagnostic_load_samples values(p_operation,p_sample,elapsed,octet_length(result::text));
 end if;
 return result;
end $$;

-- Small-tenant baseline is measured before adding the other tenant's 10k rows.
do $$declare i integer;small_job uuid;begin
 select id into strict small_job from diagnostic_load_jobs where tenant='small' and n=1;
 for i in -9..200 loop
  perform pg_temp.sample_diagnostic_metadata('small_baseline_list_25',i,'small','list');
  perform pg_temp.sample_diagnostic_metadata('small_baseline_get',i,'small','get',small_job);
 end loop;
end $$;

insert into diagnostic_load_jobs select 'large',n,gen_random_uuid() from generate_series(1,10000)n;
select pg_temp.populate_diagnostic_metadata('large');
-- Only temporary-map statistics are updated. ANALYZE on persistent relations
-- would outlive this transaction, so production statistics are left untouched.
analyze diagnostic_load_jobs;
analyze diagnostic_load_context;

do $$declare i integer;large_job uuid;hidden_job uuid;small_job uuid;large_cursor uuid;begin
 if (select count(*) from public.support_diagnostic_jobs j join diagnostic_load_context c on c.organization_id=j.organization_id where c.tenant='large')<>10000
 or (select count(*) from public.support_diagnostic_jobs j join diagnostic_load_context c on c.organization_id=j.organization_id where c.tenant='small')<>25 then
  raise exception 'metadata load fixture count mismatch';end if;
 select id into strict small_job from diagnostic_load_jobs where tenant='small' and n=1;
 select id into strict hidden_job from diagnostic_load_jobs where tenant='large' and n=5;
 select id into strict large_cursor from diagnostic_load_jobs where tenant='large' and n%5<>0 order by id offset 4000 limit 1;
 for i in -9..200 loop
  select id into strict large_job from diagnostic_load_jobs where tenant='large' and n=(greatest(i,1)*37%1999)*5+1+(greatest(i,1)%4);
  perform pg_temp.sample_diagnostic_metadata('large_list_first_25',i,'large','list');
  perform pg_temp.sample_diagnostic_metadata('small_interleaved_list_25',i,'small','list');
  perform pg_temp.sample_diagnostic_metadata('large_list_middle_25',i,'large','list',null,large_cursor);
  perform pg_temp.sample_diagnostic_metadata('small_interleaved_get',i,'small','get',small_job);
  perform pg_temp.sample_diagnostic_metadata('large_list_first_100',i,'large','list',null,null,100);
  perform pg_temp.sample_diagnostic_metadata('small_after_max_page_list_25',i,'small','list');
  perform pg_temp.sample_diagnostic_metadata('large_get_varied_history',i,'large','get',large_job);
  perform pg_temp.sample_diagnostic_metadata('large_get_other_creator_denied',i,'large','get',hidden_job,null,25,'not_found');
  perform pg_temp.sample_diagnostic_metadata('small_get_foreign_tenant_denied',i,'small','get',large_job,null,25,'not_found');
 end loop;
end $$;

select 'rollback fixture: 10,000 large-tenant receipts (8,000 current creator / 2,000 other creator), 25 small-tenant receipts; 10 warmup + 200 measured calls per operation; interleaved single connection' as fixture_scale;
select operation,count(*) as samples,
 round(percentile_cont(0.50) within group(order by milliseconds)::numeric,3) as p50_ms,
 round(percentile_cont(0.95) within group(order by milliseconds)::numeric,3) as p95_ms,
 round(percentile_cont(0.99) within group(order by milliseconds)::numeric,3) as p99_ms,
 round(max(milliseconds)::numeric,3) as max_ms,
 min(response_bytes) as min_response_bytes,max(response_bytes) as max_response_bytes
from diagnostic_load_samples group by operation order by operation;
select j.state,count(*) as rows,round(avg(pg_column_size(j))::numeric,1) as mean_row_bytes
from public.support_diagnostic_jobs j join diagnostic_load_context c on c.organization_id=j.organization_id
where c.tenant='large' group by j.state order by j.state;

-- RPCs are PL/pgSQL, so EXPLAIN on the call alone hides their nested queries.
-- Emit actual, unforced plans for equivalent list/get predicates, including the
-- real next-page UUID bound. These are evidence, never enable_seqscan overrides.
do $$declare c diagnostic_load_context;cursor_id uuid;job uuid;line text;i integer;begin
 select * into strict c from diagnostic_load_context where tenant='large';
 select id into strict cursor_id from diagnostic_load_jobs where tenant='large' and n%5<>0 order by id offset 4000 limit 1;
 select id into strict job from diagnostic_load_jobs where tenant='large' and n=1;
 raise notice 'M15-04 PLAN large list first 25';
 for line in execute format('explain(analyze,buffers,costs off) select * from public.support_diagnostic_jobs where organization_id=%L::uuid and creator_user_id=%L::uuid order by id limit 25',c.organization_id,c.actor_id) loop raise notice '%',line;end loop;
 raise notice 'M15-04 PLAN large list middle 25';
 for line in execute format('explain(analyze,buffers,costs off) select * from public.support_diagnostic_jobs where organization_id=%L::uuid and creator_user_id=%L::uuid and id>%L::uuid order by id limit 25',c.organization_id,c.actor_id,cursor_id) loop raise notice '%',line;end loop;
 -- The RPC's optional cursor OR can produce a different cached plan from a
 -- literal predicate. Let PostgreSQL choose its own custom/generic plan after
 -- repeated calls and expose that prepared equivalent as additional evidence.
 execute 'prepare m15_04_load_cursor_plan(uuid,uuid,uuid,integer) as select * from public.support_diagnostic_jobs where organization_id=$1 and creator_user_id=$2 and ($3 is null or id>$3) order by id limit $4';
 for i in 1..10 loop
  execute format('execute m15_04_load_cursor_plan(%L,%L,%L,25)',c.organization_id,c.actor_id,case when i%2=0 then cursor_id else null end);
 end loop;
 raise notice 'M15-04 PLAN cached optional-cursor equivalent after 10 mixed executions';
 for line in execute format('explain(analyze,buffers,costs off) execute m15_04_load_cursor_plan(%L,%L,%L,25)',c.organization_id,c.actor_id,cursor_id) loop raise notice '%',line;end loop;
 execute 'deallocate m15_04_load_cursor_plan';
 raise notice 'M15-04 PLAN large creator-scoped get';
 for line in execute format('explain(analyze,buffers,costs off) select * from public.support_diagnostic_jobs where organization_id=%L::uuid and creator_user_id=%L::uuid and id=%L::uuid',c.organization_id,c.actor_id,job) loop raise notice '%',line;end loop;
 select * into strict c from diagnostic_load_context where tenant='small';
 raise notice 'M15-04 PLAN small list 25 after 10k other-tenant rows';
 for line in execute format('explain(analyze,buffers,costs off) select * from public.support_diagnostic_jobs where organization_id=%L::uuid and creator_user_id=%L::uuid order by id limit 25',c.organization_id,c.actor_id) loop raise notice '%',line;end loop;
end $$;
rollback;
