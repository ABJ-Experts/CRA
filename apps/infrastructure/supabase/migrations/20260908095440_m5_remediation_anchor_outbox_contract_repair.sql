create or replace function public.record_finding_remediation_anchor_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid,
  p_remediation_kind text,
  p_fix_version text,
  p_mitigation_description text,
  p_availability_at timestamptz,
  p_availability_provenance text,
  p_availability_basis text,
  p_correction_reason text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_finding public.vulnerability_findings%rowtype;
  v_release public.product_releases%rowtype;
  v_current public.vulnerability_finding_remediation_anchors%rowtype;
  v_anchor public.vulnerability_finding_remediation_anchors%rowtype;
  v_existing record;
  v_digest text;
  v_is_correction boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_actor_user_id is null or p_finding_id is null
    or p_idempotency_key is null or p_expected_revision is null or p_expected_revision < 0
    or p_remediation_kind is null or p_remediation_kind not in ('corrective', 'mitigation')
    or (p_remediation_kind = 'corrective' and char_length(btrim(coalesce(p_fix_version, ''))) not between 1 and 500)
    or char_length(btrim(coalesce(p_mitigation_description, ''))) not between 1 and 4000
    or (p_fix_version is not null and char_length(btrim(p_fix_version)) not between 1 and 500)
    or (p_mitigation_description is not null and char_length(btrim(p_mitigation_description)) not between 1 and 4000)
    or (p_availability_at is not null and p_availability_at > v_now)
    or ((p_availability_at is null) <> (p_availability_provenance is null))
    or ((p_availability_at is null) <> (p_availability_basis is null))
    or (p_availability_at is not null and (p_availability_provenance <> 'human_asserted'
      or char_length(btrim(coalesce(p_availability_basis, ''))) not between 1 and 4000)) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m5_triage_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  v_digest := encode(extensions.digest(jsonb_build_object(
    'findingId', p_finding_id, 'remediationKind', p_remediation_kind,
    'fixVersion', nullif(btrim(p_fix_version), ''),
    'mitigationDescription', nullif(btrim(p_mitigation_description), ''),
    'availabilityAt', p_availability_at,
    'availabilityProvenance', p_availability_provenance,
    'availabilityBasis', nullif(btrim(p_availability_basis), ''),
    'correctionReason', nullif(btrim(p_correction_reason), ''),
    'expectedRevision', p_expected_revision
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'record_remediation_anchor', v_digest);
  if found then
    return query select v_existing.outcome, v_existing.result;
    return;
  end if;

  select * into v_finding from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id
  for update;
  if not found or v_finding.status <> 'active' then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_finding.closed_at is not null then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  select * into v_release from public.product_releases releases
  where releases.organization_id = p_organization_id and releases.id = v_finding.release_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_current from public.vulnerability_finding_remediation_anchors anchors
  where anchors.organization_id = p_organization_id and anchors.finding_id = p_finding_id and anchors.is_current
  for update;
  v_is_correction := found;
  if (not v_is_correction and p_expected_revision <> 0)
    or (v_is_correction and p_expected_revision <> v_current.revision) then
    return query select 'conflict'::text, jsonb_build_object(
      'remediation', public.m5_remediation_projection_json(p_organization_id, p_finding_id));
    return;
  end if;
  if (not v_is_correction and nullif(btrim(coalesce(p_correction_reason, '')), '') is not null)
    or (not v_is_correction and v_release.archived_at is not null)
    or (v_is_correction and char_length(btrim(coalesce(p_correction_reason, ''))) not between 1 and 2000) then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  if v_is_correction then
    update public.vulnerability_finding_remediation_anchors
    set is_current = false, superseded_at = v_now, superseded_by = p_actor_user_id
    where organization_id = p_organization_id and id = v_current.id;
  end if;
  insert into public.vulnerability_finding_remediation_anchors(
    organization_id, finding_id, revision, remediation_kind, fix_version, mitigation_description,
    availability_at, availability_provenance, availability_basis, correction_reason, recorded_by, recorded_at
  ) values (
    p_organization_id, p_finding_id, case when v_is_correction then v_current.revision + 1 else 1 end,
    p_remediation_kind, nullif(btrim(p_fix_version), ''), btrim(p_mitigation_description),
    p_availability_at, p_availability_provenance, nullif(btrim(p_availability_basis), ''),
    case when v_is_correction then btrim(p_correction_reason) else null end, p_actor_user_id, v_now
  ) returning * into v_anchor;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, finding_id, remediation_anchor_id,
    event_type, event_key, payload, correlation_id, occurred_at, delivery_state, delivered_at
  ) values (
    p_organization_id, v_release.product_id, v_release.id, p_finding_id, v_anchor.id,
    case when v_is_correction then 'remediation_anchor.corrected' else 'remediation_anchor.recorded' end,
    case when v_is_correction then 'remediation-anchor:corrected:' else 'remediation-anchor:recorded:' end || v_anchor.id::text,
    jsonb_build_object('schemaVersion', 1,
      'eventKey', case when v_is_correction then 'remediation-anchor:corrected:' else 'remediation-anchor:recorded:' end || v_anchor.id::text,
      'eventType', case when v_is_correction then 'remediation_anchor.corrected' else 'remediation_anchor.recorded' end,
      'organizationId', p_organization_id,
      'productId', v_release.product_id,
      'releaseId', v_release.id,
      'findingId', p_finding_id,
      'remediationRevision', v_anchor.revision,
      'remediation', public.m5_remediation_anchor_json(p_organization_id, v_anchor.id),
      'reintroducedFromFindingId', null,
      'occurredAt', public.m2_utc_z(v_now)),
    coalesce(p_correlation_id, gen_random_uuid()), v_now, 'queued', null
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id,
    case when v_is_correction then 'vulnerability.remediation_anchor_corrected' else 'vulnerability.remediation_anchor_recorded' end,
    'vulnerability_finding_remediation_anchor', v_anchor.id::text,
    jsonb_build_object('findingId', p_finding_id, 'revision', v_anchor.revision,
      'idempotencyKey', p_idempotency_key, 'correlationId', p_correlation_id));
  insert into public.vulnerability_triage_commands(organization_id, actor_user_id, idempotency_key, operation, request_digest, result)
  values (p_organization_id, p_actor_user_id, p_idempotency_key, 'record_remediation_anchor', v_digest,
    jsonb_build_object('remediation', public.m5_remediation_projection_json(p_organization_id, p_finding_id)));
  return query select case when v_is_correction then 'corrected' else 'recorded' end,
    jsonb_build_object('remediation', public.m5_remediation_projection_json(p_organization_id, p_finding_id));
end;
$$;

create or replace function public.get_finding_remediation_anchors(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_finding_id is null or not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
    or not exists (select 1 from public.vulnerability_findings findings
      where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, jsonb_build_object(
    'current', (select public.m5_remediation_anchor_json(p_organization_id, anchors.id)
      from public.vulnerability_finding_remediation_anchors anchors
      where anchors.organization_id = p_organization_id and anchors.finding_id = p_finding_id and anchors.is_current),
    'history', coalesce((select jsonb_agg(public.m5_remediation_anchor_json(p_organization_id, anchors.id)
      order by anchors.revision) from public.vulnerability_finding_remediation_anchors anchors
      where anchors.organization_id = p_organization_id and anchors.finding_id = p_finding_id), '[]'::jsonb)
  );
end;
$$;

-- This runs inside the existing matching write transaction. A current release
-- can be marked reintroduced only when a completed directed diff establishes
-- its source lineage and a prior source in that lineage contains the same
-- normalized identity/version/advisory with an effective fixed assessment.
create or replace function public.m5_remediation_mark_reintroduced_finding(
  p_organization_id uuid, p_finding_id uuid
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target public.vulnerability_findings%rowtype;
  v_prior_id uuid;
  v_product_id uuid;
  v_archived boolean;
  v_has_lineage boolean;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_target from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id
  for update;
  if not found or v_target.status <> 'active' then
    return 'not_evaluated';
  end if;
  if v_target.reintroduced_from_finding_id is not null then
    return 'reintroduced';
  end if;
  select releases.archived_at is not null into v_archived
  from public.product_releases releases
  where releases.organization_id = p_organization_id and releases.id = v_target.release_id;
  if coalesce(v_archived, true) then
    return 'skipped_archived';
  end if;
  select exists (
    select 1 from public.vulnerability_finding_component_occurrences links
    join public.vulnerability_component_occurrences occurrences
      on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
    join public.sbom_diff_reports reports
      on reports.organization_id = occurrences.organization_id and reports.document_id = occurrences.document_id
    where links.organization_id = p_organization_id and links.finding_id = p_finding_id and links.state = 'active'
      and reports.state = 'completed' and reports.finding_delta_state = 'ready'
  ) into v_has_lineage;
  if not v_has_lineage then
    return 'not_evaluated';
  end if;
  with recursive target_document as (
    select occurrences.document_id
    from public.vulnerability_finding_component_occurrences links
    join public.vulnerability_component_occurrences occurrences
      on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
    where links.organization_id = p_organization_id and links.finding_id = p_finding_id and links.state = 'active'
    order by occurrences.id limit 1
  ), completed_lineage as (
    select reports.baseline_source_id as source_id, reports.baseline_document_id as document_id
    from public.sbom_diff_reports reports
    join target_document target on target.document_id = reports.document_id
    where reports.organization_id = p_organization_id and reports.release_id = v_target.release_id
      and reports.state = 'completed' and reports.finding_delta_state = 'ready'
    union
    select sources.supersedes_source_id, document_sources.document_id
    from completed_lineage lineage
    join public.sbom_sources sources on sources.organization_id = p_organization_id and sources.id = lineage.source_id
    join public.sbom_document_sources document_sources
      on document_sources.organization_id = sources.organization_id and document_sources.source_id = sources.supersedes_source_id
    where sources.supersedes_source_id is not null
  ), target_occurrences as (
    select occurrences.component_identity, occurrences.component_version, occurrences.identity_kind
    from public.vulnerability_finding_component_occurrences links
    join public.vulnerability_component_occurrences occurrences
      on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
    where links.organization_id = p_organization_id and links.finding_id = p_finding_id and links.state = 'active'
  )
  select prior.id into v_prior_id
  from completed_lineage lineage
  join public.vulnerability_finding_component_occurrences prior_links
    on prior_links.organization_id = p_organization_id
  join public.vulnerability_component_occurrences prior_occurrences
    on prior_occurrences.organization_id = prior_links.organization_id
   and prior_occurrences.id = prior_links.occurrence_id and prior_occurrences.document_id = lineage.document_id
  join public.vulnerability_findings prior
    on prior.organization_id = prior_links.organization_id and prior.id = prior_links.finding_id
  join target_occurrences target_occurrences
    on target_occurrences.identity_kind = prior_occurrences.identity_kind
   and target_occurrences.component_identity = prior_occurrences.component_identity
   and target_occurrences.component_version = prior_occurrences.component_version
  join public.vulnerability_finding_assessments assessments
    on assessments.organization_id = prior.organization_id
   and assessments.id = public.m5_bulk_effective_assessment_id(prior.organization_id, prior.id)
  where prior.id <> v_target.id
    and prior.release_id <> v_target.release_id
    and prior.canonical_advisory_id = v_target.canonical_advisory_id
    and assessments.vex_status = 'fixed'
    and assessments.approval_state in ('approved', 'approval_not_required')
  order by prior.last_evaluated_at desc, prior.id
  limit 1;
  if v_prior_id is null then return 'not_reintroduced'; end if;
  update public.vulnerability_findings
  set reintroduced_from_finding_id = v_prior_id, reintroduced_at = v_now, updated_at = v_now
  where organization_id = p_organization_id and id = p_finding_id
    and reintroduced_from_finding_id is null;
  if not found then return 'reintroduced'; end if;
  select releases.product_id into v_product_id from public.product_releases releases
  where releases.organization_id = p_organization_id and releases.id = v_target.release_id;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, finding_id, reintroduced_from_finding_id,
    event_type, event_key, payload, correlation_id, occurred_at, delivery_state, delivered_at
  ) values (
    p_organization_id, v_product_id, v_target.release_id, p_finding_id, v_prior_id,
    'component.reintroduced', 'component-reintroduced:' || p_finding_id::text || ':' || v_prior_id::text,
    jsonb_build_object('schemaVersion', 1,
      'eventKey', 'component-reintroduced:' || p_finding_id::text || ':' || v_prior_id::text,
      'eventType', 'component.reintroduced',
      'organizationId', p_organization_id,
      'productId', v_product_id,
      'releaseId', v_target.release_id,
      'findingId', p_finding_id,
      'remediationRevision', null,
      'remediation', null,
      'reintroducedFromFindingId', v_prior_id,
      'occurredAt', public.m2_utc_z(v_now)),
    gen_random_uuid(), v_now, 'queued', null
  ) on conflict (organization_id, event_key) do nothing;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.component_reintroduced', 'vulnerability_finding', p_finding_id::text,
    jsonb_build_object('fromFindingId', v_prior_id, 'releaseId', v_target.release_id));
  return 'reintroduced';
end;
$$;

-- M6 reads these feature-owned event types through this narrow service-role
-- boundary. It deliberately does not lease or acknowledge them: M6 owns its
-- own obligation idempotency/audit transaction, keyed by `eventKey`.
create or replace function public.list_m6_remediation_outbox_events(
  p_organization_id uuid,
  p_limit integer default 100,
  p_cursor uuid default null
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_events jsonb; v_next_cursor uuid;
begin
  if p_organization_id is null or p_limit not between 1 and 100 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  with page as (
    select * from public.product_regulatory_outbox_events events
    where events.organization_id = p_organization_id
      and events.event_type in ('remediation_anchor.recorded', 'remediation_anchor.corrected', 'component.reintroduced')
      and events.delivery_state = 'queued'
      and (p_cursor is null or events.id > p_cursor)
    order by events.id
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventKey', events.event_key,
    'eventType', events.event_type,
    'organizationId', events.organization_id,
    'productId', events.product_id,
    'releaseId', events.release_id,
    'findingId', events.finding_id,
    'remediationRevision', case when events.event_type in ('remediation_anchor.recorded', 'remediation_anchor.corrected')
      then (events.payload ->> 'remediationRevision')::integer else null end,
    'remediation', case when events.event_type in ('remediation_anchor.recorded', 'remediation_anchor.corrected')
      then events.payload -> 'remediation' else null end,
    'reintroducedFromFindingId', events.reintroduced_from_finding_id,
    'occurredAt', public.m2_utc_z(events.occurred_at)
  ) order by events.id), '[]'::jsonb),
    case when count(*) = p_limit then (array_agg(events.id order by events.id desc))[1] else null end
  into v_events, v_next_cursor
  from page events;
  return query select 'found'::text, jsonb_build_object(
    'events', v_events,
    'nextCursor', v_next_cursor
  );
end;
$$;

alter function public.record_finding_remediation_anchor_atomic(uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, integer, uuid, uuid) owner to postgres;
alter function public.m5_remediation_mark_reintroduced_finding(uuid, uuid) owner to postgres;
alter function public.list_m6_remediation_outbox_events(uuid, integer, uuid) owner to postgres;

revoke all on function
  public.record_finding_remediation_anchor_atomic(uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, integer, uuid, uuid),
  public.m5_remediation_mark_reintroduced_finding(uuid, uuid),
  public.list_m6_remediation_outbox_events(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function
  public.record_finding_remediation_anchor_atomic(uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, integer, uuid, uuid),
  public.list_m6_remediation_outbox_events(uuid, integer, uuid)
  to service_role;
