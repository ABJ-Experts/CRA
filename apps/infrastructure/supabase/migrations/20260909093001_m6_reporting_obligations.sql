-- CRA-M6-01: reporting obligations, frozen deadline rules, and anchor transitions.
-- Deadline authority is Postgres; submission transport and legal filing are out of scope.

create table if not exists public.reporting_rule_sets (
  id uuid primary key default gen_random_uuid(),
  version integer not null check (version > 0),
  jurisdiction text not null check (jurisdiction = 'EU-CRA'),
  effective_from timestamptz not null,
  effective_to timestamptz,
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (jurisdiction, version),
  check (effective_to is null or effective_to > effective_from)
);

insert into public.reporting_rule_sets(version, jurisdiction, effective_from, effective_to, rules)
values (
  1,
  'EU-CRA',
  '2026-01-01 00:00:00+00',
  null,
  '{
    "actively_exploited_vulnerability": [
      {"stage":"early_warning","anchor":"awareness","duration":"PT24H"},
      {"stage":"notification","anchor":"awareness","duration":"PT72H"},
      {"stage":"final_report","anchor":"remediation_available","duration":"P14D"}
    ],
    "severe_incident": [
      {"stage":"early_warning","anchor":"awareness","duration":"PT24H"},
      {"stage":"notification","anchor":"awareness","duration":"PT72H"},
      {"stage":"final_report","anchor":"notification_submitted","duration":"P1M"}
    ]
  }'::jsonb
) on conflict (jurisdiction, version) do update
set effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  rules = excluded.rules;

create table if not exists public.reporting_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_type text not null check (obligation_type in ('actively_exploited_vulnerability', 'severe_incident')),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  source_finding_id uuid,
  awareness_at timestamptz not null,
  awareness_basis text not null check (char_length(btrim(awareness_basis)) between 1 and 4000),
  rule_set_id uuid not null references public.reporting_rule_sets(id) on delete restrict,
  rule_set_version integer not null check (rule_set_version > 0),
  rule_snapshot jsonb not null check (jsonb_typeof(rule_snapshot) = 'object'),
  version integer not null default 1 check (version > 0),
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_by_display_name text not null check (char_length(btrim(created_by_display_name)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.users(id) on delete restrict,
  cancellation_reason text check (cancellation_reason is null or char_length(btrim(cancellation_reason)) between 1 and 4000),
  unique (organization_id, id),
  foreign key (organization_id, source_finding_id)
    references public.vulnerability_findings(organization_id, id) on delete restrict,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'cancelled') = (cancellation_reason is not null))
);

alter table public.reporting_obligations
  add column if not exists rule_snapshot jsonb,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references public.users(id) on delete restrict,
  add column if not exists cancellation_reason text;
update public.reporting_obligations
set rule_snapshot = jsonb_build_object(
  'id', rule_set_id,
  'version', rule_set_version,
  'jurisdiction', 'EU-CRA',
  'effectiveFrom', (
    select to_char(date_trunc('second', r.effective_from at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    from public.reporting_rule_sets r
    where r.id = rule_set_id
  ),
  'effectiveTo', null,
  'rules', (select rules from public.reporting_rule_sets r where r.id = rule_set_id)
)
where rule_snapshot is null;
alter table public.reporting_obligations
  alter column rule_snapshot set not null;

alter table public.reporting_obligations
  drop constraint if exists reporting_obligations_obligation_type_check,
  drop constraint if exists reporting_obligations_status_check,
  drop constraint if exists reporting_obligations_awareness_basis_check,
  drop constraint if exists reporting_obligations_awareness_at_check,
  drop constraint if exists reporting_obligations_rule_set_version_check,
  drop constraint if exists reporting_obligations_rule_snapshot_check,
  drop constraint if exists reporting_obligations_version_check,
  drop constraint if exists reporting_obligations_created_by_display_name_check,
  drop constraint if exists reporting_obligations_cancellation_reason_check,
  drop constraint if exists reporting_obligations_check,
  drop constraint if exists reporting_obligations_check1,
  add constraint reporting_obligations_obligation_type_check
    check (obligation_type in ('actively_exploited_vulnerability', 'severe_incident')),
  add constraint reporting_obligations_status_check
    check (status in ('active', 'completed', 'cancelled')),
  add constraint reporting_obligations_awareness_basis_check
    check (char_length(btrim(awareness_basis)) between 1 and 4000),
  add constraint reporting_obligations_awareness_at_check
    check (date_trunc('second', awareness_at) = awareness_at),
  add constraint reporting_obligations_rule_set_version_check
    check (rule_set_version > 0),
  add constraint reporting_obligations_rule_snapshot_check
    check (jsonb_typeof(rule_snapshot) = 'object'),
  add constraint reporting_obligations_version_check
    check (version > 0),
  add constraint reporting_obligations_created_by_display_name_check
    check (char_length(btrim(created_by_display_name)) between 1 and 200),
  add constraint reporting_obligations_cancellation_reason_check
    check (cancellation_reason is null or char_length(btrim(cancellation_reason)) between 1 and 4000),
  add constraint reporting_obligations_check
    check ((status = 'cancelled') = (cancelled_at is not null)),
  add constraint reporting_obligations_check1
    check ((status = 'cancelled') = (cancellation_reason is not null));

create unique index if not exists reporting_obligations_one_active_finding_idx
  on public.reporting_obligations(organization_id, obligation_type, source_finding_id)
  where source_finding_id is not null and status <> 'cancelled';
create index if not exists reporting_obligations_org_status_idx
  on public.reporting_obligations(organization_id, status, updated_at desc, id desc);

drop trigger if exists set_reporting_obligations_updated_at on public.reporting_obligations;
create trigger set_reporting_obligations_updated_at
  before update on public.reporting_obligations
  for each row execute function public.set_updated_at();

create table if not exists public.reporting_obligation_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  obligation_id uuid not null,
  stage_kind text not null check (stage_kind in ('early_warning', 'notification', 'final_report')),
  anchor_kind text not null check (anchor_kind in ('awareness', 'remediation_available', 'notification_submitted')),
  duration text not null check (duration in ('PT24H', 'PT72H', 'P14D', 'P1M')),
  state text not null check (state in ('pending_anchor', 'running', 'submitted', 'overdue', 'not_required')),
  due_at timestamptz,
  submitted_at timestamptz,
  submission_reference text check (submission_reference is null or char_length(btrim(submission_reference)) between 1 and 1000),
  overdue_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, obligation_id, stage_kind),
  foreign key (organization_id, obligation_id)
    references public.reporting_obligations(organization_id, id) on delete cascade,
  check (state <> 'pending_anchor' or (due_at is null and submitted_at is null and overdue_at is null)),
  check ((submitted_at is null and submission_reference is null) or (submitted_at is not null and submission_reference is not null))
);

