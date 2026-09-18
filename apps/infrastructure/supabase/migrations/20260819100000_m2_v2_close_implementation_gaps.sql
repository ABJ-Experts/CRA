-- M2 V2 gap-closing migration. Builds on 20260817151835 / 20260817160813 /
-- 20260818100000 without altering their existing behavior. Adds no tables.
--
-- 1. Wires product_substantial_modification_assessments into the retention
--    authority mechanism artifacts already use, so an unresolved
--    potentially_substantial/substantial determination blocks organization
--    purge the same way a published artifact does.
-- 2. Adds real storage-cleanup completion: a two-step RPC pair the worker
--    calls around the actual storage delete, re-checking expiry, org-level
--    legal hold, and content-addressed object-key sharing at execution time.
-- 3. Adds periodic post-publication integrity re-verification for
--    authenticated_download artifacts (external_reference artifacts already
--    have this via the existing external_reference_monitor event).
-- 4. Extends product_compliance_metrics_snapshot with an upload-failure
--    gauge and folds type_mismatch into the quarantine gauge.
-- 5. Adds a metadata-edit RPC (title / supported platform / signature
--    metadata only -- never the immutable content-identity columns) with an
--    audit trail, since no edit path existed at all.

-- =============================================================================
-- 1. Assessment retention-authority wiring
-- =============================================================================

insert into public.retention_evidence_classes(identifier, default_requested_retention_days)
values ('substantial_modification', 0)
on conflict(identifier) do update set enabled = true;
insert into public.organization_retention_policies(
  organization_id, evidence_class, requested_retention_days, effective_retention_days
)
select organizations.id, classes.identifier,
  classes.default_requested_retention_days, classes.default_requested_retention_days
from public.organizations organizations
join public.retention_evidence_classes classes on classes.identifier = 'substantial_modification'
on conflict(organization_id, evidence_class) do nothing;
insert into public.evidence_protection_watermarks(organization_id, evidence_class)
select organizations.id, 'substantial_modification'
from public.organizations organizations
on conflict(organization_id, evidence_class) do nothing;

