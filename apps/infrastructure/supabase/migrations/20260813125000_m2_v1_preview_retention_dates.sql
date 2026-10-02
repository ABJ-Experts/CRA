-- Preview the legal retention effect of a proposed support-period decision without
-- persisting it.  This is intentionally SQL-side so the preview and authoritative
-- projection share the same UTC calendar-year rules.

create or replace function public.m2_support_preview_json(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_current public.product_support_periods,
  p_support_starts_at timestamptz,
  p_support_ends_at timestamptz,
  p_expected_lifetime_justification text
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_current jsonb;
  v_proposed jsonb;
  v_lowering boolean;
  v_blocked jsonb := '[]'::jsonb;
  v_categories jsonb := jsonb_build_array('support_alerts', 'retention_dates');
  v_digest text;
  v_current_retention timestamptz;
  v_proposed_retention timestamptz;
  v_current_incomplete boolean;
  v_proposed_incomplete boolean;
begin
  v_current := case when p_current is null then null else public.m2_support_period_json(p_current) end;
  v_proposed := jsonb_build_object(
    'supportStartsAt', public.m2_utc_z(p_support_starts_at),
    'supportEndsAt', public.m2_utc_z(p_support_ends_at),
    'expectedLifetimeJustification', btrim(p_expected_lifetime_justification)
  );
  v_lowering := p_current is not null and p_support_ends_at < p_current.support_ends_at;

  select product.retention_until into v_current_retention
  from public.products product
  where product.organization_id = p_organization_id and product.id = p_product_id;

  select
    bool_or(release.placed_on_market_at is null or candidate.support_ends_at is null),
    max(greatest(
      public.m2_retention_placement_candidate(release.placed_on_market_at),
      candidate.support_ends_at
    ))
  into v_proposed_incomplete, v_proposed_retention
  from public.product_releases release
  left join lateral (
    select case
      when p_release_id = release.id then p_support_ends_at
      when p_release_id is null and override.support_ends_at is not null then override.support_ends_at
      when p_release_id is null then p_support_ends_at
      else current_scope.support_ends_at
    end as support_ends_at
    from public.m2_active_support_period(p_organization_id, p_product_id, release.id) current_scope
    left join lateral (
      select period.support_ends_at
      from public.product_support_periods period
      where period.organization_id = p_organization_id
        and period.product_id = p_product_id
        and period.release_id = release.id
        and period.superseded_at is null
      limit 1
    ) override on true
  ) candidate on true
  where release.organization_id = p_organization_id and release.product_id = p_product_id;

  if coalesce(v_proposed_incomplete, true) then
    v_proposed_retention := null;
  end if;

  if exists (
    select 1
    from public.product_lifecycle_dependency_facts facts
    where facts.organization_id = p_organization_id
      and facts.product_id = p_product_id
      and facts.active
      and facts.authority_kind = 'legal_hold'
  ) then
    v_blocked := v_blocked || jsonb_build_array('active_legal_hold');
  end if;

  if exists (
    select 1
    from public.product_lifecycle_dependency_facts facts
    where facts.organization_id = p_organization_id
      and facts.product_id = p_product_id
      and facts.active
      and facts.authority_kind = 'retention'
  ) then
    v_categories := v_categories || jsonb_build_array('legal_floors', 'registered_evidence');
  end if;

  v_digest := encode(extensions.digest(jsonb_build_object(
    'productId', p_product_id,
    'releaseId', p_release_id,
    'activeScopeRevision', coalesce(p_current.scope_revision, 0),
    'current', v_current,
    'proposed', v_proposed
  )::text, 'sha256'), 'hex');

  return jsonb_build_object(
    'current', v_current,
    'proposed', v_proposed,
    'lowering', v_lowering,
    'previewDigest', v_digest,
    'activeScopeRevision', coalesce(p_current.scope_revision, 0),
    'isShortening', v_lowering,
    'retentionProtectionWouldReduce', v_lowering,
    'blockedReasons', v_blocked,
    'affectedCategories', v_categories,
    'currentRetentionUntil', public.m2_utc_z(v_current_retention),
    'proposedRetentionUntil', public.m2_utc_z(v_proposed_retention)
  );
end $$;

alter function public.m2_support_preview_json(uuid, uuid, uuid, public.product_support_periods, timestamptz, timestamptz, text) owner to postgres;
revoke all on function public.m2_support_preview_json(uuid, uuid, uuid, public.product_support_periods, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.m2_support_preview_json(uuid, uuid, uuid, public.product_support_periods, timestamptz, timestamptz, text) to service_role;