alter table public.reporting_obligation_stages
  add column if not exists created_at timestamptz not null default clock_timestamp(),
  add column if not exists updated_at timestamptz not null default clock_timestamp();

alter table public.reporting_obligation_stages
  drop constraint if exists reporting_obligation_stages_stage_kind_check,
  drop constraint if exists reporting_obligation_stages_anchor_kind_check,
  drop constraint if exists reporting_obligation_stages_duration_check,
  drop constraint if exists reporting_obligation_stages_state_check,
  drop constraint if exists reporting_obligation_stages_submission_reference_check,
  drop constraint if exists reporting_obligation_stages_version_check,
  drop constraint if exists reporting_obligation_stages_check,
  drop constraint if exists reporting_obligation_stages_check1,
  drop constraint if exists reporting_obligation_stages_obligation_id_stage_kind_key,
  drop constraint if exists reporting_obligation_stages_organization_id_id_key,
  drop constraint if exists reporting_obligation_stages_organization_id_obligation_id_s_key,
  add constraint reporting_obligation_stages_stage_kind_check
    check (stage_kind in ('early_warning', 'notification', 'final_report')),
  add constraint reporting_obligation_stages_anchor_kind_check
    check (anchor_kind in ('awareness', 'remediation_available', 'notification_submitted')),
  add constraint reporting_obligation_stages_duration_check
    check (duration in ('PT24H', 'PT72H', 'P14D', 'P1M')),
  add constraint reporting_obligation_stages_state_check
    check (state in ('pending_anchor', 'running', 'submitted', 'overdue', 'not_required')),
  add constraint reporting_obligation_stages_submission_reference_check
    check (submission_reference is null or char_length(btrim(submission_reference)) between 1 and 1000),
  add constraint reporting_obligation_stages_version_check
    check (version > 0),
  add constraint reporting_obligation_stages_check
    check (state <> 'pending_anchor' or (due_at is null and submitted_at is null and overdue_at is null)),
  add constraint reporting_obligation_stages_check1
    check ((submitted_at is null and submission_reference is null) or (submitted_at is not null and submission_reference is not null)),
  add constraint reporting_obligation_stages_organization_id_id_key
    unique (organization_id, id),
  add constraint reporting_obligation_stages_organization_id_obligation_id_s_key
    unique (organization_id, obligation_id, stage_kind);

create index if not exists reporting_obligation_stages_due_idx
  on public.reporting_obligation_stages(organization_id, due_at, id)
  where state = 'running';

drop trigger if exists set_reporting_obligation_stages_updated_at on public.reporting_obligation_stages;
create trigger set_reporting_obligation_stages_updated_at
  before update on public.reporting_obligation_stages
  for each row execute function public.set_updated_at();

create table if not exists public.reporting_obligation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  obligation_id uuid not null,
  event_kind text not null check (event_kind in ('created', 'anchor_corrected', 'stage_submitted', 'stage_overdue', 'cancelled')),
  anchor_kind text check (anchor_kind is null or anchor_kind in ('awareness', 'remediation_available', 'notification_submitted')),
  stage_kind text check (stage_kind is null or stage_kind in ('early_warning', 'notification', 'final_report')),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid references public.users(id) on delete restrict,
  actor_display_name text check (actor_display_name is null or char_length(btrim(actor_display_name)) between 1 and 200),
  old_value jsonb,
  new_value jsonb,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 4000),
  correlation_id uuid,
  unique (organization_id, id),
  foreign key (organization_id, obligation_id)
    references public.reporting_obligations(organization_id, id) on delete cascade,
  check ((old_value is null or jsonb_typeof(old_value) = 'object') and (new_value is null or jsonb_typeof(new_value) = 'object'))
);

alter table public.reporting_obligation_events
  add column if not exists old_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists correlation_id uuid;
alter table public.reporting_obligation_events
  drop constraint if exists reporting_obligation_events_event_kind_check,
  add constraint reporting_obligation_events_event_kind_check check (event_kind in (
    'created', 'anchor_corrected', 'stage_submitted', 'stage_overdue', 'cancelled'
  ));
