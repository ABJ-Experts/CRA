-- Forward-only M2 V2 hardening for external security-update artifacts and
-- restart-safe workers. It adds no tables: the original three-table migration
-- remains the durable record source.

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_distribution_check,
  add constraint product_security_update_artifact_distribution_check check (
    (distribution_kind = 'authenticated_download' and object_key is not null
      and distribution_reference is null
      and jsonb_array_length(published_external_references) = 0)
    or (distribution_kind = 'external_reference' and object_key is null
      and distribution_reference is not null
      and distribution_reference ~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$'
      and distribution_reference !~* '(signature|token|x-amz-)'
      and jsonb_array_length(published_external_references) > 0
      and public.m2_v2_valid_published_external_references(published_external_references))
  );

create or replace function public.m2_v2_guard_security_update_artifact_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array[
    'support_period_id', 'support_period_revision', 'upload_status', 'integrity_status', 'review_status', 'reviewed_at', 'reviewed_by',
    'review_reason', 'publication_status', 'published_at', 'published_by',
    'availability_status', 'issued_candidate_at', 'support_candidate_at',
    'availability_winning_rule', 'computed_availability_until', 'availability_until',
    'non_reduction_applied', 'availability_explanation', 'replacement_artifact_id',
    'replaced_at', 'replaced_by', 'replacement_reason', 'withdrawn_at', 'withdrawn_by',
    'withdrawal_reason', 'cleanup_scheduled_at', 'cleanup_scheduled_by', 'version',
    'updated_at', 'updated_by'
  ]) is distinct from (to_jsonb(old) - array[
    'support_period_id', 'support_period_revision', 'upload_status', 'integrity_status', 'review_status', 'reviewed_at', 'reviewed_by',
    'review_reason', 'publication_status', 'published_at', 'published_by',
    'availability_status', 'issued_candidate_at', 'support_candidate_at',
    'availability_winning_rule', 'computed_availability_until', 'availability_until',
    'non_reduction_applied', 'availability_explanation', 'replacement_artifact_id',
    'replaced_at', 'replaced_by', 'replacement_reason', 'withdrawn_at', 'withdrawn_by',
    'withdrawal_reason', 'cleanup_scheduled_at', 'cleanup_scheduled_by', 'version',
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


create or replace function public.m2_v2_resolve_security_update_artifact_worker_actor(
  p_organization_id uuid
) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  select member.user_id
  from public.organization_members member
  join public.users user_record on user_record.id = member.user_id and user_record.is_active
  where member.organization_id = p_organization_id and member.role in ('owner', 'admin')
  order by case member.role when 'owner' then 0 else 1 end, member.user_id
  limit 1
$$;

create or replace function public.m2_v2_record_security_update_artifact_worker_effect(
  p_organization_id uuid, p_artifact_id uuid, p_worker_actor uuid,
  p_source_updated_by uuid, p_operation text, p_correlation_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_worker_actor,
    'product.security_update_artifact_worker_effect_authorized',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('operation', p_operation, 'workerActorId', p_worker_actor,
      'sourceUpdatedBy', p_source_updated_by, 'correlationId', p_correlation_id)
  );
end;
$$;

create or replace function public.finalize_product_security_update_artifact_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_verified_sha256 text, p_verified_byte_size bigint,
  p_verified_content_type text, p_integrity_status text, p_correlation_id uuid
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
  select * into v_effect from public.finalize_product_security_update_artifact_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_verified_sha256, p_verified_byte_size, p_verified_content_type, p_integrity_status, p_correlation_id
  );
  if v_effect.outcome = 'finalized' then
    perform public.m2_v2_record_security_update_artifact_worker_effect(
      p_organization_id, p_artifact_id, v_worker_actor, v_source_updated_by, 'inspect', p_correlation_id
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.recalc_security_update_artifact_availability_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_correlation_id uuid
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
  select * into v_effect from public.recalc_product_security_update_artifact_availability_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_correlation_id
  );
  if v_effect.outcome in ('recalculated', 'blocked') then
    perform public.m2_v2_record_security_update_artifact_worker_effect(
      p_organization_id, p_artifact_id, v_worker_actor, v_source_updated_by,
      'availability_recalculate', p_correlation_id
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.schedule_security_update_artifact_cleanup_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_correlation_id uuid
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
  select * into v_effect from public.schedule_product_security_update_artifact_cleanup_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_correlation_id
  );
  if v_effect.outcome = 'scheduled' then
    perform public.m2_v2_record_security_update_artifact_worker_effect(
      p_organization_id, p_artifact_id, v_worker_actor, v_source_updated_by, 'cleanup', p_correlation_id
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.monitor_security_update_external_reference_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_monitor_outcome text, p_correlation_id uuid
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
  select * into v_effect from public.monitor_product_security_update_external_reference_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_monitor_outcome, p_correlation_id
  );
  if v_effect.outcome = 'monitored' then
    perform public.m2_v2_record_security_update_artifact_worker_effect(
      p_organization_id, p_artifact_id, v_worker_actor, v_source_updated_by,
      'external_reference_monitor', p_correlation_id
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.review_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_review_decision text, p_review_reason text,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if p_expected_version is null or p_review_decision not in ('cleared', 'rejected')
     or char_length(btrim(p_review_reason)) not between 1 and 1000 then
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
  if v_artifact.review_status <> 'pending_review'
     or (p_review_decision = 'cleared' and (
       v_artifact.upload_status <> 'finalized' or v_artifact.integrity_status <> 'verified'
     )) then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  update public.product_security_update_artifacts set
    review_status = p_review_decision, reviewed_at = now(), reviewed_by = p_actor_user_id,
    review_reason = btrim(p_review_reason), version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_reviewed',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('reviewDecision', p_review_decision, 'correlationId', p_correlation_id));
  return query select 'reviewed'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.finalize_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_verified_sha256 text, p_verified_byte_size bigint,
  p_verified_content_type text, p_integrity_status text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if p_expected_version is null or p_integrity_status not in (
    'verified', 'hash_mismatch', 'type_mismatch', 'corrupt', 'unavailable', 'provider_unavailable'
  ) or (p_integrity_status = 'verified' and (
    p_verified_sha256 !~ '^[a-f0-9]{64}$'
    or p_verified_byte_size is null or char_length(btrim(p_verified_content_type)) = 0
  )) or (p_integrity_status <> 'verified' and (
    p_verified_sha256 is not null or p_verified_byte_size is not null or p_verified_content_type is not null
  )) then
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
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    if v_artifact.upload_status = 'finalized' and v_artifact.integrity_status = p_integrity_status then
      return query select 'finalized'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    end if;
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  if (v_artifact.distribution_kind = 'authenticated_download'
      and v_artifact.upload_status not in ('reserved', 'uploaded'))
     or (v_artifact.distribution_kind = 'external_reference'
      and v_artifact.upload_status <> 'reserved') then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  if v_artifact.distribution_kind = 'authenticated_download' and not exists (
    select 1 from storage.objects
    where bucket_id = 'security-update-artifacts' and name = v_artifact.object_key
  ) then
    p_integrity_status := 'unavailable';
  end if;
  if p_integrity_status = 'verified' and (
    p_verified_sha256 <> v_artifact.sha256 or p_verified_byte_size <> v_artifact.byte_size
    or btrim(p_verified_content_type) <> v_artifact.content_type
  ) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  update public.product_security_update_artifacts set
    upload_status = case when p_integrity_status = 'verified' then 'finalized' else 'failed' end,
    integrity_status = p_integrity_status, version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  update public.product_regulatory_outbox_events set
    delivery_state = 'delivered', delivered_at = now(), lease_owner = null, lease_expires_at = null
  where organization_id = p_organization_id and event_type = 'security_update_artifact.inspect'
    and payload->>'artifactId' = p_artifact_id::text
    and delivery_state in ('scheduled', 'leased', 'retrying');
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_finalized',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('integrityStatus', p_integrity_status, 'correlationId', p_correlation_id));
  return query select 'finalized'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

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

revoke update (distribution_reference, published_external_references)
on public.product_security_update_artifacts from service_role;

create or replace function public.schedule_product_security_update_artifact_cleanup_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.availability_status <> 'expired'
     and v_artifact.availability_until is not null
     and v_artifact.availability_until < now() then
    update public.product_security_update_artifacts set
      availability_status = 'expired', version = version + 1,
      availability_explanation = jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'expired', 'code', 'availability_expired'
      ), updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    perform public.m2_v2_set_lifecycle_dependency_fact(
      p_organization_id, p_product_id, v_artifact.release_id,
      'security_update_artifact', v_artifact.id, false, p_actor_user_id
    );
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_availability_expired',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('correlationId', p_correlation_id));
  end if;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state
  ) values (
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact.cleanup', concat('security-update-artifact:cleanup:', v_artifact.id::text),
    jsonb_build_object('artifactId', v_artifact.id), p_correlation_id, now(),
    greatest(now(), coalesce(v_artifact.availability_until, now())), 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;
  if v_artifact.cleanup_scheduled_at is null then
    update public.product_security_update_artifacts set cleanup_scheduled_at = now(),
      cleanup_scheduled_by = p_actor_user_id, version = version + 1, updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_cleanup_scheduled',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('dueAt', public.m2_utc_z(greatest(now(), coalesce(v_artifact.availability_until, now()))),
        'correlationId', p_correlation_id));
  end if;
  return query select 'scheduled'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.monitor_product_security_update_external_reference_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_monitor_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_integrity_status text;
  v_available boolean;
