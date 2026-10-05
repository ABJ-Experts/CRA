-- Manual rollback-scoped load probe. Run only against the local CRA stack:
-- docker exec -i supabase_db_cra psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < tests/m12-06-burst-load.sql
begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('local CRA development schema and seed only',
  current_database()='postgres'
  and exists(select 1 from public.organizations
    where id='00000000-0000-4000-8000-0000000000ca')
  and exists(select 1 from public.vulnerability_findings
    where id='90100000-0000-4000-8000-000000000014'));

create temp table m1206_load_ids(id uuid primary key,ordinal integer not null);
create temp table m1206_load_ids_second(id uuid primary key,ordinal integer not null);
create temp table m1206_load_latency(kind text not null,elapsed_ms numeric not null);

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_window timestamptz:=date_bin(interval '2 minutes',
    clock_timestamp()-interval '4 minutes',
    '2000-01-01 00:00:00+00'::timestamptz);
  v_started timestamptz; v_count integer; v_batches integer;
  v_max integer; v_critical uuid:=gen_random_uuid(); v_started_read timestamptz;
  v_n integer;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('seeded owner exists',v_owner is not null);
  update public.organization_settings
  set notification_delivery_mode='unified',
    notification_burst_enabled=true,
    notification_burst_started_at=v_window-interval '1 minute',
    notification_feed_started_at=v_window-interval '1 minute'
  where organization_id=v_org;
  insert into m1206_load_ids(id,ordinal)
  select gen_random_uuid(),n from generate_series(1,1000) n;
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at)
  select l.id,v_org,'90100000-0000-4000-8000-000000000014',
    'internal_sla_breached','m1206-load:'||l.id::text,
    v_window+make_interval(secs=>5+(l.ordinal%90)),
    v_window+make_interval(secs=>5+(l.ordinal%90))
  from m1206_load_ids l;
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at)
  select v_org,'finding_triage','finding_triage_alert',l.id,
    'internal_sla_breached',
    '/findings?findingId=90100000-0000-4000-8000-000000000014',
    'Load finding',v_owner,v_owner,'queued',
    v_window+make_interval(secs=>5+(l.ordinal%90)),v_window
  from m1206_load_ids l;
  perform pg_temp.check('all 1000 events preserved in burst pending',
    (select count(*) from public.notification_dispatches d
      join m1206_load_ids l on l.id=d.source_id
      where d.organization_id=v_org and d.status='burst_pending')=1000);
  insert into public.notification_dispatches(
    id,organization_id,category,source_type,source_id,source_subtype,
    original_recipient_user_id,effective_recipient_user_id,status,created_at)
  values(v_critical,v_org,'evidence','evidence_quarantined',gen_random_uuid(),
    'evidence_quarantined',v_owner,v_owner,'queued',v_window+interval '15 seconds');
  perform pg_temp.check('critical source bypasses burst',
    (select status='queued' from public.notification_dispatches
      where organization_id=v_org and id=v_critical));
  v_started:=clock_timestamp();
  perform * from public.schedule_notification_burst_batches_atomic(
    v_org,clock_timestamp(),1000);
  insert into m1206_load_latency values('schedule',
    extract(epoch from clock_timestamp()-v_started)*1000);
  select count(distinct b.id),max(cardinality(b.dispatch_ids))
    into v_batches,v_max
  from public.notification_digest_batches b
  join public.notification_dispatches d on d.organization_id=b.organization_id
    and d.id=any(b.dispatch_ids)
  join m1206_load_ids l on l.id=d.source_id
  where b.organization_id=v_org and b.batch_kind='burst'
    and d.status='burst_pending';
  perform pg_temp.check('1000 events reduced by at least 90 percent',
    v_batches<=100);
  perform pg_temp.check('batch membership never exceeds 100',v_max<=100);
  select count(*) into v_count from public.notification_dispatches d
  join m1206_load_ids l on l.id=d.source_id
  where d.organization_id=v_org and d.status='burst_pending';
  perform pg_temp.check('no eligible source dropped',v_count=1000);
  v_started_read:=clock_timestamp();
  perform * from public.m1204_feed_rows(v_org,v_owner);
  insert into m1206_load_latency values('source_feed_rows',
    extract(epoch from clock_timestamp()-v_started_read)*1000);
  v_started_read:=clock_timestamp();
  perform * from public.vulnerability_triage_alert_events e
  cross join lateral public.get_vulnerability_triage_alert_details(
    e.organization_id,e.id) details
  where e.organization_id=v_org and e.id in (select id from m1206_load_ids);
  insert into m1206_load_latency values('m5_details_1000',
    extract(epoch from clock_timestamp()-v_started_read)*1000);
  for v_n in 1..20 loop
    v_started_read:=clock_timestamp();
    perform * from public.list_notification_feed_grouped_atomic(
      v_org,v_owner,'finding_triage',null,'all',null,25);
    insert into m1206_load_latency values('grouped_read',
      extract(epoch from clock_timestamp()-v_started_read)*1000);
    v_started_read:=clock_timestamp();
    perform * from public.list_notification_feed_cohort_atomic(
      v_org,v_owner,'finding_sla_breached',v_window,null,25);
    insert into m1206_load_latency values('filtered_cohort_read',
      extract(epoch from clock_timestamp()-v_started_read)*1000);
    v_started_read:=clock_timestamp();
    perform * from public.list_notification_feed_atomic(
      v_org,v_owner,'finding_triage',null,'all',null,25);
    insert into m1206_load_latency values('default_event_read',
      extract(epoch from clock_timestamp()-v_started_read)*1000);
  end loop;
  raise notice 'M12-06 load: original=1000, burst_batches=%, reduction=% percent, max_members=%',
    v_batches,round((1-v_batches::numeric/1000)*100,2),v_max;
