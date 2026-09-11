-- Persist command identity on the immutable decision itself. This gives create
-- and supersede retries a stable replay result without introducing another
-- mutable workflow table.

alter table public.product_support_periods
  add column if not exists idempotency_key uuid,
  add column if not exists idempotency_request_digest text;

alter table public.product_support_periods
  drop constraint if exists product_support_periods_idempotency_digest_check;
alter table public.product_support_periods
  add constraint product_support_periods_idempotency_digest_check check (
    (idempotency_key is null and idempotency_request_digest is null)
    or (idempotency_key is not null and idempotency_request_digest ~ '^[a-f0-9]{64}$')
  );

create unique index if not exists product_support_period_actor_idempotency_key
  on public.product_support_periods(organization_id, decision_actor_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.m2_support_period_command_digest(p_payload jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex')
$$;

create or replace function public.create_product_support_period_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_support_starts_at timestamptz, p_support_ends_at timestamptz,
  p_expected_lifetime_justification text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, support_period jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_period public.product_support_periods%rowtype;
  v_replay public.product_support_periods%rowtype;
  v_retention jsonb;
  v_request_digest text;
begin
  if p_idempotency_key is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id
  for update;
  if not found or (
    p_release_id is not null and not exists (
      select 1 from public.product_releases
      where organization_id = p_organization_id
        and product_id = p_product_id
        and id = p_release_id
    )
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if p_support_ends_at <= p_support_starts_at
    or char_length(btrim(p_expected_lifetime_justification)) = 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  v_request_digest := public.m2_support_period_command_digest(jsonb_build_object(
    'action', 'create', 'productId', p_product_id, 'releaseId', p_release_id,
    'supportStartsAt', public.m2_utc_z(p_support_starts_at),
    'supportEndsAt', public.m2_utc_z(p_support_ends_at),
    'justification', btrim(p_expected_lifetime_justification)
  ));
  select * into v_replay from public.product_support_periods
  where organization_id = p_organization_id
    and decision_actor_id = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'created'::text, public.m2_support_period_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  if exists (
    select 1 from public.product_support_periods
    where organization_id = p_organization_id and product_id = p_product_id
      and release_id is not distinct from p_release_id and superseded_at is null
  ) then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;

  insert into public.product_support_periods(
    organization_id, product_id, release_id, support_starts_at, support_ends_at,
    expected_lifetime_justification, decision_actor_id, effective_at, scope_revision,
    created_by, updated_by, idempotency_key, idempotency_request_digest
  ) values (
    p_organization_id, p_product_id, p_release_id, p_support_starts_at, p_support_ends_at,
    btrim(p_expected_lifetime_justification), p_actor_user_id, now(), 1,
    p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_period;
  v_retention := public.m2_recalculate_product_retention_atomic(
    p_organization_id, p_product_id, p_actor_user_id, false
  );
  perform public.m2_schedule_support_alerts(
    p_organization_id, p_product_id, v_period, p_correlation_id
  );
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state, delivered_at
  ) values (
    p_organization_id, p_product_id, null, 'product.retention.recalculated',
    concat('retention:', v_period.id::text, ':', v_period.scope_revision::text),
    v_retention, p_correlation_id, now(), 'delivered', now()
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.support_period_created',
    'product_support_period', v_period.id::text,
    jsonb_build_object(
      'after', public.m2_support_period_json(v_period),
      'retention', v_retention, 'correlationId', p_correlation_id,
      'requestDigest', v_request_digest
    )
  );
  return query select 'created'::text, public.m2_support_period_json(v_period);
exception when unique_violation then
  select * into v_replay from public.product_support_periods
  where organization_id = p_organization_id
    and decision_actor_id = p_actor_user_id
    and idempotency_key = p_idempotency_key;
  if found and v_replay.idempotency_request_digest = v_request_digest then
    return query select 'created'::text, public.m2_support_period_json(v_replay);
  end if;
  if found then
    return query select 'idempotency_mismatch'::text, null::jsonb;
  end if;
  return query select 'conflict'::text, null::jsonb;
end $$;

create or replace function public.supersede_product_support_period_atomic(
  p_organization_id uuid, p_product_id uuid, p_support_period_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_support_starts_at timestamptz, p_support_ends_at timestamptz,
  p_expected_lifetime_justification text, p_reason text, p_preview_digest text,
  p_allow_protection_reduction boolean, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, support_period jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.product_support_periods%rowtype;
  v_new public.product_support_periods%rowtype;
  v_replay public.product_support_periods%rowtype;
  v_preview jsonb;
  v_retention jsonb;
  v_lowering boolean;
  v_request_digest text;
begin
  if p_idempotency_key is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_request_digest := public.m2_support_period_command_digest(jsonb_build_object(
    'action', 'supersede', 'productId', p_product_id,
    'supportPeriodId', p_support_period_id, 'expectedVersion', p_expected_version,
    'supportStartsAt', public.m2_utc_z(p_support_starts_at),
    'supportEndsAt', public.m2_utc_z(p_support_ends_at),
    'justification', btrim(p_expected_lifetime_justification),
    'reason', btrim(p_reason), 'previewDigest', p_preview_digest,
    'allowProtectionReduction', p_allow_protection_reduction
  ));
  select * into v_replay from public.product_support_periods
  where organization_id = p_organization_id
    and decision_actor_id = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'superseded'::text, public.m2_support_period_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  select * into v_old from public.product_support_periods
  where organization_id = p_organization_id and product_id = p_product_id and id = p_support_period_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_old.superseded_at is not null or v_old.version <> p_expected_version then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;
  if p_support_ends_at <= p_support_starts_at
    or char_length(btrim(p_expected_lifetime_justification)) = 0
    or char_length(btrim(p_reason)) = 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  v_preview := public.m2_support_preview_json(
    p_organization_id, p_product_id, v_old.release_id, v_old,
    p_support_starts_at, p_support_ends_at, p_expected_lifetime_justification
  );
  v_lowering := coalesce((v_preview ->> 'isShortening')::boolean, false);
  if v_lowering and (p_preview_digest is null or p_preview_digest <> v_preview ->> 'previewDigest') then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;
  if v_lowering and exists (
    select 1 from public.product_lifecycle_dependency_facts facts
    where facts.organization_id = p_organization_id and facts.product_id = p_product_id
      and facts.active and facts.authority_kind in ('legal_hold', 'retention')
  ) then
    return query select 'blocked'::text, null::jsonb;
    return;
  end if;
  if v_lowering and not p_allow_protection_reduction then
    return query select 'blocked'::text, null::jsonb;
    return;
  end if;
  update public.product_support_periods
  set superseded_at = now(), updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_old.id;
  insert into public.product_support_periods(
    organization_id, product_id, release_id, support_starts_at, support_ends_at,
    expected_lifetime_justification, decision_actor_id, effective_at, scope_revision,
    created_by, updated_by, idempotency_key, idempotency_request_digest
  ) values (
    p_organization_id, p_product_id, v_old.release_id, p_support_starts_at, p_support_ends_at,
    btrim(p_expected_lifetime_justification), p_actor_user_id, now(), v_old.scope_revision + 1,
    p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_new;
  update public.product_support_periods
  set superseded_by_id = v_new.id, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_old.id;
  update public.product_regulatory_outbox_events
  set delivery_state = 'obsolete', obsolete_at = now(), lease_owner = null, lease_expires_at = null
  where organization_id = p_organization_id and event_type = 'support_period.alert'
    and support_period_id = v_old.id
    and delivery_state in ('scheduled', 'retrying', 'recipient_unavailable') and due_at > now();
  v_retention := public.m2_recalculate_product_retention_atomic(
    p_organization_id, p_product_id, p_actor_user_id, v_lowering
  );
  perform public.m2_schedule_support_alerts(
    p_organization_id, p_product_id, v_new, p_correlation_id
  );
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state, delivered_at
  ) values (
    p_organization_id, p_product_id, null, 'product.retention.recalculated',
    concat('retention:', v_new.id::text, ':', v_new.scope_revision::text),
    v_retention, p_correlation_id, now(), 'delivered', now()
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.support_period_superseded',
    'product_support_period', v_new.id::text,
    jsonb_build_object(
      'before', public.m2_support_period_json(v_old),
      'after', public.m2_support_period_json(v_new),
      'reason', btrim(p_reason), 'previewDigest', p_preview_digest,
      'retention', v_retention, 'correlationId', p_correlation_id,
      'requestDigest', v_request_digest
    )
  );
  return query select 'superseded'::text, public.m2_support_period_json(v_new);
exception when unique_violation then
  select * into v_replay from public.product_support_periods
  where organization_id = p_organization_id
    and decision_actor_id = p_actor_user_id
    and idempotency_key = p_idempotency_key;
  if found and v_replay.idempotency_request_digest = v_request_digest then
    return query select 'superseded'::text, public.m2_support_period_json(v_replay);
  end if;
  if found then
    return query select 'idempotency_mismatch'::text, null::jsonb;
  end if;
  return query select 'conflict'::text, null::jsonb;
end $$;

alter function public.m2_support_period_command_digest(jsonb) owner to postgres;
alter function public.create_product_support_period_atomic(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, uuid, uuid) owner to postgres;
alter function public.supersede_product_support_period_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, text, boolean, uuid, uuid) owner to postgres;
revoke all on function public.m2_support_period_command_digest(jsonb), public.create_product_support_period_atomic(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, uuid, uuid), public.supersede_product_support_period_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, text, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_product_support_period_atomic(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, uuid, uuid), public.supersede_product_support_period_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, text, boolean, uuid, uuid) to service_role;
