-- A read must not retroactively start an SLA for a finding that predates the
-- policy. Policy configuration is prospective even when a queue/detail read
-- is the first operation to materialize that finding's operational state.

create or replace function public.m5_triage_ensure_state(
  p_organization_id uuid,
  p_finding_id uuid,
  p_actor_user_id uuid
) returns public.vulnerability_finding_triage_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.vulnerability_finding_triage_states%rowtype;
  v_severity text;
  v_policy public.vulnerability_triage_sla_policies%rowtype;
  v_has_state boolean;
  v_has_policy boolean;
  v_finding_created_at timestamptz;
  v_elapsed_seconds bigint;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_state
  from public.vulnerability_finding_triage_states state
  where state.organization_id = p_organization_id
    and state.finding_id = p_finding_id
  for update;
  v_has_state := found;

  select finding.created_at into v_finding_created_at
  from public.vulnerability_findings finding
  where finding.organization_id = p_organization_id
    and finding.id = p_finding_id;

  v_severity := public.m5_triage_finding_severity(p_organization_id, p_finding_id);

  if not v_has_state then
    select * into v_policy
    from public.vulnerability_triage_sla_policies policy
    where policy.organization_id = p_organization_id
      and policy.severity = v_severity
      and policy.enabled
      and v_finding_created_at >= policy.updated_at;
    v_has_policy := found;

    insert into public.vulnerability_finding_triage_states(
      organization_id, finding_id, last_observed_severity, sla_severity,
      sla_policy_version, sla_target_minutes, sla_started_at, updated_by
    ) values (
      p_organization_id, p_finding_id, v_severity,
      case when v_has_policy then v_severity else null end,
      case when v_has_policy then v_policy.version else null end,
      case when v_has_policy then v_policy.target_minutes else null end,
      case when v_has_policy then v_now else null end,
      p_actor_user_id
    ) returning * into v_state;
  elsif v_state.last_observed_severity is distinct from v_severity then
    select * into v_policy
    from public.vulnerability_triage_sla_policies policy
    where policy.organization_id = p_organization_id
      and policy.severity = v_severity
      and policy.enabled;
    v_has_policy := found;

    v_elapsed_seconds := v_state.sla_elapsed_seconds + case
      when v_state.sla_started_at is not null and v_state.sla_paused_at is null
      then greatest(0, extract(epoch from v_now - greatest(v_state.sla_started_at, v_state.updated_at))::bigint)
      else 0
    end;

    update public.vulnerability_finding_triage_states
    set
      last_observed_severity = v_severity,
      sla_severity = case when v_has_policy then v_severity else null end,
      sla_policy_version = case when v_has_policy then v_policy.version else null end,
      sla_target_minutes = case when v_has_policy then v_policy.target_minutes else null end,
      sla_started_at = case when v_has_policy then coalesce(v_state.sla_started_at, v_now) else null end,
      sla_elapsed_seconds = case when v_has_policy then v_elapsed_seconds else 0 end,
      sla_paused_at = case when v_has_policy then v_state.sla_paused_at else null end,
      sla_breached_at = case
        when v_has_policy and v_state.sla_breached_at is not null
          and v_elapsed_seconds >= v_policy.target_minutes::bigint * 60
        then v_state.sla_breached_at
        else null
      end,
      version = version + 1,
      updated_at = v_now,
      updated_by = p_actor_user_id
    where organization_id = p_organization_id
      and finding_id = p_finding_id
    returning * into v_state;
  end if;

  return v_state;
end;
$$;

alter function public.m5_triage_ensure_state(uuid, uuid, uuid) owner to postgres;
revoke all on function public.m5_triage_ensure_state(uuid, uuid, uuid) from public;
grant execute on function public.m5_triage_ensure_state(uuid, uuid, uuid) to service_role;
