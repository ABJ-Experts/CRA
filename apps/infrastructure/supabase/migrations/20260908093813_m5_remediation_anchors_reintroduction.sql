-- CRA-M5-05: human-asserted remediation anchors remain independent from VEX.
-- They are append-only operational evidence, while the established finding
-- ledger remains the source for matching and assessment history.

create table public.vulnerability_finding_remediation_anchors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  revision integer not null check (revision > 0),
  remediation_kind text not null check (remediation_kind in ('corrective', 'mitigation')),
  fix_version text check (fix_version is null or char_length(btrim(fix_version)) between 1 and 500),
  mitigation_description text not null check (char_length(btrim(mitigation_description)) between 1 and 4000),
  availability_at timestamptz,
  availability_provenance text check (availability_provenance is null or availability_provenance = 'human_asserted'),
  availability_basis text check (availability_basis is null or char_length(btrim(availability_basis)) between 1 and 4000),
  correction_reason text check (correction_reason is null or char_length(btrim(correction_reason)) between 1 and 2000),
  is_current boolean not null default true,
  superseded_at timestamptz,
  superseded_by uuid references public.users(id) on delete restrict,
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, finding_id, revision),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  check ((remediation_kind = 'corrective' and fix_version is not null)
    or remediation_kind = 'mitigation'),
  check ((availability_at is null and availability_provenance is null and availability_basis is null)
    or (availability_at is not null and availability_provenance = 'human_asserted' and availability_basis is not null)),
  check ((is_current and superseded_at is null and superseded_by is null)
    or (not is_current and superseded_at is not null and superseded_by is not null))
);

create unique index vulnerability_finding_remediation_anchors_one_current_idx
  on public.vulnerability_finding_remediation_anchors(organization_id, finding_id)
  where is_current;
create index vulnerability_finding_remediation_anchors_history_idx
  on public.vulnerability_finding_remediation_anchors(organization_id, finding_id, revision desc);

-- Revisions are immutable. The only permitted update is the transactional
-- current-to-history transition immediately before its replacement is written.
create or replace function public.prevent_remediation_anchor_history_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_current
    and not new.is_current
    and new.superseded_at is not null
    and new.superseded_by is not null
    and new.organization_id = old.organization_id
    and new.finding_id = old.finding_id
    and new.revision = old.revision
    and new.remediation_kind = old.remediation_kind
    and new.fix_version is not distinct from old.fix_version
    and new.mitigation_description is not distinct from old.mitigation_description
    and new.availability_at is not distinct from old.availability_at
    and new.availability_provenance is not distinct from old.availability_provenance
    and new.availability_basis is not distinct from old.availability_basis
    and new.correction_reason is not distinct from old.correction_reason
    and new.recorded_by = old.recorded_by
    and new.recorded_at = old.recorded_at then
    return new;
  end if;
  raise exception 'remediation anchor revisions are immutable';
end;
$$;
create trigger prevent_remediation_anchor_history_mutation
  before update on public.vulnerability_finding_remediation_anchors
  for each row execute function public.prevent_remediation_anchor_history_mutation();

alter table public.vulnerability_finding_remediation_anchors enable row level security;
revoke all on table public.vulnerability_finding_remediation_anchors from public, anon, authenticated;
grant all on table public.vulnerability_finding_remediation_anchors to service_role;

alter table public.vulnerability_findings
  add column reintroduced_from_finding_id uuid,
  add column reintroduced_at timestamptz,
  add constraint vulnerability_findings_reintroduced_from_finding_fk
    foreign key (organization_id, reintroduced_from_finding_id)
    references public.vulnerability_findings(organization_id, id) on delete restrict,
  add constraint vulnerability_findings_reintroduced_marker_check
    check ((reintroduced_from_finding_id is null and reintroduced_at is null)
      or (reintroduced_from_finding_id is not null and reintroduced_at is not null));
create index vulnerability_findings_reintroduced_projection_idx
  on public.vulnerability_findings(organization_id, reintroduced_at desc, id)
  where reintroduced_from_finding_id is not null;