end $$;

-- A second organization is entirely transaction-local. Its legal entity,
-- product, release, finding, events, and dispatches all disappear at ROLLBACK.
do $$
declare
  v_org uuid:=gen_random_uuid(); v_entity uuid:=gen_random_uuid();
  v_product uuid:=gen_random_uuid(); v_release uuid:=gen_random_uuid();
  v_finding uuid:=gen_random_uuid(); v_owner uuid; v_window timestamptz;
  v_started timestamptz; v_batches integer; v_max integer; v_n integer;
  v_claim record; v_prepared record; v_batch_id uuid;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('seeded owner exists for second tenant',v_owner is not null);
  select date_bin(interval '2 minutes',clock_timestamp()-interval '4 minutes',
    '2000-01-01 00:00:00+00'::timestamptz) into v_window;
  insert into public.organizations(id,name,slug)
  values(v_org,'M12 burst load tenant','m1206-load-'||left(replace(v_org::text,'-',''),12));
  insert into public.organization_members(organization_id,user_id,role)
  values(v_org,v_owner,'owner');
  insert into public.organization_legal_entities(
    id,organization_id,identifier,display_name,legal_name,
    registered_address_line_1,registered_address_locality,
    registered_address_postal_code,registered_address_country,
    main_establishment_country,manufacturer_contact_name,
    manufacturer_contact_email,completion_status,status,is_default,
    created_by,updated_by)
  select v_entity,v_org,'m1206-load',l.display_name,l.legal_name,
    l.registered_address_line_1,l.registered_address_locality,
    l.registered_address_postal_code,l.registered_address_country,
    l.main_establishment_country,l.manufacturer_contact_name,
    l.manufacturer_contact_email,'complete','active',true,v_owner,v_owner
  from public.organization_legal_entities l
  join public.products p on p.legal_entity_id=l.id
  where p.id='90100000-0000-4000-8000-000000000001';
  insert into public.products(
    id,organization_id,legal_entity_id,legal_entity_version,
    legal_entity_snapshot,name,internal_code,product_type,
    responsible_owner_id,created_by,updated_by)
  select v_product,v_org,v_entity,0,
    jsonb_set(jsonb_set(p.legal_entity_snapshot,'{id}',to_jsonb(v_entity)),
      '{organizationId}',to_jsonb(v_org)),
    'Burst load product','m1206-load','standalone_software',
    v_owner,v_owner,v_owner
  from public.products p where p.id='90100000-0000-4000-8000-000000000001';
  insert into public.product_releases(
    id,organization_id,product_id,legal_entity_id,legal_entity_version,
    legal_entity_snapshot,label,release_version,lifecycle,created_by,updated_by)
  select v_release,v_org,v_product,v_entity,0,
    jsonb_set(jsonb_set(r.legal_entity_snapshot,'{id}',to_jsonb(v_entity)),
      '{organizationId}',to_jsonb(v_org)),
    'Burst load release','1.0','development',v_owner,v_owner
  from public.product_releases r
  where r.id='90100000-0000-4000-8000-000000000002';
  insert into public.vulnerability_findings(
    id,organization_id,release_id,component_identity,canonical_advisory_id,
    vulnerability_id,source_feed_key,source_record_id,source_record_version_id,
    affected_range_id,match_method,comparator_name,comparator_version,
    evaluated_component_value,affected_range,event_sequence,confidence,
    confidence_table_version,confidence_explanation,status)
  select v_finding,v_org,v_release,f.component_identity,f.canonical_advisory_id,
    f.vulnerability_id,f.source_feed_key,f.source_record_id,f.source_record_version_id,
    f.affected_range_id,f.match_method,f.comparator_name,f.comparator_version,
    f.evaluated_component_value,f.affected_range,f.event_sequence,f.confidence,
    f.confidence_table_version,f.confidence_explanation,'active'
  from public.vulnerability_findings f
  where f.id='90100000-0000-4000-8000-000000000014';
  update public.organization_settings
  set notification_delivery_mode='unified',notification_burst_enabled=true,
    notification_burst_started_at=v_window-interval '1 minute',
    notification_feed_started_at=v_window-interval '1 minute'
  where organization_id=v_org;
  insert into m1206_load_ids_second(id,ordinal)
  select gen_random_uuid(),n from generate_series(1,1000) n;
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at)
  select l.id,v_org,v_finding,'internal_sla_breached',
    'm1206-load-second:'||l.id::text,
    v_window+make_interval(secs=>5+(l.ordinal%90)),
    v_window+make_interval(secs=>5+(l.ordinal%90))
  from m1206_load_ids_second l;
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,
    safe_title,original_recipient_user_id,effective_recipient_user_id,
    status,created_at,next_attempt_at)
  select v_org,'finding_triage','finding_triage_alert',l.id,
    'internal_sla_breached','/findings?findingId='||v_finding::text,
    'Load finding',v_owner,v_owner,'queued',
    v_window+make_interval(secs=>5+(l.ordinal%90)),v_window
  from m1206_load_ids_second l;
  perform pg_temp.check('second tenant retains 1000 eligible events',
    (select count(*) from public.notification_dispatches d
      join m1206_load_ids_second l on l.id=d.source_id
      where d.organization_id=v_org and d.status='burst_pending')=1000);
  v_started:=clock_timestamp();
  perform * from public.schedule_notification_burst_batches_atomic(
    v_org,clock_timestamp(),1000);
  insert into m1206_load_latency values('schedule_tenant_2',
    extract(epoch from clock_timestamp()-v_started)*1000);
  select count(distinct b.id),max(cardinality(b.dispatch_ids))
    into v_batches,v_max
  from public.notification_digest_batches b
  join public.notification_dispatches d on d.organization_id=b.organization_id
    and d.id=any(b.dispatch_ids)
  join m1206_load_ids_second l on l.id=d.source_id
  where b.organization_id=v_org and b.batch_kind='burst';
  perform pg_temp.check('second tenant has ten isolated bounded batches',
    v_batches=10 and v_max=100);
  perform pg_temp.check('first tenant batch excludes second tenant sources',
    not exists(select 1 from public.notification_digest_batches b
      join public.notification_dispatches d on d.id=any(b.dispatch_ids)
      join m1206_load_ids_second l on l.id=d.source_id
      where b.organization_id='00000000-0000-4000-8000-0000000000ca'));
  select * into v_claim from public.claim_notification_burst_batch_atomic(
    v_org,gen_random_uuid(),120);
  perform pg_temp.check('second tenant burst can be claimed',
    v_claim.outcome='claimed');
  v_batch_id:=(v_claim.batch->>'batchId')::uuid;
  select * into v_prepared from public.prepare_notification_burst_batch_atomic(
    v_org,v_batch_id,(v_claim.batch->>'leaseOwner')::uuid,
    (v_claim.batch->>'checkpointVersion')::integer);
  perform pg_temp.check('second tenant email batch freezes 100 visible members',
    v_prepared.outcome='ready'
    and (v_prepared.delivery #>> '{payload,count}')::integer=100);
  for v_n in 1..20 loop
    v_started:=clock_timestamp();
    perform * from public.list_notification_feed_grouped_atomic(
      v_org,v_owner,'finding_triage',null,'all',null,25);
    insert into m1206_load_latency values('grouped_read_tenant_2',
      extract(epoch from clock_timestamp()-v_started)*1000);
    v_started:=clock_timestamp();
    perform * from public.list_notification_feed_cohort_atomic(
      v_org,v_owner,'finding_sla_breached',v_window,null,25);
    insert into m1206_load_latency values('filtered_cohort_read_tenant_2',
      extract(epoch from clock_timestamp()-v_started)*1000);
    v_started:=clock_timestamp();
    perform * from public.list_notification_feed_batch_atomic(
      v_org,v_owner,v_batch_id,null,25);
    insert into m1206_load_latency values('filtered_batch_read_tenant_2',
      extract(epoch from clock_timestamp()-v_started)*1000);
  end loop;
  raise notice 'M12-06 second tenant: original=1000, burst_batches=%, reduction=% percent, max_members=%',
    v_batches,round((1-v_batches::numeric/1000)*100,2),v_max;
end $$;

select kind,count(*) as samples,round(min(elapsed_ms),2) as min_ms,
  round(percentile_cont(0.95) within group(order by elapsed_ms)::numeric,2) as p95_ms,
  round(percentile_cont(0.99) within group(order by elapsed_ms)::numeric,2) as p99_ms,
  round(max(elapsed_ms),2) as max_ms
from m1206_load_latency group by kind order by kind;

select pg_temp.check('default event read meets burst p95/p99 targets',
  (select percentile_cont(0.95) within group(order by elapsed_ms)<400
    and percentile_cont(0.99) within group(order by elapsed_ms)<1000
    from m1206_load_latency where kind='default_event_read'));

rollback;