alter table public.reporting_obligation_events
  drop constraint if exists reporting_obligation_events_anchor_kind_check,
  drop constraint if exists reporting_obligation_events_stage_kind_check,
  drop constraint if exists reporting_obligation_events_actor_display_name_check,
  drop constraint if exists reporting_obligation_events_reason_check,
  drop constraint if exists reporting_obligation_events_check,
  drop constraint if exists reporting_obligation_events_organization_id_id_key,
  drop constraint if exists reporting_obligation_events_organization_id_event_key_key,
  add constraint reporting_obligation_events_anchor_kind_check
    check (anchor_kind is null or anchor_kind in ('awareness', 'remediation_available', 'notification_submitted')),
  add constraint reporting_obligation_events_stage_kind_check
    check (stage_kind is null or stage_kind in ('early_warning', 'notification', 'final_report')),
  add constraint reporting_obligation_events_actor_display_name_check
    check (actor_display_name is null or char_length(btrim(actor_display_name)) between 1 and 200),
  add constraint reporting_obligation_events_reason_check
    check (reason is null or char_length(btrim(reason)) between 1 and 4000),
  add constraint reporting_obligation_events_check
    check ((old_value is null or jsonb_typeof(old_value) = 'object') and (new_value is null or jsonb_typeof(new_value) = 'object')),
  add constraint reporting_obligation_events_organization_id_id_key
    unique (organization_id, id);
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reporting_obligation_events' and column_name = 'event_key'
  ) then
    alter table public.reporting_obligation_events alter column event_key set default gen_random_uuid()::text;
  end if;
end $$;

create index if not exists reporting_obligation_events_obligation_idx
  on public.reporting_obligation_events(organization_id, obligation_id, occurred_at, id);

-- The tenant export materializer deliberately locks every registered source.
-- Extend the existing M5-07 lock tail rather than forking that security-sensitive RPC.
do $$
declare
  v_definition text;
  v_old_lock text := 'public.vulnerability_finding_note_mentions' || chr(10) || '  in share mode';
  v_new_lock text := 'public.vulnerability_finding_note_mentions, public.reporting_obligations, public.reporting_obligation_stages, public.reporting_obligation_events' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')
  ) into v_definition;

  if position(v_new_lock in v_definition) > 0 then
    return;
  end if;

  if position(v_old_lock in v_definition) = 0 then
    raise exception 'M6-01 export lock anchor is missing';
  end if;

  execute replace(v_definition, v_old_lock, v_new_lock);
end;
$$;

alter table public.vulnerability_triage_commands
  drop constraint if exists vulnerability_triage_commands_operation_check,
  add constraint vulnerability_triage_commands_operation_check check (operation in (
    'assign', 'suppress', 'set_sla_policy', 'record_remediation_anchor',
    'create_vex_export_snapshot', 'configure_vex_publication_target',
    'queue_vex_publication', 'retry_vex_publication', 'withdraw_vex_publication',
    'note_create', 'note_update', 'note_delete',
    'create_reporting_obligation', 'correct_reporting_anchor', 'record_reporting_submission', 'cancel_reporting_obligation'
  ));

alter table public.reporting_rule_sets enable row level security;
alter table public.reporting_obligations enable row level security;
alter table public.reporting_obligation_stages enable row level security;
alter table public.reporting_obligation_events enable row level security;

revoke all on table public.reporting_rule_sets, public.reporting_obligations,
  public.reporting_obligation_stages, public.reporting_obligation_events
  from public, anon, authenticated;
grant all on table public.reporting_rule_sets, public.reporting_obligations,
  public.reporting_obligation_stages, public.reporting_obligation_events
  to service_role;

