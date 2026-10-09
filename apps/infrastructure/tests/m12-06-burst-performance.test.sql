-- Local CRA only. Keep all 1,000 source rows and batch state transaction-local.
begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('local CRA seed and schema',
  current_database()='postgres'
  and exists(select 1 from public.organizations
    where id='00000000-0000-4000-8000-0000000000ca')
  and exists(select 1 from public.vulnerability_findings
    where id='90100000-0000-4000-8000-000000000014'));

create temp table m1206_perf_ids(id uuid primary key,ordinal integer not null);
create temp table m1206_perf_state(
  organization_id uuid,worker_id uuid,batch_id uuid,checkpoint_version integer);

do $$
declare
  v_org constant uuid:='00000000-0000-4000-8000-0000000000ca';
  v_finding constant uuid:='90100000-0000-4000-8000-000000000014';
  v_owner uuid; v_window timestamptz;
  v_sample_dispatch uuid; v_sample_source uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('seeded owner exists',v_owner is not null);
  v_window:=date_bin(interval '2 minutes',clock_timestamp()-interval '4 minutes',
    '2000-01-01 00:00:00+00'::timestamptz);
  update public.organization_settings
  set notification_delivery_mode='unified',notification_burst_enabled=true,
    notification_burst_started_at=v_window-interval '1 minute'
  where organization_id=v_org;
  insert into m1206_perf_ids(id,ordinal)
  select gen_random_uuid(),n from generate_series(1,1000) n;
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at)
  select p.id,v_org,v_finding,'internal_sla_breached',
    'm1206-perf:'||p.id::text,
    v_window+make_interval(secs=>5+(p.ordinal%90)),
    v_window+make_interval(secs=>5+(p.ordinal%90))
  from m1206_perf_ids p;
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at)
  select v_org,'finding_triage','finding_triage_alert',p.id,
    'internal_sla_breached','/findings?findingId='||v_finding::text,
    'Load finding',v_owner,v_owner,'queued',
    v_window+make_interval(secs=>5+(p.ordinal%90)),v_window
  from m1206_perf_ids p;
  perform pg_temp.check('1000 eligible pending dispatches',
    (select count(*) from public.notification_dispatches d
      join m1206_perf_ids p on p.id=d.source_id
      where d.organization_id=v_org and d.status='burst_pending')=1000);
  perform pg_temp.check('set validation matches existing per-dispatch gates',
    not exists(
      select 1 from public.m1206_burst_batch_validation(v_org,
        array(select d.id from public.notification_dispatches d
          join m1206_perf_ids p on p.id=d.source_id
          where d.organization_id=v_org order by p.ordinal limit 2)) checked
      where checked.source_valid is distinct from
        public.m12_03_dispatch_source_valid(v_org,checked.dispatch_id)
        or checked.valid is distinct from
        public.m12_06_burst_dispatch_delivery_valid(
          v_org,checked.dispatch_id)));
  select d.id,d.source_id into v_sample_dispatch,v_sample_source
  from public.notification_dispatches d
  join m1206_perf_ids p on p.id=d.source_id
  where d.organization_id=v_org order by p.ordinal limit 1;
  update public.vulnerability_triage_alert_events
  set state='delivered' where organization_id=v_org and id=v_sample_source;
  perform pg_temp.check('completed source loses batch authorization',
    (select not source_valid and not valid
      from public.m1206_burst_batch_validation(
        v_org,array[v_sample_dispatch]))
    and not public.m12_03_dispatch_source_valid(v_org,v_sample_dispatch));
  update public.vulnerability_triage_alert_events
  set state='queued' where organization_id=v_org and id=v_sample_source;
  update public.organization_settings
  set notification_burst_enabled=false where organization_id=v_org;
  perform pg_temp.check('changed organization policy loses eligibility',
    (select source_valid and not valid
      from public.m1206_burst_batch_validation(
        v_org,array[v_sample_dispatch]))
    and not public.m12_06_burst_dispatch_delivery_valid(
      v_org,v_sample_dispatch));
  update public.organization_settings
  set notification_burst_enabled=true where organization_id=v_org;
  insert into m1206_perf_state(organization_id) values(v_org);
end $$;

select pg_temp.check('performance helpers are service-role only',
  has_function_privilege('service_role',
    'public.m1206_burst_candidates(uuid)','EXECUTE')
  and has_function_privilege('service_role',
    'public.m1206_burst_batch_validation(uuid,uuid[])','EXECUTE')
  and not has_function_privilege('anon',
    'public.m1206_burst_candidates(uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.m1206_burst_batch_validation(uuid,uuid[])','EXECUTE'));

-- PostgREST caps each RPC at eight seconds. Apply the bound to each RPC
-- separately, after fixture creation, without contacting any HTTP service.
set local statement_timeout='8s';
do $$
declare v_org uuid; v_result record; v_batch_count integer;
  v_started timestamptz;
