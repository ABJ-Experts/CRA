-- The active-scope unique index is intentionally strict. Retire the predecessor
-- before inserting its successor; the enclosing RPC transaction restores it if a
-- later write fails, so no gap is observable outside the transaction.

create or replace function public.supersede_product_support_period_atomic(
  p_organization_id uuid, p_product_id uuid, p_support_period_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_support_starts_at timestamptz, p_support_ends_at timestamptz,
  p_expected_lifetime_justification text, p_reason text, p_preview_digest text,
  p_allow_protection_reduction boolean, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, support_period jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_product public.products%rowtype;
  v_old public.product_support_periods%rowtype;
  v_new public.product_support_periods%rowtype;
  v_preview jsonb;
  v_retention jsonb;
  v_lowering boolean;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_product from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
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
  set superseded_at = now(), updated_at = now(), updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_old.id;
  insert into public.product_support_periods(
    organization_id, product_id, release_id, support_starts_at, support_ends_at,
    expected_lifetime_justification, decision_actor_id, effective_at, scope_revision,
    created_by, updated_by
  ) values (
    p_organization_id, p_product_id, v_old.release_id, p_support_starts_at, p_support_ends_at,
    btrim(p_expected_lifetime_justification), p_actor_user_id, now(), v_old.scope_revision + 1,
    p_actor_user_id, p_actor_user_id
  ) returning * into v_new;
  update public.product_support_periods
  set superseded_by_id = v_new.id, updated_at = now(), updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_old.id;
  update public.product_regulatory_outbox_events
  set delivery_state = 'obsolete', obsolete_at = now(), lease_owner = null, lease_expires_at = null
  where organization_id = p_organization_id and event_type = 'support_period.alert'
    and support_period_id = v_old.id
    and delivery_state in ('scheduled', 'retrying', 'recipient_unavailable') and due_at > now();
  v_retention := public.m2_recalculate_product_retention_atomic(
    p_organization_id, p_product_id, p_actor_user_id, v_lowering
  );
  perform public.m2_schedule_support_alerts(p_organization_id, p_product_id, v_new, p_correlation_id);
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state, delivered_at
  ) values (
    p_organization_id, p_product_id, null, 'product.retention.recalculated',
    concat('retention:', v_new.id::text, ':', v_new.scope_revision::text), v_retention,
    p_correlation_id, now(), 'delivered', now()
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.support_period_superseded',
    'product_support_period', v_new.id::text,
    jsonb_build_object(
      'before', public.m2_support_period_json(v_old),
      'after', public.m2_support_period_json(v_new),
      'reason', btrim(p_reason), 'previewDigest', p_preview_digest,
      'retention', v_retention, 'correlationId', p_correlation_id
    )
  );
  return query select 'superseded'::text, public.m2_support_period_json(v_new);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end $$;

alter function public.supersede_product_support_period_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, text, boolean, uuid, uuid) owner to postgres;
revoke all on function public.supersede_product_support_period_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, text, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function public.supersede_product_support_period_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, text, boolean, uuid, uuid) to service_role;
