-- CRA-M5-04: finite finding suppressions and internal-only remediation SLA
-- alerts. This is deliberately separate from VEX and regulatory workflows.

create table public.vulnerability_finding_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  revision integer not null check (revision > 0),
  reason text not null check (reason = btrim(reason) and char_length(reason) between 1 and 2000),
  expires_at timestamptz not null,
  is_current boolean not null default true,
  ended_at timestamptz,
  ended_reason text check (ended_reason is null or ended_reason in ('extended', 'expired', 'superseded')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, finding_id, revision),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  check (expires_at > created_at),
  check ((is_current and ended_at is null and ended_reason is null)
    or (not is_current and ended_at is not null and ended_reason is not null))
);
create unique index vulnerability_finding_suppressions_one_current_idx
  on public.vulnerability_finding_suppressions(organization_id, finding_id) where is_current;
create index vulnerability_finding_suppressions_expiry_idx
  on public.vulnerability_finding_suppressions(organization_id, expires_at, id) where is_current;

create table public.vulnerability_triage_sla_policies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'unknown')),
  enabled boolean not null,
  target_minutes integer check (target_minutes between 1 and 5256000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  primary key (organization_id, severity),
  check ((enabled and target_minutes is not null) or (not enabled and target_minutes is null))
);
create trigger set_vulnerability_triage_sla_policies_updated_at
  before update on public.vulnerability_triage_sla_policies
  for each row execute function public.set_updated_at();

create table public.vulnerability_finding_triage_states (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  assignee_user_id uuid references public.users(id) on delete restrict,
  sla_severity text check (sla_severity is null or sla_severity in ('critical', 'high', 'medium', 'low', 'unknown')),
  sla_policy_version integer check (sla_policy_version is null or sla_policy_version > 0),
  sla_target_minutes integer check (sla_target_minutes is null or sla_target_minutes between 1 and 5256000),
  sla_started_at timestamptz,
  sla_elapsed_seconds bigint not null default 0 check (sla_elapsed_seconds >= 0),
  sla_paused_at timestamptz,
  sla_breached_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.users(id) on delete restrict,
  primary key (organization_id, finding_id),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  foreign key (organization_id, assignee_user_id)
    references public.organization_members(organization_id, user_id) on delete restrict,
  check ((sla_target_minutes is null and sla_severity is null and sla_policy_version is null and sla_started_at is null)
    or (sla_target_minutes is not null and sla_severity is not null and sla_policy_version is not null and sla_started_at is not null))
);
create index vulnerability_finding_triage_states_assignee_idx
  on public.vulnerability_finding_triage_states(organization_id, assignee_user_id, updated_at desc, finding_id);
create index vulnerability_finding_triage_states_sla_due_idx
  on public.vulnerability_finding_triage_states(organization_id, sla_breached_at, sla_paused_at)
  where sla_target_minutes is not null;

create table public.vulnerability_triage_alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  suppression_id uuid references public.vulnerability_finding_suppressions(id) on delete cascade,
  event_kind text not null check (event_kind in ('suppression_expired', 'internal_sla_breached')),
  event_key text not null check (event_key ~ '^[a-z0-9:_-]{1,200}$'),
  state text not null default 'queued' check (state in ('queued', 'leased', 'retrying', 'delivered', 'dead_letter', 'recipient_unavailable', 'skipped_superseded', 'skipped_deleted')),
  due_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 12 check (max_attempts between 1 and 20),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  error_message text check (error_message is null or char_length(btrim(error_message)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, event_key),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  check ((lease_owner is null) = (lease_expires_at is null)),
  check ((event_kind = 'suppression_expired' and suppression_id is not null)
    or (event_kind = 'internal_sla_breached' and suppression_id is null))
);
create index vulnerability_triage_alert_events_due_idx
  on public.vulnerability_triage_alert_events(organization_id, due_at, id)
  where state in ('queued', 'retrying');
create trigger set_vulnerability_triage_alert_events_updated_at
  before update on public.vulnerability_triage_alert_events
  for each row execute function public.set_updated_at();

-- Idempotency is durable because mutations are intentionally never replayed by
-- the browser transport. Keeping this ledger local avoids a cross-feature bus.
create table public.vulnerability_triage_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('assign', 'suppress', 'set_sla_policy')),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, actor_user_id, idempotency_key)
);

alter table public.vulnerability_finding_suppressions enable row level security;
alter table public.vulnerability_triage_sla_policies enable row level security;
alter table public.vulnerability_finding_triage_states enable row level security;
alter table public.vulnerability_triage_alert_events enable row level security;
alter table public.vulnerability_triage_commands enable row level security;
grant all on table public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies,
  public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events,
  public.vulnerability_triage_commands to service_role;
