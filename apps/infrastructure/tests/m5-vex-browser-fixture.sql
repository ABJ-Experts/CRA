-- One clearly tagged, local-only fixture for manual browser verification.
-- It deliberately reuses the seeded tenant's existing product, release, and
-- vulnerability feed facts. Do not run against a hosted/shared database.
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_product uuid;
  v_release uuid;
  v_vulnerability uuid;
  v_source_record uuid;
  v_source_version uuid;
  v_range uuid;
begin
  select id into v_product from public.products
    where organization_id = v_org order by id limit 1;
  select id into v_release from public.product_releases
    where organization_id = v_org and product_id = v_product order by id limit 1;
  select id into v_vulnerability from public.vulnerabilities order by id limit 1;
  select id into v_source_record from public.vulnerability_source_records order by id limit 1;
  select id into v_source_version from public.vulnerability_source_record_versions order by id limit 1;

  if v_release is null or v_vulnerability is null or v_source_record is null or v_source_version is null then
    raise exception 'The normal local seed is incomplete; browser fixture was not created';
  end if;

  insert into public.vulnerability_affected_ranges (
    vulnerability_id, source_record_version_id, ecosystem, package_name,
    range_type, range_value, event_sequence
  ) values (
    v_vulnerability, v_source_version, 'npm', 'm5-vex-browser-fixture',
    'SEMVER', '{"events":[{"introduced":"0"}]}'::jsonb, '[]'::jsonb
  ) on conflict (source_record_version_id, ecosystem, package_name, range_type, range_value)
    do nothing returning id into v_range;

  if v_range is null then
    select id into v_range from public.vulnerability_affected_ranges
      where source_record_version_id = v_source_version
        and ecosystem = 'npm'
        and package_name = 'm5-vex-browser-fixture'
        and range_type = 'SEMVER'
        and range_value = '{"events":[{"introduced":"0"}]}'::jsonb;
  end if;

  insert into public.vulnerability_findings (
    id, organization_id, release_id, component_identity, canonical_advisory_id,
    vulnerability_id, source_feed_key, source_record_id, source_record_version_id,
    affected_range_id, match_method, comparator_name, comparator_version,
    evaluated_component_value, affected_range, event_sequence, confidence,
    confidence_table_version, confidence_explanation, reevaluation_state
  ) values (
    'a5020000-0000-4000-8000-000000000001', v_org, v_release,
    'pkg:npm/m5-vex-browser-fixture@1.0.0', 'CVE-M5-VEX-BROWSER-0001',
    v_vulnerability, 'cisa_kev', v_source_record, v_source_version, v_range,
    'purl_osv', 'm5-browser-fixture', '1', '1.0.0',
    '{"versions":["1.0.0"]}'::jsonb, '[]'::jsonb, 0.91,
    'm5-browser-fixture', 'Local browser-only VEX verification fixture.', 'unchanged'
  ) on conflict (id) do nothing;
end;
$$;
