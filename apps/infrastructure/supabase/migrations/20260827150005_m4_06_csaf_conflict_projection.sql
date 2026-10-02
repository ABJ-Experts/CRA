-- M4-06: expose the immutable CSAF assertion status alongside public-source
-- assertions. A vendor fixed/not-affected assertion must remain reviewable
-- when a public source still reports the advisory as active; it must never
-- overwrite the public projection.
create or replace function public.get_vulnerability_csaf_reconciliation_detail(
  p_canonical_id text
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (
    select id, canonical_id, updated_at
    from public.vulnerabilities
    where canonical_id = btrim(p_canonical_id)
  ), source_versions as (
    select records.feed_key, records.source_record_key, records.record_state,
      versions.source_updated_at, versions.promoted_at, versions.normalized_payload,
      versions.reconciliation_detail
    from target
    join public.vulnerability_source_records records on records.vulnerability_id = target.id
    join public.vulnerability_source_record_versions versions on versions.id = records.current_version_id
    where records.feed_key in ('vendor_csaf', 'nvd', 'osv', 'github_advisory')
  ), assertions as (
    select jsonb_build_object(
      'sourceFeed', feed_key,
      'sourceRecordId', source_record_key,
      'status', case when feed_key = 'vendor_csaf' then coalesce(
        (select nullif(item -> 'value' ->> 'status', '')
         from jsonb_array_elements(coalesce(normalized_payload -> 'enrichments', '[]'::jsonb)) item
         where item ->> 'type' = 'csaf'
         limit 1), record_state)
        else record_state end,
      'assertedAt', source_updated_at,
      'publisher', case when feed_key = 'vendor_csaf'
        then nullif(normalized_payload #>> '{csafProvenance,publisherName}', '')
        else feed_key end
    ) as assertion
    from source_versions
  ), explicit_conflicts as (
    select distinct jsonb_array_elements_text(
      case when jsonb_typeof(reconciliation_detail -> 'conflicts') = 'array'
        then reconciliation_detail -> 'conflicts' else '[]'::jsonb end
    ) as conflict
    from source_versions
    where feed_key = 'vendor_csaf'
  ), derived_conflicts as (
    select 'vendor_fixed_public_affected'::text as conflict
    where exists (
      select 1 from assertions where assertion ->> 'sourceFeed' = 'vendor_csaf'
        and assertion ->> 'status' in ('fixed', 'known_not_affected')
    ) and exists (
      select 1 from assertions where assertion ->> 'sourceFeed' <> 'vendor_csaf'
        and assertion ->> 'status' = 'active'
    )
  ), conflicts as (
    select conflict from explicit_conflicts
    union
    select conflict from derived_conflicts
  )
  select case when not exists (select 1 from target)
      or not exists (select 1 from assertions)
    then null
    else jsonb_build_object(
      'canonicalId', (select canonical_id from target),
      'vendorTrackingId', coalesce(
        (select normalized_payload #>> '{csafProvenance,trackingId}'
         from source_versions where feed_key = 'vendor_csaf'
         order by promoted_at desc limit 1),
        (select canonical_id from target)
      ),
      'sourceAssertions', (select jsonb_agg(assertion order by assertion ->> 'sourceFeed', assertion ->> 'sourceRecordId') from assertions),
      'conflicts', coalesce((select jsonb_agg(conflict order by conflict) from conflicts), '[]'::jsonb),
      'updatedAt', (select updated_at from target)
    ) end;
$$;

alter function public.get_vulnerability_csaf_reconciliation_detail(text) owner to postgres;
revoke all on function public.get_vulnerability_csaf_reconciliation_detail(text) from public, anon, authenticated;
grant execute on function public.get_vulnerability_csaf_reconciliation_detail(text) to service_role;