revoke all on table public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies,
  public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events,
  public.vulnerability_triage_commands from public, anon, authenticated;

create or replace function public.m5_triage_finding_severity(p_organization_id uuid, p_finding_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce((i.intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) < 0 then 'unknown'
    when (i.intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 9 then 'critical'
    when (i.intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 7 then 'high'
    when (i.intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 4 then 'medium' else 'low' end
  from public.vulnerability_findings f
  cross join lateral (select public.m4_03_intelligence_with_provenance_json(
    f.vulnerability_id, f.last_evaluated_at
  ) as intelligence) i
  where f.organization_id = p_organization_id and f.id = p_finding_id
$$;

create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select m.role
    from public.organization_members m
    join public.users u on u.id = m.user_id and u.is_active
    join public.organizations o on o.id = m.organization_id and o.is_active
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
  ), base_permissions as (
    select role,
      case p_permission_key
        when 'can_edit_findings' then role in ('owner', 'admin')
        when 'can_edit_organization' then role = 'owner'
        else false
      end as granted
    from membership
  ), custom_permissions as (
    select bool_or((roles.permissions ->> p_permission_key)::boolean) as granted
    from membership m
    join public.user_role_assignments assignments
      on assignments.organization_id = p_organization_id and assignments.user_id = p_actor_user_id
    join public.custom_roles roles
      on roles.organization_id = p_organization_id and roles.id = assignments.role_id
    where roles.is_active and not roles.is_deleted
      and jsonb_typeof(roles.permissions -> p_permission_key) = 'boolean'
      and (roles.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(overrides.permissions -> p_permission_key) = 'boolean'
      then (overrides.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base
    left join public.base_role_permission_overrides overrides
      on overrides.organization_id = p_organization_id and overrides.base_role = base.role
  )
  select coalesce(
    (select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted, false) or coalesce(custom_permissions.granted, false)
       from base_permissions cross join custom_permissions),
    false
  )
$$;

create or replace function public.m5_triage_actor_can_edit_findings(p_organization_id uuid, p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_findings')
$$;

create or replace function public.m5_triage_actor_can_configure_sla(p_organization_id uuid, p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m join public.users u on u.id = m.user_id and u.is_active
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id and m.role = 'owner'
  ) and public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_organization')
$$;

create or replace function public.m5_triage_active_member(p_organization_id uuid, p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_organization_id is not null and p_actor_user_id is not null
    and public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
$$;

create or replace function public.m5_triage_command_result(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid, p_operation text, p_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_command public.vulnerability_triage_commands%rowtype;
begin
  select * into v_command from public.vulnerability_triage_commands c
  where c.organization_id = p_organization_id and c.actor_user_id = p_actor_user_id
    and c.idempotency_key = p_idempotency_key for update;
  if not found then return; end if;
  if v_command.operation <> p_operation or v_command.request_digest <> p_digest then
    return query select 'idempotency_conflict'::text, null::jsonb;
  else return query select 'idempotent'::text, v_command.result;
  end if;
end;
$$;

create or replace function public.m5_triage_state_json(p_organization_id uuid, p_finding_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  -- Replaced with the contract projection after its helper is declared below.
  -- No mutation can call this helper until this forward migration completes.
  select null::jsonb
$$;

create or replace function public.m5_triage_ensure_state(
  p_organization_id uuid, p_finding_id uuid, p_actor_user_id uuid
) returns public.vulnerability_finding_triage_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state public.vulnerability_finding_triage_states%rowtype; v_severity text; v_has_state boolean;
  v_policy public.vulnerability_triage_sla_policies%rowtype;
begin
  select * into v_state from public.vulnerability_finding_triage_states s
  where s.organization_id = p_organization_id and s.finding_id = p_finding_id for update;
  v_has_state := found;
  v_severity := public.m5_triage_finding_severity(p_organization_id, p_finding_id);
  if not v_has_state then
    select * into v_policy from public.vulnerability_triage_sla_policies p
      where p.organization_id = p_organization_id and p.severity = v_severity and p.enabled;
    insert into public.vulnerability_finding_triage_states(
      organization_id, finding_id, sla_severity, sla_policy_version, sla_target_minutes, sla_started_at, updated_by
    ) values (p_organization_id, p_finding_id,
      case when found then v_severity else null end, case when found then v_policy.version else null end,
      case when found then v_policy.target_minutes else null end, case when found then clock_timestamp() else null end,
      p_actor_user_id) returning * into v_state;
  elsif v_state.sla_severity is distinct from v_severity then
    select * into v_policy from public.vulnerability_triage_sla_policies p
      where p.organization_id = p_organization_id and p.severity = v_severity and p.enabled;
    update public.vulnerability_finding_triage_states set
      sla_severity = case when found then v_severity else null end,
      sla_policy_version = case when found then v_policy.version else null end,
      sla_target_minutes = case when found then v_policy.target_minutes else null end,
      sla_started_at = case when found then coalesce(v_state.sla_started_at, clock_timestamp()) else null end,
      sla_elapsed_seconds = sla_elapsed_seconds + case when sla_started_at is not null and sla_paused_at is null
        then greatest(0, extract(epoch from clock_timestamp() - greatest(sla_started_at, updated_at))::bigint) else 0 end,
      version = version + 1, updated_at = clock_timestamp(), updated_by = p_actor_user_id
    where organization_id = p_organization_id and finding_id = p_finding_id returning * into v_state;
  end if;
  return v_state;
end;
$$;

create or replace function public.assign_finding_triage_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid, p_assignee_user_id uuid,
  p_expected_version integer, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state public.vulnerability_finding_triage_states%rowtype; v_existing record; v_result jsonb; v_digest text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_finding_id is null or p_idempotency_key is null
    or p_expected_version is null or p_expected_version < 0
    or not public.m5_triage_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_assignee_user_id is not null and not public.m5_triage_actor_can_edit_findings(p_organization_id, p_assignee_user_id) then
    return query select 'assignee_unavailable'::text, null::jsonb; return;
  end if;
  if not exists (select 1 from public.vulnerability_findings f where f.organization_id = p_organization_id
    and f.id = p_finding_id and f.status = 'active') then return query select 'not_found'::text, null::jsonb; return; end if;
  v_digest := encode(extensions.digest(jsonb_build_object('findingId', p_finding_id, 'assigneeUserId', p_assignee_user_id,
    'expectedVersion', p_expected_version)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'assign',v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_state from public.m5_triage_ensure_state(p_organization_id,p_finding_id,p_actor_user_id);
  if p_expected_version <> v_state.version then return query select 'conflict'::text, public.m5_triage_state_json(p_organization_id,p_finding_id); return; end if;
  update public.vulnerability_finding_triage_states set assignee_user_id = p_assignee_user_id,
    sla_elapsed_seconds = sla_elapsed_seconds + case when sla_started_at is not null and sla_paused_at is null
      then greatest(0, extract(epoch from clock_timestamp() - greatest(sla_started_at, updated_at))::bigint) else 0 end,
    version = version + 1, updated_at = clock_timestamp(), updated_by = p_actor_user_id
    where organization_id = p_organization_id and finding_id = p_finding_id;
  v_result := jsonb_build_object('operational', public.m5_triage_state_json(p_organization_id,p_finding_id));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
    values(p_organization_id,p_actor_user_id,p_idempotency_key,'assign',v_digest,v_result);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values
    (p_organization_id,p_actor_user_id,'vulnerability.triage_assignee_changed','vulnerability_finding',p_finding_id::text,
      jsonb_build_object('assigneeUserId',p_assignee_user_id,'correlationId',p_correlation_id,'idempotencyKey',p_idempotency_key));
  return query select 'updated'::text, v_result;
end;
$$;

create or replace function public.suppress_finding_triage_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid, p_reason text, p_expires_at timestamptz,
  p_expected_version integer, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state public.vulnerability_finding_triage_states%rowtype; v_current public.vulnerability_finding_suppressions%rowtype;
  v_new public.vulnerability_finding_suppressions%rowtype; v_existing record; v_result jsonb; v_digest text; v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_actor_user_id is null or p_finding_id is null or p_idempotency_key is null
    or p_expected_version is null or p_expected_version < 0 or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000
    or p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '10 years'
    or not public.m5_triage_actor_can_edit_findings(p_organization_id,p_actor_user_id) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not exists (select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active') then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'reason',btrim(p_reason),
    'expiresAt',p_expires_at,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text,0));
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'suppress',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_state from public.m5_triage_ensure_state(p_organization_id,p_finding_id,p_actor_user_id);
  if p_expected_version <> v_state.version then return query select 'conflict'::text,public.m5_triage_state_json(p_organization_id,p_finding_id); return; end if;
  select * into v_current from public.vulnerability_finding_suppressions s where s.organization_id=p_organization_id and s.finding_id=p_finding_id and s.is_current for update;
  if found then update public.vulnerability_finding_suppressions set is_current=false, ended_at=v_now, ended_reason='extended'
    where organization_id=p_organization_id and id=v_current.id; end if;
  insert into public.vulnerability_finding_suppressions(organization_id,finding_id,revision,reason,expires_at,created_by)
    values(p_organization_id,p_finding_id,coalesce(v_current.revision,0)+1,btrim(p_reason),p_expires_at,p_actor_user_id) returning * into v_new;
  update public.vulnerability_finding_triage_states set
    sla_elapsed_seconds = sla_elapsed_seconds + case when sla_started_at is not null and sla_paused_at is null
      then greatest(0,extract(epoch from v_now - greatest(sla_started_at,updated_at))::bigint) else 0 end,
    sla_paused_at = coalesce(sla_paused_at,v_now), version=version+1, updated_at=v_now, updated_by=p_actor_user_id
    where organization_id=p_organization_id and finding_id=p_finding_id;
  v_result:=jsonb_build_object('operational',public.m5_triage_state_json(p_organization_id,p_finding_id));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
    values(p_organization_id,p_actor_user_id,p_idempotency_key,'suppress',v_digest,v_result);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values
    (p_organization_id,p_actor_user_id,'vulnerability.triage_suppressed','vulnerability_finding_suppression',v_new.id::text,
      jsonb_build_object('findingId',p_finding_id,'reason',v_new.reason,'expiresAt',v_new.expires_at,
        'correlationId',p_correlation_id,'idempotencyKey',p_idempotency_key));
  return query select case when v_current.id is null then 'suppressed' else 'extended' end,v_result;
end;
$$;

create or replace function public.set_vulnerability_triage_sla_policy_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_severity text, p_enabled boolean, p_target_minutes integer,
  p_expected_version integer, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_policy public.vulnerability_triage_sla_policies%rowtype; v_existing record; v_result jsonb; v_digest text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_severity not in ('critical','high','medium','low','unknown')
    or p_enabled is null or p_idempotency_key is null or p_expected_version is null or p_expected_version < 0
    or (p_enabled and p_target_minutes not between 1 and 5256000) or (not p_enabled and p_target_minutes is not null)
    or not public.m5_triage_actor_can_configure_sla(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('severity',p_severity,'enabled',p_enabled,'targetMinutes',p_target_minutes,
    'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text,0));
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'set_sla_policy',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_policy from public.vulnerability_triage_sla_policies p where p.organization_id=p_organization_id and p.severity=p_severity for update;
  if found and v_policy.version<>p_expected_version then return query select 'conflict'::text,
    jsonb_build_object('policy',jsonb_build_object('severity',v_policy.severity,'enabled',v_policy.enabled,
      'targetMinutes',v_policy.target_minutes,'version',v_policy.version)); return; end if;
  if not found and p_expected_version<>0 then return query select 'conflict'::text,null::jsonb; return; end if;
  insert into public.vulnerability_triage_sla_policies(organization_id,severity,enabled,target_minutes,created_by,updated_by)
    values(p_organization_id,p_severity,p_enabled,p_target_minutes,p_actor_user_id,p_actor_user_id)
    on conflict(organization_id,severity) do update set enabled=excluded.enabled,target_minutes=excluded.target_minutes,
      version=public.vulnerability_triage_sla_policies.version+1,updated_by=excluded.updated_by
    returning * into v_policy;
  v_result:=jsonb_build_object('policy',jsonb_build_object('severity',v_policy.severity,'enabled',v_policy.enabled,
    'targetMinutes',v_policy.target_minutes,'version',v_policy.version,'updatedAt',v_policy.updated_at,
    'updatedByUserId',v_policy.updated_by));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result)
    values(p_organization_id,p_actor_user_id,p_idempotency_key,'set_sla_policy',v_digest,v_result);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values
    (p_organization_id,p_actor_user_id,'vulnerability.triage_sla_policy_changed','vulnerability_triage_sla_policy',p_severity,
      jsonb_build_object('after',v_result,'correlationId',p_correlation_id,'idempotencyKey',p_idempotency_key));
  return query select 'updated'::text,v_result;
end;
$$;

create or replace function public.list_vulnerability_triage_sla_policies(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,result jsonb) language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_build_object('policies',coalesce((select jsonb_agg(jsonb_build_object(
    'severity',severity.value,'enabled',coalesce(p.enabled,false),'targetMinutes',p.target_minutes,
    'version',coalesce(p.version,1),'updatedAt',coalesce(p.updated_at,clock_timestamp()),'updatedByUserId',p.updated_by)
    order by severity.ordinality)
    from unnest(array['critical','high','medium','low','unknown']) with ordinality severity(value,ordinality)
    left join public.vulnerability_triage_sla_policies p on p.organization_id=p_organization_id and p.severity=severity.value),'[]'::jsonb));
end;
$$;

create or replace function public.m5_triage_materialize_due_work(p_organization_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_suppression public.vulnerability_finding_suppressions%rowtype; v_state public.vulnerability_finding_triage_states%rowtype;
  v_count integer:=0; v_now timestamptz:=clock_timestamp();
begin
  -- Severity is source-fed and can change without a user mutation. Refreshing
  -- the snapshot here preserves accrued elapsed time while applying only the
  -- new severity's current policy.
  perform public.m5_triage_ensure_state(p_organization_id, stale.finding_id, null)
  from public.vulnerability_finding_triage_states stale
  join public.vulnerability_findings findings
    on findings.organization_id = stale.organization_id and findings.id = stale.finding_id
  where stale.organization_id = p_organization_id and findings.status = 'active';
  for v_suppression in select * from public.vulnerability_finding_suppressions s where s.organization_id=p_organization_id
    and s.is_current and s.expires_at<=v_now order by s.expires_at,s.id for update skip locked loop
    update public.vulnerability_finding_suppressions set is_current=false,ended_at=v_now,ended_reason='expired' where id=v_suppression.id;
    update public.vulnerability_finding_triage_states set sla_paused_at=null,updated_at=v_now,
      version=version+1 where organization_id=p_organization_id and finding_id=v_suppression.finding_id;
    insert into public.vulnerability_triage_alert_events(organization_id,finding_id,suppression_id,event_kind,event_key)
      values(p_organization_id,v_suppression.finding_id,v_suppression.id,'suppression_expired','suppression_expired:'||v_suppression.id::text)
      on conflict(organization_id,event_key) do nothing;
    v_count:=v_count+1;
  end loop;
  for v_state in select s.* from public.vulnerability_finding_triage_states s join public.vulnerability_findings f
    on f.organization_id=s.organization_id and f.id=s.finding_id and f.status='active'
    where s.organization_id=p_organization_id and s.sla_target_minutes is not null and s.sla_paused_at is null
      and s.sla_breached_at is null for update of s skip locked loop
    if v_state.sla_elapsed_seconds + greatest(0,extract(epoch from v_now - greatest(v_state.sla_started_at,v_state.updated_at))::bigint)
      >= v_state.sla_target_minutes::bigint*60 then
      update public.vulnerability_finding_triage_states set sla_breached_at=v_now,updated_at=v_now,version=version+1
        where organization_id=p_organization_id and finding_id=v_state.finding_id;
      insert into public.vulnerability_triage_alert_events(organization_id,finding_id,event_kind,event_key)
        values(p_organization_id,v_state.finding_id,'internal_sla_breached','internal_sla_breached:'||v_state.finding_id::text)
        on conflict(organization_id,event_key) do nothing;
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.list_due_vulnerability_triage_alert_organizations(p_limit integer default 1000)
returns table(organization_id uuid) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 1000 then return; end if;
  -- Materialization happens before selection so expiry restores actionability
  -- even when no notification provider is available.
  perform public.m5_triage_materialize_due_work(o.organization_id) from (
    select distinct suppressions.organization_id from public.vulnerability_finding_suppressions suppressions where suppressions.is_current and suppressions.expires_at<=clock_timestamp()
    union
    select distinct states.organization_id from public.vulnerability_finding_triage_states states
      where states.sla_target_minutes is not null and states.sla_paused_at is null and states.sla_breached_at is null
    limit p_limit
  ) o;
  return query select distinct e.organization_id from public.vulnerability_triage_alert_events e
    where e.due_at<=clock_timestamp() and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp()))
    order by e.organization_id limit p_limit;
end;
$$;

create or replace function public.claim_vulnerability_triage_alert(p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120)
returns table(outcome text,alert_event jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.vulnerability_triage_alert_events%rowtype;
begin
  if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100
    or p_lease_seconds not between 10 and 3600 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  perform public.m5_triage_materialize_due_work(p_organization_id);
  select * into v_event from public.vulnerability_triage_alert_events e where e.organization_id=p_organization_id and e.due_at<=clock_timestamp()
    and (e.state in ('queued','retrying') or (e.state='leased' and e.lease_expires_at<=clock_timestamp())) order by e.due_at,e.id for update skip locked limit 1;
  if not found then return query select 'none_due'::text,null::jsonb; return; end if;
  update public.vulnerability_triage_alert_events set state='leased',attempts=attempts+1,last_attempt_at=clock_timestamp(),
    lease_owner=btrim(p_worker_id),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),error_code=null,error_message=null
    where organization_id=p_organization_id and id=v_event.id returning * into v_event;
  return query select 'claimed'::text,jsonb_build_object('id',v_event.id,'kind',v_event.event_kind,'findingId',v_event.finding_id,'attempts',v_event.attempts);
end;
$$;

create or replace function public.get_vulnerability_triage_alert_details(p_organization_id uuid,p_event_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_event public.vulnerability_triage_alert_events%rowtype; v_recipient record; v_severity text;
begin
  select * into v_event from public.vulnerability_triage_alert_events e where e.organization_id=p_organization_id and e.id=p_event_id;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_event.finding_id) then
    return query select 'skipped_deleted'::text,null::jsonb; return;
  end if;
  if exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_event.finding_id and f.status='superseded') then
    return query select 'skipped_superseded'::text,null::jsonb; return;
  end if;
  select s.assignee_user_id,u.email,u.id into v_recipient from public.vulnerability_finding_triage_states s
    join public.users u on u.id=s.assignee_user_id and u.is_active
    where s.organization_id=p_organization_id and s.finding_id=v_event.finding_id
      and public.m5_triage_actor_can_edit_findings(p_organization_id,s.assignee_user_id);
  if not found then select u.id,u.email into v_recipient from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
    where m.organization_id=p_organization_id and m.role in ('owner','admin') and public.m5_triage_actor_can_edit_findings(p_organization_id,m.user_id)
    order by case m.role when 'owner' then 0 else 1 end,u.id limit 1; end if;
  if not found then return query select 'recipient_unavailable'::text,null::jsonb; return; end if;
  v_severity:=public.m5_triage_finding_severity(p_organization_id,v_event.finding_id);
  return query select 'found'::text,jsonb_build_object('recipient',jsonb_build_object('userId',v_recipient.id,'email',v_recipient.email),
    'alert',jsonb_build_object('kind',v_event.event_kind,'findingId',v_event.finding_id,
      'advisoryId',(select canonical_advisory_id from public.vulnerability_findings where organization_id=p_organization_id and id=v_event.finding_id),
      'severity',v_severity,'internalOnly',true,'regulatoryDeadlineChanged',false));
end;
$$;

create or replace function public.complete_vulnerability_triage_alert(
  p_organization_id uuid,p_event_id uuid,p_worker_id text,p_delivered boolean,p_error_code text default null,p_error_message text default null
) returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.vulnerability_triage_alert_events%rowtype;
begin
  if p_organization_id is null or p_event_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_delivered is null
    or (not p_delivered and (btrim(coalesce(p_error_code,'')) !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
      or (p_error_code not in ('recipient_unavailable','skipped_superseded','skipped_deleted') and char_length(btrim(coalesce(p_error_message,''))) not between 1 and 1000)
      or (p_error_code in ('recipient_unavailable','skipped_superseded','skipped_deleted') and p_error_message is not null and char_length(btrim(p_error_message)) not between 1 and 1000))) then
    return query select 'invalid_request'::text; return;
  end if;
  select * into v_event from public.vulnerability_triage_alert_events e where e.organization_id=p_organization_id and e.id=p_event_id for update;
  if not found then return query select 'not_found'::text; return; end if;
  if v_event.state<>'leased' or v_event.lease_owner<>btrim(p_worker_id) or v_event.lease_expires_at<=clock_timestamp() then return query select 'conflict'::text; return; end if;
  if p_delivered then update public.vulnerability_triage_alert_events set state='delivered',delivered_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,error_code=null,error_message=null where id=v_event.id;
    return query select 'delivered'::text; return; end if;
  update public.vulnerability_triage_alert_events set state=case when p_error_code in ('recipient_unavailable','skipped_superseded','skipped_deleted') then p_error_code
      when attempts>=max_attempts then 'dead_letter' else 'retrying' end,
    due_at=case when attempts>=max_attempts then due_at else clock_timestamp()+make_interval(secs=>least(900,30*power(2,greatest(0,attempts-1))::integer)) end,
    lease_owner=null,lease_expires_at=null,error_code=btrim(p_error_code),error_message=btrim(p_error_message) where id=v_event.id;
  return query select case when p_error_code in ('recipient_unavailable','skipped_superseded','skipped_deleted') then p_error_code
    when v_event.attempts>=v_event.max_attempts then 'dead_letter' else 'retry_scheduled' end;
end;
$$;

-- Additive projection wrapper: the existing queue/detail payload remains
-- unchanged except for its parsed `operational` member.
create or replace function public.m5_triage_operational_json(p_organization_id uuid, p_finding_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'version', coalesce(s.version, 1),
    'assignee', case when s.assignee_user_id is null then null else jsonb_build_object('userId', s.assignee_user_id,
      'displayName', left(coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email), 500)) end,
    'suppression', case when x.id is null then jsonb_build_object('state', 'actionable', 'reason', null,
      'expiresAt', null, 'revision', null) else jsonb_build_object('state', 'suppressed', 'reason', x.reason,
      'expiresAt', x.expires_at, 'revision', x.revision) end,
    'internalSla', case when s.sla_target_minutes is null then jsonb_build_object('state', 'not_configured',
      'severity', public.m5_triage_finding_severity(requested.organization_id, requested.finding_id), 'targetMinutes', null, 'startedAt', null, 'pausedAt', null, 'dueAt', null)
      when s.sla_breached_at is not null then jsonb_build_object('state', 'breached', 'severity', s.sla_severity,
        'targetMinutes', s.sla_target_minutes, 'startedAt', s.sla_started_at, 'pausedAt', s.sla_paused_at,
        'dueAt', s.sla_breached_at)
      when s.sla_paused_at is not null then jsonb_build_object('state', 'paused', 'severity', s.sla_severity,
        'targetMinutes', s.sla_target_minutes, 'startedAt', s.sla_started_at, 'pausedAt', s.sla_paused_at,
        'dueAt', s.sla_paused_at + make_interval(secs => greatest(0, s.sla_target_minutes::bigint * 60 - s.sla_elapsed_seconds)))
      else jsonb_build_object('state', 'tracking', 'severity', s.sla_severity, 'targetMinutes', s.sla_target_minutes,
        'startedAt', s.sla_started_at, 'pausedAt', null, 'dueAt', clock_timestamp() + make_interval(secs => greatest(0,
          s.sla_target_minutes::bigint * 60 - s.sla_elapsed_seconds - extract(epoch from clock_timestamp() - greatest(s.sla_started_at, s.updated_at))::bigint))) end,
    'notification', case when e.id is null then jsonb_build_object('state', 'not_requested', 'lastAttemptAt', null,
      'deliveredAt', null, 'failureMessage', null) else jsonb_build_object('state', case when e.state='queued' then 'pending' else e.state end,
      'lastAttemptAt', e.last_attempt_at, 'deliveredAt', e.delivered_at, 'failureMessage', e.error_message) end
  )
  from (select p_organization_id as organization_id, p_finding_id as finding_id) requested
  left join public.vulnerability_finding_triage_states s on s.organization_id=requested.organization_id and s.finding_id=requested.finding_id
  left join public.users u on u.id=s.assignee_user_id
  left join lateral (select * from public.vulnerability_finding_suppressions suppression where suppression.organization_id=requested.organization_id
    and suppression.finding_id=requested.finding_id and suppression.is_current limit 1) x on true
  left join lateral (select * from public.vulnerability_triage_alert_events alert where alert.organization_id=requested.organization_id
    and alert.finding_id=requested.finding_id order by alert.created_at desc,alert.id desc limit 1) e on true
$$;

create or replace function public.m5_triage_state_json(p_organization_id uuid, p_finding_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.m5_triage_operational_json(p_organization_id, p_finding_id)
$$;

alter function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)
  rename to list_finding_triage_queue_m5_04_raw;
create or replace function public.list_finding_triage_queue(
  p_organization_id uuid, p_actor_user_id uuid, p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50, p_cursor text default null, p_sort text default null, p_order text default null
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_raw jsonb; v_rows jsonb;
begin
  perform public.m5_triage_materialize_due_work(p_organization_id);
  select raw.result into v_raw from public.list_finding_triage_queue_m5_04_raw(
    p_organization_id,p_actor_user_id,p_filters-'suppressionStates'-'internalSlaStates'-'notificationDeliveryStates',p_limit,p_cursor,p_sort,p_order
  ) raw limit 1;
  if v_raw is null then return query select 'not_found'::text,null::jsonb; return; end if;
  select coalesce(jsonb_agg(jsonb_set(item,'{operational}',op.value,true) order by ordinality),'[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(v_raw->'rows','[]'::jsonb)) with ordinality rows(item,ordinality)
  cross join lateral (select public.m5_triage_operational_json(p_organization_id,(item#>>'{finding,id}')::uuid) value) op
  where (p_filters->'suppressionStates' is null or op.value#>>'{suppression,state}'=any(array(select jsonb_array_elements_text(p_filters->'suppressionStates'))))
    and (p_filters->'internalSlaStates' is null or op.value#>>'{internalSla,state}'=any(array(select jsonb_array_elements_text(p_filters->'internalSlaStates'))))
    and (p_filters->'notificationDeliveryStates' is null or op.value#>>'{notification,state}'=any(array(select jsonb_array_elements_text(p_filters->'notificationDeliveryStates'))));
  return query select 'found'::text,jsonb_set(v_raw,'{rows}',v_rows,true);
end;
$$;

alter function public.get_finding_triage_detail(uuid,uuid,uuid) rename to get_finding_triage_detail_m5_04_raw;
create or replace function public.get_finding_triage_detail(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid
) returns table(outcome text,result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_raw jsonb;
begin
  perform public.m5_triage_materialize_due_work(p_organization_id);
  select raw.result into v_raw from public.get_finding_triage_detail_m5_04_raw(p_organization_id,p_actor_user_id,p_finding_id) raw limit 1;
  if v_raw is null then return query select 'not_found'::text,null::jsonb; return; end if;
  -- The raw projection is preserved intact, including the contract key
  -- 'reEvaluationState'; this wrapper only appends operational state.
  return query select 'found'::text,jsonb_set(v_raw,'{operational}',public.m5_triage_operational_json(p_organization_id,p_finding_id),true);
end;
$$;

alter function public.assign_finding_triage_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid) owner to postgres;
alter function public.suppress_finding_triage_atomic(uuid,uuid,uuid,text,timestamptz,integer,uuid,uuid) owner to postgres;
alter function public.set_vulnerability_triage_sla_policy_atomic(uuid,uuid,text,boolean,integer,integer,uuid,uuid) owner to postgres;
alter function public.list_vulnerability_triage_sla_policies(uuid,uuid) owner to postgres;
alter function public.list_due_vulnerability_triage_alert_organizations(integer) owner to postgres;
alter function public.claim_vulnerability_triage_alert(uuid,text,integer) owner to postgres;
alter function public.get_vulnerability_triage_alert_details(uuid,uuid) owner to postgres;
alter function public.complete_vulnerability_triage_alert(uuid,uuid,text,boolean,text,text) owner to postgres;
alter function public.m5_triage_active_member(uuid,uuid) owner to postgres;
alter function public.m5_triage_operational_json(uuid,uuid) owner to postgres;
alter function public.list_finding_triage_queue_m5_04_raw(uuid,uuid,jsonb,integer,text,text,text) owner to postgres;
alter function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text) owner to postgres;
alter function public.get_finding_triage_detail_m5_04_raw(uuid,uuid,uuid) owner to postgres;
alter function public.get_finding_triage_detail(uuid,uuid,uuid) owner to postgres;
revoke all on function public.m5_triage_finding_severity(uuid,uuid),public.m5_triage_actor_can_configure_sla(uuid,uuid),public.m5_triage_active_member(uuid,uuid),
  public.m5_triage_command_result(uuid,uuid,uuid,text,text),public.m5_triage_state_json(uuid,uuid),
  public.m5_triage_ensure_state(uuid,uuid,uuid),public.m5_triage_materialize_due_work(uuid),
  public.assign_finding_triage_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid),
  public.suppress_finding_triage_atomic(uuid,uuid,uuid,text,timestamptz,integer,uuid,uuid),
  public.set_vulnerability_triage_sla_policy_atomic(uuid,uuid,text,boolean,integer,integer,uuid,uuid),
  public.list_vulnerability_triage_sla_policies(uuid,uuid),public.list_due_vulnerability_triage_alert_organizations(integer),
  public.claim_vulnerability_triage_alert(uuid,text,integer),public.get_vulnerability_triage_alert_details(uuid,uuid),
  public.complete_vulnerability_triage_alert(uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.m5_triage_operational_json(uuid,uuid),
  public.list_finding_triage_queue_m5_04_raw(uuid,uuid,jsonb,integer,text,text,text),
  public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text),
  public.get_finding_triage_detail_m5_04_raw(uuid,uuid,uuid),public.get_finding_triage_detail(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.assign_finding_triage_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid),
  public.suppress_finding_triage_atomic(uuid,uuid,uuid,text,timestamptz,integer,uuid,uuid),
  public.set_vulnerability_triage_sla_policy_atomic(uuid,uuid,text,boolean,integer,integer,uuid,uuid),
  public.list_vulnerability_triage_sla_policies(uuid,uuid),public.list_due_vulnerability_triage_alert_organizations(integer),
  public.claim_vulnerability_triage_alert(uuid,text,integer),public.get_vulnerability_triage_alert_details(uuid,uuid),
  public.complete_vulnerability_triage_alert(uuid,uuid,text,boolean,text,text) to service_role;
grant execute on function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text),
  public.get_finding_triage_detail(uuid,uuid,uuid) to service_role;