-- ponytail: reason_kind='obligation' + protect_through='infinity' models an
-- open-ended "must be resolved before purge" fact -- there is no natural
-- expiry date the way an artifact has availability_until. If a dedicated
-- reason taxonomy is ever needed, extend retention_authoritative_facts_kind_check.
create or replace function public.m2_v2_set_assessment_retention_fact(
  p_assessment public.product_substantial_modification_assessments
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.retention_authoritative_facts(
    organization_id, evidence_class, reason_kind, source_record_id,
    required_retention_days, protect_through, active, last_observed_at
  ) values (
    p_assessment.organization_id, 'substantial_modification', 'obligation', p_assessment.id,
    0, 'infinity'::timestamptz,
    p_assessment.status = 'reviewed'
      and p_assessment.determination in ('potentially_substantial', 'substantial')
      and p_assessment.superseded_at is null,
    now()
  ) on conflict(organization_id, evidence_class, reason_kind, source_record_id) do update set
    active = excluded.active,
    last_observed_at = excluded.last_observed_at;
end;
$$;
alter function public.m2_v2_set_assessment_retention_fact(public.product_substantial_modification_assessments) owner to postgres;
revoke all on function public.m2_v2_set_assessment_retention_fact(public.product_substantial_modification_assessments)
from public, anon, authenticated;
grant execute on function public.m2_v2_set_assessment_retention_fact(public.product_substantial_modification_assessments)
to service_role;

create or replace function public.reassess_product_substantial_modification_atomic(
  p_organization_id uuid, p_product_id uuid, p_assessment_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_modification_identifier text, p_title text,
  p_description text, p_technical_scope text, p_introduced_at timestamptz,
  p_detected_or_assessed_at timestamptz, p_previous_state text,
  p_resulting_state text, p_required_follow_up_actions jsonb, p_answers jsonb,
  p_rationale text, p_evidence_references jsonb, p_suggestion text,
  p_release_ids uuid[], p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.product_substantial_modification_assessments%rowtype;
  v_new public.product_substantial_modification_assessments%rowtype;
  v_replay public.product_substantial_modification_assessments%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_request_digest text;
begin
  if p_idempotency_key is null or p_expected_version is null
     or not public.m2_v2_assessment_payload_complete(
       p_modification_identifier, p_title, p_description, p_technical_scope,
       p_introduced_at, p_detected_or_assessed_at, p_previous_state, p_resulting_state,
       p_required_follow_up_actions, p_answers, p_rationale
     )
     or jsonb_typeof(p_evidence_references) <> 'array'
     or char_length(btrim(p_rationale)) not between 1 and 4000
     or p_suggestion is null or p_suggestion not in ('undetermined', 'not_substantial', 'potentially_substantial')
     or cardinality(p_release_ids) is null or cardinality(p_release_ids) = 0
     or (select count(distinct release_id) from unnest(p_release_ids) release_id) <> cardinality(p_release_ids) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_old from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and product_id = p_product_id and id = p_assessment_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if exists (
    select 1 from unnest(p_release_ids) release_id
    where not exists (
      select 1 from public.product_releases
      where organization_id = p_organization_id and product_id = p_product_id and id = release_id
    )
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'reassess', 'assessmentId', p_assessment_id, 'expectedVersion', p_expected_version,
    'modificationIdentifier', btrim(p_modification_identifier), 'title', btrim(p_title),
    'description', btrim(p_description), 'technicalScope', btrim(p_technical_scope),
    'introducedAt', public.m2_utc_z(p_introduced_at),
    'detectedOrAssessedAt', public.m2_utc_z(p_detected_or_assessed_at),
    'previousState', btrim(p_previous_state), 'resultingState', btrim(p_resulting_state),
    'requiredFollowUpActions', p_required_follow_up_actions,
    'answers', p_answers, 'rationale', btrim(p_rationale),
    'evidenceReferences', p_evidence_references, 'suggestion', p_suggestion,
    'releaseIds', to_jsonb(p_release_ids)
  ));
  select * into v_replay from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'reassessed'::text, public.m2_v2_assessment_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  if v_old.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_assessment_json(v_old);
    return;
  end if;
  if v_old.superseded_at is not null then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  update public.product_substantial_modification_assessments set
    status = 'superseded', superseded_at = now(), superseded_by_id = v_new_id,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_old.id;
  v_old.status := 'superseded';
  v_old.superseded_at := now();
  perform public.m2_v2_set_assessment_retention_fact(v_old);
  insert into public.product_substantial_modification_assessments(
    id, organization_id, product_id, modification_id, supersedes_id, revision,
    modification_identifier, title, description, technical_scope, introduced_at,
    detected_or_assessed_at, previous_state, resulting_state, required_follow_up_actions,
    completeness_state, status, answers, rationale, evidence_references, policy_suggestion,
    created_by, updated_by,
    idempotency_key, idempotency_request_digest
  ) values (
    v_new_id, p_organization_id, p_product_id, v_old.modification_id, v_old.id, v_old.revision + 1,
    btrim(p_modification_identifier), btrim(p_title), btrim(p_description), btrim(p_technical_scope),
    p_introduced_at, p_detected_or_assessed_at, btrim(p_previous_state), btrim(p_resulting_state),
    p_required_follow_up_actions, 'complete', 'submitted_for_review', p_answers, btrim(p_rationale),
    p_evidence_references, p_suggestion,
    p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_new;
  insert into public.product_substantial_modification_releases(
    organization_id, assessment_id, product_id, release_id, created_by
  ) select p_organization_id, v_new.id, p_product_id, release_id, p_actor_user_id
    from unnest(p_release_ids) release_id;
  update public.product_lifecycle_dependency_facts set
    active = false, reconciled_at = now(), reconciled_by = p_actor_user_id
  where organization_id = p_organization_id and authority_kind = 'substantial_modification'
    and record_id = v_old.id and active;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.substantial_modification_reassessed',
    'product_substantial_modification_assessment', v_new.id::text,
    jsonb_build_object(
      'supersedesId', v_old.id, 'modificationId', v_new.modification_id,
      'revision', v_new.revision, 'releaseIds', to_jsonb(p_release_ids),
      'correlationId', p_correlation_id, 'requestDigest', v_request_digest
    )
  );
  return query select 'reassessed'::text, public.m2_v2_assessment_json(v_new);
end;
$$;

create or replace function public.review_product_substantial_modification_assessment_atomic(
  p_organization_id uuid, p_product_id uuid, p_assessment_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_determination text, p_determination_rationale text,
  p_override_reason text, p_correlation_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assessment public.product_substantial_modification_assessments%rowtype;
  v_release record;
begin
  if p_expected_version is null
     or p_determination not in ('undetermined', 'not_substantial', 'potentially_substantial', 'substantial')
     or char_length(btrim(p_determination_rationale)) not between 1 and 4000
     or (p_override_reason is not null and char_length(btrim(p_override_reason)) not between 1 and 1000) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_assessment from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and product_id = p_product_id and id = p_assessment_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_assessment.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_assessment_json(v_assessment);
    return;
  end if;
  if v_assessment.status <> 'submitted_for_review'
     or v_assessment.completeness_state <> 'complete'
     or not public.m2_v2_assessment_payload_complete(
       v_assessment.modification_identifier, v_assessment.title, v_assessment.description,
       v_assessment.technical_scope, v_assessment.introduced_at,
       v_assessment.detected_or_assessed_at, v_assessment.previous_state,
       v_assessment.resulting_state, v_assessment.required_follow_up_actions,
       v_assessment.answers, v_assessment.rationale
     )
     or not exists (
       select 1 from public.product_substantial_modification_releases
       where organization_id = p_organization_id and assessment_id = p_assessment_id
     ) then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  if v_assessment.policy_suggestion <> p_determination
     and char_length(btrim(coalesce(p_override_reason, ''))) = 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  update public.product_substantial_modification_assessments set
    status = 'reviewed', determination = p_determination,
    review_rationale = btrim(p_determination_rationale),
    override_reason = nullif(btrim(p_override_reason), ''), reviewed_at = now(),
    reviewed_by = p_actor_user_id, version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_assessment_id
  returning * into v_assessment;
  if p_determination in ('potentially_substantial', 'substantial') then
    for v_release in
      select release_id from public.product_substantial_modification_releases
      where organization_id = p_organization_id and assessment_id = p_assessment_id
    loop
      perform public.m2_v2_set_lifecycle_dependency_fact(
        p_organization_id, p_product_id, v_release.release_id,
        'substantial_modification', p_assessment_id, true, p_actor_user_id
      );
    end loop;
  end if;
  perform public.m2_v2_set_assessment_retention_fact(v_assessment);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.substantial_modification_reviewed',
    'product_substantial_modification_assessment', p_assessment_id::text,
    jsonb_build_object(
      'determination', p_determination,
      'overrideApplied', v_assessment.override_reason is not null,
      'correlationId', p_correlation_id
    )
  );
  return query select 'reviewed'::text, public.m2_v2_assessment_json(v_assessment);
end;
$$;

alter function public.reassess_product_substantial_modification_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, timestamptz, timestamptz, text, text,
  jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid
) owner to postgres;
alter function public.review_product_substantial_modification_assessment_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) owner to postgres;
revoke all on function
  public.reassess_product_substantial_modification_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, text, timestamptz, timestamptz, text, text,
    jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid
  ),
  public.review_product_substantial_modification_assessment_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, uuid
  )
