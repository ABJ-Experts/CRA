-- A first support-period decision has no historical predecessor. Expose that
-- fact as JSON null rather than a synthetic all-null period record.

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
  v_current := case when p_current is null then null else public.m2_support_period_json(p_current) end;
  v_proposed := jsonb_build_object('supportStartsAt',public.m2_utc_z(p_support_starts_at),'supportEndsAt',public.m2_utc_z(p_support_ends_at),'expectedLifetimeJustification',btrim(p_expected_lifetime_justification));
  v_lowering := p_current is not null and p_support_ends_at < p_current.support_ends_at;
  if exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='legal_hold') then
    v_blocked := v_blocked || jsonb_build_array('active_legal_hold');
  end if;
  if exists(select 1 from public.product_lifecycle_dependency_facts facts where facts.organization_id=p_organization_id and facts.product_id=p_product_id and facts.active and facts.authority_kind='retention') then
    v_categories := v_categories || jsonb_build_array('legal_floors','registered_evidence');
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('productId',p_product_id,'releaseId',p_release_id,'activeScopeRevision',coalesce(p_current.scope_revision,0),'current',v_current,'proposed',v_proposed)::text,'sha256'),'hex');
  return jsonb_build_object('current',v_current,'proposed',v_proposed,'lowering',v_lowering,'previewDigest',v_digest,
    'activeScopeRevision',coalesce(p_current.scope_revision,0),'isShortening',v_lowering,
    'retentionProtectionWouldReduce',v_lowering,'blockedReasons',v_blocked,'affectedCategories',v_categories,
    'currentRetentionUntil',null,'proposedRetentionUntil',null);
end $$;

alter function public.m2_support_preview_json(uuid,uuid,uuid,public.product_support_periods,timestamptz,timestamptz,text) owner to postgres;
revoke all on function public.m2_support_preview_json(uuid,uuid,uuid,public.product_support_periods,timestamptz,timestamptz,text) from public, anon, authenticated;
