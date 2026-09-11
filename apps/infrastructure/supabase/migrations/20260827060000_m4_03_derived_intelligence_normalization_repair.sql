-- The feed mirror stores provider values in a common { type, value } envelope.
-- Project derived intelligence from that durable shape (and the earlier object
-- EPSS form) without changing immutable source-record versions.
create or replace function public.m4_03_intelligence_json(
  p_vulnerability_id uuid,
  p_assessed_at timestamptz
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with src as (
    select
      records.id as record_id,
      records.feed_key,
      records.source_updated_at,
      versions.id as version_id,
      versions.promoted_at,
      enrichments.enrichment_type,
      enrichments.enrichment,
      configs.freshness_state
    from public.vulnerability_source_records records
    join public.vulnerability_source_record_versions versions
      on versions.id = records.current_version_id
    join public.vulnerability_enrichments enrichments
      on enrichments.source_record_version_id = versions.id
    join public.vulnerability_feed_configs configs
      on configs.feed_key = records.feed_key
    where records.vulnerability_id = p_vulnerability_id
      and records.record_state = 'active'
  ),
  epss_candidates as (
    select
      src.*,
      case
        when jsonb_typeof(enrichment -> 'value') = 'number'
          and enrichment ->> 'value' ~ '^(0|1)(\\.[0-9]+)?$'
          then (enrichment ->> 'value')::numeric
        when jsonb_typeof(enrichment -> 'value') = 'object'
          and enrichment -> 'value' ->> 'epss' ~ '^(0|1)(\\.[0-9]+)?$'
          then (enrichment -> 'value' ->> 'epss')::numeric
        else null
      end as probability
    from src
    where enrichment_type = 'epss'
  ),
  epss as (
    select * from epss_candidates where probability is not null
    order by source_updated_at desc nulls last, promoted_at desc
    limit 1
  ),
  cvss as (
    select src.*, value as data
    from src
    cross join lateral jsonb_path_query(enrichment -> 'value', '$.**.cvssData') value
    union all
    select src.*, enrichment -> 'value'
    from src
    where enrichment_type = 'cvss'
  ),
  cvss_rows as (
    select
      jsonb_build_object(
        'version', coalesce(data ->> 'version', substring(data ->> 'vectorString' from 'CVSS:([0-9.]+)')),
        'baseScore', (coalesce(data ->> 'baseScore', data ->> 'score'))::numeric,
        'vector', data ->> 'vectorString',
        'provenance', jsonb_build_object(
          'sourceFeed', feed_key,
          'sourceRecordId', record_id,
          'sourceRecordVersionId', version_id,
          'observedAt', source_updated_at,
          'retrievedAt', promoted_at
        )
      ) as value,
      coalesce(data ->> 'version', substring(data ->> 'vectorString' from 'CVSS:([0-9.]+)')) as version,
      source_updated_at,
      promoted_at,
      freshness_state
    from cvss
    where coalesce(data ->> 'baseScore', data ->> 'score') ~ '^[0-9]+(\\.[0-9]+)?$'
      and coalesce(data ->> 'vectorString', '') <> ''
  ),
  cwe_rows as (
    select jsonb_build_object(
      'id', value ->> 'cweId',
      'name', null,
      'provenance', jsonb_build_object(
        'sourceFeed', src.feed_key,
        'sourceRecordId', src.record_id,
        'sourceRecordVersionId', src.version_id,
        'observedAt', src.source_updated_at,
        'retrievedAt', src.promoted_at
      )
    ) as value
    from src
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(src.enrichment -> 'value') = 'array'
        then src.enrichment -> 'value' else '[]'::jsonb end
    ) value
    where src.enrichment_type = 'cwes'
      and value ->> 'cweId' ~ '^CWE-[1-9][0-9]*$'
    union all
    select jsonb_build_object(
      'id', description ->> 'value',
      'name', null,
      'provenance', jsonb_build_object(
        'sourceFeed', src.feed_key,
        'sourceRecordId', src.record_id,
        'sourceRecordVersionId', src.version_id,
        'observedAt', src.source_updated_at,
        'retrievedAt', src.promoted_at
      )
    )
    from src
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(src.enrichment -> 'value') = 'array'
        then src.enrichment -> 'value' else '[]'::jsonb end
    ) weakness
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(weakness -> 'description') = 'array'
        then weakness -> 'description' else '[]'::jsonb end
    ) description
    where src.enrichment_type = 'weaknesses'
      and description ->> 'value' ~ '^CWE-[1-9][0-9]*$'
  )
  select jsonb_build_object(
    'cvss', jsonb_build_object(
      'freshness', case
        when exists(select 1 from cvss_rows) then coalesce(
          (select case freshness_state when 'healthy' then 'fresh' when 'stale' then 'stale' else 'unavailable' end from cvss_rows limit 1),
          'absent'
        )
        else 'absent'
      end,
      'assessedAt', p_assessed_at,
      'preferred', (select value from cvss_rows order by
        case version when '4.0' then 4 when '3.1' then 3 when '3.0' then 2 when '2.0' then 1 else 0 end desc,
        source_updated_at desc nulls last, promoted_at desc limit 1),
      'observations', coalesce((select jsonb_agg(value order by source_updated_at desc nulls last, promoted_at desc) from cvss_rows), '[]'::jsonb)
    ),
    'epss', jsonb_build_object(
      'freshness', coalesce(
        (select case freshness_state when 'healthy' then 'fresh' when 'stale' then 'stale' else 'unavailable' end from epss),
        (select case freshness_state when 'healthy' then 'absent' when 'stale' then 'absent' else 'unavailable' end from public.vulnerability_feed_configs where feed_key = 'epss')
      ),
      'assessedAt', p_assessed_at,
      'value', (select probability from epss),
      'observationDate', (select source_updated_at::date from epss),
      'provenance', (select jsonb_build_object(
        'sourceFeed', feed_key,
        'sourceRecordId', record_id,
        'sourceRecordVersionId', version_id,
        'observedAt', source_updated_at,
        'retrievedAt', promoted_at
      ) from epss)
    ),
    'kev', jsonb_build_object(
      'freshness', 'absent', 'assessedAt', p_assessed_at,
      'status', 'not_listed', 'listingDate', null, 'provenance', null
    ),
    'cwes', coalesce((select jsonb_agg(value order by value ->> 'id') from cwe_rows), '[]'::jsonb),
    'aliases', '[]'::jsonb,
    'references', '[]'::jsonb
  );
$$;

alter function public.m4_03_intelligence_json(uuid, timestamptz) owner to postgres;
revoke all on function public.m4_03_intelligence_json(uuid, timestamptz)
  from public, anon, authenticated;