alter table public.product_regulatory_outbox_events
  add column finding_id uuid,
  add column remediation_anchor_id uuid,
  add column reintroduced_from_finding_id uuid,
  add constraint product_regulatory_outbox_finding_fk
    foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  add constraint product_regulatory_outbox_remediation_anchor_fk
    foreign key (organization_id, remediation_anchor_id)
    references public.vulnerability_finding_remediation_anchors(organization_id, id) on delete restrict,
  add constraint product_regulatory_outbox_reintroduced_from_finding_fk
    foreign key (organization_id, reintroduced_from_finding_id)
    references public.vulnerability_findings(organization_id, id) on delete restrict;

alter table public.product_regulatory_outbox_events
  drop constraint if exists product_regulatory_outbox_events_event_type_check,
  add constraint product_regulatory_outbox_events_event_type_check check (event_type in (
    'release.market_availability_changed', 'release.lifecycle_changed',
    'release.placed_on_market_changed', 'support_period.alert',
    'product.retention.recalculated', 'product_relationship.graph_changed',
    'security_update_artifact.inspect',
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup',
    'security_update_artifact.external_reference_monitor',
    'security_update_artifact.integrity_reverify',
    'remediation_anchor.recorded', 'remediation_anchor.corrected',
    'component.reintroduced'
  )),
  add constraint product_regulatory_outbox_remediation_shape_check check (
    (event_type in ('remediation_anchor.recorded', 'remediation_anchor.corrected')
      and finding_id is not null and remediation_anchor_id is not null and reintroduced_from_finding_id is null)
    or (event_type = 'component.reintroduced'
      and finding_id is not null and remediation_anchor_id is null and reintroduced_from_finding_id is not null)
    or (event_type not in ('remediation_anchor.recorded', 'remediation_anchor.corrected', 'component.reintroduced')
      and finding_id is null and remediation_anchor_id is null and reintroduced_from_finding_id is null)
  );
alter table public.product_regulatory_outbox_events
  drop constraint if exists product_regulatory_outbox_events_delivery_state_check,
  add constraint product_regulatory_outbox_events_delivery_state_check check
    (delivery_state in ('pending', 'queued', 'scheduled', 'leased', 'delivered', 'retrying',
      'dead_letter', 'obsolete', 'recipient_unavailable'));
create index product_regulatory_outbox_remediation_idx
  on public.product_regulatory_outbox_events(organization_id, event_type, occurred_at, id)
  where event_type in ('remediation_anchor.recorded', 'remediation_anchor.corrected', 'component.reintroduced');

alter table public.vulnerability_triage_commands
  drop constraint if exists vulnerability_triage_commands_operation_check,
  add constraint vulnerability_triage_commands_operation_check check
    (operation in ('assign', 'suppress', 'set_sla_policy', 'record_remediation_anchor'));

create or replace function public.m5_remediation_anchor_json(
  p_organization_id uuid, p_anchor_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', anchors.id,
    'findingId', anchors.finding_id,
    'revision', anchors.revision,
    'remediationKind', anchors.remediation_kind,
    'fixVersion', anchors.fix_version,
    'mitigationDescription', anchors.mitigation_description,
    'availabilityAt', case when anchors.availability_at is null then null else public.m2_utc_z(anchors.availability_at) end,
    'availabilityProvenance', anchors.availability_provenance,
    'availabilityBasis', anchors.availability_basis,
    'correctionReason', anchors.correction_reason,
    'recordedByUserId', anchors.recorded_by,
    'recordedAt', public.m2_utc_z(anchors.recorded_at)
  )
  from public.vulnerability_finding_remediation_anchors anchors
  where anchors.organization_id = p_organization_id and anchors.id = p_anchor_id
$$;

