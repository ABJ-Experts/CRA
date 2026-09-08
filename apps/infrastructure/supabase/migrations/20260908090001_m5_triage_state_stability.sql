-- Preserve a severity observation even when no SLA is configured. Without it,
-- a read-side materialization mistakes an unconfigured state for a severity
-- change and increments the optimistic-concurrency version on every read.
alter table public.vulnerability_finding_triage_states
  add column last_observed_severity text check (
    last_observed_severity is null
    or last_observed_severity in ('critical', 'high', 'medium', 'low', 'unknown')
  );

update public.vulnerability_finding_triage_states state
set last_observed_severity = public.m5_triage_finding_severity(
  state.organization_id,
  state.finding_id
)
where state.last_observed_severity is null;

alter table public.vulnerability_finding_triage_states
  alter column last_observed_severity set not null;

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
begin
  select * into v_state
  from public.vulnerability_finding_triage_states state
  where state.organization_id = p_organization_id
    and state.finding_id = p_finding_id
  for update;

  v_severity := public.m5_triage_finding_severity(
    p_organization_id,
    p_finding_id
  );

  if not found then
    select * into v_policy
    from public.vulnerability_triage_sla_policies policy
    where policy.organization_id = p_organization_id
      and policy.severity = v_severity
      and policy.enabled;

    insert into public.vulnerability_finding_triage_states(
      organization_id,
      finding_id,
      last_observed_severity,
      sla_severity,
      sla_policy_version,
      sla_target_minutes,
      sla_started_at,
      updated_by
    ) values (
      p_organization_id,
      p_finding_id,
      v_severity,
      case when found then v_severity else null end,
      case when found then v_policy.version else null end,
      case when found then v_policy.target_minutes else null end,
      case when found then clock_timestamp() else null end,
      p_actor_user_id
    ) returning * into v_state;
  elsif v_state.last_observed_severity is distinct from v_severity then
    select * into v_policy
    from public.vulnerability_triage_sla_policies policy
    where policy.organization_id = p_organization_id
      and policy.severity = v_severity
      and policy.enabled;

    update public.vulnerability_finding_triage_states
    set
      last_observed_severity = v_severity,
      sla_severity = case when found then v_severity else null end,
      sla_policy_version = case when found then v_policy.version else null end,
      sla_target_minutes = case when found then v_policy.target_minutes else null end,
      sla_started_at = case
        when found then coalesce(v_state.sla_started_at, clock_timestamp())
        else null
      end,
      sla_elapsed_seconds = sla_elapsed_seconds + case
        when sla_started_at is not null and sla_paused_at is null
          then greatest(
            0,
            extract(
              epoch from clock_timestamp() - greatest(sla_started_at, updated_at)
            )::bigint
          )
        else 0
      end,
      version = version + 1,
      updated_at = clock_timestamp(),
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
grant execute on function public.m5_triage_ensure_state(uuid, uuid, uuid)
  to service_role;