begin
  select organization_id into v_org from m1206_perf_state;
  v_started:=clock_timestamp();
  select * into v_result from public.schedule_notification_burst_batches_atomic(
    v_org,clock_timestamp(),1000);
  raise notice 'M12-06 1000-member schedule ms=%',
    round((extract(epoch from clock_timestamp()-v_started)*1000)::numeric,2);
  perform pg_temp.check('scheduler returns ten full batches',
    v_result.outcome='scheduled' and v_result.created=10);
  select count(*) into v_batch_count from public.notification_digest_batches b
  where b.organization_id=v_org and b.batch_kind='burst'
    and exists(select 1 from public.notification_dispatches d
      join m1206_perf_ids p on p.id=d.source_id
      where d.organization_id=v_org and d.id=any(b.dispatch_ids));
  perform pg_temp.check('all members frozen without loss',v_batch_count=10);
end $$;

do $$
declare v_org uuid; v_claim record; v_prepare record;
  v_started timestamptz;
begin
  select organization_id into v_org from m1206_perf_state;
  select * into v_claim from public.claim_notification_burst_batch_atomic(
    v_org,gen_random_uuid(),120);
  perform pg_temp.check('a full batch can be claimed',v_claim.outcome='claimed');
  v_started:=clock_timestamp();
  select * into v_prepare from public.prepare_notification_burst_batch_atomic(
    v_org,(v_claim.batch->>'batchId')::uuid,
    (v_claim.batch->>'leaseOwner')::uuid,
    (v_claim.batch->>'checkpointVersion')::integer);
  raise notice 'M12-06 100-member prepare ms=%',
    round((extract(epoch from clock_timestamp()-v_started)*1000)::numeric,2);
  perform pg_temp.check('100 authorized members prepared inside timeout',
    v_prepare.outcome='ready'
    and (v_prepare.delivery #>> '{payload,count}')::integer=100);
end $$;

-- A critical transition releases a large open-window burst promptly instead
-- of making the direct worker wait for the two-minute window to close.
create temp table m1206_perf_critical_ids(id uuid primary key);
do $$
declare
  v_org constant uuid:='00000000-0000-4000-8000-0000000000ca';
  v_finding constant uuid:='90100000-0000-4000-8000-000000000014';
  v_owner uuid; v_vulnerability uuid; v_source_version uuid; v_feed text;
  v_created_at timestamptz:=clock_timestamp()+interval '30 seconds';
  v_result record; v_started timestamptz;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select f.vulnerability_id into v_vulnerability
  from public.vulnerability_findings f
  where f.organization_id=v_org and f.id=v_finding;
  select r.current_version_id,r.feed_key into v_source_version,v_feed
  from public.vulnerability_source_records r
  where r.vulnerability_id=v_vulnerability and r.current_version_id is not null
  order by r.id limit 1;
  insert into m1206_perf_critical_ids(id)
  select gen_random_uuid() from generate_series(1,1000);
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at)
  select x.id,v_org,v_finding,'internal_sla_breached',
    'm1206-perf-critical:'||x.id::text,v_created_at,v_created_at
  from m1206_perf_critical_ids x;
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at)
  select v_org,'finding_triage','finding_triage_alert',x.id,
    'internal_sla_breached','/findings?findingId='||v_finding::text,
    'Critical transition fixture',v_owner,v_owner,'queued',
    v_created_at,clock_timestamp()
  from m1206_perf_critical_ids x;
  perform pg_temp.check('second 1000 initially noncritical and pending',
    (select count(*) from public.notification_dispatches d
      join m1206_perf_critical_ids x on x.id=d.source_id
      where d.organization_id=v_org and d.status='burst_pending')=1000);
  insert into public.vulnerability_enrichments(
    vulnerability_id,source_record_version_id,feed_key,
    enrichment_type,enrichment)
  values(v_vulnerability,v_source_version,v_feed,'cvss',
    '{"value":{"version":"3.1","baseScore":9,"vectorString":"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}}'::jsonb);
  perform pg_temp.check('critical transition wakes local tenant',
    exists(select 1 from public.list_due_notification_burst_organizations_atomic(
      null,1000) due where due.organization_id=v_org));
  v_started:=clock_timestamp();
  select * into v_result from public.schedule_notification_burst_batches_atomic(
    v_org,clock_timestamp(),1000);
  raise notice 'M12-06 1000-member critical release ms=%',
    round((extract(epoch from clock_timestamp()-v_started)*1000)::numeric,2);
  perform pg_temp.check('all escalated members bypass window under timeout',
    v_result.released>=1000
    and (select count(*) from public.notification_dispatches d
      join m1206_perf_critical_ids x on x.id=d.source_id
      where d.organization_id=v_org and d.status='queued')=1000);
  perform pg_temp.check('prepared older batch membership stays frozen',
    (select count(*) from public.notification_dispatches d
      join m1206_perf_ids x on x.id=d.source_id
      where d.organization_id=v_org and d.status='burst_pending')=1000);
end $$;

rollback;
