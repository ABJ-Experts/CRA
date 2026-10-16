-- A later high/critical M5 assessment must wake and bypass an open burst.
-- Fixture changes remain local and roll back, including CVSS enrichment.
begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('local CRA seed only',
  current_database()='postgres'
  and exists(select 1 from public.organizations
    where id='00000000-0000-4000-8000-0000000000ca')
  and exists(select 1 from public.vulnerability_findings
    where id='90100000-0000-4000-8000-000000000014'));

do $$
declare
  v_org constant uuid:='00000000-0000-4000-8000-0000000000ca';
  v_finding constant uuid:='90100000-0000-4000-8000-000000000014';
  v_vulnerability uuid; v_source_version uuid; v_feed text;
  v_owner uuid; v_event uuid:=gen_random_uuid(); v_dispatch uuid;
  v_created_at timestamptz:=clock_timestamp()+interval '30 seconds';
  v_result record;
begin
  select f.vulnerability_id into v_vulnerability
  from public.vulnerability_findings f
  where f.organization_id=v_org and f.id=v_finding;
  select r.current_version_id,r.feed_key into v_source_version,v_feed
  from public.vulnerability_source_records r
  where r.vulnerability_id=v_vulnerability and r.current_version_id is not null
  order by r.id limit 1;
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('seeded source and owner exist',
    v_source_version is not null and v_owner is not null);
  perform pg_temp.check('finding initially below critical threshold',
    public.m5_triage_finding_severity(v_org,v_finding)
      not in ('high','critical'));
  update public.organization_settings
  set notification_delivery_mode='unified',
    notification_burst_enabled=true,
    notification_burst_started_at=clock_timestamp()-interval '1 minute'
  where organization_id=v_org;
  -- The 30-second fixture skew keeps the two-minute ingestion window open
  -- across a test run near a clock boundary; all rows roll back.
  insert into public.vulnerability_triage_alert_events(
    id,organization_id,finding_id,event_kind,event_key,due_at,created_at)
  values(v_event,v_org,v_finding,'internal_sla_breached',
    'm1206-critical-escalation:'||v_event::text,v_created_at,v_created_at);
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,
    source_link,safe_title,original_recipient_user_id,
    effective_recipient_user_id,status,created_at,next_attempt_at)
  values(v_org,'finding_triage','finding_triage_alert',v_event,
    'internal_sla_breached','/findings?findingId='||v_finding::text,
    'Critical transition fixture',v_owner,v_owner,
    'queued',v_created_at,clock_timestamp()) returning id into v_dispatch;
  perform pg_temp.check('event entered open burst while noncritical',
    (select d.status='burst_pending'
      and date_bin(interval '2 minutes',d.created_at,
        '2000-01-01 00:00:00+00'::timestamptz)
        +interval '2 minutes'>clock_timestamp()+interval '20 seconds'
      from public.notification_dispatches d
      where d.organization_id=v_org and d.id=v_dispatch));
  insert into public.vulnerability_enrichments(
    vulnerability_id,source_record_version_id,feed_key,
    enrichment_type,enrichment)
  values(v_vulnerability,v_source_version,v_feed,'cvss',
    '{"value":{"version":"3.1","baseScore":9,"vectorString":"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}}'::jsonb);
  perform pg_temp.check('same finding is now critical',
    public.m5_triage_finding_severity(v_org,v_finding)='critical');
  perform pg_temp.check('critical transition wakes tenant before window closes',
    exists(select 1 from public.list_due_notification_burst_organizations_atomic(
      null,1000) due where due.organization_id=v_org));
  select * into v_result from public.schedule_notification_burst_batches_atomic(
    v_org,clock_timestamp(),1000);
  perform pg_temp.check('critical member released to direct queue',
    v_result.outcome='scheduled' and v_result.released>=1
    and (select status='queued' from public.notification_dispatches
      where organization_id=v_org and id=v_dispatch));
  perform pg_temp.check('critical release is auditable',
    exists(select 1 from public.audit_logs a
      where a.organization_id=v_org
        and a.action='notification.burst_critical_released'
        and a.entity_id=v_dispatch::text));
end $$;

rollback;