create or replace function public.m6_utc_second_z(p_value timestamptz)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select to_char(date_trunc('second', p_value at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

create or replace function public.m6_actor_display_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, p_user_id::text)
  from public.users u
  where u.id = p_user_id
$$;

create or replace function public.m6_due_at(p_anchor timestamptz, p_duration text)
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select case p_duration
    when 'PT24H' then p_anchor + interval '24 hours'
    when 'PT72H' then p_anchor + interval '72 hours'
    when 'P14D' then p_anchor + interval '14 days'
    -- Force UTC civil-calendar arithmetic so a server/session timezone cannot
    -- alter month-end clamping or the returned instant.
    when 'P1M' then ((p_anchor at time zone 'UTC') + interval '1 month') at time zone 'UTC'
  end
$$;

create or replace function public.m6_anchor_at(p_obligation public.reporting_obligations, p_anchor_kind text)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select case p_anchor_kind
    when 'awareness' then p_obligation.awareness_at
    when 'remediation_available' then coalesce(
      (
        select (e.new_value->>'anchoredAt')::timestamptz
        from public.reporting_obligation_events e
        where e.organization_id = p_obligation.organization_id
          and e.obligation_id = p_obligation.id
          and e.anchor_kind = 'remediation_available'
        order by e.occurred_at desc, e.id desc
        limit 1
      ),
      (
        select a.availability_at
        from public.vulnerability_finding_remediation_anchors a
        where a.organization_id = p_obligation.organization_id
          and a.finding_id = p_obligation.source_finding_id
          and a.is_current
          and a.availability_at is not null
        order by a.recorded_at desc, a.id desc
        limit 1
      )
    )
    when 'notification_submitted' then (
      select coalesce(e.new_value->>'submittedAt', e.new_value->>'anchoredAt')::timestamptz
      from public.reporting_obligation_events e
      where e.organization_id = p_obligation.organization_id
        and e.obligation_id = p_obligation.id
        and e.anchor_kind = 'notification_submitted'
      order by e.occurred_at desc, e.id desc
      limit 1
    )
  end
$$;

create or replace function public.m6_refresh_reporting_obligation_stages(
  p_organization_id uuid,
  p_obligation_id uuid,
  p_now timestamptz default clock_timestamp()
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_obligation public.reporting_obligations%rowtype;
  v_stage public.reporting_obligation_stages%rowtype;
  v_anchor timestamptz;
  v_due timestamptz;
begin
  select * into v_obligation
  from public.reporting_obligations
  where organization_id = p_organization_id and id = p_obligation_id
  for update;
  if not found then return; end if;

  for v_stage in
    select * from public.reporting_obligation_stages
    where organization_id = p_organization_id and obligation_id = p_obligation_id
    for update
  loop
    if v_obligation.status = 'cancelled' and v_stage.submitted_at is null then
      update public.reporting_obligation_stages
      set state = 'not_required',
        updated_at = date_trunc('second', p_now), version = version + 1
      where organization_id = p_organization_id and id = v_stage.id;
    elsif v_stage.submitted_at is not null then
      update public.reporting_obligation_stages
      set state = 'submitted',
        overdue_at = case when overdue_at is null and due_at is not null and submitted_at > due_at then due_at else overdue_at end,
        updated_at = date_trunc('second', p_now)
      where organization_id = p_organization_id and id = v_stage.id;
    else
      v_anchor := public.m6_anchor_at(v_obligation, v_stage.anchor_kind);
      v_due := case when v_anchor is null then null else public.m6_due_at(v_anchor, v_stage.duration) end;
      update public.reporting_obligation_stages
      set due_at = date_trunc('second', v_due),
        state = case when v_due is null then 'pending_anchor' when overdue_at is not null or v_due <= p_now then 'overdue' else 'running' end,
        overdue_at = case when v_due is null then null when overdue_at is not null then overdue_at when v_due <= p_now then date_trunc('second', v_due) else null end,
        updated_at = date_trunc('second', p_now)
      where organization_id = p_organization_id and id = v_stage.id;
    end if;
  end loop;
end;
$$;

create or replace function public.m6_reporting_stage_json(p_organization_id uuid, p_stage_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', s.id,
    'kind', s.stage_kind,
    'anchor', s.anchor_kind,
    'duration', s.duration,
    'state', s.state,
    'dueAt', case when s.due_at is null then null else public.m6_utc_second_z(s.due_at) end,
    'submittedAt', case when s.submitted_at is null then null else public.m6_utc_second_z(s.submitted_at) end,
    'overdueAt', case when s.overdue_at is null then null else public.m6_utc_second_z(s.overdue_at) end,
    'version', s.version
  )
  from public.reporting_obligation_stages s
  where s.organization_id = p_organization_id and s.id = p_stage_id
$$;

create or replace function public.m6_reporting_obligation_json(p_organization_id uuid, p_obligation_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id,
    'organizationId', o.organization_id,
    'type', o.obligation_type,
    'status', o.status,
    'source', case when o.source_finding_id is null then jsonb_build_object('kind', 'manual') else jsonb_build_object('kind', 'finding', 'findingId', o.source_finding_id) end,
    'ruleSet', jsonb_build_object(
      'id', o.rule_set_id,
      'version', o.rule_set_version,
      'jurisdiction', 'EU-CRA',
      'effectiveFrom', o.rule_snapshot->>'effectiveFrom',
      'effectiveTo', o.rule_snapshot->'effectiveTo'
    ),
    'awarenessAt', public.m6_utc_second_z(o.awareness_at),
    'awarenessBasis', o.awareness_basis,
    'createdBy', jsonb_build_object('userId', o.created_by_user_id, 'displayName', o.created_by_display_name),
    'createdAt', public.m6_utc_second_z(o.created_at),
    'updatedAt', public.m6_utc_second_z(o.updated_at),
    'version', o.version,
    'cancelledAt', case when o.cancelled_at is null then null else public.m6_utc_second_z(o.cancelled_at) end,
    'cancellationReason', o.cancellation_reason,
    'stages', coalesce((
      select jsonb_agg(public.m6_reporting_stage_json(p_organization_id, s.id) order by case s.stage_kind when 'early_warning' then 1 when 'notification' then 2 else 3 end)
      from public.reporting_obligation_stages s
      where s.organization_id = p_organization_id and s.obligation_id = o.id
    ), '[]'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.anchor_kind,
        'anchoredAt', coalesce(e.new_value->>'anchoredAt', e.new_value->>'submittedAt'),
        'basis', e.new_value->>'basis',
        'reason', e.reason,
        'recordedBy', jsonb_build_object('userId', e.actor_user_id, 'displayName', e.actor_display_name),
        'recordedAt', public.m6_utc_second_z(e.occurred_at)
      ) order by e.occurred_at, e.id)
      from public.reporting_obligation_events e
      where e.organization_id = p_organization_id and e.obligation_id = o.id and e.anchor_kind is not null and e.actor_user_id is not null
    ), '[]'::jsonb)
  )
  from public.reporting_obligations o
  where o.organization_id = p_organization_id and o.id = p_obligation_id
$$;

create or replace function public.m6_command_digest(p_payload jsonb)
returns text language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex')
$$;

