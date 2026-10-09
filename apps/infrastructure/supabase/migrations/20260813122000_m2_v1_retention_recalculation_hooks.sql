-- Roll-forward hardening for M2 V1: controlling placement and hold facts
-- update the durable retention projection in their originating transaction.

create or replace function public.m2_recalculate_product_retention_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid,
  p_allow_protection_reduction boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_product public.products%rowtype;
  v_release record;
  v_period public.product_support_periods%rowtype;
  v_placement timestamptz;
  v_candidate timestamptz;
  v_support timestamptz;
  v_final timestamptz;
  v_max timestamptz;
  v_protection timestamptz;
  v_incomplete boolean := false;
  v_releases jsonb := '[]'::jsonb;
  v_placed_max timestamptz;
  v_support_max timestamptz;
  v_winner text;
  v_hold boolean := false;
  v_incomplete_reasons jsonb := '[]'::jsonb;
begin
  select * into v_product
  from public.products
  where organization_id = p_organization_id and id = p_product_id
  for update;
  if not found then return null; end if;

  v_hold := exists (
    select 1 from public.product_lifecycle_dependency_facts facts
    where facts.organization_id = p_organization_id
      and facts.product_id = p_product_id
      and facts.active
      and facts.authority_kind = 'legal_hold'
  );

  for v_release in
    select * from public.product_releases
    where organization_id = p_organization_id and product_id = p_product_id
    order by id
  loop
    select * into v_period
    from public.m2_active_support_period(
      p_organization_id, p_product_id, v_release.id
    );
    v_placement := v_release.placed_on_market_at;
    v_support := v_period.support_ends_at;
    if v_placement is null or v_support is null then
      v_incomplete := true;
      if v_placement is null then
        v_incomplete_reasons := v_incomplete_reasons || '"missing_placed_on_market_at"'::jsonb;
      end if;
      if v_support is null then
        v_incomplete_reasons := v_incomplete_reasons || '"missing_support_period"'::jsonb;
      end if;
      v_releases := v_releases || jsonb_build_array(jsonb_build_object(
        'releaseId', v_release.id,
        'ruleVersion', 'm2.v1.later_of_placement_plus_10y_or_support_end',
        'status', 'incomplete',
        'placedOnMarketCandidate', case when v_placement is null then null else public.m2_utc_z(public.m2_retention_placement_candidate(v_placement)) end,
        'supportPeriodCandidate', case when v_support is null then null else public.m2_utc_z(v_support) end,
        'retentionUntil', null,
        'retentionProtectionUntil', case when v_product.retention_protection_until is null then null else public.m2_utc_z(v_product.retention_protection_until) end,
        'winningRule', null,
        'incompleteReasons', jsonb_strip_nulls(jsonb_build_array(
          case when v_placement is null then 'missing_placed_on_market_at' end,
          case when v_support is null then 'missing_support_period' end
        )),
        'legalHoldActive', v_hold
      ));
      continue;
    end if;

    v_candidate := public.m2_retention_placement_candidate(v_placement);
    v_final := greatest(v_candidate, v_support);
    v_max := greatest(coalesce(v_max, '-infinity'::timestamptz), v_final);
    v_placed_max := greatest(
      coalesce(v_placed_max, '-infinity'::timestamptz), v_candidate
    );
    v_support_max := greatest(
      coalesce(v_support_max, '-infinity'::timestamptz), v_support
    );
    v_releases := v_releases || jsonb_build_array(jsonb_build_object(
      'releaseId', v_release.id,
      'ruleVersion', 'm2.v1.later_of_placement_plus_10y_or_support_end',
      'status', 'current',
      'placedOnMarketCandidate', public.m2_utc_z(v_candidate),
      'supportPeriodCandidate', public.m2_utc_z(v_support),
      'retentionUntil', public.m2_utc_z(v_final),
      'retentionProtectionUntil', public.m2_utc_z(greatest(
        v_final, coalesce(v_product.retention_protection_until, '-infinity'::timestamptz)
      )),
      'winningRule', case
        when v_candidate = v_support then 'equal'
        when v_candidate > v_support then 'placed_on_market_plus_10_calendar_years'
        else 'support_period_end'
      end,
      'incompleteReasons', '[]'::jsonb,
      'legalHoldActive', v_hold
    ));
  end loop;

  if not exists (
    select 1 from public.product_releases
    where organization_id = p_organization_id and product_id = p_product_id
  ) then
    v_incomplete := true;
    v_incomplete_reasons := v_incomplete_reasons || '"missing_release"'::jsonb;
  end if;

  select coalesce(jsonb_agg(distinct reason), '[]'::jsonb)
  into v_incomplete_reasons
  from jsonb_array_elements_text(v_incomplete_reasons) reason;

  if v_incomplete then
    update public.products
    set retention_status = 'incomplete',
        retention_until = null,
        retention_rule_version = 'm2.v1.later_of_placement_plus_10y_or_support_end',
        retention_recalculated_at = now(),
        retention_recalculated_by = p_actor_user_id
    where id = v_product.id;
  else
    v_protection := case
      when p_allow_protection_reduction then v_max
      else greatest(coalesce(v_product.retention_protection_until, '-infinity'::timestamptz), v_max)
    end;
    update public.products
    set retention_status = 'current',
        retention_until = v_max,
        retention_protection_until = nullif(v_protection, '-infinity'::timestamptz),
        retention_rule_version = 'm2.v1.later_of_placement_plus_10y_or_support_end',
        retention_recalculated_at = now(),
        retention_recalculated_by = p_actor_user_id
    where id = v_product.id;
  end if;

  if not v_incomplete then
    v_winner := case
      when v_placed_max = v_support_max then 'equal'
      when v_placed_max > v_support_max then 'placed_on_market_plus_10_calendar_years'
      else 'support_period_end'
    end;
  end if;

  return jsonb_build_object(
    'ruleVersion', 'm2.v1.later_of_placement_plus_10y_or_support_end',
    'status', case when v_incomplete then 'incomplete' else 'current' end,
    'placedOnMarketCandidate', case when v_incomplete then null else public.m2_utc_z(v_placed_max) end,
    'supportPeriodCandidate', case when v_incomplete then null else public.m2_utc_z(v_support_max) end,
    'retentionUntil', case when v_incomplete then null else public.m2_utc_z(v_max) end,
    'retentionProtectionUntil', case
      when (select retention_protection_until from public.products where id = v_product.id) is null then null
      else public.m2_utc_z((select retention_protection_until from public.products where id = v_product.id))
    end,
    'winningRule', v_winner,
    'incompleteReasons', case when v_incomplete then v_incomplete_reasons else '[]'::jsonb end,
    'legalHoldActive', v_hold,
    'releaseCalculations', v_releases
  );