begin
  if p_expected_version is null or p_monitor_outcome not in (
    'verified', 'external_content_changed', 'unavailable', 'provider_unavailable'
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
  if v_artifact.distribution_kind <> 'external_reference'
     or v_artifact.publication_status not in ('published', 'replaced') then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  v_available := p_monitor_outcome = 'verified'
    and v_artifact.availability_status = 'available'
    and v_artifact.availability_until is not null
    and v_artifact.availability_until >= now();
  v_integrity_status := case p_monitor_outcome
    when 'verified' then 'verified'
    when 'external_content_changed' then 'corrupt'
    else p_monitor_outcome
  end;
  update public.product_security_update_artifacts set
    integrity_status = v_integrity_status,
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
        'status', 'blocked', 'code', p_monitor_outcome)
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
    'security_update_artifact.external_reference_monitor',
    concat('security-update-artifact:external-reference-monitor:', v_artifact.id::text,
      ':', to_char((now() + interval '1 day')::date, 'YYYYMMDD')),
    jsonb_build_object('artifactId', v_artifact.id), p_correlation_id,
    now(), now() + interval '1 day', 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id,
    'product.security_update_artifact_external_reference_monitored',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('monitorOutcome', p_monitor_outcome, 'correlationId', p_correlation_id));
  return query select 'monitored'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.reserve_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_update_version text, p_title text, p_artifact_type text, p_supported_platform text,
  p_signature_metadata jsonb, p_distribution_kind text,
  p_validated_external_references jsonb, p_file_name text,
  p_content_type text, p_byte_size bigint, p_sha256 text, p_issued_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_replay public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_artifact_id uuid := gen_random_uuid();
  v_object_key text;
  v_distribution_reference text;
  v_request_digest text;
  v_support_eligible boolean := false;
