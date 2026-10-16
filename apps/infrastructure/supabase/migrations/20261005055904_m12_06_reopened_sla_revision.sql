-- A matching refresh can reactivate the same finding row after supersession.
-- A new active period is a new SLA cycle, while old alert rows stay immutable.
create function public.m1206_restart_reactivated_finding_sla()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_severity text;
  v_policy public.vulnerability_triage_sla_policies%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if old.status<>'superseded' or new.status<>'active' then return new; end if;
  v_severity:=public.m5_triage_finding_severity(new.organization_id,new.id);
  select * into v_policy from public.vulnerability_triage_sla_policies
  where organization_id=new.organization_id and severity=v_severity and enabled;
  if found then
    insert into public.vulnerability_finding_triage_states(
      organization_id,finding_id,last_observed_severity,sla_severity,
      sla_policy_version,sla_target_minutes,sla_started_at,
      sla_elapsed_seconds,sla_paused_at,sla_breached_at
    ) values(new.organization_id,new.id,v_severity,v_severity,
      v_policy.version,v_policy.target_minutes,v_now,0,null,null)
    on conflict(organization_id,finding_id) do update set
      last_observed_severity=excluded.last_observed_severity,
      sla_severity=excluded.sla_severity,
      sla_policy_version=excluded.sla_policy_version,
      sla_target_minutes=excluded.sla_target_minutes,
      sla_started_at=excluded.sla_started_at,
      sla_elapsed_seconds=0,sla_paused_at=null,sla_breached_at=null,
      version=vulnerability_finding_triage_states.version+1;
  else
    update public.vulnerability_finding_triage_states
    set last_observed_severity=v_severity,sla_severity=null,
      sla_policy_version=null,sla_target_minutes=null,sla_started_at=null,
      sla_elapsed_seconds=0,sla_paused_at=null,sla_breached_at=null,
      version=version+1
    where organization_id=new.organization_id and finding_id=new.id;
  end if;
  return new;
end $$;

create trigger restart_reactivated_finding_sla
after update of status on public.vulnerability_findings
for each row when (old.status='superseded' and new.status='active')
execute function public.m1206_restart_reactivated_finding_sla();

-- The M5 materializer still inserts its legacy key. Rewrite only new inserts
-- using the state version after the breach transition, preserving old keys.
create function public.m1206_version_sla_breach_key()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision integer;
begin
  if new.event_kind<>'internal_sla_breached'
    or new.event_key<>'internal_sla_breached:'||new.finding_id::text then
    return new;
  end if;
  select version into v_revision from public.vulnerability_finding_triage_states
  where organization_id=new.organization_id and finding_id=new.finding_id;
  if v_revision is null then
    raise check_violation using message='finding SLA state is missing';
  end if;
  new.event_key:=new.event_key||':'||v_revision::text;
  return new;
end $$;

create trigger version_sla_breach_key
before insert on public.vulnerability_triage_alert_events
for each row execute function public.m1206_version_sla_breach_key();

revoke all on function public.m1206_restart_reactivated_finding_sla() from public,anon,authenticated;
revoke all on function public.m1206_version_sla_breach_key() from public,anon,authenticated;
grant execute on function public.m1206_restart_reactivated_finding_sla() to service_role;
grant execute on function public.m1206_version_sla_breach_key() to service_role;