create or replace function public.create_reporting_obligation_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_obligation_type text,
  p_source_finding_id uuid,
  p_awareness_at timestamptz,
  p_awareness_basis text,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule public.reporting_rule_sets%rowtype;
  v_obligation public.reporting_obligations%rowtype;
  v_stage jsonb;
  v_existing record;
  v_digest text;
  v_actor_name text;
  v_rule_snapshot jsonb;
  v_now timestamptz := date_trunc('second', clock_timestamp());
begin
  if p_organization_id is null or p_actor_user_id is null
    or p_obligation_type not in ('actively_exploited_vulnerability', 'severe_incident')
    or p_awareness_at is null or char_length(btrim(coalesce(p_awareness_basis, ''))) not between 1 and 4000
    or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := public.m6_command_digest(jsonb_build_object(
    'type', p_obligation_type, 'sourceFindingId', p_source_finding_id,
    'awarenessAt', date_trunc('second', p_awareness_at), 'awarenessBasis', btrim(p_awareness_basis)
  ));
  select * into v_existing from public.m5_triage_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, 'create_reporting_obligation', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;

  if p_source_finding_id is not null and not exists (
    select 1 from public.vulnerability_findings f
    where f.organization_id = p_organization_id and f.id = p_source_finding_id and f.status = 'active'
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select * into v_rule
  from public.reporting_rule_sets r
  where r.jurisdiction = 'EU-CRA' and r.effective_from <= v_now and (r.effective_to is null or r.effective_to > v_now)
  order by r.effective_from desc, r.version desc
  limit 1;
  if not found then return query select 'unavailable'::text, null::jsonb; return; end if;

  v_rule_snapshot := jsonb_build_object(
    'id', v_rule.id, 'version', v_rule.version, 'jurisdiction', v_rule.jurisdiction,
    'effectiveFrom', public.m6_utc_second_z(v_rule.effective_from),
    'effectiveTo', case when v_rule.effective_to is null then null else public.m6_utc_second_z(v_rule.effective_to) end,
    'rules', v_rule.rules
  );
  v_actor_name := public.m6_actor_display_name(p_actor_user_id);

  begin
    insert into public.reporting_obligations(
      organization_id, obligation_type, source_finding_id, awareness_at, awareness_basis,
      rule_set_id, rule_set_version, rule_snapshot, created_by_user_id, created_by_display_name,
      created_at, updated_at
    ) values (
      p_organization_id, p_obligation_type, p_source_finding_id, date_trunc('second', p_awareness_at),
      btrim(p_awareness_basis), v_rule.id, v_rule.version, v_rule_snapshot, p_actor_user_id, v_actor_name, v_now, v_now
    ) returning * into v_obligation;
  exception when unique_violation then
    return query select 'conflict'::text, null::jsonb;
    return;
  end;

  insert into public.reporting_obligation_events(organization_id, obligation_id, event_kind, anchor_kind, occurred_at, actor_user_id, actor_display_name, new_value, correlation_id)
  values (p_organization_id, v_obligation.id, 'created', 'awareness', v_now, p_actor_user_id, v_actor_name,
    jsonb_build_object('anchoredAt', public.m6_utc_second_z(p_awareness_at), 'basis', btrim(p_awareness_basis)), p_correlation_id);

  for v_stage in select * from jsonb_array_elements(v_rule.rules -> p_obligation_type) loop
    insert into public.reporting_obligation_stages(organization_id, obligation_id, stage_kind, anchor_kind, duration, state)
    values (p_organization_id, v_obligation.id, v_stage->>'stage', v_stage->>'anchor', v_stage->>'duration', 'pending_anchor');
  end loop;
  perform public.m6_refresh_reporting_obligation_stages(p_organization_id, v_obligation.id, v_now);

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'reporting.obligation_created', 'reporting_obligation', v_obligation.id::text,
    jsonb_build_object('type', p_obligation_type, 'sourceFindingId', p_source_finding_id, 'ruleSetVersion', v_rule.version, 'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'create_reporting_obligation', v_digest,
    jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, v_obligation.id)));

  return query select 'created'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, v_obligation.id));
end;
$$;

create or replace function public.correct_reporting_obligation_anchor_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_obligation_id uuid,
  p_anchor_kind text,
  p_anchor_at timestamptz,
  p_basis text,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_obligation public.reporting_obligations%rowtype;
  v_existing record;
  v_digest text;
  v_actor_name text;
  v_old jsonb;
  v_now timestamptz := date_trunc('second', clock_timestamp());
