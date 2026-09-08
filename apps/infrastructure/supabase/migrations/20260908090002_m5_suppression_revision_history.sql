-- An expired revision is history, not a reusable number. The state row is
-- already locked by m5_triage_ensure_state before this maximum is read.
create or replace function public.suppress_finding_triage_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid,
  p_reason text,
  p_expires_at timestamptz,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.vulnerability_finding_triage_states%rowtype;
  v_current public.vulnerability_finding_suppressions%rowtype;
  v_new public.vulnerability_finding_suppressions%rowtype;
  v_existing record;
  v_result jsonb;
  v_digest text;
  v_next_revision integer;
  v_has_current boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_actor_user_id is null or p_finding_id is null
    or p_idempotency_key is null or p_expected_version is null
    or p_expected_version < 0
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 2000
    or p_expires_at is null or p_expires_at <= v_now
    or p_expires_at > v_now + interval '10 years'
    or not public.m5_triage_actor_can_edit_findings(
      p_organization_id,
      p_actor_user_id
    ) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  if not exists (
    select 1 from public.vulnerability_findings finding
    where finding.organization_id = p_organization_id
      and finding.id = p_finding_id
      and finding.status = 'active'
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  v_digest := encode(
    extensions.digest(
      jsonb_build_object(
        'findingId', p_finding_id,
        'reason', btrim(p_reason),
        'expiresAt', p_expires_at,
        'expectedVersion', p_expected_version
      )::text,
      'sha256'
    ),
    'hex'
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select * into v_existing from public.m5_triage_command_result(
    p_organization_id,
    p_actor_user_id,
    p_idempotency_key,
    'suppress',
    v_digest
  );
  if found then
    return query select v_existing.outcome, v_existing.result;
    return;
  end if;

  select * into v_state from public.m5_triage_ensure_state(
    p_organization_id,
    p_finding_id,
    p_actor_user_id
  );
  if p_expected_version <> v_state.version then
    return query select
      'conflict'::text,
      public.m5_triage_state_json(p_organization_id, p_finding_id);
    return;
  end if;

  select * into v_current
  from public.vulnerability_finding_suppressions suppression
  where suppression.organization_id = p_organization_id
    and suppression.finding_id = p_finding_id
    and suppression.is_current
  for update;
  v_has_current := found;

  select coalesce(max(suppression.revision), 0) + 1 into v_next_revision
  from public.vulnerability_finding_suppressions suppression
  where suppression.organization_id = p_organization_id
    and suppression.finding_id = p_finding_id;

  if v_has_current then
    update public.vulnerability_finding_suppressions
    set is_current = false, ended_at = v_now, ended_reason = 'extended'
    where organization_id = p_organization_id and id = v_current.id;
  end if;

  insert into public.vulnerability_finding_suppressions(
    organization_id,
    finding_id,
    revision,
    reason,
    expires_at,
    created_by
  ) values (
    p_organization_id,
    p_finding_id,
    v_next_revision,
    btrim(p_reason),
    p_expires_at,
    p_actor_user_id
  ) returning * into v_new;

  update public.vulnerability_finding_triage_states
  set
    sla_elapsed_seconds = sla_elapsed_seconds + case
      when sla_started_at is not null and sla_paused_at is null then greatest(
        0,
        extract(epoch from v_now - greatest(sla_started_at, updated_at))::bigint
      )
      else 0
    end,
    sla_paused_at = coalesce(sla_paused_at, v_now),
    version = version + 1,
    updated_at = v_now,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and finding_id = p_finding_id;

  v_result := jsonb_build_object(
    'operational',
    public.m5_triage_state_json(p_organization_id, p_finding_id)
  );
  insert into public.vulnerability_triage_commands(
    organization_id,
    actor_user_id,
    idempotency_key,
    operation,
    request_digest,
    result
  ) values (
    p_organization_id,
    p_actor_user_id,
    p_idempotency_key,
    'suppress',
    v_digest,
    v_result
  );
  insert into public.audit_logs(
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    changes
  ) values (
    p_organization_id,
    p_actor_user_id,
    'vulnerability.triage_suppressed',
    'vulnerability_finding_suppression',
    v_new.id::text,
    jsonb_build_object(
      'findingId', p_finding_id,
      'reason', v_new.reason,
      'expiresAt', v_new.expires_at,
      'correlationId', p_correlation_id,
      'idempotencyKey', p_idempotency_key
    )
  );

  return query select
    case when v_has_current then 'extended' else 'suppressed' end,
    v_result;
end;
$$;

alter function public.suppress_finding_triage_atomic(
  uuid, uuid, uuid, text, timestamptz, integer, uuid, uuid
) owner to postgres;
revoke all on function public.suppress_finding_triage_atomic(
  uuid, uuid, uuid, text, timestamptz, integer, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.suppress_finding_triage_atomic(
  uuid, uuid, uuid, text, timestamptz, integer, uuid, uuid
) to service_role;

-- These private permission helpers are referenced by all triage mutations.
-- Re-declare them in the repair migration so a database that applied the
-- original additive migration before its final helper definitions remains
-- fail-closed rather than returning a generic service failure.
create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_key text
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role
    from public.organization_members member
    join public.users user_record
      on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization
      on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role,
      case p_permission_key
        when 'can_edit_findings' then role in ('owner', 'admin')
        when 'can_edit_organization' then role = 'owner'
        else false
      end as granted
    from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership
    join public.user_role_assignments assignment
      on assignment.organization_id = p_organization_id
      and assignment.user_id = p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id = p_organization_id
      and custom_role.id = assignment.role_id
    where custom_role.is_active
      and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key) = 'boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case
      when jsonb_typeof(permission_override.permissions -> p_permission_key) = 'boolean'
        then (permission_override.permissions ->> p_permission_key)::boolean
    end as granted
    from base_permissions base_permission
    left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id = p_organization_id
      and permission_override.base_role = base_permission.role
  )
  select coalesce(
    (select granted from override_permissions where granted is not null limit 1),
    (
      select coalesce(base_permissions.granted, false)
        or coalesce(custom_permissions.granted, false)
      from base_permissions cross join custom_permissions
    ),
    false
  )
$$;

create or replace function public.m5_triage_actor_can_edit_findings(
  p_organization_id uuid,
  p_actor_user_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.m5_triage_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'can_edit_findings'
  )
$$;

alter function public.m5_triage_actor_has_permission(uuid, uuid, text)
  owner to postgres;
alter function public.m5_triage_actor_can_edit_findings(uuid, uuid)
  owner to postgres;
revoke all on function public.m5_triage_actor_has_permission(uuid, uuid, text),
  public.m5_triage_actor_can_edit_findings(uuid, uuid)
  from public, anon, authenticated;
