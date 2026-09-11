-- Repair the already-applied local M5 migration without resetting development
-- data. Fresh environments receive the corrected definitions in the original
-- migration; this forward migration keeps existing installations equivalent.

drop trigger if exists set_vulnerability_triage_saved_views_updated_at
  on public.vulnerability_triage_saved_views;
create trigger set_vulnerability_triage_saved_views_updated_at
  before update on public.vulnerability_triage_saved_views
  for each row execute function public.set_updated_at();

drop trigger if exists set_vulnerability_triage_saved_view_defaults_updated_at
  on public.vulnerability_triage_saved_view_defaults;
create trigger set_vulnerability_triage_saved_view_defaults_updated_at
  before update on public.vulnerability_triage_saved_view_defaults
  for each row execute function public.set_updated_at();

alter function public.create_finding_saved_view_atomic(uuid, uuid, text, jsonb, text, text, uuid, uuid)
  set search_path = public, extensions, pg_temp;
alter function public.update_finding_saved_view_atomic(uuid, uuid, uuid, integer, text, jsonb, text, text, uuid, uuid)
  set search_path = public, extensions, pg_temp;
alter function public.delete_finding_saved_view_atomic(uuid, uuid, uuid, integer, uuid, uuid)
  set search_path = public, extensions, pg_temp;
alter function public.set_finding_saved_view_default_atomic(uuid, uuid, uuid, uuid, uuid)
  set search_path = public, extensions, pg_temp;
alter function public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text) volatile;

create or replace function public.create_finding_saved_view_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_name text, p_filters jsonb,
  p_sort text, p_order text, p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_digest text; v_existing record; v_view public.vulnerability_triage_saved_views%rowtype; v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_idempotency_key is null or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or jsonb_typeof(p_filters) <> 'object'
     or p_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss') or p_order not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('name', btrim(p_name), 'filters', p_filters,
    'sort', p_sort, 'order', p_order)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'create', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  begin
    insert into public.vulnerability_triage_saved_views(
      organization_id, name, filters, sort_key, sort_order, created_by, updated_by
    ) values (p_organization_id, btrim(p_name), p_filters, p_sort, p_order, p_actor_user_id, p_actor_user_id)
    returning * into v_view;
  exception when unique_violation then
    return query select 'name_conflict'::text, null::jsonb; return;
  end;
  v_result := jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
    'defaultViewId', (select saved_view_id from public.vulnerability_triage_saved_view_defaults
      where organization_id = p_organization_id and user_id = p_actor_user_id));
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'create', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_created',
    'vulnerability_triage_saved_view', v_view.id::text,
    jsonb_build_object('after', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
      'correlationId', p_correlation_id, 'idempotencyKey', p_idempotency_key));
  return query select 'created'::text, v_result;
end;
$$;

create or replace function public.update_finding_saved_view_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_saved_view_id uuid, p_expected_version integer,
  p_name text, p_filters jsonb, p_sort text, p_order text, p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_digest text; v_existing record; v_view public.vulnerability_triage_saved_views%rowtype; v_before jsonb; v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_saved_view_id is null or p_idempotency_key is null or p_expected_version is null or p_expected_version < 1
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 or jsonb_typeof(p_filters) <> 'object'
     or p_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss') or p_order not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('id', p_saved_view_id, 'version', p_expected_version,
    'name', btrim(p_name), 'filters', p_filters, 'sort', p_sort, 'order', p_order)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'update', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_view from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_view.version <> p_expected_version then
    return query select 'version_conflict'::text,
      jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id)); return;
  end if;
  v_before := public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id);
  begin
    update public.vulnerability_triage_saved_views views
    set name = btrim(p_name), filters = p_filters, sort_key = p_sort, sort_order = p_order,
      version = views.version + 1, updated_by = p_actor_user_id, updated_at = clock_timestamp()
    where views.organization_id = p_organization_id and views.id = p_saved_view_id returning * into v_view;
  exception when unique_violation then
    return query select 'name_conflict'::text, null::jsonb; return;
  end;
  v_result := jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
    'defaultViewId', (select saved_view_id from public.vulnerability_triage_saved_view_defaults
      where organization_id = p_organization_id and user_id = p_actor_user_id));
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'update', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_updated',
    'vulnerability_triage_saved_view', v_view.id::text,
    jsonb_build_object('before', v_before, 'after', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
      'correlationId', p_correlation_id, 'idempotencyKey', p_idempotency_key));
  return query select 'updated'::text, v_result;
end;
$$;

create or replace function public.delete_finding_saved_view_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_saved_view_id uuid, p_expected_version integer,
  p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_digest text; v_existing record; v_view public.vulnerability_triage_saved_views%rowtype; v_before jsonb; v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_saved_view_id is null or p_idempotency_key is null or p_expected_version is null or p_expected_version < 1 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('id', p_saved_view_id, 'version', p_expected_version)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'delete', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_view from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_view.version <> p_expected_version then
    return query select 'version_conflict'::text,
      jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id),
        'defaultViewId', (select saved_view_id from public.vulnerability_triage_saved_view_defaults
          where organization_id = p_organization_id and user_id = p_actor_user_id)); return;
  end if;
  v_before := public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id);
  delete from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id;
  v_result := jsonb_build_object('view', null, 'defaultViewId',
    (select saved_view_id from public.vulnerability_triage_saved_view_defaults
      where organization_id = p_organization_id and user_id = p_actor_user_id));
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'delete', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_deleted',
    'vulnerability_triage_saved_view', p_saved_view_id::text,
    jsonb_build_object('before', v_before, 'correlationId', p_correlation_id,
      'idempotencyKey', p_idempotency_key));
  return query select 'deleted'::text, v_result;