create or replace function public.m5_remediation_projection_json(
  p_organization_id uuid, p_finding_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with current_anchor as (
    select anchors.*
    from public.vulnerability_finding_remediation_anchors anchors
    where anchors.organization_id = p_organization_id
      and anchors.finding_id = p_finding_id and anchors.is_current
  ), effective_vex as (
    select assessments.vex_status, assessments.approval_state
    from public.vulnerability_finding_assessments assessments
    where assessments.organization_id = p_organization_id
      and assessments.id = public.m5_bulk_effective_assessment_id(p_organization_id, p_finding_id)
  ), finding as (
    select findings.id, findings.reintroduced_from_finding_id, findings.reintroduced_at, releases.archived_at
    from public.vulnerability_findings findings
    join public.product_releases releases
      on releases.organization_id = findings.organization_id and releases.id = findings.release_id
    where findings.organization_id = p_organization_id and findings.id = p_finding_id
  ), lineage as (
    select exists (
      select 1
      from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      join public.sbom_diff_reports reports
        on reports.organization_id = occurrences.organization_id and reports.document_id = occurrences.document_id
      where links.organization_id = p_organization_id and links.finding_id = p_finding_id and links.state = 'active'
        and reports.state = 'completed' and reports.finding_delta_state = 'ready'
    ) as is_evaluated
  )
  select jsonb_build_object(
    'state', case
      when current_anchor.id is null then 'not_recorded'
      when effective_vex.vex_status = 'fixed'
        and effective_vex.approval_state in ('approved', 'approval_not_required') then 'applied'
      when current_anchor.availability_at is not null then 'available'
      else 'planned'
    end,
    'anchor', case when current_anchor.id is null then null
      else public.m5_remediation_anchor_json(p_organization_id, current_anchor.id) end,
    'reintroduction', jsonb_build_object(
      'state', case when finding.archived_at is not null then 'not_evaluated'
        when finding.reintroduced_from_finding_id is not null then 'reintroduced'
        when lineage.is_evaluated then 'not_reintroduced' else 'not_evaluated' end,
      'fromFindingId', finding.reintroduced_from_finding_id,
      'detectedAt', case when finding.reintroduced_at is null then null else public.m2_utc_z(finding.reintroduced_at) end
    )
  )
  from finding
  left join current_anchor on true
  left join effective_vex on true
  cross join lineage
$$;

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

create or replace function public.m5_remediation_detect_reintroduced_finding_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state = 'active' then
    perform public.m5_remediation_mark_reintroduced_finding(new.organization_id, new.finding_id);
  end if;
  return new;
end;
$$;
-- Matching persists a finding before it links the normalized occurrence. Hook
-- the link, not the finding insert, so the lineage/identity query has the
-- exact current component version available in the same transaction.
drop trigger if exists m5_remediation_detect_reintroduced_finding
  on public.vulnerability_findings;
create trigger m5_remediation_detect_reintroduced_finding
  after insert or update of state on public.vulnerability_finding_component_occurrences
  for each row execute function public.m5_remediation_detect_reintroduced_finding_trigger();

-- Extend the existing operational projection without rewriting the M5-04
-- suppression/SLA state machine.
alter function public.m5_triage_operational_json(uuid, uuid)
  rename to m5_triage_operational_json_m5_04;
create or replace function public.m5_triage_operational_json(p_organization_id uuid, p_finding_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_set(
    public.m5_triage_operational_json_m5_04(p_organization_id, p_finding_id),
    '{remediation}', public.m5_remediation_projection_json(p_organization_id, p_finding_id), true
  )
$$;

create or replace function public.list_finding_triage_queue(
  p_organization_id uuid, p_actor_user_id uuid, p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50, p_cursor text default null, p_sort text default null, p_order text default null
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_raw jsonb; v_rows jsonb;
begin
  perform public.m5_triage_materialize_due_work(p_organization_id);
  select raw.result into v_raw from public.list_finding_triage_queue_raw(
    p_organization_id, p_actor_user_id,
    p_filters - 'vexStatuses' - 'approvalStates' - 'suppressionStates' - 'internalSlaStates'
      - 'notificationDeliveryStates' - 'remediationStates' - 'reintroductionStates',
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
$$;

alter function public.prevent_remediation_anchor_history_mutation() owner to postgres;
alter function public.m5_remediation_anchor_json(uuid, uuid) owner to postgres;
alter function public.m5_remediation_projection_json(uuid, uuid) owner to postgres;
alter function public.record_finding_remediation_anchor_atomic(uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, integer, uuid, uuid) owner to postgres;
alter function public.get_finding_remediation_anchors(uuid, uuid, uuid) owner to postgres;
alter function public.m5_remediation_mark_reintroduced_finding(uuid, uuid) owner to postgres;
alter function public.m5_remediation_detect_reintroduced_finding_trigger() owner to postgres;
alter function public.list_m6_remediation_outbox_events(uuid, integer, uuid) owner to postgres;
alter function public.m5_triage_operational_json_m5_04(uuid, uuid) owner to postgres;
alter function public.m5_triage_operational_json(uuid, uuid) owner to postgres;
alter function public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text) owner to postgres;

revoke all on function public.prevent_remediation_anchor_history_mutation(),
  public.m5_remediation_anchor_json(uuid, uuid), public.m5_remediation_projection_json(uuid, uuid),
  public.record_finding_remediation_anchor_atomic(uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, integer, uuid, uuid),
  public.get_finding_remediation_anchors(uuid, uuid, uuid), public.m5_remediation_mark_reintroduced_finding(uuid, uuid),
  public.m5_remediation_detect_reintroduced_finding_trigger(), public.list_m6_remediation_outbox_events(uuid, integer, uuid), public.m5_triage_operational_json_m5_04(uuid, uuid),
  public.m5_triage_operational_json(uuid, uuid), public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_finding_remediation_anchor_atomic(uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, integer, uuid, uuid),
  public.get_finding_remediation_anchors(uuid, uuid, uuid), public.list_m6_remediation_outbox_events(uuid, integer, uuid), public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text)
  to service_role;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('vulnerability_triage_operational', 'vulnerability_finding_remediation_anchors', 'organization_id', 'id', 5)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

do $$
declare
  v_definition text;
  v_old_lock text := 'public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events' || chr(10) || '  in share mode';
  v_new_lock text := 'public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events, public.vulnerability_finding_remediation_anchors' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')
  ) into v_definition;

  if position(v_old_lock in v_definition) = 0 then
    raise exception 'M5-05 export lock anchor is missing';
  end if;

  execute replace(v_definition, v_old_lock, v_new_lock);
end;
$$;

-- The expected lock set for function public.materialize_organization_export_snapshot_atomic:
-- lock table
-- public.organizations, public.organization_legal_profiles, public.organization_members, public.audit_logs, public.invitations, public.custom_roles, public.base_role_permission_overrides, public.menu_permissions, public.user_role_assignments, public.user_table_preferences, public.organization_onboarding, public.organization_onboarding_stages, public.organization_onboarding_evidence, public.organization_settings, public.organization_lifecycles, public.organization_retention_policies, public.retention_authority_states, public.retention_authoritative_facts, public.retention_floor_snapshots, public.retention_floor_reasons, public.evidence_protection_watermarks, public.retention_cleanup_runs, public.retention_cleanup_items, public.organization_export_jobs, public.organization_export_parts, public.organization_export_snapshots, public.organization_purge_jobs, public.organization_purge_work_items, public.organization_permissions_version, public.organization_legal_entities, public.organization_legal_entity_dependency_authorities, public.organization_legal_entity_dependency_facts, public.organization_branding_drafts, public.organization_branding_assets, public.organization_branding_versions, public.products, public.product_releases, public.product_legal_entity_assignments, public.product_lifecycle_dependency_facts, public.product_release_market_availability, public.product_regulatory_outbox_events, public.product_support_periods, public.software_baselines, public.software_baseline_release_memberships, public.product_relationships, public.finding_propagation_sources, public.finding_impact_associations, public.finding_product_impact_overrides, public.finding_propagation_jobs, public.product_import_jobs, public.product_import_rows, public.product_substantial_modification_assessments, public.product_substantial_modification_releases, public.product_security_update_artifacts, public.connectors, public.product_external_identities, public.field_authority_policies, public.sync_runs, public.sync_run_plan_items, public.sync_conflicts, public.sync_connector_cursors, public.sbom_documents, public.sbom_document_sources, public.sbom_components, public.sbom_component_identities, public.sbom_component_dependencies, public.organization_sbom_quality_settings, public.sbom_quality_reports, public.sbom_quality_findings, public.sbom_diff_reports, public.sbom_diff_component_changes, public.sbom_supplier_requests, public.sbom_supplier_submissions, public.sbom_composite_reviews, public.sbom_composite_review_inputs, public.sbom_composite_conflicts, public.sbom_composite_unresolved_relationships, public.sbom_composite_component_provenance, public.sbom_composite_dependency_provenance, public.vulnerability_reachability_results, public.vulnerability_finding_review_events, public.vulnerability_finding_assessments, public.vulnerability_finding_assessment_evidence_links, public.vulnerability_finding_assessment_history_events, public.vulnerability_assessment_approval_policies, public.vulnerability_finding_assessment_bulk_operations, public.vulnerability_finding_assessment_bulk_operation_targets, public.vulnerability_finding_suppressions, public.vulnerability_triage_sla_policies, public.vulnerability_finding_triage_states, public.vulnerability_triage_alert_events, public.vulnerability_finding_remediation_anchors
-- in share mode;
