-- Start internal-SLA tracking for new active findings under an already-enabled
-- policy, and keep severity changes from accidentally preserving stale breach
-- state after the target changes.

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
  v_elapsed_seconds bigint;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_state
  from public.vulnerability_finding_triage_states state
  where state.organization_id = p_organization_id
    and state.finding_id = p_finding_id
  for update;
  v_has_state := found;

  v_severity := public.m5_triage_finding_severity(
    p_organization_id,
    p_finding_id
  );

  if not v_has_state then
    select * into v_policy
    from public.vulnerability_triage_sla_policies policy
    where policy.organization_id = p_organization_id
      and policy.severity = v_severity
      and policy.enabled;
    v_has_policy := found;

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
      when v_state.sla_started_at is not null
        and v_state.sla_paused_at is null
      then greatest(
        0,
        extract(
          epoch from v_now - greatest(v_state.sla_started_at, v_state.updated_at)
        )::bigint
      )
      else 0
    end;

    update public.vulnerability_finding_triage_states
    set
      last_observed_severity = v_severity,
      sla_severity = case when v_has_policy then v_severity else null end,
      sla_policy_version = case when v_has_policy then v_policy.version else null end,
      sla_target_minutes = case when v_has_policy then v_policy.target_minutes else null end,
      sla_started_at = case
        when v_has_policy then coalesce(v_state.sla_started_at, v_now)
        else null
      end,
      sla_elapsed_seconds = case when v_has_policy then v_elapsed_seconds else 0 end,
      sla_paused_at = case when v_has_policy then v_state.sla_paused_at else null end,
      sla_breached_at = case
        when v_has_policy
          and v_state.sla_breached_at is not null
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

