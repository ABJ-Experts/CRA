-- M2 V1 support commitments, deterministic product retention, and durable
-- support-end alerts. This is additive: no historical compliance fact is
-- removed if callers/workers are rolled back.

alter table public.products
  add column if not exists retention_until timestamptz,
  add column if not exists retention_protection_until timestamptz,
  add column if not exists retention_status text not null default 'incomplete'
    check (retention_status in ('current', 'incomplete')),
  add column if not exists retention_rule_version text,
  add column if not exists retention_recalculated_at timestamptz,
  add column if not exists retention_recalculated_by uuid references public.users(id) on delete set null;

alter table public.organization_settings
  add column if not exists support_alert_intervals integer[] not null default array[180, 90, 30],
  add column if not exists support_alert_intervals_version integer not null default 1,
  add column if not exists support_alert_intervals_updated_at timestamptz not null default now(),
  add column if not exists support_alert_intervals_updated_by uuid references public.users(id) on delete set null;

alter table public.organization_settings
  drop constraint if exists organization_settings_support_alert_intervals_check;
create or replace function public.m2_valid_support_alert_intervals(p_values integer[])
returns boolean language sql immutable strict set search_path = public, pg_temp as $$
  select cardinality(p_values) between 1 and 12
     and p_values = array(select distinct value from unnest(p_values) value order by value desc)
     and (select bool_and(value between 1 and 3650) from unnest(p_values) value)
$$;
alter table public.organization_settings
  add constraint organization_settings_support_alert_intervals_check check (
    public.m2_valid_support_alert_intervals(support_alert_intervals)
  );

create table if not exists public.product_support_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid,
  support_starts_at timestamptz not null,
  support_ends_at timestamptz not null,
  expected_lifetime_justification text not null check (char_length(btrim(expected_lifetime_justification)) between 1 and 4000),
  decision_actor_id uuid not null references public.users(id) on delete restrict,
  effective_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_id uuid,
  scope_revision integer not null check (scope_revision > 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, product_id, release_id, scope_revision),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id, release_id) references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_id) references public.product_support_periods(organization_id, id) on delete restrict,
  check (support_ends_at > support_starts_at),
  check ((superseded_at is null) = (superseded_by_id is null))
);

create unique index if not exists product_support_period_active_default_key
  on public.product_support_periods(organization_id, product_id)
  where release_id is null and superseded_at is null;
create unique index if not exists product_support_period_active_release_key
  on public.product_support_periods(organization_id, product_id, release_id)
  where release_id is not null and superseded_at is null;
create index if not exists product_support_period_history_idx
  on public.product_support_periods(organization_id, product_id, release_id, created_at desc, id desc);

alter table public.product_support_periods enable row level security;
revoke all on public.product_support_periods from public, anon, authenticated;
grant select, insert, update on public.product_support_periods to service_role;

-- Retention arithmetic intentionally uses UTC calendar fields. `+ interval
-- '10 years'` would be tempting but this function makes the leap-day policy
-- explicit and reuses an invariant timestamp formatter.
create or replace function public.m2_retention_placement_candidate(p_placed_at timestamptz)
returns timestamptz language sql immutable strict set search_path = public, pg_temp as $$
  select make_timestamptz(
    extract(year from p_placed_at at time zone 'UTC')::integer + 10,
    extract(month from p_placed_at at time zone 'UTC')::integer,
    least(
      extract(day from p_placed_at at time zone 'UTC')::integer,
      extract(day from (date_trunc('month', make_date(extract(year from p_placed_at at time zone 'UTC')::integer + 10, extract(month from p_placed_at at time zone 'UTC')::integer, 1)) + interval '1 month - 1 day'))::integer
    ),
    extract(hour from p_placed_at at time zone 'UTC')::integer,
    extract(minute from p_placed_at at time zone 'UTC')::integer,
    extract(second from p_placed_at at time zone 'UTC'),
    'UTC'
  )
$$;