begin
  if p_organization_id is null or p_actor_user_id is null or p_obligation_id is null
    or p_anchor_kind not in ('awareness', 'remediation_available', 'notification_submitted')
    or p_anchor_at is null or p_expected_version is null or p_expected_version < 1 or p_idempotency_key is null
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 4000
    or (p_anchor_kind = 'awareness' and char_length(btrim(coalesce(p_basis, ''))) not between 1 and 4000)
    or (p_anchor_kind <> 'awareness' and p_basis is not null)
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := public.m6_command_digest(jsonb_build_object(
    'obligationId', p_obligation_id, 'anchor', p_anchor_kind, 'anchorAt', date_trunc('second', p_anchor_at),
    'basis', p_basis, 'reason', btrim(p_reason), 'expectedVersion', p_expected_version
  ));
  select * into v_existing from public.m5_triage_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, 'correct_reporting_anchor', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;

  select * into v_obligation from public.reporting_obligations
  where organization_id = p_organization_id and id = p_obligation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_obligation.status = 'cancelled' then return query select 'invalid_state'::text, null::jsonb; return; end if;
  if v_obligation.version <> p_expected_version then
    return query select 'conflict'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
    return;
  end if;
  if p_anchor_kind = 'remediation_available' and v_obligation.obligation_type <> 'actively_exploited_vulnerability' then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  if p_anchor_kind = 'notification_submitted' and v_obligation.obligation_type <> 'severe_incident' then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;

  v_actor_name := public.m6_actor_display_name(p_actor_user_id);
  v_old := jsonb_build_object(
    'anchoredAt', case when public.m6_anchor_at(v_obligation, p_anchor_kind) is null then null else public.m6_utc_second_z(public.m6_anchor_at(v_obligation, p_anchor_kind)) end,
    'basis', case when p_anchor_kind = 'awareness' then v_obligation.awareness_basis else null end
  );

  update public.reporting_obligations
  set awareness_at = case when p_anchor_kind = 'awareness' then date_trunc('second', p_anchor_at) else awareness_at end,
    awareness_basis = case when p_anchor_kind = 'awareness' then btrim(p_basis) else awareness_basis end,
    version = version + 1,
    updated_at = v_now
  where organization_id = p_organization_id and id = p_obligation_id
  returning * into v_obligation;

  insert into public.reporting_obligation_events(
    organization_id, obligation_id, event_kind, anchor_kind, occurred_at, actor_user_id,
    actor_display_name, old_value, new_value, reason, correlation_id
  ) values (
    p_organization_id, p_obligation_id, 'anchor_corrected', p_anchor_kind, v_now, p_actor_user_id, v_actor_name, v_old,
    jsonb_build_object('anchoredAt', public.m6_utc_second_z(p_anchor_at), 'basis', case when p_anchor_kind = 'awareness' then btrim(p_basis) else null end),
    btrim(p_reason), p_correlation_id
  );
  perform public.m6_refresh_reporting_obligation_stages(p_organization_id, p_obligation_id, v_now);

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'reporting.anchor_corrected.high', 'reporting_obligation', p_obligation_id::text,
    jsonb_build_object('anchor', p_anchor_kind, 'old', v_old, 'reason', btrim(p_reason), 'severity', 'high', 'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'correct_reporting_anchor', v_digest,
    jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id)));

  return query select 'updated'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
end;
$$;

create or replace function public.record_reporting_obligation_stage_submission_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_obligation_id uuid,
  p_stage_kind text,
  p_submitted_at timestamptz,
  p_submission_reference text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_obligation public.reporting_obligations%rowtype;
  v_stage public.reporting_obligation_stages%rowtype;
  v_existing record;
  v_digest text;
  v_actor_name text;
  v_now timestamptz := date_trunc('second', clock_timestamp());
begin
  if p_organization_id is null or p_actor_user_id is null or p_obligation_id is null
    or p_stage_kind not in ('early_warning', 'notification', 'final_report')
    or p_submitted_at is null or char_length(btrim(coalesce(p_submission_reference, ''))) not between 1 and 1000
    or p_expected_version is null or p_expected_version < 1 or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := public.m6_command_digest(jsonb_build_object(
    'obligationId', p_obligation_id, 'stage', p_stage_kind, 'submittedAt', date_trunc('second', p_submitted_at),
    'submissionReference', btrim(p_submission_reference), 'expectedVersion', p_expected_version
  ));
  select * into v_existing from public.m5_triage_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, 'record_reporting_submission', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;

  select * into v_obligation from public.reporting_obligations
  where organization_id = p_organization_id and id = p_obligation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_obligation.status = 'cancelled' then return query select 'invalid_state'::text, null::jsonb; return; end if;
  if v_obligation.version <> p_expected_version then
    return query select 'conflict'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
    return;
  end if;

  select * into v_stage from public.reporting_obligation_stages
  where organization_id = p_organization_id and obligation_id = p_obligation_id and stage_kind = p_stage_kind
  for update;
  if not found or v_stage.state = 'pending_anchor' then return query select 'invalid_state'::text, null::jsonb; return; end if;

  v_actor_name := public.m6_actor_display_name(p_actor_user_id);
  update public.reporting_obligation_stages
  set submitted_at = date_trunc('second', p_submitted_at),
    submission_reference = btrim(p_submission_reference),
    state = 'submitted',
    overdue_at = case when overdue_at is not null then overdue_at when due_at is not null and p_submitted_at > due_at then due_at else null end,
    version = version + 1,
    updated_at = v_now
  where organization_id = p_organization_id and id = v_stage.id;
  update public.reporting_obligations
  set version = version + 1, updated_at = v_now
  where organization_id = p_organization_id and id = p_obligation_id
  returning * into v_obligation;

  insert into public.reporting_obligation_events(
    organization_id, obligation_id, event_kind, stage_kind, anchor_kind, occurred_at,
    actor_user_id, actor_display_name, new_value, correlation_id
  ) values (
    p_organization_id, p_obligation_id, 'stage_submitted', p_stage_kind,
    case when p_stage_kind = 'notification' and v_obligation.obligation_type = 'severe_incident' then 'notification_submitted' else null end,
    v_now, p_actor_user_id, v_actor_name,
    jsonb_build_object('submittedAt', public.m6_utc_second_z(p_submitted_at), 'submissionReference', btrim(p_submission_reference),
      'anchoredAt', public.m6_utc_second_z(p_submitted_at), 'basis', null),
    p_correlation_id
  );
  perform public.m6_refresh_reporting_obligation_stages(p_organization_id, p_obligation_id, v_now);

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'reporting.stage_submitted', 'reporting_obligation', p_obligation_id::text,
    jsonb_build_object('stage', p_stage_kind, 'submittedAt', public.m6_utc_second_z(p_submitted_at), 'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'record_reporting_submission', v_digest,
    jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id)));

  return query select 'updated'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