from public, anon, authenticated;
grant execute on function
  public.reassess_product_substantial_modification_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, text, timestamptz, timestamptz, text, text,
    jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid
  ),
  public.review_product_substantial_modification_assessment_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, uuid
  )
to service_role;

-- =============================================================================
-- 2. Real storage cleanup (recheck-then-delete-then-complete)
-- =============================================================================

alter table public.product_security_update_artifacts
  add column if not exists cleanup_completed_at timestamptz,
  add column if not exists cleanup_completed_by uuid references public.users(id) on delete restrict;

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_cleanup_pair_check,
  add constraint product_security_update_artifact_cleanup_pair_check check (
    (cleanup_completed_at is null and cleanup_completed_by is null)
    or (cleanup_completed_at is not null and cleanup_completed_by is not null
        and cleanup_scheduled_at is not null)
  );

grant update (
  title, supported_platform, signature_metadata, cleanup_completed_at, cleanup_completed_by
) on table public.product_security_update_artifacts to service_role;

create or replace function public.m2_v2_guard_security_update_artifact_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array[
    'title', 'supported_platform', 'signature_metadata',
    'support_period_id', 'support_period_revision', 'upload_status', 'integrity_status', 'review_status', 'reviewed_at', 'reviewed_by',
    'review_reason', 'publication_status', 'published_at', 'published_by',
    'availability_status', 'issued_candidate_at', 'support_candidate_at',
    'availability_winning_rule', 'computed_availability_until', 'availability_until',
    'non_reduction_applied', 'availability_explanation', 'replacement_artifact_id',
    'replaced_at', 'replaced_by', 'replacement_reason', 'withdrawn_at', 'withdrawn_by',
    'withdrawal_reason', 'cleanup_scheduled_at', 'cleanup_scheduled_by',
    'cleanup_completed_at', 'cleanup_completed_by', 'version',
    'updated_at', 'updated_by'
  ]) is distinct from (to_jsonb(old) - array[
    'title', 'supported_platform', 'signature_metadata',
    'support_period_id', 'support_period_revision', 'upload_status', 'integrity_status', 'review_status', 'reviewed_at', 'reviewed_by',
    'review_reason', 'publication_status', 'published_at', 'published_by',
    'availability_status', 'issued_candidate_at', 'support_candidate_at',
    'availability_winning_rule', 'computed_availability_until', 'availability_until',
    'non_reduction_applied', 'availability_explanation', 'replacement_artifact_id',
    'replaced_at', 'replaced_by', 'replacement_reason', 'withdrawn_at', 'withdrawn_by',
    'withdrawal_reason', 'cleanup_scheduled_at', 'cleanup_scheduled_by',
    'cleanup_completed_at', 'cleanup_completed_by', 'version',
    'updated_at', 'updated_by'
  ]) then
    raise exception 'security update artifact content identity is immutable';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'security update artifact version must advance by one';
  end if;
  if new.availability_until is not null and old.availability_until is not null
     and new.availability_until < old.availability_until then
    raise exception 'security update availability cannot be reduced';
  end if;
  if new.replacement_artifact_id = new.id then
    raise exception 'security update artifact cannot replace itself';
  end if;
  return new;