create or replace function public.m2_support_period_json(p_period public.product_support_periods)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_period.id, 'organizationId', p_period.organization_id,
    'productId', p_period.product_id, 'releaseId', p_period.release_id,
    'supportStartsAt', public.m2_utc_z(p_period.support_starts_at),
    'supportEndsAt', public.m2_utc_z(p_period.support_ends_at),
    'expectedLifetimeJustification', p_period.expected_lifetime_justification,
    'decisionActorId', p_period.decision_actor_id,
    'effectiveAt', public.m2_utc_z(p_period.effective_at),
    'supersededAt', case when p_period.superseded_at is null then null else public.m2_utc_z(p_period.superseded_at) end,
    'supersededById', p_period.superseded_by_id,
    'scopeRevision', p_period.scope_revision, 'version', p_period.version,
    'createdAt', public.m2_utc_z(p_period.created_at), 'createdBy', p_period.created_by,
    'updatedAt', public.m2_utc_z(p_period.updated_at), 'updatedBy', p_period.updated_by
  )
$$;

-- Extend the existing transaction outbox rather than create an alert table.
alter table public.product_regulatory_outbox_events
  alter column release_id drop not null,
  drop constraint if exists product_regulatory_outbox_events_event_type_check,
  add column if not exists due_at timestamptz,
  add column if not exists support_period_id uuid,
  add column if not exists support_period_revision integer,
  add column if not exists alert_threshold_days integer,
  add column if not exists delivery_state text not null default 'pending'
    check (delivery_state in ('pending', 'scheduled', 'leased', 'delivered', 'retrying', 'dead_letter', 'obsolete', 'recipient_unavailable')),
  add column if not exists missed boolean not null default false,
  add column if not exists obsolete_at timestamptz,
  add column if not exists lease_owner uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists checkpoint_version integer not null default 0,
  add column if not exists last_error_code text,
  add column if not exists delivered_to_user_id uuid references public.users(id) on delete set null;
alter table public.product_regulatory_outbox_events
  add constraint product_regulatory_outbox_events_event_type_check check (event_type in (
    'release.market_availability_changed', 'release.lifecycle_changed',
    'release.placed_on_market_changed', 'support_period.alert',
    'product.retention.recalculated'
  ));
alter table public.product_regulatory_outbox_events
  add constraint product_regulatory_outbox_support_period_fk foreign key (organization_id, support_period_id)
    references public.product_support_periods(organization_id, id) on delete restrict;
create unique index if not exists product_support_alert_idempotency_key
  on public.product_regulatory_outbox_events(organization_id, support_period_id, support_period_revision, alert_threshold_days)
  where event_type = 'support_period.alert';
create index if not exists product_support_alert_due_idx
  on public.product_regulatory_outbox_events(organization_id, due_at, id)
  where event_type = 'support_period.alert' and delivery_state in ('scheduled', 'retrying', 'recipient_unavailable');

create or replace function public.m2_active_support_period(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid
) returns public.product_support_periods language sql stable set search_path = public, pg_temp as $$
  select period.* from public.product_support_periods period
   where period.organization_id = p_organization_id and period.product_id = p_product_id
     and period.superseded_at is null
     and (period.release_id = p_release_id or period.release_id is null)
   order by case when period.release_id = p_release_id then 0 else 1 end
   limit 1
$$;