end;
$$;

create or replace function public.set_finding_saved_view_default_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_saved_view_id uuid, p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_digest text; v_existing record; v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id) or p_idempotency_key is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('savedViewId', p_saved_view_id)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'set_default', v_digest);
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  if p_saved_view_id is not null and not exists (
    select 1 from public.vulnerability_triage_saved_views views
    where views.organization_id = p_organization_id and views.id = p_saved_view_id
  ) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  insert into public.vulnerability_triage_saved_view_defaults(
    organization_id, user_id, saved_view_id, updated_at
  ) values (p_organization_id, p_actor_user_id, p_saved_view_id, clock_timestamp())
  on conflict (organization_id, user_id) do update
    set saved_view_id = excluded.saved_view_id, updated_at = excluded.updated_at;
  v_result := jsonb_build_object('view', case when p_saved_view_id is null then null
      else public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id) end,
    'defaultViewId', p_saved_view_id);
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'set_default', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_default_set',
    'vulnerability_triage_saved_view_default', p_actor_user_id::text,
    jsonb_build_object('savedViewId', p_saved_view_id, 'correlationId', p_correlation_id,
      'idempotencyKey', p_idempotency_key));
  return query select 'updated'::text, v_result;
end;
$$;

create or replace function public.get_finding_triage_detail(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_finding public.vulnerability_findings%rowtype; v_document_id uuid;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id) or p_finding_id is null then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_finding from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active';
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select occurrences.document_id into v_document_id
  from public.vulnerability_finding_component_occurrences links
  join public.vulnerability_component_occurrences occurrences
    on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
  where links.organization_id = p_organization_id and links.finding_id = p_finding_id and links.state = 'active'
  order by occurrences.id limit 1;
  return query select 'found'::text, jsonb_build_object(
    'finding', jsonb_build_object(
      'id', findings.id, 'releaseId', findings.release_id, 'productId', products.id,
      'productName', products.name, 'releaseName', releases.label,
      'componentIdentity', findings.component_identity, 'advisoryId', findings.canonical_advisory_id,
      'vulnerabilityId', findings.vulnerability_id, 'matchMethod', findings.match_method,
      'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
      'evaluatedComponentValue', findings.evaluated_component_value, 'affectedRange', findings.affected_range,
      'eventSequence', findings.event_sequence, 'confidence', findings.confidence,
      'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
      'lastEvaluatedAt', findings.last_evaluated_at, 'humanAssessment', case when findings.human_verdict is null then null else
        jsonb_build_object('verdict', findings.human_verdict, 'rationale', findings.human_rationale,
          'assessedByUserId', findings.human_assessed_by, 'assessedAt', findings.human_assessed_at) end,
      'reevaluationState', findings.reevaluation_state,
      'intelligence', public.m4_03_intelligence_with_provenance_json(findings.vulnerability_id, findings.last_evaluated_at)
    ),
    'componentOccurrences', coalesce((select jsonb_agg(jsonb_build_object(
      'componentId', occurrences.component_id, 'documentId', occurrences.document_id,
      'purl', occurrences.canonical_purl, 'version', occurrences.component_version,
      'identity', occurrences.component_identity
    ) order by occurrences.id) from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      where links.organization_id = p_organization_id and links.finding_id = findings.id and links.state = 'active'), '[]'::jsonb),
    'reachability', case when v_document_id is null then null else (
      select evidence.result from public.get_vulnerability_finding_reachability_evidence(
        p_organization_id, p_actor_user_id, v_document_id, findings.id, false
      ) evidence
    ) end,
    'advisoryReview', case when v_document_id is null then null else (
      select review.result from public.get_vulnerability_finding_advisory_review(
        p_organization_id, p_actor_user_id, v_document_id, findings.id
      ) review
    ) end,
    'history', coalesce((select history_row.result -> 'items' from public.list_vulnerability_finding_reevaluation_history(
      p_organization_id, p_actor_user_id, v_document_id, findings.id, 1, 100
    ) history_row), '[]'::jsonb),
    'relatedFindings', coalesce((select jsonb_agg(jsonb_build_object(
      'id', related.id, 'productId', related_products.id, 'productName', related_products.name,
      'releaseId', related.release_id, 'releaseName', related_releases.label,
      'componentIdentity', related.component_identity, 'advisoryId', related.canonical_advisory_id,
      'firstDetectedAt', related.first_detected_at
    ) order by related.last_evaluated_at desc, related.id desc)
      from public.vulnerability_findings related
      join public.product_releases related_releases on related_releases.organization_id = related.organization_id and related_releases.id = related.release_id
      join public.products related_products on related_products.organization_id = related_releases.organization_id and related_products.id = related_releases.product_id
      where related.organization_id = p_organization_id and related.status = 'active'
        and related.vulnerability_id = findings.vulnerability_id and related.id <> findings.id), '[]'::jsonb)
  ) from public.vulnerability_findings findings
  join public.product_releases releases on releases.organization_id = findings.organization_id and releases.id = findings.release_id
  join public.products products on products.organization_id = releases.organization_id and products.id = releases.product_id
  where findings.organization_id = p_organization_id and findings.id = p_finding_id;
end;
$$;

alter function public.get_finding_triage_detail(uuid, uuid, uuid) owner to postgres;
revoke all on function public.get_finding_triage_detail(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_finding_triage_detail(uuid, uuid, uuid) to service_role;