end;
$$;

create or replace function public.begin_product_security_update_artifact_cleanup_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid
) returns table(outcome text, object_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_legal_hold boolean;
  v_shared boolean;
begin
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;
  if v_artifact.cleanup_completed_at is not null then
    return query select 'already_completed'::text, null::text;
    return;
  end if;
  if v_artifact.availability_status <> 'expired' and v_artifact.publication_status <> 'withdrawn' then
    return query select 'not_due'::text, null::text;
    return;
  end if;
  select exists(
    select 1 from public.retention_authoritative_facts facts
    where facts.organization_id = p_organization_id and facts.reason_kind = 'legal_hold' and facts.active
  ) into v_legal_hold;
  if v_legal_hold then
    return query select 'legal_hold'::text, null::text;
    return;
  end if;
  if v_artifact.object_key is not null then
    select exists(
      select 1 from public.product_security_update_artifacts sibling
      where sibling.organization_id = p_organization_id
        and sibling.object_key = v_artifact.object_key
        and sibling.id <> v_artifact.id
        and sibling.availability_status <> 'expired'
        and sibling.publication_status <> 'withdrawn'
    ) into v_shared;
    if v_shared then
      return query select 'shared_object'::text, null::text;
      return;
    end if;
  end if;
  return query select 'clear'::text, v_artifact.object_key;
end;
$$;

create or replace function public.complete_product_security_update_artifact_cleanup_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_object_removed boolean, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_artifact.cleanup_completed_at is not null then
    return query select 'already_completed'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  update public.product_security_update_artifacts set
    cleanup_completed_at = now(), cleanup_completed_by = p_actor_user_id,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_cleanup_completed',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('objectRemoved', p_object_removed, 'correlationId', p_correlation_id)
  );
  return query select 'completed'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.begin_security_update_artifact_cleanup_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid
) returns table(outcome text, object_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_worker_actor uuid;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id) into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::text;
    return;
  end if;
  return query select * from public.begin_product_security_update_artifact_cleanup_atomic(
    p_organization_id, p_product_id, p_artifact_id
  );
end;
$$;

create or replace function public.complete_security_update_artifact_cleanup_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_object_removed boolean,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_worker_actor uuid; v_source_updated_by uuid; v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id) into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id for share;
  select * into v_effect from public.complete_product_security_update_artifact_cleanup_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_object_removed, p_correlation_id
  );
  if v_effect.outcome = 'completed' then
    perform public.m2_v2_record_security_update_artifact_worker_effect(
      p_organization_id, p_artifact_id, v_worker_actor, v_source_updated_by, 'cleanup_completed', p_correlation_id
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

revoke all on function
  public.begin_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid),
  public.complete_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, boolean, uuid),
  public.begin_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid),
  public.complete_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, boolean, uuid)
