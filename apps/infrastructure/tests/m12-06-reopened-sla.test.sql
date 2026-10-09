-- A reactivated finding can breach a new SLA cycle without erasing its first event.
begin;

create function pg_temp.check(p_label text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_label; end if;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_finding uuid;
  v_severity text;
  v_owner uuid;
  v_first_key text;
  v_first_id uuid;
begin
  select id into v_finding from public.vulnerability_findings
  where organization_id=v_org and status='active' order by id limit 1;
  perform pg_temp.check('seeded active finding exists',v_finding is not null);
  v_severity:=public.m5_triage_finding_severity(v_org,v_finding);
  select id into v_owner from public.users where email='owner@cra.test';
  insert into public.vulnerability_triage_sla_policies(
    organization_id,severity,enabled,target_minutes,created_by,updated_by
  ) values(v_org,v_severity,true,1,v_owner,v_owner)
  on conflict(organization_id,severity) do update set
    enabled=true,target_minutes=1,version=vulnerability_triage_sla_policies.version+1,
    updated_by=excluded.updated_by;
  insert into public.vulnerability_finding_triage_states(
    organization_id,finding_id,last_observed_severity,sla_severity,
    sla_policy_version,sla_target_minutes,sla_started_at,sla_elapsed_seconds,
    sla_paused_at,sla_breached_at
  ) values(v_org,v_finding,v_severity,v_severity,1,1,clock_timestamp()-interval '5 minutes',60,null,null)
  on conflict(organization_id,finding_id) do update set
    last_observed_severity=excluded.last_observed_severity,
    sla_severity=excluded.sla_severity,
    sla_policy_version=excluded.sla_policy_version,
    sla_target_minutes=excluded.sla_target_minutes,
    sla_started_at=excluded.sla_started_at,
    sla_elapsed_seconds=excluded.sla_elapsed_seconds,
    sla_paused_at=null,sla_breached_at=null,
    version=vulnerability_finding_triage_states.version+1;

  perform public.m5_triage_materialize_due_work(v_org);
  select id,event_key into v_first_id,v_first_key
  from public.vulnerability_triage_alert_events
  where organization_id=v_org and finding_id=v_finding
    and event_kind='internal_sla_breached'
  order by created_at desc,id desc limit 1;
  perform pg_temp.check('first SLA cycle emits a source event',v_first_id is not null);
  perform public.m5_triage_materialize_due_work(v_org);
  perform pg_temp.check('retry does not duplicate the first cycle',
    (select count(*) from public.vulnerability_triage_alert_events
      where organization_id=v_org and finding_id=v_finding
        and event_kind='internal_sla_breached')=1);

  update public.vulnerability_findings
  set status='superseded',superseded_at=clock_timestamp()
  where organization_id=v_org and id=v_finding;
  update public.vulnerability_findings
  set status='active',superseded_at=null
  where organization_id=v_org and id=v_finding;
  perform pg_temp.check('reactivation starts a fresh SLA cycle',
    exists(select 1 from public.vulnerability_finding_triage_states
      where organization_id=v_org and finding_id=v_finding
        and sla_breached_at is null and sla_elapsed_seconds=0));

  update public.vulnerability_finding_triage_states
  set sla_elapsed_seconds=60
  where organization_id=v_org and finding_id=v_finding;
  perform public.m5_triage_materialize_due_work(v_org);
  perform pg_temp.check('second SLA cycle has a distinct durable event',
    (select count(*) from public.vulnerability_triage_alert_events
      where organization_id=v_org and finding_id=v_finding
        and event_kind='internal_sla_breached')=2
    and exists(select 1 from public.vulnerability_triage_alert_events
      where organization_id=v_org and finding_id=v_finding
        and event_kind='internal_sla_breached' and id<>v_first_id and event_key<>v_first_key));
  perform public.m5_triage_materialize_due_work(v_org);
  perform pg_temp.check('retry does not duplicate the reopened cycle',
    (select count(*) from public.vulnerability_triage_alert_events
      where organization_id=v_org and finding_id=v_finding
        and event_kind='internal_sla_breached')=2);
end $$;

rollback;