begin
  if p_idempotency_key is null
     or char_length(btrim(p_update_version)) not between 1 and 200
     or char_length(btrim(p_title)) not between 1 and 200
     or p_artifact_type not in ('software_update', 'firmware_update', 'security_advisory')
     or char_length(btrim(p_supported_platform)) not between 1 and 500
     or jsonb_typeof(p_signature_metadata) <> 'object'
     or p_distribution_kind not in ('authenticated_download', 'external_reference')
     or jsonb_typeof(p_validated_external_references) <> 'array'
     or char_length(btrim(p_file_name)) not between 1 and 255
     or char_length(btrim(p_content_type)) not between 1 and 255
     or p_byte_size not between 1 and 2147483647
     or p_sha256 !~ '^[a-f0-9]{64}$' or p_issued_at is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found or not exists (
    select 1 from public.product_releases
    where organization_id = p_organization_id and product_id = p_product_id and id = p_release_id
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, p_release_id
  );
  v_support_eligible := found and p_issued_at >= v_support.support_starts_at
    and p_issued_at <= v_support.support_ends_at;
  if p_distribution_kind = 'authenticated_download'
     and jsonb_array_length(p_validated_external_references) <> 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if p_distribution_kind = 'external_reference' then
    if jsonb_array_length(p_validated_external_references) = 0
       or not public.m2_v2_valid_published_external_references(p_validated_external_references) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
    select reference->>'uri' into v_distribution_reference
    from jsonb_array_elements(p_validated_external_references) reference
    limit 1;
    if v_distribution_reference is null then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'reserve_artifact', 'productId', p_product_id, 'releaseId', p_release_id,
    'updateVersion', btrim(p_update_version), 'title', btrim(p_title),
    'artifactType', p_artifact_type, 'supportedPlatform', btrim(p_supported_platform),
    'signatureMetadata', p_signature_metadata, 'distributionKind', p_distribution_kind,
    'validatedExternalReferences', p_validated_external_references,
    'fileName', btrim(p_file_name), 'contentType', btrim(p_content_type),
    'byteSize', p_byte_size, 'sha256', p_sha256, 'issuedAt', public.m2_utc_z(p_issued_at)
  ));
  select * into v_replay from public.product_security_update_artifacts
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_replay, true);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  v_object_key := case when p_distribution_kind = 'authenticated_download'
    then concat(p_organization_id::text, '/', v_artifact_id::text, '/', p_sha256)
    else null end;
  insert into public.product_security_update_artifacts(
    id, organization_id, product_id, release_id, support_period_id, support_period_revision,
    update_version, title, artifact_type, supported_platform, signature_metadata,
    distribution_kind, distribution_reference, published_external_references,
    file_name, content_type, byte_size, sha256, object_key, issued_at,
    upload_status, integrity_status, availability_status, availability_explanation,
    created_by, updated_by, idempotency_key, idempotency_request_digest
  ) values (
    v_artifact_id, p_organization_id, p_product_id, p_release_id,
    case when v_support_eligible then v_support.id else null end,
    case when v_support_eligible then v_support.scope_revision else null end,
    btrim(p_update_version), btrim(p_title), p_artifact_type,
    btrim(p_supported_platform), p_signature_metadata, p_distribution_kind,
    v_distribution_reference, p_validated_external_references,
    btrim(p_file_name), btrim(p_content_type), p_byte_size, p_sha256, v_object_key,
    p_issued_at, 'reserved', 'pending',
    case when v_support_eligible then 'pending' else 'blocked' end,
    jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1',
      'status', case when v_support_eligible then 'pending' else 'blocked' end,
      'code', case when v_support_eligible then 'awaiting_publication'
        when v_support.id is null then 'missing_support_period'
        else 'issued_at_outside_current_support_period' end
    ), p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_artifact;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state
  ) values (
    p_organization_id, p_product_id, p_release_id, 'security_update_artifact.inspect',
    concat('security-update-artifact:inspect:', v_artifact.id::text),
    jsonb_build_object('artifactId', v_artifact.id, 'distributionKind', p_distribution_kind),
    p_correlation_id, now(), 'scheduled'
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_reserved',
    'product_security_update_artifact', v_artifact.id::text,
    jsonb_build_object('releaseId', p_release_id, 'distributionKind', p_distribution_kind,
      'externalReferenceCount', jsonb_array_length(p_validated_external_references),
      'correlationId', p_correlation_id, 'requestDigest', v_request_digest)
  );
  return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_artifact, true);
end;
$$;

alter function public.m2_v2_guard_security_update_artifact_update() owner to postgres;
alter function public.m2_v2_resolve_security_update_artifact_worker_actor(uuid) owner to postgres;
alter function public.m2_v2_record_security_update_artifact_worker_effect(uuid, uuid, uuid, uuid, text, uuid) owner to postgres;
alter function public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid) owner to postgres;
alter function public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid) owner to postgres;
alter function public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;
alter function public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid) owner to postgres;
alter function public.schedule_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid) owner to postgres;
alter function public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid) owner to postgres;
alter function public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid) owner to postgres;

revoke all on function
  public.m2_v2_guard_security_update_artifact_update(),
  public.m2_v2_resolve_security_update_artifact_worker_actor(uuid),
  public.m2_v2_record_security_update_artifact_worker_effect(uuid, uuid, uuid, uuid, text, uuid),
  public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid),
  public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid),
  public.schedule_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, uuid),
  public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid),
  public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid),
  public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid),
  public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid),
  public.schedule_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, uuid),
  public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid),
  public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid),
  public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid)
to service_role;
