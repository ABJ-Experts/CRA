-- Preserve the exact CPE proof evaluated by the worker and make the human
-- verdict command return its exact finding rather than a first-page lookup.
create or replace function public.record_vulnerability_finding_human_verdict_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_document_id uuid,
  p_finding_id uuid,
  p_verdict text,
  p_rationale text,
  p_idempotency_key uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_finding public.vulnerability_findings%rowtype; v_before jsonb; v_after jsonb; v_existing jsonb; v_payload jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_finding_id is null or p_idempotency_key is null
     or p_verdict not in ('affected', 'not_affected')
     or char_length(btrim(coalesce(p_rationale, ''))) not between 1 and 2000
     or not public.m4_03_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_finding_id::text || ':' || p_idempotency_key::text, 0));
  select changes -> 'after' into v_existing from public.audit_logs logs
  where logs.organization_id = p_organization_id and logs.action = 'vulnerability.finding_human_verdict_recorded'
    and logs.entity_type = 'vulnerability_finding' and logs.entity_id = p_finding_id::text
    and logs.changes ->> 'idempotencyKey' = p_idempotency_key::text
  order by logs.created_at desc, logs.id desc limit 1;
  if found then
    if v_existing #>> '{assessment,verdict}' = p_verdict and v_existing #>> '{assessment,rationale}' = btrim(p_rationale) then
      return query select 'recorded'::text, v_existing;
    end if;
    return query select 'idempotency_conflict'::text, null::jsonb;
  end if;
  select * into v_finding from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id
    and exists (
      select 1 from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
        and occurrences.organization_id = links.organization_id
      where links.finding_id = findings.id and links.organization_id = findings.organization_id
        and links.state = 'active' and occurrences.document_id = p_document_id
    ) for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  v_before := jsonb_strip_nulls(jsonb_build_object('humanVerdict', v_finding.human_verdict,
    'humanRationale', v_finding.human_rationale, 'humanAssessedAt', v_finding.human_assessed_at,
    'effectiveVerdict', coalesce(v_finding.human_verdict, v_finding.automatic_verdict),
    'reevaluationState', v_finding.reevaluation_state));
  update public.vulnerability_findings findings set
    human_verdict = p_verdict, human_rationale = btrim(p_rationale),
    human_assessed_by = p_actor_user_id, human_assessed_at = clock_timestamp(),
    reevaluation_state = case when findings.automatic_verdict <> p_verdict then 'review_required' else 'unchanged' end,
    proposed_state = case when findings.automatic_verdict <> p_verdict then jsonb_build_object(
      'automaticVerdict', findings.automatic_verdict, 'reason', 'human_assessment_conflict') else '{}'::jsonb end,
    updated_at = clock_timestamp()
  where findings.organization_id = p_organization_id and findings.id = p_finding_id
  returning * into v_finding;
  select jsonb_build_object(
    'id', findings.id, 'releaseId', findings.release_id, 'componentId', occurrences.component_id,
    'componentPurl', occurrences.canonical_purl, 'componentCpe', occurrences.canonical_cpe,
    'componentVersion', occurrences.component_version, 'advisoryId', findings.canonical_advisory_id,
    'vulnerabilityId', findings.vulnerability_id, 'sourceFeedKey', findings.source_feed_key,
    'sourceRecordId', findings.source_record_id, 'sourceRecordVersionId', findings.source_record_version_id,
    'affectedRangeId', findings.affected_range_id, 'outcome', 'affected', 'matchMethod', findings.match_method,
    'cpeSpecificity', case when findings.match_method = 'cpe_nvd' then
      coalesce(findings.affected_range ->> 'm4CpeSpecificity', 'broad_family') else null end,
    'cpeConfigurationEvidence', case when findings.match_method = 'cpe_nvd' then
      coalesce(findings.affected_range -> 'm4CpeConfigurationEvidence', '{}'::jsonb) else null end,
    'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
    'affectedRange', findings.affected_range, 'eventSequence', findings.event_sequence,
    'confidence', findings.confidence, 'confidenceTableVersion', findings.confidence_table_version,
    'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
    'lastEvaluatedAt', findings.last_evaluated_at, 'reEvaluationState', findings.reevaluation_state,
    'proposedState', findings.proposed_state, 'closedAt', findings.closed_at, 'closureReason', findings.closure_reason,
    'humanAssessment', jsonb_build_object('verdict', findings.human_verdict, 'rationale', findings.human_rationale,
      'assessedByUserId', findings.human_assessed_by, 'assessedAt', findings.human_assessed_at),
    'aliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias))
      from public.vulnerability_aliases aliases where aliases.vulnerability_id = findings.vulnerability_id), '[]'::jsonb)
  ) into v_payload
  from public.vulnerability_findings findings
  join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
    and links.organization_id = findings.organization_id and links.state = 'active'
  join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
    and occurrences.organization_id = findings.organization_id
  where findings.organization_id = p_organization_id and findings.id = v_finding.id
    and occurrences.document_id = p_document_id
  order by occurrences.id limit 1;
  v_after := jsonb_build_object('finding', v_payload, 'assessment', jsonb_build_object(
    'verdict', v_finding.human_verdict, 'rationale', v_finding.human_rationale,
    'assessedByUserId', v_finding.human_assessed_by, 'assessedAt', v_finding.human_assessed_at));
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.finding_human_verdict_recorded',
    'vulnerability_finding', p_finding_id::text,
    jsonb_build_object('before', v_before, 'proposed', v_finding.proposed_state, 'after', v_after,
      'idempotencyKey', p_idempotency_key));
  return query select 'recorded'::text, v_after;
end;
$$;

revoke execute on function public.record_vulnerability_finding_human_verdict_atomic(
  uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_vulnerability_finding_human_verdict_atomic(
  uuid, uuid, uuid, uuid, text, text, uuid
) to service_role;
alter function public.record_vulnerability_finding_human_verdict_atomic(uuid, uuid, uuid, uuid, text, text, uuid) owner to postgres;