create or replace function public.m2_recalculate_product_retention_atomic(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid, p_allow_protection_reduction boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_release record; v_period public.product_support_periods%rowtype;
  v_placement timestamptz; v_candidate timestamptz; v_support timestamptz; v_final timestamptz;
  v_max timestamptz; v_protection timestamptz; v_incomplete boolean := false; v_releases jsonb := '[]'::jsonb;
  v_placed_max timestamptz; v_support_max timestamptz; v_winner text; v_hold boolean := false;
begin
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update;
  if not found then return null; end if;
  for v_release in select * from public.product_releases where organization_id=p_organization_id and product_id=p_product_id order by id loop
    select * into v_period from public.m2_active_support_period(p_organization_id,p_product_id,v_release.id);
    v_placement := v_release.placed_on_market_at;
    v_support := v_period.support_ends_at;
    if v_placement is null or v_support is null then
      v_incomplete := true;
      v_releases := v_releases || jsonb_build_array(jsonb_build_object(
        'releaseId',v_release.id,'ruleVersion','m2.v1.later_of_placement_plus_10y_or_support_end','status','incomplete',
        'placedOnMarketCandidate',case when v_placement is null then null else public.m2_utc_z(public.m2_retention_placement_candidate(v_placement)) end,
        'supportPeriodCandidate',case when v_support is null then null else public.m2_utc_z(v_support) end,
        'retentionUntil',null,'retentionProtectionUntil',case when v_product.retention_protection_until is null then null else public.m2_utc_z(v_product.retention_protection_until) end,
        'winningRule',null,'incompleteReasons',jsonb_strip_nulls(jsonb_build_array(case when v_placement is null then 'missing_placed_on_market_at' end,case when v_support is null then 'missing_support_period' end)),'legalHoldActive',v_hold));
      continue;
    end if;
    v_candidate := public.m2_retention_placement_candidate(v_placement);
    v_final := greatest(v_candidate,v_support);
    v_max := greatest(coalesce(v_max,'-infinity'::timestamptz),v_final);
    v_placed_max := greatest(coalesce(v_placed_max,'-infinity'::timestamptz),v_candidate);
    v_support_max := greatest(coalesce(v_support_max,'-infinity'::timestamptz),v_support);
    v_releases := v_releases || jsonb_build_array(jsonb_build_object(
      'releaseId',v_release.id,'ruleVersion','m2.v1.later_of_placement_plus_10y_or_support_end','status','current',
      'placedOnMarketCandidate',public.m2_utc_z(v_candidate),'supportPeriodCandidate',public.m2_utc_z(v_support),
      'retentionUntil',public.m2_utc_z(v_final),'retentionProtectionUntil',public.m2_utc_z(greatest(v_final,coalesce(v_product.retention_protection_until,'-infinity'::timestamptz))),
      'winningRule',case when v_candidate=v_support then 'equal' when v_candidate>v_support then 'placed_on_market_plus_10_calendar_years' else 'support_period_end' end,
      'incompleteReasons','[]'::jsonb,'legalHoldActive',v_hold));
  end loop;
  if not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id) then v_incomplete := true; end if;
  if v_incomplete then
    update public.products set retention_status='incomplete',retention_until=null,retention_rule_version='m2.v1.later_of_placement_plus_10y_or_support_end',retention_recalculated_at=now(),retention_recalculated_by=p_actor_user_id where id=v_product.id;
  else
    v_protection := case when p_allow_protection_reduction then v_max else greatest(coalesce(v_product.retention_protection_until,'-infinity'::timestamptz),v_max) end;
    update public.products set retention_status='current',retention_until=v_max,retention_protection_until=nullif(v_protection,'-infinity'::timestamptz),retention_rule_version='m2.v1.later_of_placement_plus_10y_or_support_end',retention_recalculated_at=now(),retention_recalculated_by=p_actor_user_id where id=v_product.id;
  end if;
  if not v_incomplete then v_winner := case when v_placed_max=v_support_max then 'equal' when v_placed_max>v_support_max then 'placed_on_market_plus_10_calendar_years' else 'support_period_end' end; end if;
  return jsonb_build_object('ruleVersion','m2.v1.later_of_placement_plus_10y_or_support_end','status',case when v_incomplete then 'incomplete' else 'current' end,
    'placedOnMarketCandidate',case when v_incomplete then null else public.m2_utc_z(v_placed_max) end,'supportPeriodCandidate',case when v_incomplete then null else public.m2_utc_z(v_support_max) end,
    'retentionUntil',case when v_incomplete then null else public.m2_utc_z(v_max) end,'retentionProtectionUntil',case when (select retention_protection_until from public.products where id=v_product.id) is null then null else public.m2_utc_z((select retention_protection_until from public.products where id=v_product.id)) end,
    'winningRule',v_winner,'incompleteReasons',case when v_incomplete then jsonb_build_array('missing_support_period') else '[]'::jsonb end,'legalHoldActive',v_hold,'releaseCalculations',v_releases);
end $$;

