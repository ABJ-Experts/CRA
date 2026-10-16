-- Correct decimal validation in the existing source-owned CVSS projection.
-- Preference, provenance, authority and permission semantics remain unchanged.
CREATE OR REPLACE FUNCTION public.m4_03_cvss_rows(p_vulnerability_ids uuid[])
 RETURNS TABLE(vulnerability_id uuid, value jsonb, version text, source_updated_at timestamp with time zone, promoted_at timestamp with time zone, freshness_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with src as (
    select
      records.vulnerability_id,
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
    where records.vulnerability_id = any(p_vulnerability_ids)
      and records.record_state = 'active'
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
      vulnerability_id,
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
    where coalesce(data ->> 'baseScore', data ->> 'score') ~ '^[0-9]+(\.[0-9]+)?$'
      and coalesce(data ->> 'vectorString', '') <> ''
  )
 select vulnerability_id,value,version,source_updated_at,promoted_at,freshness_state from cvss_rows;
$function$;


revoke all on function public.m4_03_cvss_rows(uuid[])from public,anon,authenticated,service_role;