end $$;

create or replace function public.m2_record_retention_recalculation(
  p_organization_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid,
  p_cause text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_retention jsonb; v_correlation_id uuid := gen_random_uuid();
begin
  v_retention := public.m2_recalculate_product_retention_atomic(
    p_organization_id, p_product_id, p_actor_user_id, false
  );
  if v_retention is null then return; end if;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state, delivered_at
  ) values (
    p_organization_id, p_product_id, null, 'product.retention.recalculated',
    concat('retention:', p_cause, ':', v_correlation_id::text), v_retention,
    v_correlation_id, now(), 'delivered', now()
  );
  insert into public.audit_logs(
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'product.retention_recalculated',
    'product', p_product_id::text,
    jsonb_build_object('cause', p_cause, 'retention', v_retention,
      'correlationId', v_correlation_id)
  );
end $$;

create or replace function public.m2_recalculate_retention_after_release_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.m2_record_retention_recalculation(
    new.organization_id, new.product_id, new.updated_by,
    case when tg_op = 'INSERT' then 'release_created' else 'placed_on_market_changed' end
  );
  return new;
end $$;

drop trigger if exists m2_recalculate_retention_after_release_change on public.product_releases;
create trigger m2_recalculate_retention_after_release_change
after insert or update of placed_on_market_at on public.product_releases
for each row execute function public.m2_recalculate_retention_after_release_change();

create or replace function public.m2_recalculate_retention_after_legal_fact_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.authority_kind not in ('legal_hold', 'retention') then return new; end if;
  perform public.m2_record_retention_recalculation(
    new.organization_id, new.product_id, new.reconciled_by, 'binding_fact_changed'
  );
  return new;
end $$;

drop trigger if exists m2_recalculate_retention_after_legal_fact_change on public.product_lifecycle_dependency_facts;
create trigger m2_recalculate_retention_after_legal_fact_change
after insert or update of active, authority_kind on public.product_lifecycle_dependency_facts
for each row execute function public.m2_recalculate_retention_after_legal_fact_change();

alter function public.m2_recalculate_product_retention_atomic(uuid, uuid, uuid, boolean) owner to postgres;
alter function public.m2_record_retention_recalculation(uuid, uuid, uuid, text) owner to postgres;
alter function public.m2_recalculate_retention_after_release_change() owner to postgres;
alter function public.m2_recalculate_retention_after_legal_fact_change() owner to postgres;
revoke all on function public.m2_record_retention_recalculation(uuid, uuid, uuid, text), public.m2_recalculate_retention_after_release_change(), public.m2_recalculate_retention_after_legal_fact_change() from public, anon, authenticated;