from public, anon, authenticated;
grant execute on function
  public.begin_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid),
  public.complete_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, boolean, uuid),
  public.begin_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid),
  public.complete_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, boolean, uuid)
to service_role;

-- =============================================================================
-- 3. Post-publication integrity re-verification (authenticated_download)
-- =============================================================================

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
    'security_update_artifact.integrity_reverify'
  ));

drop index if exists product_security_update_artifact_outbox_idx;
create index product_security_update_artifact_outbox_idx
  on public.product_regulatory_outbox_events(organization_id, event_type, occurred_at, id)
  where event_type in (
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup',
    'security_update_artifact.integrity_reverify'
  );

create or replace function public.list_due_product_security_update_artifact_organizations()
returns table(organization_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select distinct event.organization_id
  from public.product_regulatory_outbox_events event
  where event.event_type in (
    'security_update_artifact.inspect',
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup',
    'security_update_artifact.external_reference_monitor',
    'security_update_artifact.integrity_reverify'
  ) and (
    (event.delivery_state in ('scheduled', 'retrying') and event.due_at <= now())
    or (event.delivery_state = 'leased' and event.lease_expires_at <= now())
  )
  order by event.organization_id
$$;

create or replace function public.reverify_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_verified_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_available boolean;
begin
  if p_expected_version is null or p_verified_outcome not in (
    'verified', 'missing', 'corrupt', 'hash_mismatch', 'type_mismatch', 'provider_unavailable'
  ) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.distribution_kind <> 'authenticated_download'
     or v_artifact.publication_status not in ('published', 'replaced') then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  v_available := p_verified_outcome = 'verified'
    and v_artifact.availability_status = 'available'
    and v_artifact.availability_until is not null
    and v_artifact.availability_until >= now();
  update public.product_security_update_artifacts set
    integrity_status = case p_verified_outcome when 'missing' then 'unavailable' else p_verified_outcome end,
    upload_status = case when p_verified_outcome = 'missing' then 'missing' else upload_status end,
    availability_status = case
      when v_artifact.availability_status = 'expired'
        or (v_artifact.availability_until is not null and v_artifact.availability_until < now()) then 'expired'
      when v_available then availability_status else 'blocked'
    end,
    availability_explanation = case
      when v_artifact.availability_status = 'expired'
        or (v_artifact.availability_until is not null and v_artifact.availability_until < now())
        then jsonb_build_object('ruleVersion', 'm2.v2.security-update-availability.v1',
          'status', 'expired', 'code', 'availability_expired')
      when v_available then availability_explanation
      else jsonb_build_object('ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'blocked', 'code', concat('integrity_', p_verified_outcome))
    end,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  perform public.m2_v2_set_lifecycle_dependency_fact(
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact', v_artifact.id, v_available, p_actor_user_id
  );
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state
  ) values (
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact.integrity_reverify',
    concat('security-update-artifact:integrity-reverify:', v_artifact.id::text,
      ':', to_char((now() + interval '7 days')::date, 'YYYYMMDD')),
    jsonb_build_object('artifactId', v_artifact.id), p_correlation_id,
    now(), now() + interval '7 days', 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id,
    'product.security_update_artifact_integrity_reverified',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('verifiedOutcome', p_verified_outcome, 'correlationId', p_correlation_id));
  return query select 'reverified'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.reverify_security_update_artifact_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_verified_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_worker_actor uuid; v_source_updated_by uuid; v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id) into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb; return;
  end if;
  select updated_by into v_source_updated_by from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id for share;
  select * into v_effect from public.reverify_product_security_update_artifact_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_verified_outcome, p_correlation_id
  );
  if v_effect.outcome = 'reverified' then
    perform public.m2_v2_record_security_update_artifact_worker_effect(
      p_organization_id, p_artifact_id, v_worker_actor, v_source_updated_by, 'integrity_reverify', p_correlation_id
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

-- Schedule the first reverify cycle for authenticated_download artifacts on
-- publish, mirroring the existing external_reference_monitor scheduling.
create or replace function public.publish_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_published_external_references jsonb, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_issued_candidate timestamptz;
  v_computed timestamptz;
  v_winner text;
  v_distribution_reference text;
begin
  if p_expected_version is null or jsonb_typeof(p_published_external_references) <> 'array' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.publication_status <> 'draft' or v_artifact.review_status <> 'cleared'
     or v_artifact.upload_status <> 'finalized' or v_artifact.integrity_status <> 'verified' then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, v_artifact.release_id
  );
  if not found or v_support.id <> v_artifact.support_period_id
     or v_artifact.issued_at < v_support.support_starts_at
     or v_artifact.issued_at > v_support.support_ends_at then
    update public.product_security_update_artifacts set
      availability_status = 'blocked', availability_explanation = jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1', 'status', 'blocked',
        'code', 'support_period_missing_or_changed'
      ), version = version + 1, updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_publish_blocked',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('code', 'support_period_missing_or_changed', 'correlationId', p_correlation_id));
    return query select 'blocked'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  if v_artifact.distribution_kind = 'authenticated_download'
     and jsonb_array_length(p_published_external_references) <> 0 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if v_artifact.distribution_kind = 'external_reference' then
    if jsonb_array_length(p_published_external_references) = 0
       or not public.m2_v2_valid_published_external_references(p_published_external_references)
       or p_published_external_references <> v_artifact.published_external_references then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
    select reference->>'uri' into v_distribution_reference
    from jsonb_array_elements(v_artifact.published_external_references) reference
    limit 1;
    if v_distribution_reference is null then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
  end if;
  v_issued_candidate := public.m2_v2_availability_candidate(v_artifact.issued_at);
  v_computed := greatest(v_issued_candidate, v_support.support_ends_at);
  v_winner := case when v_issued_candidate = v_support.support_ends_at then 'equal'
    when v_issued_candidate > v_support.support_ends_at then 'issued_at_plus_10_calendar_years'
    else 'support_period_end' end;
  update public.product_security_update_artifacts set
    publication_status = 'published', published_at = now(), published_by = p_actor_user_id,
    availability_status = 'available', issued_candidate_at = v_issued_candidate,
    support_candidate_at = v_support.support_ends_at, availability_winning_rule = v_winner,
    computed_availability_until = v_computed,
    availability_until = greatest(coalesce(availability_until, '-infinity'::timestamptz), v_computed),
    non_reduction_applied = coalesce(availability_until, '-infinity'::timestamptz) > v_computed,
    availability_explanation = jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1', 'status', 'current',
      'issuedCandidate', public.m2_utc_z(v_issued_candidate),
      'supportCandidate', public.m2_utc_z(v_support.support_ends_at), 'winningRule', v_winner
    ), distribution_reference = v_distribution_reference,
    published_external_references = case when v_artifact.distribution_kind = 'external_reference'
      then v_artifact.published_external_references else p_published_external_references end,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  perform public.m2_v2_set_lifecycle_dependency_fact(
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact', v_artifact.id, true, p_actor_user_id
  );
  perform public.m2_v2_set_artifact_retention_fact(v_artifact);
  if v_artifact.distribution_kind = 'external_reference' then
    insert into public.product_regulatory_outbox_events(
      organization_id, product_id, release_id, event_type, event_key, payload,
      correlation_id, occurred_at, delivery_state
    ) values (
      p_organization_id, p_product_id, v_artifact.release_id,
      'security_update_artifact.external_reference_monitor',
      concat('security-update-artifact:external-reference-monitor:', v_artifact.id::text),
      jsonb_build_object('artifactId', v_artifact.id), p_correlation_id, now(), 'scheduled'
    ) on conflict(organization_id, event_key) do nothing;
  else
    insert into public.product_regulatory_outbox_events(
      organization_id, product_id, release_id, event_type, event_key, payload,
      correlation_id, occurred_at, due_at, delivery_state
    ) values (
      p_organization_id, p_product_id, v_artifact.release_id,
      'security_update_artifact.integrity_reverify',
      concat('security-update-artifact:integrity-reverify:', v_artifact.id::text,
        ':', to_char((now() + interval '7 days')::date, 'YYYYMMDD')),
      jsonb_build_object('artifactId', v_artifact.id), p_correlation_id,
      now(), now() + interval '7 days', 'scheduled'
    ) on conflict(organization_id, event_key) do nothing;
  end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_published',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('availabilityUntil', public.m2_utc_z(v_artifact.availability_until),
      'distributionKind', v_artifact.distribution_kind,
      'externalReferenceCount', jsonb_array_length(v_artifact.published_external_references),
      'correlationId', p_correlation_id));
  return query select 'published'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