create or replace function public.get_product_retention_worker_now()
returns table(outcome text, database_now timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select 'found'::text, clock_timestamp()
$$;

create or replace function public.list_due_product_support_alert_organizations()
returns table(organization_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select distinct event.organization_id
  from public.product_regulatory_outbox_events event
  where event.event_type='support_period.alert'
    and (
      (event.delivery_state in ('scheduled','retrying','recipient_unavailable') and event.due_at<=clock_timestamp())
      or (event.delivery_state='leased' and event.lease_expires_at<=clock_timestamp())
    )
  order by event.organization_id
$$;

create or replace function public.claim_product_support_alert_atomic(
  p_organization_id uuid, p_lease_owner uuid, p_lease_seconds integer
) returns table(outcome text, delivery_id uuid, lease_owner uuid, checkpoint_version integer, event jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.product_regulatory_outbox_events%rowtype; v_product public.products%rowtype; v_period public.product_support_periods%rowtype;
begin
  if p_lease_seconds not between 1 and 3600 then return query select 'invalid_state'::text,null::uuid,null::uuid,null::integer,null::jsonb; return; end if;
  select * into v_event from public.product_regulatory_outbox_events event
   where event.organization_id=p_organization_id and event.event_type='support_period.alert'
     and ((event.delivery_state in ('scheduled','retrying','recipient_unavailable') and event.due_at<=clock_timestamp()) or (event.delivery_state='leased' and event.lease_expires_at<=clock_timestamp()))
   order by event.due_at,event.id for update skip locked limit 1;
  if not found then return query select 'none_available'::text,null::uuid,null::uuid,null::integer,null::jsonb; return; end if;
  update public.product_regulatory_outbox_events set delivery_state='leased',lease_owner=p_lease_owner,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),checkpoint_version=checkpoint_version+1,delivery_attempts=delivery_attempts+1,last_delivery_error=null,last_error_code=null where id=v_event.id returning * into v_event;
  select * into v_product from public.products where organization_id=p_organization_id and id=v_event.product_id;
  select * into v_period from public.product_support_periods where organization_id=p_organization_id and id=v_event.support_period_id;
  return query select 'claimed'::text,v_event.id,v_event.lease_owner,v_event.checkpoint_version,
    jsonb_build_object('organizationId',p_organization_id,'productId',v_event.product_id,'releaseId',v_event.release_id,'eventType','support_period.alert','eventKey',v_event.event_key,'supportPeriodId',v_event.support_period_id,'supportPeriodRevision',v_event.support_period_revision,'thresholdDays',v_event.alert_threshold_days,'supportEndsAt',public.m2_utc_z(v_period.support_ends_at),'dueAt',public.m2_utc_z(v_event.due_at),'deliveryState',case when v_event.missed then 'missed_catch_up' else 'current' end,'productName',v_product.name);
end $$;

create or replace function public.get_product_support_alert_product_owner_recipient(
  p_organization_id uuid, p_product_id uuid
) returns table(user_id uuid, email text)
language sql security definer set search_path = public, pg_temp as $$
  select user_record.id,user_record.email from public.products product
  join public.organization_members member on member.organization_id=product.organization_id and member.user_id=product.responsible_owner_id
  join public.users user_record on user_record.id=member.user_id and user_record.is_active
  where product.organization_id=p_organization_id and product.id=p_product_id
  limit 1
$$;

create or replace function public.get_product_support_alert_owner_or_admin_recipient(
  p_organization_id uuid
) returns table(user_id uuid, email text)
language sql security definer set search_path = public, pg_temp as $$
  select user_record.id,user_record.email from public.organization_members member
  join public.users user_record on user_record.id=member.user_id and user_record.is_active
  where member.organization_id=p_organization_id and member.role in ('owner','admin')
  order by case member.role when 'owner' then 0 else 1 end,user_record.id
  limit 1
$$;

create or replace function public.complete_product_support_alert_delivery_atomic(
  p_organization_id uuid, p_delivery_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer, p_recipient_user_id uuid
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.product_regulatory_outbox_events set delivery_state='delivered',delivered_at=clock_timestamp(),delivered_to_user_id=p_recipient_user_id,lease_owner=null,lease_expires_at=null,last_delivery_error=null,last_error_code=null
   where organization_id=p_organization_id and id=p_delivery_id and event_type='support_period.alert' and delivery_state='leased' and lease_owner=p_lease_owner and checkpoint_version=p_expected_checkpoint_version;
  if found then return query select 'completed'::text; else return query select 'conflict'::text; end if;
end $$;

create or replace function public.fail_product_support_alert_delivery_atomic(
  p_organization_id uuid, p_delivery_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer, p_code text, p_retryable boolean
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempt integer; v_state text;
begin
  select delivery_attempts into v_attempt from public.product_regulatory_outbox_events where organization_id=p_organization_id and id=p_delivery_id and event_type='support_period.alert' and delivery_state='leased' and lease_owner=p_lease_owner and checkpoint_version=p_expected_checkpoint_version for update;
  if not found then return query select 'conflict'::text; return; end if;
  v_state := case when not p_retryable or v_attempt>=12 then 'dead_letter' when p_code='recipient_unavailable' then 'recipient_unavailable' else 'retrying' end;
  update public.product_regulatory_outbox_events set delivery_state=v_state,missed=true,lease_owner=null,lease_expires_at=null,last_error_code=left(coalesce(nullif(btrim(p_code),''),'provider_unavailable'),100),last_delivery_error=null,due_at=case when v_state='dead_letter' then due_at else clock_timestamp()+make_interval(secs=>least(3600,greatest(30,30*power(2,least(v_attempt,7))::integer))) end
   where organization_id=p_organization_id and id=p_delivery_id;
  return query select 'failed'::text;
end $$;

-- The view is intentionally aggregate-only: operational users can investigate
-- stale/incomplete scheduling without exposing recipient, evidence, or payload.
create or replace view public.product_retention_alert_operations
with (security_invoker = true) as
  select product.organization_id, product.id as product_id, product.retention_status,
    count(event.id) filter (where event.event_type='support_period.alert' and event.delivery_state='dead_letter') as dead_letter_count,
    count(event.id) filter (where event.event_type='support_period.alert' and event.delivery_state in ('retrying','recipient_unavailable')) as retrying_count,
    count(event.id) filter (where event.event_type='support_period.alert' and event.delivery_state='delivered' and event.missed) as missed_delivery_count,
    max(clock_timestamp()-event.due_at) filter (where event.event_type='support_period.alert' and event.delivery_state in ('scheduled','retrying','recipient_unavailable')) as current_alert_lag
  from public.products product left join public.product_regulatory_outbox_events event on event.organization_id=product.organization_id and event.product_id=product.id
  group by product.organization_id, product.id, product.retention_status;

create or replace function public.supersede_product_support_period_atomic(
  p_organization_id uuid, p_product_id uuid, p_support_period_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_support_starts_at timestamptz, p_support_ends_at timestamptz,
  p_expected_lifetime_justification text, p_reason text, p_preview_digest text,
  p_allow_protection_reduction boolean, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, support_period jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_old public.product_support_periods%rowtype;
  v_new public.product_support_periods%rowtype; v_preview jsonb; v_retention jsonb; v_lowering boolean;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_old from public.product_support_periods where organization_id=p_organization_id and product_id=p_product_id and id=p_support_period_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_old.superseded_at is not null or v_old.version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
  if p_support_ends_at<=p_support_starts_at or char_length(btrim(p_expected_lifetime_justification))=0 or char_length(btrim(p_reason))=0 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  v_preview := public.m2_support_preview_json(p_organization_id,p_product_id,v_old.release_id,v_old,p_support_starts_at,p_support_ends_at,p_expected_lifetime_justification);
  v_lowering := coalesce((v_preview->>'isShortening')::boolean,false);
  if v_lowering and (p_preview_digest is null or p_preview_digest<>v_preview->>'previewDigest') then return query select 'conflict'::text,null::jsonb; return; end if;
  if v_lowering and exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='legal_hold') then return query select 'blocked'::text,null::jsonb; return; end if;
  if v_lowering and not p_allow_protection_reduction then return query select 'blocked'::text,null::jsonb; return; end if;
  insert into public.product_support_periods(organization_id,product_id,release_id,support_starts_at,support_ends_at,expected_lifetime_justification,decision_actor_id,effective_at,scope_revision,created_by,updated_by)
  values(p_organization_id,p_product_id,v_old.release_id,p_support_starts_at,p_support_ends_at,btrim(p_expected_lifetime_justification),p_actor_user_id,now(),v_old.scope_revision+1,p_actor_user_id,p_actor_user_id) returning * into v_new;
  update public.product_support_periods set superseded_at=now(),superseded_by_id=v_new.id,updated_at=now(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=v_old.id;
  update public.product_regulatory_outbox_events set delivery_state='obsolete',obsolete_at=now(),lease_owner=null,lease_expires_at=null
   where organization_id=p_organization_id and event_type='support_period.alert' and support_period_id=v_old.id
     and delivery_state in ('scheduled','retrying','recipient_unavailable') and due_at>now();
  v_retention := public.m2_recalculate_product_retention_atomic(p_organization_id,p_product_id,p_actor_user_id,v_lowering);
  perform public.m2_schedule_support_alerts(p_organization_id,p_product_id,v_new,p_correlation_id);
  insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,occurred_at,delivery_state,delivered_at)
    values(p_organization_id,p_product_id,null,'product.retention.recalculated',concat('retention:',v_new.id::text,':',v_new.scope_revision::text),v_retention,p_correlation_id,now(),'delivered',now());
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'product.support_period_superseded','product_support_period',v_new.id::text,jsonb_build_object('before',public.m2_support_period_json(v_old),'after',public.m2_support_period_json(v_new),'reason',btrim(p_reason),'previewDigest',p_preview_digest,'retention',v_retention,'correlationId',p_correlation_id));
  return query select 'superseded'::text,public.m2_support_period_json(v_new);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end $$;

create or replace function public.get_product_retention_calculation(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid
) returns table(outcome text, retention jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_calculation jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  v_calculation := public.m2_recalculate_product_retention_atomic(p_organization_id,p_product_id,p_actor_user_id,false);
  return query select 'found'::text,v_calculation;
end $$;

create or replace function public.get_organization_support_alert_intervals(
  p_organization_id uuid, p_actor_user_id uuid
) returns table(outcome text, intervals jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_build_object('alertIntervalsDays',settings.support_alert_intervals,'version',settings.support_alert_intervals_version,'updatedAt',public.m2_utc_z(settings.support_alert_intervals_updated_at),'updatedBy',settings.support_alert_intervals_updated_by)
    from public.organization_settings settings where settings.organization_id=p_organization_id;
end $$;

create or replace function public.update_organization_support_alert_intervals_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_expected_version integer, p_alert_intervals integer[], p_correlation_id uuid
) returns table(outcome text, intervals jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.organization_settings%rowtype; v_normalized integer[];
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_settings from public.organization_settings where organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_settings.support_alert_intervals_version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
  select array_agg(value order by value desc) into v_normalized from (select distinct value from unnest(p_alert_intervals) value where value between 1 and 3650) values;
  if v_normalized is null or cardinality(v_normalized)<>cardinality(p_alert_intervals) or cardinality(v_normalized)>12 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  update public.organization_settings set support_alert_intervals=v_normalized,support_alert_intervals_version=support_alert_intervals_version+1,support_alert_intervals_updated_at=now(),support_alert_intervals_updated_by=p_actor_user_id where organization_id=p_organization_id;
  -- Existing future schedules retain their decision history. New periods use
  -- the new policy; no prior alert is silently added or removed.
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'organization.support_alert_intervals_updated','organization_settings',p_organization_id::text,jsonb_build_object('before',v_settings.support_alert_intervals,'after',v_normalized,'correlationId',p_correlation_id));
  return query select 'updated'::text,jsonb_build_object('alertIntervalsDays',v_normalized,'version',v_settings.support_alert_intervals_version+1,'updatedAt',public.m2_utc_z(now()),'updatedBy',p_actor_user_id);
end $$;

create or replace function public.get_product_support_alert_history(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid
) returns table(outcome text, alerts jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,coalesce(jsonb_agg(jsonb_build_object('id',event.id,'supportPeriodId',event.support_period_id,'supportPeriodRevision',event.support_period_revision,'releaseId',event.release_id,'thresholdDays',event.alert_threshold_days,'dueAt',public.m2_utc_z(event.due_at),'deliveredAt',case when event.delivered_at is null then null else public.m2_utc_z(event.delivered_at) end,'deliveryState',event.delivery_state,'missed',event.missed,'obsolete',event.delivery_state='obsolete','attempts',event.delivery_attempts,'lastErrorCode',event.last_error_code,'createdAt',public.m2_utc_z(event.occurred_at)) order by event.due_at desc,event.id desc),'[]'::jsonb)
    from public.product_regulatory_outbox_events event where event.organization_id=p_organization_id and event.product_id=p_product_id and event.event_type='support_period.alert';
end $$;

create or replace function public.m2_schedule_support_alerts(
  p_organization_id uuid,
  p_product_id uuid,
  p_period public.product_support_periods,
  p_correlation_id uuid
) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_threshold integer; v_due timestamptz;
begin
  for v_threshold in select unnest(settings.support_alert_intervals)
    from public.organization_settings settings where settings.organization_id=p_organization_id loop
    v_due := p_period.support_ends_at - make_interval(days => v_threshold);
    insert into public.product_regulatory_outbox_events(
      organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,
      occurred_at,due_at,support_period_id,support_period_revision,alert_threshold_days,
      delivery_state,missed
    ) values (
      p_organization_id,p_product_id,p_period.release_id,'support_period.alert',
      concat(p_period.id::text,':',p_period.scope_revision::text,':',v_threshold::text,':email'),
      jsonb_build_object('supportPeriodEnd',public.m2_utc_z(p_period.support_ends_at),'thresholdDays',v_threshold),
      p_correlation_id,now(),v_due,p_period.id,p_period.scope_revision,v_threshold,
      'scheduled',v_due <= now()
    ) on conflict (organization_id,support_period_id,support_period_revision,alert_threshold_days)
      where event_type='support_period.alert' do nothing;
  end loop;
end $$;

create or replace function public.m2_support_preview_json(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_current public.product_support_periods,
  p_support_starts_at timestamptz,
  p_support_ends_at timestamptz,
  p_expected_lifetime_justification text
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_current jsonb; v_proposed jsonb; v_lowering boolean; v_blocked jsonb := '[]'::jsonb;
  v_categories jsonb := jsonb_build_array('support_alerts','retention_dates'); v_digest text;
begin
  v_current := public.m2_support_period_json(p_current);
  v_proposed := jsonb_build_object('supportStartsAt',public.m2_utc_z(p_support_starts_at),'supportEndsAt',public.m2_utc_z(p_support_ends_at),'expectedLifetimeJustification',btrim(p_expected_lifetime_justification));
  v_lowering := p_current is not null and p_support_ends_at < p_current.support_ends_at;
  if exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='legal_hold') then
    v_blocked := v_blocked || jsonb_build_array('active_legal_hold');
  end if;
  if exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='retention') then
    v_categories := v_categories || jsonb_build_array('legal_floors','registered_evidence');
  end if;
  v_digest := encode(digest(jsonb_build_object('productId',p_product_id,'releaseId',p_release_id,'activeScopeRevision',coalesce(p_current.scope_revision,0),'current',v_current,'proposed',v_proposed)::text,'sha256'),'hex');
  return jsonb_build_object('current',v_current,'proposed',v_proposed,'lowering',v_lowering,'previewDigest',v_digest,
    'activeScopeRevision',coalesce(p_current.scope_revision,0),'isShortening',v_lowering,
    'retentionProtectionWouldReduce',v_lowering,'blockedReasons',v_blocked,'affectedCategories',v_categories,
    'currentRetentionUntil',null,'proposedRetentionUntil',null);
end $$;

create or replace function public.get_product_support_periods(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid
) returns table(outcome text, support_periods jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id)
     or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  return query select 'found'::text,coalesce(jsonb_agg(public.m2_support_period_json(period) order by period.created_at desc,period.id desc),'[]'::jsonb)
    from public.product_support_periods period where period.organization_id=p_organization_id and period.product_id=p_product_id;
end $$;

create or replace function public.preview_product_support_period_change(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_support_starts_at timestamptz, p_support_ends_at timestamptz,
  p_expected_lifetime_justification text
) returns table(outcome text, preview jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_period public.product_support_periods%rowtype;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id)
     or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select * into v_period from public.m2_active_support_period(p_organization_id,p_product_id,p_release_id);
  if found and v_period.version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
  return query select 'found'::text,public.m2_support_preview_json(p_organization_id,p_product_id,p_release_id,v_period,p_support_starts_at,p_support_ends_at,p_expected_lifetime_justification);
end $$;

create or replace function public.create_product_support_period_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_support_starts_at timestamptz, p_support_ends_at timestamptz,
  p_expected_lifetime_justification text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, support_period jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_period public.product_support_periods%rowtype; v_retention jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update;
  if not found or (p_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id)) then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_support_ends_at<=p_support_starts_at or char_length(btrim(p_expected_lifetime_justification))=0 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if exists(select 1 from public.product_support_periods where organization_id=p_organization_id and product_id=p_product_id and release_id is not distinct from p_release_id and superseded_at is null) then return query select 'conflict'::text,null::jsonb; return; end if;
  insert into public.product_support_periods(organization_id,product_id,release_id,support_starts_at,support_ends_at,expected_lifetime_justification,decision_actor_id,effective_at,scope_revision,created_by,updated_by)
  values(p_organization_id,p_product_id,p_release_id,p_support_starts_at,p_support_ends_at,btrim(p_expected_lifetime_justification),p_actor_user_id,now(),1,p_actor_user_id,p_actor_user_id) returning * into v_period;
  v_retention := public.m2_recalculate_product_retention_atomic(p_organization_id,p_product_id,p_actor_user_id,false);
  perform public.m2_schedule_support_alerts(p_organization_id,p_product_id,v_period,p_correlation_id);
  insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,occurred_at,delivery_state,delivered_at)
    values(p_organization_id,p_product_id,null,'product.retention.recalculated',concat('retention:',v_period.id::text,':',v_period.scope_revision::text),v_retention,p_correlation_id,now(),'delivered',now());
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'product.support_period_created','product_support_period',v_period.id::text,jsonb_build_object('after',public.m2_support_period_json(v_period),'retention',v_retention,'correlationId',p_correlation_id));
  return query select 'created'::text,public.m2_support_period_json(v_period);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end $$;

alter function public.get_product_support_periods(uuid,uuid,uuid) owner to postgres;
alter function public.preview_product_support_period_change(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text) owner to postgres;
alter function public.create_product_support_period_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid) owner to postgres;
alter function public.supersede_product_support_period_atomic(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text,text,boolean,uuid,uuid) owner to postgres;
alter function public.get_product_retention_calculation(uuid,uuid,uuid) owner to postgres;
alter function public.get_organization_support_alert_intervals(uuid,uuid) owner to postgres;
alter function public.update_organization_support_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid) owner to postgres;
alter function public.get_product_support_alert_history(uuid,uuid,uuid) owner to postgres;
alter function public.get_product_retention_worker_now() owner to postgres;
alter function public.list_due_product_support_alert_organizations() owner to postgres;
alter function public.claim_product_support_alert_atomic(uuid,uuid,integer) owner to postgres;
alter function public.get_product_support_alert_product_owner_recipient(uuid,uuid) owner to postgres;
alter function public.get_product_support_alert_owner_or_admin_recipient(uuid) owner to postgres;
alter function public.complete_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,uuid) owner to postgres;
alter function public.fail_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,text,boolean) owner to postgres;
revoke all on function public.get_product_support_periods(uuid,uuid,uuid), public.preview_product_support_period_change(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text), public.create_product_support_period_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid), public.supersede_product_support_period_atomic(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text,text,boolean,uuid,uuid), public.get_product_retention_calculation(uuid,uuid,uuid), public.get_organization_support_alert_intervals(uuid,uuid), public.update_organization_support_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid), public.get_product_support_alert_history(uuid,uuid,uuid), public.get_product_retention_worker_now(), public.list_due_product_support_alert_organizations(), public.claim_product_support_alert_atomic(uuid,uuid,integer), public.get_product_support_alert_product_owner_recipient(uuid,uuid), public.get_product_support_alert_owner_or_admin_recipient(uuid), public.complete_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,uuid), public.fail_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,text,boolean) from public, anon, authenticated;
grant execute on function public.get_product_support_periods(uuid,uuid,uuid), public.preview_product_support_period_change(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text), public.create_product_support_period_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid), public.supersede_product_support_period_atomic(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text,text,boolean,uuid,uuid), public.get_product_retention_calculation(uuid,uuid,uuid), public.get_organization_support_alert_intervals(uuid,uuid), public.update_organization_support_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid), public.get_product_support_alert_history(uuid,uuid,uuid), public.get_product_retention_worker_now(), public.list_due_product_support_alert_organizations(), public.claim_product_support_alert_atomic(uuid,uuid,integer), public.get_product_support_alert_product_owner_recipient(uuid,uuid), public.get_product_support_alert_owner_or_admin_recipient(uuid), public.complete_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,uuid), public.fail_product_support_alert_delivery_atomic(uuid,uuid,uuid,integer,text,boolean) to service_role;
grant select on public.product_retention_alert_operations to service_role;