create or replace function public.m5_triage_materialize_due_work(p_organization_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_suppression public.vulnerability_finding_suppressions%rowtype;
  v_state public.vulnerability_finding_triage_states%rowtype;
  v_new_state record;
  v_count integer := 0;
  v_row_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  for v_new_state in
    select
      finding.id as finding_id,
      severity.value as severity,
      policy.version as policy_version,
      policy.target_minutes as target_minutes
    from public.vulnerability_findings finding
    cross join lateral (
      select public.m5_triage_finding_severity(
        finding.organization_id,
        finding.id
      ) as value
    ) severity
    join public.vulnerability_triage_sla_policies policy
      on policy.organization_id = finding.organization_id
      and policy.severity = severity.value
      and policy.enabled
    left join public.vulnerability_finding_triage_states state
      on state.organization_id = finding.organization_id
      and state.finding_id = finding.id
    where finding.organization_id = p_organization_id
      and finding.status = 'active'
      and state.finding_id is null
      and finding.created_at >= policy.updated_at
    order by finding.created_at, finding.id
  loop
    insert into public.vulnerability_finding_triage_states(
      organization_id,
      finding_id,
      last_observed_severity,
      sla_severity,
      sla_policy_version,
      sla_target_minutes,
      sla_started_at
    ) values (
      p_organization_id,
      v_new_state.finding_id,
      v_new_state.severity,
      v_new_state.severity,
      v_new_state.policy_version,
      v_new_state.target_minutes,
      v_now
    )
    on conflict (organization_id, finding_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_count := v_count + v_row_count;
  end loop;

  perform public.m5_triage_ensure_state(p_organization_id, stale.finding_id, null)
  from public.vulnerability_finding_triage_states stale
  join public.vulnerability_findings finding
    on finding.organization_id = stale.organization_id
    and finding.id = stale.finding_id
  where stale.organization_id = p_organization_id
    and finding.status = 'active';

  for v_suppression in
    select *
    from public.vulnerability_finding_suppressions suppression
    where suppression.organization_id = p_organization_id
      and suppression.is_current
      and suppression.expires_at <= v_now
    order by suppression.expires_at, suppression.id
    for update skip locked
  loop
    update public.vulnerability_finding_suppressions
    set is_current = false,
        ended_at = v_now,
        ended_reason = 'expired'
    where organization_id = p_organization_id
      and id = v_suppression.id;

    update public.vulnerability_finding_triage_states
    set sla_paused_at = null,
        updated_at = v_now,
        version = version + 1
    where organization_id = p_organization_id
      and finding_id = v_suppression.finding_id;

    insert into public.vulnerability_triage_alert_events(
      organization_id,
      finding_id,
      suppression_id,
      event_kind,
      event_key
    ) values (
      p_organization_id,
      v_suppression.finding_id,
      v_suppression.id,
      'suppression_expired',
      'suppression_expired:' || v_suppression.id::text
    )
    on conflict (organization_id, event_key) do nothing;
    v_count := v_count + 1;
  end loop;

  for v_state in
    select state.*
    from public.vulnerability_finding_triage_states state
    join public.vulnerability_findings finding
      on finding.organization_id = state.organization_id
      and finding.id = state.finding_id
      and finding.status = 'active'
    where state.organization_id = p_organization_id
      and state.sla_target_minutes is not null
      and state.sla_paused_at is null
      and state.sla_breached_at is null
    for update of state skip locked
  loop
    if v_state.sla_elapsed_seconds + greatest(
      0,
      extract(
        epoch from v_now - greatest(v_state.sla_started_at, v_state.updated_at)
      )::bigint
    ) >= v_state.sla_target_minutes::bigint * 60 then
      update public.vulnerability_finding_triage_states
      set sla_breached_at = v_now,
          updated_at = v_now,
          version = version + 1
      where organization_id = p_organization_id
        and finding_id = v_state.finding_id;

      insert into public.vulnerability_triage_alert_events(
        organization_id,
        finding_id,
        event_kind,
        event_key
      ) values (
        p_organization_id,
        v_state.finding_id,
        'internal_sla_breached',
        'internal_sla_breached:' || v_state.finding_id::text
      )
      on conflict (organization_id, event_key) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.list_due_vulnerability_triage_alert_organizations(p_limit integer default 1000)
returns table(organization_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 1000 then
    return;
  end if;

  perform public.m5_triage_materialize_due_work(candidate.organization_id)
  from (
    select distinct suppression.organization_id
    from public.vulnerability_finding_suppressions suppression
    where suppression.is_current
      and suppression.expires_at <= clock_timestamp()
    union
    select distinct state.organization_id
    from public.vulnerability_finding_triage_states state
    where state.sla_target_minutes is not null
      and state.sla_paused_at is null
      and state.sla_breached_at is null
    union
    select distinct finding.organization_id
    from public.vulnerability_findings finding
    cross join lateral (
      select public.m5_triage_finding_severity(
        finding.organization_id,
        finding.id
      ) as value
    ) severity
    join public.vulnerability_triage_sla_policies policy
      on policy.organization_id = finding.organization_id
      and policy.severity = severity.value
      and policy.enabled
    left join public.vulnerability_finding_triage_states state
      on state.organization_id = finding.organization_id
      and state.finding_id = finding.id
    where finding.status = 'active'
      and state.finding_id is null
      and finding.created_at >= policy.updated_at
    limit p_limit
  ) candidate;

  return query
  select distinct event.organization_id
  from public.vulnerability_triage_alert_events event
  where event.due_at <= clock_timestamp()
    and (
      event.state in ('queued', 'retrying')
      or (event.state = 'leased' and event.lease_expires_at <= clock_timestamp())
    )
  order by event.organization_id
  limit p_limit;
end;
$$;

alter function public.m5_triage_ensure_state(uuid, uuid, uuid) owner to postgres;
alter function public.m5_triage_materialize_due_work(uuid) owner to postgres;
alter function public.list_due_vulnerability_triage_alert_organizations(integer) owner to postgres;
revoke all on function public.m5_triage_ensure_state(uuid, uuid, uuid),
  public.m5_triage_materialize_due_work(uuid),
  public.list_due_vulnerability_triage_alert_organizations(integer)
  from public, anon, authenticated;
grant execute on function public.list_due_vulnerability_triage_alert_organizations(integer)
  to service_role;