revoke all on function
  public.reverify_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.reverify_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.reverify_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.reverify_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, uuid)
to service_role;

-- =============================================================================
-- 4. Metrics: upload-failure gauge, quarantine now includes type_mismatch
-- =============================================================================

-- Postgres refuses to CREATE OR REPLACE a function when the OUT-parameter
-- row shape changes (new artifact_upload_failed column) -- drop then recreate.
drop function if exists public.product_compliance_metrics_snapshot(uuid);

create function public.product_compliance_metrics_snapshot(
  p_organization_id uuid
)
returns table(
  assessment_backlog bigint,
  flagged_assessments bigint,
  artifact_quarantine bigint,
  artifact_hash_mismatch bigint,
  artifact_provider_unavailable bigint,
  artifact_upload_missing bigint,
  artifact_upload_failed bigint,
  artifact_expiring_availability bigint,
  artifact_availability_blocked bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_organization_id is null then
    raise exception 'organization id is required'
      using errcode = '22023';
  end if;

  return query
    select
      (select count(*)
        from public.product_substantial_modification_assessments assessments
        where assessments.organization_id = p_organization_id
          and assessments.superseded_at is null
          and assessments.status = 'submitted_for_review'),
      (select count(*)
        from public.product_substantial_modification_assessments assessments
        where assessments.organization_id = p_organization_id
          and assessments.superseded_at is null
          and assessments.determination in ('substantial', 'potentially_substantial')),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.integrity_status in ('corrupt', 'type_mismatch')),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.integrity_status = 'hash_mismatch'),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.integrity_status in ('unavailable', 'provider_unavailable')),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.upload_status = 'missing'),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.upload_status = 'failed'),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.publication_status = 'published'
          and artifacts.availability_status = 'available'
          and artifacts.availability_until is not null
          and artifacts.availability_until > now()
          and artifacts.availability_until <= now() + interval '30 days'),
      (select count(*)
        from public.product_security_update_artifacts artifacts
        where artifacts.organization_id = p_organization_id
          and artifacts.availability_status = 'blocked');
