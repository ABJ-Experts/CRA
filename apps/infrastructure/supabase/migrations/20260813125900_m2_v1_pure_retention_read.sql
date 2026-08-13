-- Reading a legal calculation must not rewrite the projection or create an
-- unaudited compliance effect. Projection updates remain exclusively in the
-- audited mutation and lifecycle-trigger paths.

create or replace function public.m2_read_product_retention_calculation(
  p_organization_id uuid,
  p_product_id uuid
) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_product public.products%rowtype;
  v_release record;
  v_period public.product_support_periods%rowtype;
  v_placement timestamptz;
  v_candidate timestamptz;
  v_support timestamptz;
  v_final timestamptz;
  v_max timestamptz;
  v_placed_max timestamptz;
  v_support_max timestamptz;
  v_winner text;
  v_incomplete boolean := false;
  v_incomplete_reasons jsonb := '[]'::jsonb;
  v_releases jsonb := '[]'::jsonb;
  v_hold boolean := false;
begin
  select * into v_product from public.products
  where organization_id = p_organization_id and id = p_product_id;
  if not found then return null; end if;

  v_hold := exists (
    select 1 from public.product_lifecycle_dependency_facts facts
    where facts.organization_id = p_organization_id
      and facts.product_id = p_product_id
      and facts.active and facts.authority_kind = 'legal_hold'
  );
  for v_release in
    select * from public.product_releases
    where organization_id = p_organization_id and product_id = p_product_id
    order by id
  loop
    select * into v_period from public.m2_active_support_period(
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
    v_placed_max := greatest(coalesce(v_placed_max, '-infinity'::timestamptz), v_candidate);
    v_support_max := greatest(coalesce(v_support_max, '-infinity'::timestamptz), v_support);
    v_releases := v_releases || jsonb_build_array(jsonb_build_object(
      'releaseId', v_release.id,
      'ruleVersion', 'm2.v1.later_of_placement_plus_10y_or_support_end',
      'status', 'current',
      'placedOnMarketCandidate', public.m2_utc_z(v_candidate),
      'supportPeriodCandidate', public.m2_utc_z(v_support),
      'retentionUntil', public.m2_utc_z(v_final),
      'retentionProtectionUntil', public.m2_utc_z(greatest(v_final, coalesce(v_product.retention_protection_until, '-infinity'::timestamptz))),
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
    'retentionProtectionUntil', case when v_product.retention_protection_until is null then null else public.m2_utc_z(v_product.retention_protection_until) end,
    'winningRule', v_winner,
    'incompleteReasons', case when v_incomplete then v_incomplete_reasons else '[]'::jsonb end,
    'legalHoldActive', v_hold,
    'releaseCalculations', v_releases
  );
end $$;

create or replace function public.get_product_retention_calculation(
  p_organization_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid
) returns table(outcome text, retention jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_calculation jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_calculation := public.m2_read_product_retention_calculation(
    p_organization_id, p_product_id
  );
  if v_calculation is null then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    public.m2_normalize_retention_calculation(v_calculation);
end $$;

alter function public.m2_read_product_retention_calculation(uuid, uuid) owner to postgres;
alter function public.get_product_retention_calculation(uuid, uuid, uuid) owner to postgres;
revoke all on function public.m2_read_product_retention_calculation(uuid, uuid), public.get_product_retention_calculation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_product_retention_calculation(uuid, uuid, uuid) to service_role;
