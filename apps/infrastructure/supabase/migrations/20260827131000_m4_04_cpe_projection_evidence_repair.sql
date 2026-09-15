-- Do not infer CPE specificity from the component after a deterministic
-- evaluation. Return the criterion/tree proof stored with the finding.
create or replace function public.list_vulnerability_match_results_for_document_page(
  p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid,
  p_include_low_confidence boolean, p_include_reviewable boolean,
  p_page integer default 1, p_page_size integer default 50, p_q text default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer := 0; v_results jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null
     or p_include_low_confidence is null or p_include_reviewable is null
     or p_page not between 1 and 1000000 or p_page_size not between 1 and 100
     or p_q is not null and char_length(btrim(p_q)) > 200
     or not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
     or not exists (select 1 from public.sbom_documents documents
       where documents.organization_id = p_organization_id and documents.id = p_document_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  with latest_completed_job as (
    select jobs.id from public.vulnerability_match_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.document_id = p_document_id and jobs.status = 'completed'
    order by jobs.completed_at desc nulls last, jobs.created_at desc, jobs.id desc limit 1
  ), affected as (
    select jsonb_build_object('id', findings.id, 'releaseId', findings.release_id,
      'componentId', occurrences.component_id, 'componentPurl', occurrences.canonical_purl,
      'componentCpe', occurrences.canonical_cpe, 'componentVersion', occurrences.component_version,
      'advisoryId', findings.canonical_advisory_id, 'vulnerabilityId', findings.vulnerability_id,
      'sourceFeedKey', findings.source_feed_key, 'sourceRecordId', findings.source_record_id,
      'sourceRecordVersionId', findings.source_record_version_id, 'affectedRangeId', findings.affected_range_id,
      'outcome', 'affected', 'matchMethod', findings.match_method,
      'cpeSpecificity', case when findings.match_method = 'cpe_nvd' then
        coalesce(findings.affected_range ->> 'm4CpeSpecificity', 'broad_family') else null end,
      'cpeConfigurationEvidence', case when findings.match_method = 'cpe_nvd' then coalesce(
        findings.affected_range -> 'm4CpeConfigurationEvidence', jsonb_build_object(
          'configurationPath', ranges.configuration_path, 'operator', ranges.configuration_operator,
          'negated', ranges.configuration_negated, 'vulnerable', ranges.cpe_vulnerable,
          'cpe', jsonb_strip_nulls(jsonb_build_object('part', ranges.cpe_part, 'vendor', ranges.cpe_vendor,
            'product', ranges.cpe_product, 'version', ranges.cpe_version,
            'versionStartIncluding', ranges.version_start_including, 'versionStartExcluding', ranges.version_start_excluding,
            'versionEndIncluding', ranges.version_end_including, 'versionEndExcluding', ranges.version_end_excluding)))) else null end,
      'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
      'affectedRange', findings.affected_range, 'eventSequence', findings.event_sequence,
      'confidence', findings.confidence, 'confidenceTableVersion', findings.confidence_table_version,
      'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
      'lastEvaluatedAt', findings.last_evaluated_at, 'reEvaluationState', findings.reevaluation_state,
      'proposedState', findings.proposed_state, 'closedAt', findings.closed_at, 'closureReason', findings.closure_reason,
      'humanAssessment', case when findings.human_verdict is null then null else jsonb_build_object('verdict', findings.human_verdict,
        'rationale', findings.human_rationale, 'assessedByUserId', findings.human_assessed_by, 'assessedAt', findings.human_assessed_at) end,
      'aliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias)) from public.vulnerability_aliases aliases
        where aliases.vulnerability_id = findings.vulnerability_id), '[]'::jsonb)) as payload,
      findings.confidence as confidence, 0 as kind, findings.id as result_id,
      concat_ws(' ', findings.canonical_advisory_id, occurrences.canonical_purl, occurrences.canonical_cpe, occurrences.component_version) as search_text
    from public.vulnerability_findings findings
    join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
      and links.organization_id = findings.organization_id and links.state = 'active'
    join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
      and occurrences.organization_id = findings.organization_id
    join public.vulnerability_affected_ranges ranges on ranges.id = findings.affected_range_id
    where findings.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and findings.status = 'active' and (p_include_low_confidence or findings.confidence >= 0.9)
  ), reviewable as (
    select jsonb_build_object('id', evaluations.id, 'releaseId', occurrences.release_id,
      'componentId', occurrences.component_id, 'componentPurl', occurrences.canonical_purl,
      'componentCpe', occurrences.canonical_cpe, 'componentVersion', coalesce(nullif(occurrences.component_version, ''), 'unknown'),
      'outcome', 'reviewable', 'reviewCode', evaluations.review_code, 'matchMethod', evaluations.match_method,
      'comparatorName', evaluations.comparator_name, 'comparatorVersion', evaluations.comparator_version,
      'sourceFeedKey', evaluations.source_feed_key, 'sourceRecordId', evaluations.source_record_id,
      'sourceRecordVersionId', evaluations.source_record_version_id, 'affectedRangeId', evaluations.affected_range_id,
      'evaluatedAt', evaluations.evaluated_at) as payload, 0::numeric as confidence, 1 as kind, evaluations.id as result_id,
      concat_ws(' ', evaluations.review_code, occurrences.canonical_purl, occurrences.canonical_cpe, occurrences.component_version) as search_text
    from public.vulnerability_match_evaluations evaluations
    join latest_completed_job latest on latest.id = evaluations.match_job_id
    join public.vulnerability_component_occurrences occurrences on occurrences.id = evaluations.occurrence_id
      and occurrences.organization_id = evaluations.organization_id
    where evaluations.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and evaluations.outcome = 'reviewable' and p_include_reviewable
  ), results as (select * from affected union all select * from reviewable), filtered as (
    select * from results where p_q is null or search_text ilike '%' || btrim(p_q) || '%'
  ), paged as (
    select * from filtered order by kind, confidence desc, result_id offset (p_page - 1) * p_page_size limit p_page_size
  )
  select (select count(*)::integer from filtered),
    coalesce((select jsonb_agg(payload order by kind, confidence desc, result_id) from paged), '[]'::jsonb)
  into v_total, v_results;
  return query select 'found'::text, jsonb_build_object('results', v_results, 'total', v_total);
end;
$$;

revoke execute on function public.list_vulnerability_match_results_for_document_page(
  uuid, uuid, uuid, boolean, boolean, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.list_vulnerability_match_results_for_document_page(
  uuid, uuid, uuid, boolean, boolean, integer, integer, text
) to service_role;
alter function public.list_vulnerability_match_results_for_document_page(uuid, uuid, uuid, boolean, boolean, integer, integer, text) owner to postgres;