end;
$$;

revoke execute on function public.product_compliance_metrics_snapshot(uuid) from public;
revoke execute on function public.product_compliance_metrics_snapshot(uuid) from anon;
revoke execute on function public.product_compliance_metrics_snapshot(uuid) from authenticated;
grant execute on function public.product_compliance_metrics_snapshot(uuid) to service_role;

-- =============================================================================
-- 5. Artifact metadata edit (title / supported platform / signature metadata)
-- =============================================================================

create or replace function public.update_product_security_update_artifact_metadata_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_title text, p_supported_platform text,
  p_signature_metadata jsonb, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_before jsonb;
begin
  if p_expected_version is null
     or char_length(btrim(p_title)) not between 1 and 200
     or char_length(btrim(p_supported_platform)) not between 1 and 500
     or jsonb_typeof(p_signature_metadata) <> 'object' then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  if v_artifact.publication_status = 'withdrawn' then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  v_before := jsonb_build_object(
    'title', v_artifact.title, 'supportedPlatform', v_artifact.supported_platform,
    'signatureMetadata', v_artifact.signature_metadata
  );
  update public.product_security_update_artifacts set
    title = btrim(p_title), supported_platform = btrim(p_supported_platform),
    signature_metadata = coalesce(p_signature_metadata, '{}'::jsonb),
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_metadata_updated',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object('title', v_artifact.title, 'supportedPlatform', v_artifact.supported_platform,
        'signatureMetadata', v_artifact.signature_metadata),
      'correlationId', p_correlation_id
    )
  );
  return query select 'updated'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

revoke all on function
  public.update_product_security_update_artifact_metadata_atomic(uuid, uuid, uuid, uuid, integer, text, text, jsonb, uuid)
from public, anon, authenticated;
grant execute on function
  public.update_product_security_update_artifact_metadata_atomic(uuid, uuid, uuid, uuid, integer, text, text, jsonb, uuid)
to service_role;