end;
$$;

create or replace function public.cancel_reporting_obligation_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_obligation_id uuid,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_obligation public.reporting_obligations%rowtype;
  v_existing record;
  v_digest text;
  v_actor_name text;
  v_now timestamptz := date_trunc('second', clock_timestamp());
begin
  if p_organization_id is null or p_actor_user_id is null or p_obligation_id is null
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 4000
    or p_expected_version is null or p_expected_version < 1 or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := public.m6_command_digest(jsonb_build_object('obligationId', p_obligation_id, 'reason', btrim(p_reason), 'expectedVersion', p_expected_version));
  select * into v_existing from public.m5_triage_command_result(p_organization_id, p_actor_user_id, p_idempotency_key, 'cancel_reporting_obligation', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;

  select * into v_obligation from public.reporting_obligations
  where organization_id = p_organization_id and id = p_obligation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_obligation.status = 'cancelled' then return query select 'invalid_state'::text, null::jsonb; return; end if;
  if v_obligation.version <> p_expected_version then
    return query select 'conflict'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
    return;
  end if;

  v_actor_name := public.m6_actor_display_name(p_actor_user_id);
  update public.reporting_obligations
  set status = 'cancelled', cancellation_reason = btrim(p_reason), cancelled_at = v_now, cancelled_by_user_id = p_actor_user_id, version = version + 1, updated_at = v_now
  where organization_id = p_organization_id and id = p_obligation_id;
  perform public.m6_refresh_reporting_obligation_stages(p_organization_id, p_obligation_id, v_now);
  insert into public.reporting_obligation_events(organization_id, obligation_id, event_kind, occurred_at, actor_user_id, actor_display_name, reason, correlation_id)
  values (p_organization_id, p_obligation_id, 'cancelled', v_now, p_actor_user_id, v_actor_name, btrim(p_reason), p_correlation_id);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'reporting.obligation_cancelled.high', 'reporting_obligation', p_obligation_id::text,
    jsonb_build_object('reason', btrim(p_reason), 'severity', 'high', 'idempotencyKey', p_idempotency_key));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'cancel_reporting_obligation', v_digest,
    jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id)));

  return query select 'cancelled'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
end;
$$;

create or replace function public.tick_reporting_obligation_stages_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz default clock_timestamp(),
  p_idempotency_key uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_stage public.reporting_obligation_stages%rowtype;
  v_count integer := 0;
begin
  if p_organization_id is null or p_actor_user_id is null
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_edit_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  for v_stage in
    select * from public.reporting_obligation_stages
    where organization_id = p_organization_id and state = 'running' and due_at <= p_now
    for update skip locked
  loop
    update public.reporting_obligation_stages
    set state = 'overdue', overdue_at = date_trunc('second', due_at), version = version + 1, updated_at = date_trunc('second', p_now)
    where organization_id = p_organization_id and id = v_stage.id;
    insert into public.reporting_obligation_events(organization_id, obligation_id, event_kind, stage_kind, occurred_at, new_value, correlation_id)
    values (p_organization_id, v_stage.obligation_id, 'stage_overdue', v_stage.stage_kind, date_trunc('second', p_now),
      jsonb_build_object('overdueAt', public.m6_utc_second_z(v_stage.due_at)), p_idempotency_key);
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'reporting.stage_overdue.high', 'reporting_obligation', v_stage.obligation_id::text,
      jsonb_build_object('stage', v_stage.stage_kind, 'overdueAt', public.m6_utc_second_z(v_stage.due_at), 'severity', 'high'));
    v_count := v_count + 1;
  end loop;
  return query select 'updated'::text, jsonb_build_object('updated', v_count);
end;
$$;

