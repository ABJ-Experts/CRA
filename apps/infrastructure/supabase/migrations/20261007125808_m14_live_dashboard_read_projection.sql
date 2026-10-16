-- M14 composes source-owned reads without materializing source work.
create or replace function public.m14_actor_can(p_org uuid,p_actor uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_permission<>'can_view_dashboards' then public.m13_03_actor_can(p_org,p_actor,p_permission) else coalesce((
 select case when jsonb_typeof(o.permissions->p_permission)='boolean' then (o.permissions->>p_permission)::boolean else true end
 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
 join public.organizations g on g.id=m.organization_id and g.is_active
 left join public.base_role_permission_overrides o on o.organization_id=m.organization_id and o.base_role=m.role
 where m.organization_id=p_org and m.user_id=p_actor),false) end
$$;

-- Pure policy shared by the set projection and finding drilldown. Effective
-- assessment identity stays owned by M5, including immutable bulk undo.
create or replace function public.m5_finding_open_policy(p_status text,p_closed_at timestamptz,p_superseded_at timestamptz,p_review text,p_vex text,p_approval text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select p_status='active'and p_closed_at is null and p_superseded_at is null and
 (p_review in ('review_required','materially_changed','re_evaluating','source_unavailable')or not coalesce(p_vex in ('fixed','not_affected')and p_approval in ('approved','approval_not_required'),false))
$$;

create or replace function public.m5_finding_is_open(p_organization_id uuid,p_finding_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select public.m5_finding_open_policy(f.status,f.closed_at,f.superseded_at,f.reevaluation_state,a.vex_status,a.approval_state)
 from public.vulnerability_findings f left join public.vulnerability_finding_assessments a
 on a.organization_id=f.organization_id and a.id=public.m5_bulk_effective_assessment_id(f.organization_id,f.id)
 where f.organization_id=p_organization_id and f.id=p_finding_id),false)
$$;

-- Apply the shared source predicate before keyset pagination.
CREATE OR REPLACE FUNCTION public.list_finding_triage_queue_raw(p_organization_id uuid, p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text, p_sort text DEFAULT NULL::text, p_order text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, result jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cursor jsonb := '{}'::jsonb;
  v_sort text;
  v_direction text;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_invalid_filters jsonb := '[]'::jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or jsonb_typeof(p_filters) <> 'object' or p_limit not between 1 and 100
     or (p_cursor is not null and char_length(p_cursor) > 1024) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_sort := coalesce(p_sort, p_filters ->> 'sort', 'lastEvaluatedAt');
  v_direction := coalesce(p_order, p_filters ->> 'order', p_filters ->> 'direction', 'desc');
  if v_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss')
     or v_direction not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(
        translate(p_cursor, '-_', '+/') || repeat('=', (4 - length(p_cursor) % 4) % 4), 'base64'
      ), 'utf8')::jsonb;
      v_cursor_value := v_cursor ->> 'value';
      v_cursor_id := (v_cursor ->> 'id')::uuid;
      if v_cursor ->> 'sort' <> v_sort or v_cursor ->> 'direction' <> v_direction
         or v_cursor_value is null then raise exception 'invalid cursor'; end if;
    exception when others then
      return query select 'invalid_cursor'::text, null::jsonb;
      return;
    end;
  end if;
  -- Referenced IDs are intentionally never relaxed: a stale, deleted, or
  -- cross-tenant ID yields an empty page with a safe explanation.
  if jsonb_typeof(p_filters -> 'productIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'productIds') item
    where not exists (select 1 from public.products products
      where products.organization_id = p_organization_id and products.id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'productIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected product is unavailable.'));
  end if;
  if jsonb_typeof(p_filters -> 'releaseIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'releaseIds') item
    where not exists (select 1 from public.product_releases releases
      where releases.organization_id = p_organization_id and releases.id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'releaseIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected release is unavailable.'));
  end if;
  if jsonb_typeof(p_filters -> 'assessedByUserIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'assessedByUserIds') item
    where not exists (select 1 from public.organization_members members
      join public.users users on users.id = members.user_id and users.is_active
      where members.organization_id = p_organization_id and members.user_id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'assessedByUserIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected assessor is unavailable.'));
  end if;
  if jsonb_array_length(v_invalid_filters) > 0 then
    return query select 'found'::text, jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null,
      'filterIssues', v_invalid_filters);
    return;
  end if;
  with base as (
    select findings.*, releases.label as release_name, products.id as product_id, products.name as product_name,
      occurrences.document_id, occurrences.component_id, occurrences.canonical_purl,
      occurrences.canonical_cpe, occurrences.component_version,
      public.m4_03_intelligence_with_provenance_json(findings.vulnerability_id, findings.last_evaluated_at) intelligence,
      reachability.result as reachability,
      vex.vex_status, vex.approval_state
    from public.vulnerability_findings findings
    join public.product_releases releases on releases.organization_id = findings.organization_id and releases.id = findings.release_id
    join public.products products on products.organization_id = releases.organization_id and products.id = releases.product_id
    left join lateral (
      select occurrences.* from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      where links.organization_id = findings.organization_id and links.finding_id = findings.id and links.state = 'active'
      order by occurrences.id limit 1
    ) occurrences on true
    left join lateral (
      select public.m4_07_reachability_result_json(results.id) result
      from public.vulnerability_reachability_results results
      where results.organization_id = findings.organization_id and results.finding_id = findings.id and results.freshness = 'current'
      order by results.executed_at desc, results.id desc limit 1
    ) reachability on true
    left join lateral (
      select assessments.vex_status, assessments.approval_state
      from public.vulnerability_finding_assessments assessments
      where assessments.organization_id = findings.organization_id
        and assessments.finding_id = findings.id and case when coalesce((p_filters->>'openOnly')::boolean,false)then assessments.id=public.m5_bulk_effective_assessment_id(p_organization_id,findings.id)else assessments.is_current end
    ) vex on true
    where findings.organization_id = p_organization_id
      and (not coalesce((p_filters ->> 'openOnly')::boolean,false) or public.m5_finding_is_open(findings.organization_id,findings.id))
      and (p_filters -> 'findingStates' is null or findings.status::text = any(
        array(select jsonb_array_elements_text(p_filters -> 'findingStates'))
      ))
  ), filtered as (
    select base.*,
      coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) as severity_score,
      (intelligence #>> '{epss,value}')::numeric as epss_score,
      case when v_sort = 'lastEvaluatedAt' then extract(epoch from last_evaluated_at)::text
        when v_sort = 'firstDetectedAt' then extract(epoch from first_detected_at)::text
        when v_sort = 'severity' then coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1)::text
        else coalesce((intelligence #>> '{epss,value}')::numeric, -1)::text end as sort_value
    from base
    where (p_filters -> 'productIds' is null or product_id = any(array(select jsonb_array_elements_text(p_filters -> 'productIds')::uuid)))
      and (p_filters -> 'releaseIds' is null or release_id = any(array(select jsonb_array_elements_text(p_filters -> 'releaseIds')::uuid)))
      and (p_filters -> 'assessmentStates' is null or
        case when human_verdict is null then 'unassessed' else human_verdict end = any(array(select jsonb_array_elements_text(p_filters -> 'assessmentStates'))))
      and (p_filters -> 'reEvaluationStates' is null or reevaluation_state = any(array(select jsonb_array_elements_text(p_filters -> 'reEvaluationStates'))))
      and (p_filters -> 'vexStatuses' is null or vex_status = any(array(select jsonb_array_elements_text(p_filters -> 'vexStatuses'))))
      and (p_filters -> 'approvalStates' is null or approval_state = any(array(select jsonb_array_elements_text(p_filters -> 'approvalStates'))))
      and (p_filters -> 'assessedByUserIds' is null or human_assessed_by = any(array(select jsonb_array_elements_text(p_filters -> 'assessedByUserIds')::uuid)))
      and (p_filters ->> 'ageDaysMin' is null or first_detected_at <= clock_timestamp() - make_interval(days => (p_filters ->> 'ageDaysMin')::integer))
      and (p_filters ->> 'ageDaysMax' is null or first_detected_at >= clock_timestamp() - make_interval(days => (p_filters ->> 'ageDaysMax')::integer))
      and (p_filters -> 'severities' is null or case when coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) < 0 then 'unknown'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 9 then 'critical'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 7 then 'high'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 4 then 'medium' else 'low' end
        = any(array(select jsonb_array_elements_text(p_filters -> 'severities'))))
      and (p_filters ->> 'epssMin' is null or coalesce((intelligence #>> '{epss,value}')::numeric, -1) >= (p_filters ->> 'epssMin')::numeric)
      and (p_filters ->> 'epssMax' is null or coalesce((intelligence #>> '{epss,value}')::numeric, -1) <= (p_filters ->> 'epssMax')::numeric)
      and (coalesce(p_filters ->> 'epssState', 'known') <> 'unknown' or (intelligence #>> '{epss,value}') is null)
      and (p_filters -> 'kevStatuses' is null or intelligence #>> '{kev,status}' = any(array(select jsonb_array_elements_text(p_filters -> 'kevStatuses'))))
      and (p_filters -> 'reachability' is null or coalesce(reachability ->> 'verdict', 'unknown') = any(array(select jsonb_array_elements_text(p_filters -> 'reachability'))))
  ), page as (
    select * from filtered
    where p_cursor is null or case when v_direction = 'desc' then
      (sort_value::numeric, id) < (v_cursor_value::numeric, v_cursor_id)
    else (sort_value::numeric, id) > (v_cursor_value::numeric, v_cursor_id) end
    order by case when v_direction = 'asc' then sort_value::numeric end asc nulls last,
      case when v_direction = 'desc' then sort_value::numeric end desc nulls last,
      case when v_direction = 'asc' then id end asc,
      case when v_direction = 'desc' then id end desc
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'finding', jsonb_build_object(
      'id', id, 'documentId', document_id, 'releaseId', release_id, 'componentId', component_id,
      'canonicalPurl', canonical_purl, 'canonicalCpe', canonical_cpe,
      'evaluatedVersion', coalesce(component_version, evaluated_component_value),
      'advisoryId', canonical_advisory_id,
      'advisoryAliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias))
        from public.vulnerability_aliases aliases where aliases.vulnerability_id = page.vulnerability_id), '[]'::jsonb),
      'matchMethod', match_method, 'outcome', 'affected', 'sourceFeed', source_feed_key,
      'sourceRecordId', source_record_id, 'sourceRecordVersionId', source_record_version_id,
      'affectedRangeId', affected_range_id, 'affectedRangeEvents', event_sequence,
      'affectedVersions', coalesce(affected_range -> 'versions', '[]'::jsonb),
      'comparator', comparator_name, 'comparatorVersion', comparator_version,
      'confidence', jsonb_build_object('score', confidence,
        'level', case when confidence >= .9 then 'high' when confidence >= .6 then 'medium' else 'low' end,
        'explanation', confidence_explanation, 'tableVersion', confidence_table_version),
      'cpeSpecificity', case when match_method = 'cpe_nvd' then coalesce(affected_range ->> 'm4CpeSpecificity', 'broad_family') else null end,
      'cpeConfigurationEvidence', case when match_method = 'cpe_nvd' then coalesce(affected_range -> 'm4CpeConfigurationEvidence', '{}'::jsonb) else null end,
      'reEvaluationState', reevaluation_state,
      'humanAssessment', case when human_verdict is null then null else jsonb_build_object(
        'verdict', human_verdict, 'rationale', human_rationale,
        'assessedByUserId', human_assessed_by, 'assessedAt', human_assessed_at) end,
      'firstDetectedAt', first_detected_at, 'lastEvaluatedAt', last_evaluated_at,
      'createdAt', created_at, 'updatedAt', updated_at
    ),
    'product', jsonb_build_object('id', product_id, 'name', product_name),
    'release', jsonb_build_object('id', release_id, 'name', release_name),
    'severity', case when severity_score < 0 then 'unknown' when severity_score >= 9 then 'critical'
      when severity_score >= 7 then 'high' when severity_score >= 4 then 'medium' else 'low' end,
    'epss', epss_score, 'kevStatus', coalesce(intelligence #>> '{kev,status}', 'unavailable'),
    'reachability', reachability ->> 'verdict',
    'assessmentState', case when human_verdict is null then 'unassessed' else human_verdict end,
    'vexStatus', vex_status, 'approvalState', approval_state,
    'sortValue', sort_value
  ) order by case when v_direction = 'asc' then sort_value::numeric end asc nulls last,
    case when v_direction = 'desc' then sort_value::numeric end desc nulls last,
    case when v_direction = 'asc' then id end asc, case when v_direction = 'desc' then id end desc), '[]'::jsonb)
  into v_rows from page;
  return query select 'found'::text, jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_item - 'sortValue' order by ordinal)
      from jsonb_array_elements(v_rows) with ordinality rows(row_item, ordinal)), '[]'::jsonb),
    'nextCursor', case when jsonb_array_length(v_rows) = p_limit then
      translate(replace(encode(convert_to(jsonb_build_object('sort', v_sort, 'direction', v_direction,
        'value', v_rows -> (p_limit - 1) ->> 'sortValue', 'id', v_rows -> (p_limit - 1) -> 'finding' ->> 'id')::text, 'utf8'), 'base64'), E'\n', ''), '+/=', '-_')
      else null end,
    'filterIssues', '[]'::jsonb
  );
end;
$function$;

-- The additive open filter keeps effective VEX/approval filtering before the
-- source keyset, while preserving the default legacy triage behavior.
CREATE OR REPLACE FUNCTION public.list_finding_triage_queue(p_organization_id uuid, p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text, p_sort text DEFAULT NULL::text, p_order text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, result jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_raw jsonb; v_rows jsonb; v_filters jsonb;
begin
  v_filters:=p_filters-'suppressionStates'-'internalSlaStates'-'notificationDeliveryStates'-'remediationStates'-'reintroductionStates';
  if not coalesce((p_filters->>'openOnly')::boolean,false)then
    v_filters:=v_filters-'vexStatuses'-'approvalStates';
  end if;
  perform public.m5_triage_materialize_due_work(p_organization_id);
  select raw.result into v_raw from public.list_finding_triage_queue_raw(
    p_organization_id, p_actor_user_id,
    v_filters,
    p_limit, p_cursor, p_sort, p_order
  ) raw limit 1;
  if v_raw is null then return query select 'not_found'::text, null::jsonb; return; end if;
  select coalesce(jsonb_agg(
    jsonb_set(jsonb_set(jsonb_set(item, '{vexStatus}', coalesce(to_jsonb(effective.value ->> 'status'), 'null'::jsonb), true),
      '{approvalState}', coalesce(to_jsonb(effective.value ->> 'approvalState'), 'null'::jsonb), true),
      '{operational}', operational.value, true) order by ordinality), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_raw -> 'rows', '[]'::jsonb)) with ordinality rows(item, ordinality)
  left join lateral (select public.m5_vex_assessment_json(p_organization_id,
    public.m5_bulk_effective_assessment_id(p_organization_id, (item #>> '{finding,id}')::uuid)) value) effective on true
  cross join lateral (select public.m5_triage_operational_json(p_organization_id,
    (item #>> '{finding,id}')::uuid) value) operational
  where (p_filters -> 'vexStatuses' is null or effective.value ->> 'status' = any(array(select jsonb_array_elements_text(p_filters -> 'vexStatuses'))))
    and (p_filters -> 'approvalStates' is null or effective.value ->> 'approvalState' = any(array(select jsonb_array_elements_text(p_filters -> 'approvalStates'))))
    and (p_filters -> 'suppressionStates' is null or operational.value #>> '{suppression,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'suppressionStates'))))
    and (p_filters -> 'internalSlaStates' is null or operational.value #>> '{internalSla,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'internalSlaStates'))))
    and (p_filters -> 'notificationDeliveryStates' is null or operational.value #>> '{notification,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'notificationDeliveryStates'))))
    and (p_filters -> 'remediationStates' is null or operational.value #>> '{remediation,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'remediationStates'))))
    and (p_filters -> 'reintroductionStates' is null or operational.value #>> '{remediation,reintroduction,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'reintroductionStates'))));
  return query select 'found'::text, jsonb_set(v_raw, '{rows}', v_rows, true);
end;
$function$;

create or replace function public.m14_section(p_state text,p_data jsonb default null,p_updated timestamptz default null)
returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('state',p_state,'observedAt',case when p_state in ('restricted','unavailable','not_initialized') then null else public.m6_utc_second_z(statement_timestamp()) end,'updatedAt',case when p_updated is null then null else public.m6_utc_second_z(p_updated) end)
 ||case when p_state in ('restricted','unavailable','not_initialized') then '{}'::jsonb else jsonb_build_object('data',p_data) end
$$;

create or replace function public.m2_dashboard_products(p_org uuid,p_actor uuid,p_product uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d jsonb;n bigint;u timestamptz;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_products')then return public.m14_section('restricted');end if;
 select count(*),max(updated_at),jsonb_build_object('totalProducts',count(*),'activeProducts',count(*)filter(where archived_at is null),'archivedProducts',count(*)filter(where archived_at is not null))into n,u,d
 from public.products where organization_id=p_org and(p_product is null or id=p_product);
 return public.m14_section(case when n=0 then'empty'else'available'end,d,u);
end$$;

-- Measured after the cached generic plan threshold: this partial covering
-- index prevents repeated wide-heap reads while retaining the source scope.
-- It does not change decisions, grants, RLS or source record contents.
create index if not exists vulnerability_findings_dashboard_open_cover_idx
on public.vulnerability_findings(organization_id,release_id,vulnerability_id,last_evaluated_at)
include(id,updated_at,reevaluation_state)
where status='active'and closed_at is null and superseded_at is null;

-- Overview consumes only tenant, vulnerability, identity, review and update
-- fields; do not burden its covering key with release/evaluation attribution.
create index if not exists vulnerability_findings_dashboard_overview_cover_idx
on public.vulnerability_findings(organization_id,vulnerability_id)
include(id,reevaluation_state,updated_at)
where status='active'and closed_at is null and superseded_at is null;

-- Source-owned CVSS rows: the immutable-current-source rules and complete
-- normalized values are shared by the existing full reader and bounded dashboard
-- batches. No filtering/normalization or historical-time semantics change.
create or replace function public.m4_03_cvss_rows(p_vulnerability_ids uuid[])
returns table(vulnerability_id uuid,value jsonb,version text,source_updated_at timestamptz,promoted_at timestamptz,freshness_state text)
language sql stable security definer set search_path=public,pg_temp as $$
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
    where coalesce(data ->> 'baseScore', data ->> 'score') ~ '^[0-9]+(\\.[0-9]+)?$'
      and coalesce(data ->> 'vectorString', '') <> ''
  )
 select vulnerability_id,value,version,source_updated_at,promoted_at,freshness_state from cvss_rows;
$$;

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
  cvss_rows as (
    select value,version,source_updated_at,promoted_at,freshness_state
    from public.m4_03_cvss_rows(array[p_vulnerability_id])
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

create or replace function public.m5_cvss_score_severity(p_score numeric)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case when coalesce(p_score,-1)<0 then 'unknown'
 when p_score>=9 then 'critical'when p_score>=7 then 'high'
 when p_score>=4 then 'medium'else'low'end
$$;

-- The existing finding severity contract delegates to the same M4 observation
-- mapping. Dashboard grouping no longer serializes every finding UUID solely
-- to recover one representative observation. This helper is private.
create or replace function public.m5_triage_observation_severity(p_vulnerability_id uuid,p_observed_at timestamptz)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select public.m5_cvss_score_severity((i.intelligence #>> '{cvss,preferred,baseScore}')::numeric)
 from(select public.m4_03_intelligence_with_provenance_json(p_vulnerability_id,p_observed_at)intelligence)i
$$;

create or replace function public.m5_triage_finding_severity(p_organization_id uuid,p_finding_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select public.m5_triage_observation_severity(f.vulnerability_id,f.last_evaluated_at)
 from public.vulnerability_findings f
 where f.organization_id=p_organization_id and f.id=p_finding_id
$$;

-- Fail closed when deployment cannot prove intrinsic finding/release tenant scope.
do $$begin
 if not exists(select 1 from pg_constraint c where c.conrelid='public.vulnerability_findings'::regclass and c.confrelid='public.product_releases'::regclass and c.contype='f'and c.convalidated and not c.condeferrable and c.confdeltype='r'and (select bool_and(attnotnull)from pg_attribute where attrelid=c.conrelid and attname in('organization_id','release_id'))and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='organization_id'),(select attnum from pg_attribute where attrelid=c.conrelid and attname='release_id')]::smallint[] and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='organization_id'),(select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]) then raise exception 'M14 requires validated nondeferrable tenant release foreign key';end if;
end$$;

create or replace function public.m5_dashboard_findings(p_org uuid,p_actor uuid,p_product uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set jit=off as $$
declare d jsonb; n bigint; u timestamptz;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_findings') or not public.m14_actor_can(p_org,p_actor,'can_view_products') then return public.m14_section('restricted'); end if;
 -- Function-local JIT avoids compilation overhead measured on bounded reads;
 -- no global database setting changes. Intrinsic false-policy rows are omitted
 -- before joins, while the source policy still resolves VEX/review state.
 -- Set joins preserve M5 current -> undone target -> previous assessment.
 -- Keep overview/product predicates in separate fixed parameterized statements;
 -- cached generic plans must not estimate an optional-product OR as a tiny scope.
 -- Reaggregate exact observations only after effective open-policy evaluation,
 -- preserving counts/suppression/update time while avoiding repeated severity work.

 -- The validated nondeferrable composite FK below proves release tenant scope.
 -- Overview needs no release fields; product reads still join for product selection.
 -- Preferred M4 score is independent of evaluation-time attribution; overview
 -- groups only consumed policy/severity keys. Full source readers retain dates.
 if p_product is null then
 with effective_assessments as materialized(
 select current_assessment.organization_id,current_assessment.finding_id,
 case when undo.id is not null then previous.vex_status else current_assessment.vex_status end vex_status,
 case when undo.id is not null then previous.approval_state else current_assessment.approval_state end approval_state
 from public.vulnerability_finding_assessments current_assessment
 left join public.vulnerability_finding_assessment_bulk_operation_targets undo on undo.organization_id=p_org and undo.id=current_assessment.bulk_operation_target_id and undo.state='undone'
 left join public.vulnerability_finding_assessments previous on previous.organization_id=p_org and previous.id=undo.previous_assessment_id
 where current_assessment.organization_id=p_org and current_assessment.is_current),
 active_suppressions as materialized(
 select organization_id,finding_id from public.vulnerability_finding_suppressions
 where organization_id=p_org and is_current and ended_at is null and expires_at>statement_timestamp()),
 base as (
 select f.id,f.vulnerability_id,f.updated_at,f.reevaluation_state,
 effective.vex_status,
 effective.approval_state,
 suppression.finding_id is not null suppressed
 from public.vulnerability_findings f
 left join effective_assessments effective on effective.organization_id=p_org and effective.finding_id=f.id
 left join active_suppressions suppression on suppression.organization_id=p_org and suppression.finding_id=f.id
 where f.organization_id=p_org and f.status='active'and f.closed_at is null and f.superseded_at is null),
 grouped as materialized(
 select vulnerability_id,reevaluation_state,vex_status,approval_state,
 count(*)count,count(*)filter(where suppressed)suppressed_count,max(updated_at)updated_at
 from base group by vulnerability_id,reevaluation_state,vex_status,approval_state),
 -- Source severity uses the current preferred vulnerability source. Policy
 -- grouping keeps assessment/closure/review distinctions without inventing a
 -- separate decision engine, and the private source helper owns provenance.
 open_observations as materialized(
 select vulnerability_id,sum(count)count,sum(suppressed_count)suppressed_count,max(updated_at)updated_at
 from grouped where public.m5_finding_open_policy('active',null,null,reevaluation_state,vex_status,approval_state)
 group by vulnerability_id),
 source_ids as materialized(select vulnerability_id,row_number()over(order by vulnerability_id)ordinal from(select distinct vulnerability_id from open_observations)ids),
 source_batches as materialized(select array_agg(vulnerability_id)ids from source_ids group by (ordinal-1)/250),
 source_cvss as materialized(select c.*from source_batches b cross join lateral public.m4_03_cvss_rows(b.ids)c),
 preferred_cvss as materialized(select distinct on(vulnerability_id)vulnerability_id,(value->>'baseScore')::numeric score from source_cvss
 order by vulnerability_id,case version when'4.0'then 4 when'3.1'then 3 when'3.0'then 2 when'2.0'then 1 else 0 end desc,source_updated_at desc nulls last,promoted_at desc),
 scored as materialized(select o.*,public.m5_cvss_score_severity(c.score)severity from open_observations o left join preferred_cvss c using(vulnerability_id))
 select coalesce(sum(count),0)::bigint,max(updated_at),jsonb_build_object('openCount',coalesce(sum(count),0),'suppressedOpenCount',coalesce(sum(suppressed_count),0),'bySeverity',jsonb_build_object('critical',coalesce(sum(count)filter(where severity='critical'),0),'high',coalesce(sum(count)filter(where severity='high'),0),'medium',coalesce(sum(count)filter(where severity='medium'),0),'low',coalesce(sum(count)filter(where severity='low'),0),'unknown',coalesce(sum(count)filter(where severity='unknown'),0)))into n,u,d from scored;
 else
 with base as (
 select f.id,f.vulnerability_id,f.last_evaluated_at,f.updated_at,f.reevaluation_state,
 case when undo.id is not null then previous.vex_status else current_assessment.vex_status end vex_status,
 case when undo.id is not null then previous.approval_state else current_assessment.approval_state end approval_state,
 suppression.id is not null suppressed
 from public.vulnerability_findings f join public.product_releases r on r.organization_id=p_org and r.id=f.release_id
 left join public.vulnerability_finding_assessments current_assessment on current_assessment.organization_id=p_org and current_assessment.finding_id=f.id and current_assessment.is_current
 left join public.vulnerability_finding_assessment_bulk_operation_targets undo on undo.organization_id=p_org and undo.id=current_assessment.bulk_operation_target_id and undo.state='undone'
 left join public.vulnerability_finding_assessments previous on previous.organization_id=p_org and previous.id=undo.previous_assessment_id
 left join public.vulnerability_finding_suppressions suppression on suppression.organization_id=p_org and suppression.finding_id=f.id and suppression.is_current and suppression.ended_at is null and suppression.expires_at>statement_timestamp()
 where f.organization_id=p_org and f.status='active'and f.closed_at is null and f.superseded_at is null and r.product_id=p_product),
 grouped as materialized(
 select vulnerability_id,last_evaluated_at,reevaluation_state,vex_status,approval_state,
 count(*)count,count(*)filter(where suppressed)suppressed_count,max(updated_at)updated_at
 from base group by vulnerability_id,last_evaluated_at,reevaluation_state,vex_status,approval_state),
 -- Source severity depends on vulnerability/evaluation observation. Policy
 -- grouping keeps assessment/closure/review distinctions without inventing a
 -- separate decision engine, and the private source helper owns provenance.
 open_observations as materialized(
 select vulnerability_id,last_evaluated_at,sum(count)count,sum(suppressed_count)suppressed_count,max(updated_at)updated_at
 from grouped where public.m5_finding_open_policy('active',null,null,reevaluation_state,vex_status,approval_state)
 group by vulnerability_id,last_evaluated_at),
 source_ids as materialized(select vulnerability_id,row_number()over(order by vulnerability_id)ordinal from(select distinct vulnerability_id from open_observations)ids),
 source_batches as materialized(select array_agg(vulnerability_id)ids from source_ids group by (ordinal-1)/250),
 source_cvss as materialized(select c.*from source_batches b cross join lateral public.m4_03_cvss_rows(b.ids)c),
 preferred_cvss as materialized(select distinct on(vulnerability_id)vulnerability_id,(value->>'baseScore')::numeric score from source_cvss
 order by vulnerability_id,case version when'4.0'then 4 when'3.1'then 3 when'3.0'then 2 when'2.0'then 1 else 0 end desc,source_updated_at desc nulls last,promoted_at desc),
 scored as materialized(select o.*,public.m5_cvss_score_severity(c.score)severity from open_observations o left join preferred_cvss c using(vulnerability_id))
 select coalesce(sum(count),0)::bigint,max(updated_at),jsonb_build_object('openCount',coalesce(sum(count),0),'suppressedOpenCount',coalesce(sum(suppressed_count),0),'bySeverity',jsonb_build_object('critical',coalesce(sum(count)filter(where severity='critical'),0),'high',coalesce(sum(count)filter(where severity='high'),0),'medium',coalesce(sum(count)filter(where severity='medium'),0),'low',coalesce(sum(count)filter(where severity='low'),0),'unknown',coalesce(sum(count)filter(where severity='unknown'),0)))into n,u,d from scored;
 end if;
 return public.m14_section(case when n=0 then 'empty' else 'available' end,d,u);
end $$;

create or replace function public.m3_dashboard_coverage(p_org uuid,p_actor uuid,p_product uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare n bigint; c bigint; u timestamptz;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_sboms') or not public.m14_actor_can(p_org,p_actor,'can_view_products') then return public.m14_section('restricted'); end if;
 with eligible as(select r.id,r.updated_at from public.product_releases r join public.products p on p.organization_id=p_org and p.id=r.product_id
 where r.organization_id=p_org and r.archived_at is null and p.archived_at is null and r.placed_on_market_at is not null and r.lifecycle not in ('development','withdrawn') and (p_product is null or r.product_id=p_product)),
 covered as(select e.*,exists(select 1 from public.sbom_document_sources l join public.sbom_sources s on s.organization_id=p_org and s.id=l.source_id and s.release_id=e.id
 join public.sbom_documents d on d.organization_id=p_org and d.id=l.document_id
 join public.sbom_ingest_jobs j on j.organization_id=p_org and j.id=d.ingest_job_id and j.source_id=d.source_id and j.release_id=e.id
 where l.organization_id=p_org and l.release_id=e.id and s.status='verified' and s.verified_at is not null and d.state='completed' and j.status='completed' and j.validation_status in ('valid','valid_with_warnings') and j.validation_completed_at is not null and d.validation_status in ('valid','valid_with_warnings') and d.completed_at is not null and l.raw_object_id=s.raw_object_id and d.raw_object_id=s.raw_object_id and d.source_id=coalesce(s.deduplicated_from_source_id,s.id) and s.product_id=(select product_id from public.product_releases where organization_id=p_org and id=e.id) and exists(select 1 from public.sbom_sources canonical where canonical.organization_id=p_org and canonical.id=d.source_id and canonical.status='verified' and canonical.raw_object_id=d.raw_object_id and canonical.release_id=s.release_id and canonical.product_id=s.product_id)) covered from eligible e)
 select count(*),count(*)filter(where covered),max(updated_at) into n,c,u from covered;
 return public.m14_section(case when n=0 then 'empty' else 'available' end,jsonb_build_object('coveredReleases',c,'eligibleReleases',n,'percent',case when n=0 then null else round(100.0*c/n,2) end),u);
end $$;

create or replace function public.m6_dashboard_obligations(p_org uuid,p_actor uuid,p_filters jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows jsonb; n integer; position jsonb; lim integer:=coalesce((p_filters->>'limit')::integer,10); product uuid:=(p_filters->>'productId')::uuid;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_findings') or not public.m14_actor_can(p_org,p_actor,'can_view_products') then return jsonb_build_object('section',public.m14_section('restricted'),'position',null); end if;
 with scoped as(
 select s.*,o.obligation_type,o.status obligation_status,p.id product_id,p.name product_name,
 case when s.state='overdue' then 0 when s.state='running' then 1 when s.state='pending_anchor' then 2 else 3 end rank
 from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=p_org and o.id=s.obligation_id
 left join public.vulnerability_findings f on f.organization_id=p_org and f.id=o.source_finding_id
 left join lateral(select coalesce((select r.product_id from public.product_releases r where r.organization_id=p_org and r.id=f.release_id),
 (select case when count(distinct r.product_id)=1 then min(r.product_id::text)::uuid else null end from public.reporting_stage_drafts d join public.product_releases r on r.organization_id=p_org and r.id=d.release_id where d.organization_id=p_org and d.obligation_id=o.id))product_id)link on true
 left join public.products p on p.organization_id=p_org and p.id=link.product_id
 where s.organization_id=p_org and not o.is_rehearsal and (product is null or p.id=product)
 and (coalesce(p_filters->>'state','active')='history' or (o.status='active' and s.state in ('overdue','running','pending_anchor')))),
 page as(select * from scoped where p_filters->'position' is null or (rank,coalesce(due_at,'infinity'::timestamptz),id)>((p_filters#>>'{position,rank}')::integer,coalesce((p_filters#>>'{position,dueAt}')::timestamptz,'infinity'::timestamptz),(p_filters#>>'{position,id}')::uuid) order by rank,due_at nulls last,id limit lim+1),
 numbered as(select *,row_number()over(order by rank,due_at nulls last,id) rn from page)
 select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('obligationId',obligation_id,'stageId',id,'productId',product_id,'productName',product_name,'type',obligation_type,'kind',stage_kind,'state',state,'obligationStatus',obligation_status,'dueAt',case when due_at is null then null else public.m6_utc_second_z(due_at) end,'elapsedPercent',case when state='pending_anchor' then null else public.m6_reporting_stage_elapsed_percent(p_org,id,statement_timestamp()) end,'breachedAt',coalesce((select public.m6_utc_second_z(a.threshold_crossed_at)from public.reporting_deadline_alerts a where a.organization_id=p_org and a.stage_id=numbered.id and a.threshold_percent=100 order by a.threshold_crossed_at limit 1),case when overdue_at is null then null else public.m6_utc_second_z(overdue_at)end),'submittedAt',case when submitted_at is null then null else public.m6_utc_second_z(submitted_at)end)order by rn)filter(where rn<=lim),'[]'::jsonb),
 (jsonb_agg(jsonb_build_object('rank',rank,'dueAt',due_at,'id',id)order by rn)filter(where rn=lim))->0 into n,rows,position from numbered;
 return jsonb_build_object('section',public.m14_section(case when n=0 then 'empty' else 'available'end,jsonb_build_object('rows',rows,'nextCursor',null)),'position',case when n>lim then position else null end);
end $$;

create or replace function public.m7_dashboard_source_permission(p_kind text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case p_kind when 'product'then'can_view_products'when'release'then'can_view_products'when'support_period'then'can_view_products'when'sbom_document'then'can_view_sboms'when'finding'then'can_view_findings'when'evidence_document'then'can_view_evidence'when'risk_register'then'can_view_technical_files'when'manual_reference'then'can_view_technical_files'else null end
$$;

create or replace function public.m7_dashboard_source_can(p_org uuid,p_actor uuid,p_product uuid,p_kind text,p_record uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case p_kind
 when 'manual_reference' then public.m14_actor_can(p_org,p_actor,'can_view_technical_files')
 when 'product' then public.m14_actor_can(p_org,p_actor,'can_view_products')and exists(select 1 from public.products where organization_id=p_org and id=p_record and id=p_product)
 when 'release' then public.m14_actor_can(p_org,p_actor,'can_view_products')and exists(select 1 from public.product_releases where organization_id=p_org and id=p_record and product_id=p_product)
 when 'support_period' then public.m14_actor_can(p_org,p_actor,'can_view_products')and exists(select 1 from public.product_support_periods where organization_id=p_org and id=p_record and product_id=p_product)
 when 'finding' then public.m14_actor_can(p_org,p_actor,'can_view_findings')and exists(select 1 from public.vulnerability_findings f join public.product_releases r on r.organization_id=p_org and r.id=f.release_id where f.organization_id=p_org and f.id=p_record and r.product_id=p_product)
 when 'sbom_document' then public.m14_actor_can(p_org,p_actor,'can_view_sboms')and exists(select 1 from public.sbom_documents d join public.sbom_document_sources l on l.organization_id=p_org and l.document_id=d.id join public.product_releases r on r.organization_id=p_org and r.id=l.release_id where d.organization_id=p_org and d.id=p_record and r.product_id=p_product)
 when 'evidence_document' then public.m14_actor_can(p_org,p_actor,'can_view_evidence')and exists(select 1 from public.evidence_documents d join public.evidence_document_version_products l on l.organization_id=p_org and l.version_id=d.current_version_id where d.organization_id=p_org and d.id=p_record and l.product_id=p_product)
 when 'risk_register' then public.m14_actor_can(p_org,p_actor,'can_view_technical_files')and exists(select 1 from public.technical_file_risk_registers r join public.technical_files f on f.organization_id=p_org and f.id=r.technical_file_id where r.organization_id=p_org and r.id=p_record and f.product_id=p_product)
 else false end
$$;

create or replace function public.m7_dashboard_readiness(p_org uuid,p_actor uuid,p_filters jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows jsonb:='[]'; r record; projection jsonb; applicable integer; complete integer; lim integer:=coalesce((p_filters->>'limit')::integer,10); last_id uuid; more boolean:=false;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_technical_files') or not public.m14_actor_can(p_org,p_actor,'can_view_products') then return jsonb_build_object('section',public.m14_section('restricted'),'position',null);end if;
 for r in select p.id,p.name,f.id file_id from public.products p left join public.technical_files f on f.organization_id=p_org and f.product_id=p.id and f.status='active'
 where p.organization_id=p_org and p.archived_at is null and ((p_filters->>'productId')is null or p.id=(p_filters->>'productId')::uuid)
 and (p_filters->'position' is null or p.id>(p_filters#>>'{position,id}')::uuid)order by p.id limit lim+1 loop
 if jsonb_array_length(rows)=lim then more:=true;exit;end if;
 if r.file_id is null then
 rows:=rows||jsonb_build_array(jsonb_build_object('productId',r.id,'productName',r.name,'state','not_initialized'));last_id:=r.id;continue;end if;
 if exists(select 1 from public.technical_file_section_sources x join public.technical_file_sections sect on sect.organization_id=p_org and sect.id=x.section_id where x.organization_id=p_org and sect.technical_file_id=r.file_id and not public.m14_actor_can(p_org,p_actor,public.m7_dashboard_source_permission(x.source_kind)))then
 rows:=rows||jsonb_build_array(jsonb_build_object('productId',r.id,'productName',r.name,'state','restricted'));last_id:=r.id;continue;end if;
 if exists(select 1 from public.technical_file_section_sources x join public.technical_file_sections sect on sect.organization_id=p_org and sect.id=x.section_id where x.organization_id=p_org and sect.technical_file_id=r.file_id and not public.m7_dashboard_source_can(p_org,p_actor,r.id,x.source_kind,x.record_id))then
 rows:=rows||jsonb_build_array(jsonb_build_object('productId',r.id,'productName',r.name,'state','unavailable'));last_id:=r.id;continue;end if;
 if r.file_id is null then projection:=jsonb_build_object('overallStatus','empty','sections','[]'::jsonb,'gaps','[]'::jsonb,'calculatedAt',null);else projection:=public.m7_evidence_readiness_json(p_org,r.id);end if;
 select count(*)::integer,count(*)filter(where item->>'status'='complete')::integer into applicable,complete
 from jsonb_array_elements(projection->'sections')item join public.technical_file_sections s on s.organization_id=p_org and s.technical_file_id=r.file_id and s.section_key=item->>'sectionKey' where s.applicability='applicable';
 rows:=rows||jsonb_build_array(jsonb_build_object('productId',r.id,'productName',r.name,'status',case when applicable=0 then 'empty'else projection->>'overallStatus'end,'completeSections',complete,'applicableSections',applicable,'percent',case when applicable=0 then null else round(100.0*complete/applicable,2)end,'calculatedAt',projection->'calculatedAt','gaps',projection->'gaps'));
 last_id:=r.id;
 end loop;
 return jsonb_build_object('section',public.m14_section(case when jsonb_array_length(rows)=0 then 'empty'else'available'end,jsonb_build_object('rows',rows,'nextCursor',null)),'position',case when more then jsonb_build_object('id',last_id)else null end);
end $$;

create or replace function public.m3_dashboard_ingestion(p_org uuid,p_actor uuid,p_filters jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows jsonb; position jsonb; n integer; lim integer:=coalesce((p_filters->>'limit')::integer,10);
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_sboms') or not public.m14_actor_can(p_org,p_actor,'can_view_products') then return jsonb_build_object('section',public.m14_section('restricted'),'position',null);end if;
 with scoped as(select j.*,p.id product_id,p.name product_name from public.sbom_ingest_jobs j join public.product_releases r on r.organization_id=p_org and r.id=j.release_id join public.products p on p.organization_id=p_org and p.id=r.product_id
 where j.organization_id=p_org and ((p_filters->>'productId')is null or p.id=(p_filters->>'productId')::uuid)
 and (p_filters->'position'is null or (j.created_at,j.id)<((p_filters#>>'{position,createdAt}')::timestamptz,(p_filters#>>'{position,id}')::uuid)) order by j.created_at desc,j.id desc limit lim+1),numbered as(select *,row_number()over(order by created_at desc,id desc)rn from scoped)
 select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('jobId',id,'productId',product_id,'productName',product_name,'releaseId',release_id,'status',status,'createdAt',public.m6_utc_second_z(created_at),'updatedAt',public.m6_utc_second_z(updated_at))order by rn)filter(where rn<=lim),'[]'::jsonb),
 (jsonb_agg(jsonb_build_object('createdAt',created_at,'id',id)order by rn)filter(where rn=lim))->0 into n,rows,position from numbered;
 return jsonb_build_object('section',public.m14_section(case when n=0 then 'empty'else'available'end,jsonb_build_object('rows',rows,'nextCursor',null)),'position',case when n>lim then position else null end);
end $$;

create or replace function public.m4_dashboard_feed_freshness(p_org uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows jsonb;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_findings')then return public.m14_section('restricted');end if;
 select coalesce(jsonb_agg(jsonb_build_object('feedKey',feed_key,'status',case when not enabled then 'disabled' when sync_state='syncing'then'syncing' when sync_state='failed'then'failed' when coalesce(last_source_snapshot_at,last_success_at)is null then'never_synced' when coalesce(last_source_snapshot_at,last_success_at)<statement_timestamp()-make_interval(secs=>stale_threshold_seconds)then'stale'else'healthy'end,'freshness',case when not enabled then'disabled'when coalesce(last_source_snapshot_at,last_success_at)is null then'unknown'when coalesce(last_source_snapshot_at,last_success_at)<statement_timestamp()-make_interval(secs=>stale_threshold_seconds)then'stale'else'fresh'end,'lastSuccessfulSyncAt',case when last_success_at is null then null else public.m6_utc_second_z(last_success_at)end,'updatedAt',public.m6_utc_second_z(updated_at))order by feed_key),'[]'::jsonb)into rows from public.vulnerability_feed_configs;
 return public.m14_section(case when jsonb_array_length(rows)=0 then'empty'else'available'end,rows);
end $$;

create or replace function public.get_dashboard_projection(p_organization_id uuid,p_actor_user_id uuid,p_endpoint text,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 v_result jsonb; v_sections jsonb:='{}'; v_positions jsonb:='{}'; v_value jsonb; v_name text; v_product uuid; v_filters jsonb;
 v_product_row public.products; v_support public.product_support_periods; v_release uuid; v_classification text;
begin
 if not public.m14_actor_can(p_organization_id,p_actor_user_id,'can_view_dashboards') then return jsonb_build_object('outcome','not_found');end if;
 if p_endpoint not in ('overview','posture','obligations','readiness','ingestion') or jsonb_typeof(p_filters)<>'object' then return jsonb_build_object('outcome','invalid_request');end if;
 v_product:=(p_filters->>'productId')::uuid;
 if v_product is not null and (not public.m14_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not exists(select 1 from public.products where organization_id=p_organization_id and id=v_product)) then return jsonb_build_object('outcome','not_found');end if;
 v_filters:=p_filters||case when p_endpoint='posture'then jsonb_build_object('state','history')else '{}'::jsonb end||jsonb_build_object('limit',case when p_endpoint in ('overview','posture') then 10 else coalesce((p_filters->>'limit')::integer,20)end);
 if (v_filters->>'limit')::integer not between 1 and 100 then return jsonb_build_object('outcome','invalid_request');end if;
 v_result:=jsonb_build_object('organizationId',p_organization_id,'serverNow',public.m6_utc_second_z(statement_timestamp()),'generatedAt',public.m6_utc_second_z(statement_timestamp()));
 if p_endpoint='posture' then
 if v_product is null then return jsonb_build_object('outcome','not_found');end if;
 select * into v_product_row from public.products where organization_id=p_organization_id and id=v_product;
 -- Product posture uses the product support decision; per-release coverage remains source-owned.
 v_release:=null;
 v_support:=public.m2_active_support_period(p_organization_id,v_product,v_release);
 select classification into v_classification from public.product_classification_runs where organization_id=p_organization_id and product_id=v_product order by revision desc,id desc limit 1;
 v_result:=v_result||jsonb_build_object('product',jsonb_build_object('productId',v_product,'productName',v_product_row.name,'archived',v_product_row.archived_at is not null,'classification',v_classification,'support',jsonb_build_object('state',case when v_support.id is null then'missing'when v_support.support_starts_at>statement_timestamp()then'not_started'when v_support.support_ends_at<=statement_timestamp()then'ended'else'active'end,'startsAt',case when v_support.id is null then null else public.m6_utc_second_z(v_support.support_starts_at)end,'endsAt',case when v_support.id is null then null else public.m6_utc_second_z(v_support.support_ends_at)end)));
 end if;
 foreach v_name in array case when p_endpoint='overview' then array['products','findings','obligations','sbomCoverage','readiness','ingestion','feedFreshness'] when p_endpoint='posture' then array['findings','obligations','sbomCoverage','readiness','ingestion','feedFreshness']else array[p_endpoint]end loop
 begin
 if p_filters#>>array['sourceAccess',v_name]='false' then
 v_value:=jsonb_build_object('section',public.m14_section('restricted'),'position',null);
 else
 case v_name
 when'products'then v_value:=jsonb_build_object('section',public.m2_dashboard_products(p_organization_id,p_actor_user_id,v_product));
 when'findings'then v_value:=jsonb_build_object('section',public.m5_dashboard_findings(p_organization_id,p_actor_user_id,v_product));
 when'sbomCoverage'then v_value:=jsonb_build_object('section',public.m3_dashboard_coverage(p_organization_id,p_actor_user_id,v_product));
 when'feedFreshness'then v_value:=jsonb_build_object('section',public.m4_dashboard_feed_freshness(p_organization_id,p_actor_user_id));
 when'obligations'then v_value:=public.m6_dashboard_obligations(p_organization_id,p_actor_user_id,v_filters);
 when'readiness'then v_value:=public.m7_dashboard_readiness(p_organization_id,p_actor_user_id,v_filters);
 when'ingestion'then v_value:=public.m3_dashboard_ingestion(p_organization_id,p_actor_user_id,v_filters);
 end case;
 end if;
 exception when others then
 raise log 'M14 source % unavailable SQLSTATE %',v_name,sqlstate;
 v_value:=jsonb_build_object('section',public.m14_section('unavailable'),'position',null);
 end;
 v_sections:=v_sections||jsonb_build_object(v_name,v_value->'section');
 if v_value->'position' is not null and v_value->'position'<>'null'::jsonb then v_positions:=v_positions||jsonb_build_object(v_name,v_value->'position');end if;
 end loop;
 return jsonb_build_object('outcome','found','result',v_result||v_sections,'nextPosition',case when p_endpoint in ('overview','posture')then case when v_positions='{}'::jsonb then null else v_positions end else v_positions->p_endpoint end);
end $$;

-- Only the facade is exposed to service_role; inward-owned helpers remain private.
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('m14_actor_can','m5_finding_open_policy','m5_finding_is_open','m5_triage_observation_severity','m4_03_cvss_rows','m5_cvss_score_severity','m14_section','m2_dashboard_products','m5_dashboard_findings','m3_dashboard_coverage','m6_dashboard_obligations','m7_dashboard_source_permission','m7_dashboard_source_can','m7_dashboard_readiness','m3_dashboard_ingestion','m4_dashboard_feed_freshness','get_dashboard_projection')loop
 execute format('alter function %s owner to postgres',f.signature);
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.get_dashboard_projection(uuid,uuid,text,jsonb)to service_role;