create or replace function public.get_reporting_obligation(p_organization_id uuid, p_actor_user_id uuid, p_obligation_id uuid)
returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_organization_id is null or p_actor_user_id is null or p_obligation_id is null
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_view_findings')
    or not exists (select 1 from public.reporting_obligations o where o.organization_id = p_organization_id and o.id = p_obligation_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, jsonb_build_object('obligation', public.m6_reporting_obligation_json(p_organization_id, p_obligation_id));
end;
$$;

create or replace function public.list_reporting_obligations(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_cursor text,
  p_limit integer default 50,
  p_type text default null,
  p_status text default null,
  p_finding_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_after_updated timestamptz;
  v_after_id uuid;
  v_rows jsonb;
  v_cursor text;
begin
  if p_cursor is not null then
    begin
      select split_part(convert_from(decode(translate(p_cursor, '-_', '+/') || repeat('=', (4 - length(p_cursor) % 4) % 4), 'base64'), 'utf8'), '|', 1)::timestamptz,
        split_part(convert_from(decode(translate(p_cursor, '-_', '+/') || repeat('=', (4 - length(p_cursor) % 4) % 4), 'base64'), 'utf8'), '|', 2)::uuid
      into v_after_updated, v_after_id;
    exception when others then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end;
  end if;
  if p_limit not between 1 and 100
    or (p_type is not null and p_type not in ('actively_exploited_vulnerability', 'severe_incident'))
    or (p_status is not null and p_status not in ('active', 'completed', 'cancelled'))
    or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_view_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select coalesce(jsonb_agg(public.m6_reporting_obligation_json(p_organization_id, rows.id) - 'anchors' order by rows.updated_at desc, rows.id desc), '[]'::jsonb),
    max(translate(trim(trailing '=' from encode(convert_to(rows.updated_at::text || '|' || rows.id::text, 'utf8'), 'base64')), '+/', '-_'))
  into v_rows, v_cursor
  from (
    select o.id, o.updated_at
    from public.reporting_obligations o
    where o.organization_id = p_organization_id
      and (p_type is null or o.obligation_type = p_type)
      and (p_status is null or o.status = p_status)
      and (p_finding_id is null or o.source_finding_id = p_finding_id)
      and (p_cursor is null or (o.updated_at, o.id) < (v_after_updated, v_after_id))
    order by o.updated_at desc, o.id desc
    limit p_limit
  ) rows;
  return query select 'found'::text, jsonb_build_object('obligations', v_rows, 'nextCursor', case when jsonb_array_length(v_rows) = p_limit then v_cursor else null end);
end;
$$;

insert into public.organization_export_sources(source_id, enabled, sort_order)
values ('reporting_obligations', true, 48)
on conflict(source_id) do update set enabled = excluded.enabled, sort_order = excluded.sort_order;

insert into public.organization_export_source_tables(source_id, table_name, tenant_key_column, record_order_column, table_sort)
values
  ('reporting_obligations', 'reporting_obligations', 'organization_id', 'id', 1),
  ('reporting_obligations', 'reporting_obligation_stages', 'organization_id', 'id', 2),
  ('reporting_obligations', 'reporting_obligation_events', 'organization_id', 'id', 3)
on conflict(source_id, table_name) do update
set tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

alter function public.m6_utc_second_z(timestamptz) owner to postgres;
alter function public.m6_actor_display_name(uuid) owner to postgres;
alter function public.m6_due_at(timestamptz, text) owner to postgres;
alter function public.m6_anchor_at(public.reporting_obligations, text) owner to postgres;
alter function public.m6_refresh_reporting_obligation_stages(uuid, uuid, timestamptz) owner to postgres;
alter function public.m6_reporting_stage_json(uuid, uuid) owner to postgres;
alter function public.m6_reporting_obligation_json(uuid, uuid) owner to postgres;
alter function public.m6_command_digest(jsonb) owner to postgres;
alter function public.create_reporting_obligation_atomic(uuid, uuid, text, uuid, timestamptz, text, uuid, uuid) owner to postgres;
alter function public.correct_reporting_obligation_anchor_atomic(uuid, uuid, uuid, text, timestamptz, text, text, integer, uuid, uuid) owner to postgres;
alter function public.record_reporting_obligation_stage_submission_atomic(uuid, uuid, uuid, text, timestamptz, text, integer, uuid, uuid) owner to postgres;
alter function public.cancel_reporting_obligation_atomic(uuid, uuid, uuid, text, integer, uuid, uuid) owner to postgres;
alter function public.tick_reporting_obligation_stages_atomic(uuid, uuid, timestamptz, uuid) owner to postgres;
alter function public.get_reporting_obligation(uuid, uuid, uuid) owner to postgres;
alter function public.list_reporting_obligations(uuid, uuid, text, integer, text, text, uuid) owner to postgres;

revoke all on function public.m6_utc_second_z(timestamptz), public.m6_actor_display_name(uuid),
  public.m6_due_at(timestamptz, text), public.m6_anchor_at(public.reporting_obligations, text),
  public.m6_refresh_reporting_obligation_stages(uuid, uuid, timestamptz),
  public.m6_reporting_stage_json(uuid, uuid), public.m6_reporting_obligation_json(uuid, uuid), public.m6_command_digest(jsonb),
  public.create_reporting_obligation_atomic(uuid, uuid, text, uuid, timestamptz, text, uuid, uuid),
  public.correct_reporting_obligation_anchor_atomic(uuid, uuid, uuid, text, timestamptz, text, text, integer, uuid, uuid),
  public.record_reporting_obligation_stage_submission_atomic(uuid, uuid, uuid, text, timestamptz, text, integer, uuid, uuid),
  public.cancel_reporting_obligation_atomic(uuid, uuid, uuid, text, integer, uuid, uuid),
  public.tick_reporting_obligation_stages_atomic(uuid, uuid, timestamptz, uuid),
  public.get_reporting_obligation(uuid, uuid, uuid),
  public.list_reporting_obligations(uuid, uuid, text, integer, text, text, uuid)
from public, anon, authenticated;

grant execute on function public.create_reporting_obligation_atomic(uuid, uuid, text, uuid, timestamptz, text, uuid, uuid),
  public.correct_reporting_obligation_anchor_atomic(uuid, uuid, uuid, text, timestamptz, text, text, integer, uuid, uuid),
  public.record_reporting_obligation_stage_submission_atomic(uuid, uuid, uuid, text, timestamptz, text, integer, uuid, uuid),
  public.cancel_reporting_obligation_atomic(uuid, uuid, uuid, text, integer, uuid, uuid),
  public.tick_reporting_obligation_stages_atomic(uuid, uuid, timestamptz, uuid),
  public.get_reporting_obligation(uuid, uuid, uuid),
  public.list_reporting_obligations(uuid, uuid, text, integer, text, text, uuid)
to service_role;
