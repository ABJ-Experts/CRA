-- CRA-M4-03: immutable feed evidence is projected at read time while the
-- tenant-owned KEV ledger retains only safe, actionable escalation facts.
-- No raw SBOM content, credentials, or regulatory submission payload can be
-- persisted here.

create table public.vulnerability_kev_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  release_id uuid not null,
  triggering_finding_id uuid not null references public.vulnerability_findings(id) on delete restrict,
  vulnerability_id uuid not null references public.vulnerabilities(id) on delete restrict,
  kev_source_record_id uuid not null references public.vulnerability_source_records(id) on delete restrict,
  kev_source_record_version_id uuid not null references public.vulnerability_source_record_versions(id) on delete restrict,
  kev_listing_date date,
  lifecycle_state text not null check (lifecycle_state in (
    'placed_on_market', 'in_support'
  )),
  material_fingerprint text not null check (material_fingerprint ~ '^[a-f0-9]{64}$'),
  severity text not null default 'high' check (severity = 'high'),
  state text not null default 'new' check (state in ('new', 'acknowledged', 'resolved')),
  resolution_reason text check (resolution_reason is null or resolution_reason in (
    'kev_removed_or_disputed', 'kev_material_change', 'lifecycle_not_applicable', 'finding_no_longer_active'
  )),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id) on delete set null,
  reporting_status text not null default 'not_requested' check (reporting_status in (
    'not_requested', 'downstream_unavailable', 'linked'
  )),
  reporting_intent_opened_at timestamptz,
  reporting_intent_opened_by uuid references public.users(id) on delete set null,
  external_obligation_id text check (external_obligation_id is null or char_length(btrim(external_obligation_id)) between 1 and 300),
  delivery_status text not null default 'queued' check (delivery_status in (
    'queued', 'leased', 'retrying', 'delivered', 'dead_letter'
  )),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  max_delivery_attempts integer not null default 12 check (max_delivery_attempts between 1 and 20),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  last_delivery_error_code text check (last_delivery_error_code is null or last_delivery_error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  last_delivery_error_message text check (last_delivery_error_message is null or char_length(btrim(last_delivery_error_message)) between 1 and 1000),
  delivered_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, release_id, vulnerability_id, material_fingerprint),
  foreign key (organization_id, release_id)
    references public.product_releases(organization_id, id) on delete cascade,
  check ((lease_owner is null) = (lease_expires_at is null)),
  check ((state = 'resolved') = (resolved_at is not null)),
  check ((acknowledged_at is null) = (acknowledged_by is null)),
  check ((reporting_intent_opened_at is null) = (reporting_intent_opened_by is null)),
  check ((reporting_status = 'linked') = (external_obligation_id is not null)),
  check (reporting_status <> 'linked' or reporting_intent_opened_at is not null),
  check (delivery_status <> 'leased' or lease_owner is not null),
  check (delivery_status = 'leased' or lease_owner is null)
);

create index vulnerability_kev_alerts_release_state_idx
  on public.vulnerability_kev_alerts(organization_id, release_id, state, created_at desc, id desc);
create index vulnerability_kev_alerts_delivery_due_idx
  on public.vulnerability_kev_alerts(organization_id, created_at, id)
  where delivery_status in ('queued', 'retrying');
create index vulnerability_kev_alerts_expired_lease_idx
  on public.vulnerability_kev_alerts(organization_id, lease_expires_at, id)
  where delivery_status = 'leased';

alter table public.vulnerability_kev_alerts enable row level security;
revoke all on table public.vulnerability_kev_alerts from public, anon, authenticated;
revoke all on table public.vulnerability_kev_alerts from service_role;
grant select, insert, update on table public.vulnerability_kev_alerts to service_role;

drop trigger if exists set_vulnerability_kev_alerts_updated_at on public.vulnerability_kev_alerts;
create trigger set_vulnerability_kev_alerts_updated_at
before update on public.vulnerability_kev_alerts
for each row execute function public.set_updated_at();

-- Current, promoted CISA evidence is the sole legal exploitation trigger.
-- EPSS stays outside this function by design; it can be rendered as priority
-- context but can never cause a KEV escalation.
create or replace function public.m4_03_current_kev_evidence(
  p_vulnerability_id uuid
) returns table(
  source_record_id uuid,
  source_record_version_id uuid,
  listing_date date,
  material_fingerprint text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select records.id,
    versions.id,
    coalesce(records.source_updated_at, versions.source_updated_at, versions.promoted_at)::date,
    encode(extensions.digest(concat_ws('|', records.id::text, versions.id::text,
      records.record_state, coalesce(records.source_updated_at, versions.source_updated_at, versions.promoted_at)::text,
      enrichments.enrichment::text), 'sha256'), 'hex')
  from public.vulnerability_source_records records
  join public.vulnerability_source_record_versions versions
    on versions.id = records.current_version_id
  join public.vulnerability_enrichments enrichments
    on enrichments.source_record_version_id = versions.id
    and enrichments.feed_key = 'cisa_kev'
    and enrichments.enrichment_type = 'kev'
    and enrichments.enrichment -> 'value' = 'true'::jsonb
  where records.feed_key = 'cisa_kev'
    and records.vulnerability_id = p_vulnerability_id
    and records.record_state = 'active';
$$;

create or replace function public.reconcile_vulnerability_kev_alerts_for_release(
  p_organization_id uuid,
  p_release_id uuid
) returns table(outcome text, created_count integer, resolved_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lifecycle text;
  v_created integer := 0;
  v_resolved integer := 0;
begin
  if p_organization_id is null or p_release_id is null then
    return query select 'invalid_request'::text, 0, 0;
    return;
  end if;

  select releases.lifecycle into v_lifecycle
  from public.product_releases releases
  where releases.organization_id = p_organization_id and releases.id = p_release_id
  for share;
  if not found then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;

  if v_lifecycle in ('placed_on_market', 'in_support') then
    with eligible as (
      select min(findings.id::text)::uuid as triggering_finding_id, findings.vulnerability_id, evidence.source_record_id,
        evidence.source_record_version_id, evidence.listing_date, evidence.material_fingerprint
      from public.vulnerability_findings findings
      join public.m4_03_current_kev_evidence(findings.vulnerability_id) evidence on true
      where findings.organization_id = p_organization_id
        and findings.release_id = p_release_id
        and findings.status = 'active'
      group by findings.vulnerability_id, evidence.source_record_id,
        evidence.source_record_version_id, evidence.listing_date, evidence.material_fingerprint
    ), inserted as (
      insert into public.vulnerability_kev_alerts(
        organization_id, release_id, triggering_finding_id, vulnerability_id, kev_source_record_id,
        kev_source_record_version_id, kev_listing_date, lifecycle_state,
        material_fingerprint
      )
      select p_organization_id, p_release_id, eligible.triggering_finding_id, eligible.vulnerability_id,
        eligible.source_record_id, eligible.source_record_version_id,
        eligible.listing_date, v_lifecycle, eligible.material_fingerprint
      from eligible
      on conflict (organization_id, release_id, vulnerability_id, material_fingerprint) do nothing
      returning id, vulnerability_id, kev_source_record_id, kev_source_record_version_id,
        kev_listing_date, lifecycle_state, material_fingerprint
    )
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    select p_organization_id, 'vulnerability.kev_alert_raised', 'vulnerability_kev_alert',
      inserted.id::text,
      jsonb_build_object('releaseId', p_release_id, 'vulnerabilityId', inserted.vulnerability_id,
        'severity', 'high', 'lifecycleState', inserted.lifecycle_state,
        'kevSourceRecordId', inserted.kev_source_record_id,
        'kevSourceRecordVersionId', inserted.kev_source_record_version_id,
        'kevListingDate', inserted.kev_listing_date,
        'materialFingerprint', inserted.material_fingerprint)
    from inserted;
    get diagnostics v_created = row_count;

    with eligible as (
      select distinct findings.vulnerability_id, evidence.material_fingerprint
      from public.vulnerability_findings findings
      join public.m4_03_current_kev_evidence(findings.vulnerability_id) evidence on true
      where findings.organization_id = p_organization_id
        and findings.release_id = p_release_id and findings.status = 'active'
    ), resolved as (
      update public.vulnerability_kev_alerts alerts
      set state = 'resolved', resolved_at = clock_timestamp(),
        resolution_reason = case when exists (
          select 1 from eligible where eligible.vulnerability_id = alerts.vulnerability_id
        ) then 'kev_material_change' else 'kev_removed_or_disputed' end,
        lease_owner = null, lease_expires_at = null,
        delivery_status = case when alerts.delivery_status = 'leased' then 'retrying' else alerts.delivery_status end
      where alerts.organization_id = p_organization_id and alerts.release_id = p_release_id
        and alerts.state <> 'resolved'
        and not exists (
          select 1 from eligible
          where eligible.vulnerability_id = alerts.vulnerability_id
            and eligible.material_fingerprint = alerts.material_fingerprint
        )
      returning alerts.id, alerts.vulnerability_id, alerts.resolution_reason
    )
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    select p_organization_id, 'vulnerability.kev_alert_resolved', 'vulnerability_kev_alert',
      resolved.id::text,
      jsonb_build_object('releaseId', p_release_id, 'vulnerabilityId', resolved.vulnerability_id,
        'resolutionReason', resolved.resolution_reason)
    from resolved;
    get diagnostics v_resolved = row_count;
  else
    with resolved as (
      update public.vulnerability_kev_alerts alerts
      set state = 'resolved', resolved_at = clock_timestamp(),
        resolution_reason = 'lifecycle_not_applicable', lease_owner = null,
        lease_expires_at = null,
        delivery_status = case when alerts.delivery_status = 'leased' then 'retrying' else alerts.delivery_status end
      where alerts.organization_id = p_organization_id and alerts.release_id = p_release_id
        and alerts.state <> 'resolved'
      returning alerts.id, alerts.vulnerability_id
    )
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    select p_organization_id, 'vulnerability.kev_alert_resolved', 'vulnerability_kev_alert',
      resolved.id::text,
      jsonb_build_object('releaseId', p_release_id, 'vulnerabilityId', resolved.vulnerability_id,
        'resolutionReason', 'lifecycle_not_applicable')
    from resolved;
    get diagnostics v_resolved = row_count;
  end if;
  return query select 'reconciled'::text, v_created, v_resolved;
end;
$$;

create or replace function public.m4_03_reconcile_kev_alert_after_finding_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform public.reconcile_vulnerability_kev_alerts_for_release(old.organization_id, old.release_id);
  else
    perform public.reconcile_vulnerability_kev_alerts_for_release(new.organization_id, new.release_id);
    if tg_op = 'UPDATE' and old.release_id is distinct from new.release_id then
      perform public.reconcile_vulnerability_kev_alerts_for_release(old.organization_id, old.release_id);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists reconcile_kev_alert_after_finding_change on public.vulnerability_findings;
create trigger reconcile_kev_alert_after_finding_change
after insert or update of release_id, vulnerability_id, status or delete
on public.vulnerability_findings
for each row execute function public.m4_03_reconcile_kev_alert_after_finding_change();

create or replace function public.m4_03_reconcile_kev_alert_after_release_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or old.lifecycle is distinct from new.lifecycle then
    perform public.reconcile_vulnerability_kev_alerts_for_release(new.organization_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_kev_alert_after_release_change on public.product_releases;
create trigger reconcile_kev_alert_after_release_change
after insert or update of lifecycle on public.product_releases
for each row execute function public.m4_03_reconcile_kev_alert_after_release_change();

create or replace function public.m4_03_reconcile_kev_alert_after_kev_source_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare row_item record;
begin
  if new.feed_key = 'cisa_kev' then
    for row_item in
      select distinct findings.organization_id, findings.release_id
      from public.vulnerability_findings findings
      where findings.vulnerability_id = new.vulnerability_id
    loop
      perform public.reconcile_vulnerability_kev_alerts_for_release(
        row_item.organization_id, row_item.release_id
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_kev_alert_after_kev_source_change on public.vulnerability_source_records;
create trigger reconcile_kev_alert_after_kev_source_change
after insert or update of current_version_id, record_state on public.vulnerability_source_records
for each row execute function public.m4_03_reconcile_kev_alert_after_kev_source_change();

-- Promotion first advances the current-version pointer and only then inserts
-- normalized enrichment rows. Reconcile again after CISA KEV evidence lands
-- so a brand-new listing cannot be missed because of that intentional order.
create or replace function public.m4_03_reconcile_kev_alert_after_enrichment_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare row_item record;
begin
  if new.feed_key = 'cisa_kev' and new.enrichment_type = 'kev'
     and new.enrichment -> 'value' = 'true'::jsonb then
    for row_item in
      select distinct findings.organization_id, findings.release_id
      from public.vulnerability_findings findings
      where findings.vulnerability_id = new.vulnerability_id
    loop
      perform public.reconcile_vulnerability_kev_alerts_for_release(
        row_item.organization_id, row_item.release_id
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_kev_alert_after_enrichment_change on public.vulnerability_enrichments;
create trigger reconcile_kev_alert_after_enrichment_change
after insert on public.vulnerability_enrichments
for each row execute function public.m4_03_reconcile_kev_alert_after_enrichment_change();

create or replace function public.list_vulnerability_enriched_findings_for_document_page(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_document_id uuid,
  p_include_low_confidence boolean,
  p_page integer default 1,
  p_page_size integer default 50,
  p_q text default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer := 0; v_findings jsonb := '[]'::jsonb; v_alerts jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null
     or p_include_low_confidence is null or p_page not between 1 and 1000000
     or p_page_size not between 1 and 100
     or p_q is not null and char_length(btrim(p_q)) > 200
     or not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
     or not exists (select 1 from public.sbom_documents documents
       where documents.organization_id = p_organization_id and documents.id = p_document_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  with base as (
    select distinct findings.id, findings.release_id, findings.vulnerability_id,
      findings.canonical_advisory_id, findings.confidence, findings.confidence_table_version,
      findings.confidence_explanation, findings.first_detected_at, findings.last_evaluated_at,
      findings.source_feed_key, findings.source_record_id, findings.source_record_version_id,
      findings.affected_range_id, findings.match_method, findings.comparator_name,
      findings.comparator_version, findings.evaluated_component_value, findings.affected_range,
      findings.event_sequence,
      occurrences.component_id, occurrences.canonical_purl, occurrences.component_version
    from public.vulnerability_findings findings
    join public.vulnerability_finding_component_occurrences links
      on links.finding_id = findings.id and links.organization_id = findings.organization_id
      and links.state = 'active'
    join public.vulnerability_component_occurrences occurrences
      on occurrences.id = links.occurrence_id and occurrences.organization_id = findings.organization_id
    where findings.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and findings.status = 'active'
      and (p_include_low_confidence or findings.confidence >= 0.9)
      and (p_q is null or concat_ws(' ', findings.canonical_advisory_id,
        occurrences.canonical_purl, occurrences.component_version) ilike '%' || btrim(p_q) || '%')
  ), counted as (
    select base.*, count(*) over () as total_count from base
  ), paged as (
    select * from counted order by confidence desc, id
    offset (p_page - 1) * p_page_size limit p_page_size
  )
  select coalesce((select max(total_count)::integer from counted), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', paged.id, 'releaseId', paged.release_id, 'componentId', paged.component_id,
      'componentPurl', paged.canonical_purl, 'componentVersion', paged.component_version,
      'advisoryId', paged.canonical_advisory_id, 'vulnerabilityId', paged.vulnerability_id,
      'confidence', paged.confidence, 'confidenceTableVersion', paged.confidence_table_version,
      'confidenceExplanation', paged.confidence_explanation,
      'firstDetectedAt', paged.first_detected_at, 'lastEvaluatedAt', paged.last_evaluated_at,
      'sourceFeedKey', paged.source_feed_key, 'sourceRecordId', paged.source_record_id,
      'sourceRecordVersionId', paged.source_record_version_id,
      'affectedRangeId', paged.affected_range_id, 'matchMethod', paged.match_method,
      'comparator', jsonb_build_object('name', paged.comparator_name, 'version', paged.comparator_version),
      'evaluatedComponentValue', paged.evaluated_component_value,
      'affectedRange', paged.affected_range, 'eventSequence', paged.event_sequence,
      'enrichmentObservations', coalesce((select jsonb_agg(jsonb_build_object(
        'field', enrichments.enrichment_type, 'value', enrichments.enrichment -> 'value',
        'sourceFeedKey', records.feed_key, 'sourceRecordId', records.id,
        'sourceRecordVersionId', versions.id, 'sourceObservedAt',
          coalesce(records.source_updated_at, versions.source_updated_at),
        'retrievedAt', versions.promoted_at, 'recordState', records.record_state,
        'freshnessState', configs.freshness_state
      ) order by records.feed_key, enrichments.enrichment_type, versions.promoted_at desc, versions.id)
      from public.vulnerability_source_records records
      join public.vulnerability_source_record_versions versions on versions.id = records.current_version_id
      join public.vulnerability_enrichments enrichments on enrichments.source_record_version_id = versions.id
      join public.vulnerability_feed_configs configs on configs.feed_key = records.feed_key
      where records.vulnerability_id = paged.vulnerability_id), '[]'::jsonb),
      'aliases', coalesce((select jsonb_agg(jsonb_build_object(
        'alias', aliases.alias, 'sourceRecordVersionId', aliases.source_record_version_id,
        'sourceFeedKey', records.feed_key, 'sourceObservedAt',
          coalesce(records.source_updated_at, versions.source_updated_at), 'retrievedAt', versions.promoted_at
      ) order by aliases.alias, aliases.source_record_version_id)
      from public.vulnerability_aliases aliases
      join public.vulnerability_source_record_versions versions on versions.id = aliases.source_record_version_id
      join public.vulnerability_source_records records on records.id = versions.source_record_id
        and records.current_version_id = versions.id
      where aliases.vulnerability_id = paged.vulnerability_id), '[]'::jsonb),
      'references', coalesce((select jsonb_agg(jsonb_build_object(
        'url', refs.reference_url, 'type', refs.reference_type,
        'sourceRecordVersionId', refs.source_record_version_id, 'sourceFeedKey', records.feed_key,
        'sourceObservedAt', coalesce(records.source_updated_at, versions.source_updated_at),
        'retrievedAt', versions.promoted_at
      ) order by refs.reference_url, refs.source_record_version_id)
      from public.vulnerability_references refs
      join public.vulnerability_source_record_versions versions on versions.id = refs.source_record_version_id
      join public.vulnerability_source_records records on records.id = versions.source_record_id
        and records.current_version_id = versions.id
      where refs.vulnerability_id = paged.vulnerability_id), '[]'::jsonb)
    ) order by paged.confidence desc, paged.id), '[]'::jsonb)
  into v_total, v_findings from paged;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', alerts.id, 'findingId', alerts.triggering_finding_id, 'releaseId', alerts.release_id,
    'productName', products.name, 'releaseName', releases.label, 'vulnerabilityId', alerts.vulnerability_id,
    'severity', alerts.severity, 'state', alerts.state, 'lifecycleState', alerts.lifecycle_state,
    'kevSourceRecordId', alerts.kev_source_record_id,
    'kevSourceRecordVersionId', alerts.kev_source_record_version_id,
    'kevListingDate', alerts.kev_listing_date, 'materialFingerprint', alerts.material_fingerprint,
    'createdAt', alerts.created_at,
    'acknowledgedAt', alerts.acknowledged_at, 'reportingStatus', alerts.reporting_status,
    'externalObligationId', alerts.external_obligation_id, 'deliveryStatus', alerts.delivery_status,
    'lastDeliveryErrorCode', alerts.last_delivery_error_code,
    'resolvedAt', alerts.resolved_at, 'resolutionReason', alerts.resolution_reason
  ) order by alerts.created_at desc, alerts.id), '[]'::jsonb)
  into v_alerts
  from public.vulnerability_kev_alerts alerts
  join public.product_releases releases on releases.organization_id = alerts.organization_id
    and releases.id = alerts.release_id
  join public.products products on products.organization_id = releases.organization_id
    and products.id = releases.product_id
  where alerts.organization_id = p_organization_id
    and exists (
      select 1 from public.vulnerability_component_occurrences occurrences
      where occurrences.organization_id = p_organization_id and occurrences.document_id = p_document_id
        and occurrences.release_id = alerts.release_id
    );

  return query select 'found'::text,
    jsonb_build_object('findings', v_findings, 'alerts', v_alerts, 'total', v_total);
end;
$$;

-- API remains the complete custom-role resolver. This database defense-in-depth
-- check mirrors the edit-capable base roles and the organization-level hard
-- override, so a stale or revoked session cannot act through a service client.
create or replace function public.m4_03_actor_can_edit_findings(
  p_organization_id uuid, p_actor_user_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id and users.is_active
    left join public.base_role_permission_overrides overrides
      on overrides.organization_id = members.organization_id and overrides.base_role = members.role
    where members.organization_id = p_organization_id and members.user_id = p_actor_user_id
      and members.role in ('owner', 'admin')
      and coalesce(case when jsonb_typeof(overrides.permissions -> 'can_edit_findings') = 'boolean'
        then (overrides.permissions ->> 'can_edit_findings')::boolean end, true)
  );
$$;

create or replace function public.acknowledge_vulnerability_kev_alert_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid, p_alert_id uuid
) returns table(outcome text, alert jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alert public.vulnerability_kev_alerts%rowtype;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_alert_id is null
     or not public.m4_03_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_alert from public.vulnerability_kev_alerts alerts
  where alerts.organization_id = p_organization_id and alerts.id = p_alert_id
    and exists (
      select 1 from public.vulnerability_findings findings
      join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
        and links.organization_id = findings.organization_id and links.state = 'active'
      join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
        and occurrences.organization_id = findings.organization_id
      where findings.organization_id = p_organization_id and findings.release_id = alerts.release_id
        and findings.vulnerability_id = alerts.vulnerability_id and findings.status = 'active'
        and occurrences.document_id = p_document_id
    ) for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_alert.state = 'resolved' then return query select 'invalid_state'::text, null::jsonb; return; end if;
  if v_alert.acknowledged_at is null then
    update public.vulnerability_kev_alerts set state = 'acknowledged',
      acknowledged_at = clock_timestamp(), acknowledged_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_alert_id returning * into v_alert;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'vulnerability.kev_alert_acknowledged',
      'vulnerability_kev_alert', p_alert_id::text,
      jsonb_build_object('releaseId', v_alert.release_id, 'vulnerabilityId', v_alert.vulnerability_id));
  end if;
  return query select 'acknowledged'::text, jsonb_build_object(
    'id', v_alert.id, 'state', v_alert.state, 'acknowledgedAt', v_alert.acknowledged_at,
    'reportingStatus', v_alert.reporting_status
  );
end;
$$;

create or replace function public.record_vulnerability_kev_reporting_intent_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid, p_alert_id uuid,
  p_reporting_status text, p_external_obligation_id text default null
) returns table(outcome text, alert jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alert public.vulnerability_kev_alerts%rowtype;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_alert_id is null
     or p_reporting_status not in ('downstream_unavailable', 'linked')
     or (p_reporting_status = 'linked' and char_length(btrim(coalesce(p_external_obligation_id, ''))) not between 1 and 300)
     or (p_reporting_status <> 'linked' and p_external_obligation_id is not null)
     or not public.m4_03_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_alert from public.vulnerability_kev_alerts alerts
  where alerts.organization_id = p_organization_id and alerts.id = p_alert_id
    and exists (
      select 1 from public.vulnerability_findings findings
      join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
        and links.organization_id = findings.organization_id and links.state = 'active'
      join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
        and occurrences.organization_id = findings.organization_id
      where findings.organization_id = p_organization_id and findings.release_id = alerts.release_id
        and findings.vulnerability_id = alerts.vulnerability_id and findings.status = 'active'
        and occurrences.document_id = p_document_id
    ) for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_alert.state = 'resolved' then return query select 'invalid_state'::text, null::jsonb; return; end if;
  update public.vulnerability_kev_alerts set reporting_status = p_reporting_status,
    external_obligation_id = case when p_reporting_status = 'linked' then btrim(p_external_obligation_id) else null end,
    reporting_intent_opened_at = clock_timestamp(), reporting_intent_opened_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_alert_id returning * into v_alert;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.kev_reporting_intent_recorded',
    'vulnerability_kev_alert', p_alert_id::text,
    jsonb_build_object('releaseId', v_alert.release_id, 'vulnerabilityId', v_alert.vulnerability_id,
      'reportingStatus', v_alert.reporting_status,
      'externalObligationId', v_alert.external_obligation_id));
  return query select 'recorded'::text, jsonb_build_object(
    'id', v_alert.id, 'reportingStatus', v_alert.reporting_status,
    'externalObligationId', v_alert.external_obligation_id,
    'reportingIntentOpenedAt', v_alert.reporting_intent_opened_at
  );
end;
$$;

create or replace function public.list_due_vulnerability_kev_alert_organizations(
  p_limit integer default 100
) returns table(organization_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct alerts.organization_id
  from public.vulnerability_kev_alerts alerts
  where (alerts.delivery_status in ('queued', 'retrying')
      or (alerts.delivery_status = 'leased' and alerts.lease_expires_at <= clock_timestamp()))
    and alerts.state <> 'resolved'
  order by alerts.organization_id
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

create or replace function public.claim_vulnerability_kev_alert_delivery(
  p_organization_id uuid, p_worker_id text, p_lease_seconds integer default 120
) returns table(outcome text, alert jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alert public.vulnerability_kev_alerts%rowtype;
begin
  if p_organization_id is null or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 100
     or p_lease_seconds not between 10 and 3600 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  select * into v_alert from public.vulnerability_kev_alerts alerts
  where alerts.organization_id = p_organization_id and alerts.state <> 'resolved'
    and (alerts.delivery_status in ('queued', 'retrying')
      or (alerts.delivery_status = 'leased' and alerts.lease_expires_at <= clock_timestamp()))
  order by alerts.created_at, alerts.id for update skip locked limit 1;
  if not found then return query select 'none_due'::text, null::jsonb; return; end if;
  update public.vulnerability_kev_alerts set delivery_status = 'leased',
    delivery_attempts = delivery_attempts + 1, lease_owner = btrim(p_worker_id),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where organization_id = p_organization_id and id = v_alert.id returning * into v_alert;
  return query select 'claimed'::text, jsonb_build_object(
    'id', v_alert.id, 'releaseId', v_alert.release_id, 'vulnerabilityId', v_alert.vulnerability_id,
    'severity', v_alert.severity, 'state', v_alert.state, 'lifecycleState', v_alert.lifecycle_state,
    'kevListingDate', v_alert.kev_listing_date, 'deliveryAttempts', v_alert.delivery_attempts
  );
end;
$$;

create or replace function public.complete_vulnerability_kev_alert_delivery(
  p_organization_id uuid, p_alert_id uuid, p_worker_id text,
  p_delivered boolean, p_error_code text default null, p_error_message text default null
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alert public.vulnerability_kev_alerts%rowtype;
begin
  if p_organization_id is null or p_alert_id is null
     or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 100
     or p_delivered is null
     or (not p_delivered and (btrim(coalesce(p_error_code, '')) !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
       or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000)) then
    return query select 'invalid_request'::text; return;
  end if;
  select * into v_alert from public.vulnerability_kev_alerts alerts
  where alerts.organization_id = p_organization_id and alerts.id = p_alert_id for update;
  if not found then return query select 'not_found'::text; return; end if;
  if v_alert.delivery_status <> 'leased' or v_alert.lease_owner <> btrim(p_worker_id)
     or v_alert.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text; return;
  end if;
  if p_delivered then
    update public.vulnerability_kev_alerts set delivery_status = 'delivered', delivered_at = clock_timestamp(),
      lease_owner = null, lease_expires_at = null, last_delivery_error_code = null, last_delivery_error_message = null
    where organization_id = p_organization_id and id = p_alert_id;
    return query select 'delivered'::text;
  end if;
  update public.vulnerability_kev_alerts set delivery_status = case when delivery_attempts >= max_delivery_attempts
      then 'dead_letter' else 'retrying' end,
    lease_owner = null, lease_expires_at = null, last_delivery_error_code = btrim(p_error_code),
    last_delivery_error_message = btrim(p_error_message)
  where organization_id = p_organization_id and id = p_alert_id;
  return query select case when v_alert.delivery_attempts >= v_alert.max_delivery_attempts
    then 'dead_letter' else 'retry_scheduled' end;
end;
$$;

-- M4-02 regression: reject all explicitly-invalid pages before the original
-- persistence function can create occurrences or evaluations. Renaming keeps
-- its established worker semantics private while this wrapper owns validation.
alter function public.persist_vulnerability_match_page_atomic(
  uuid, uuid, text, integer, jsonb, jsonb, boolean
) rename to persist_vulnerability_match_page_atomic_unchecked;

create or replace function public.persist_vulnerability_match_page_atomic(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_expected_checkpoint_version integer, p_processed_component_ids jsonb,
  p_results jsonb, p_is_final boolean
) returns table(outcome text, processed_count integer, matched_count integer,
  reviewable_count integer, superseded_count integer, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_document_id uuid; v_snapshot_sequence bigint; v_invalid boolean := false;
begin
  if p_organization_id is null or p_job_id is null
     or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_expected_checkpoint_version is null
     or jsonb_typeof(p_processed_component_ids) <> 'array'
     or jsonb_typeof(p_results) <> 'array' or p_is_final is null then
    return query select 'invalid_request'::text, 0, 0, 0, 0, null::integer; return;
  end if;
  begin
    if exists (select 1 from jsonb_array_elements(p_processed_component_ids) item where jsonb_typeof(item) <> 'string')
       or (select count(*) from jsonb_array_elements_text(p_processed_component_ids))
          <> (select count(distinct value::uuid) from jsonb_array_elements_text(p_processed_component_ids)) then
      v_invalid := true;
    end if;
  exception when invalid_text_representation then v_invalid := true;
  end;
  if v_invalid or exists (select 1 from jsonb_array_elements(p_results) item where jsonb_typeof(item) <> 'object') then
    return query select 'invalid_request'::text, 0, 0, 0, 0, null::integer; return;
  end if;
  select jobs.document_id, jobs.osv_promotion_sequence into v_document_id, v_snapshot_sequence
  from public.vulnerability_match_jobs jobs where jobs.organization_id = p_organization_id and jobs.id = p_job_id;
  if not found then return query select 'not_found'::text, 0, 0, 0, 0, null::integer; return; end if;
  begin
    with processed as (
      select value::uuid as component_id from jsonb_array_elements_text(p_processed_component_ids)
    ), items as (
      select * from jsonb_to_recordset(p_results) as x(
        "componentId" uuid, "outcome" text, "reviewCode" text, "affectedRangeId" uuid,
        "sourceRecordId" uuid, "sourceRecordVersionId" uuid, "vulnerabilityId" uuid,
        "canonicalAdvisoryId" text, "matchMethod" text, "comparatorName" text,
        "comparatorVersion" text, "evaluatedComponentValue" text, "affectedRange" jsonb,
        "eventSequence" jsonb, "evaluatedAt" timestamptz, "confidence" numeric,
        "confidenceTableVersion" text, "confidenceExplanation" text
      )
    ) select exists (
      select 1 from items
      left join processed on processed.component_id = items."componentId"
      left join public.sbom_components components on components.id = items."componentId"
        and components.organization_id = p_organization_id and components.document_id = v_document_id
      where processed.component_id is null or components.id is null or nullif(btrim(components.canonical_purl), '') is null
        or items."outcome" not in ('affected', 'not_affected', 'reviewable')
        or coalesce(items."matchMethod", 'purl_osv') <> 'purl_osv'
        or char_length(coalesce(items."evaluatedComponentValue", '')) not between 1 and 1024
        or (items."outcome" = 'reviewable' and coalesce(items."reviewCode", '') not in (
          'unsupported_ecosystem','purl_ecosystem_mismatch','invalid_purl','unparseable_version','unsupported_range'))
        or (items."outcome" in ('affected','not_affected') and not exists (
          select 1 from public.vulnerability_feed_snapshot_source_records snapshots
          join public.vulnerability_affected_ranges ranges on ranges.id = items."affectedRangeId"
            and ranges.source_record_version_id = snapshots.source_record_version_id
          where snapshots.feed_key = 'osv' and snapshots.promotion_sequence = v_snapshot_sequence
            and snapshots.source_record_id = items."sourceRecordId"
            and snapshots.source_record_version_id = items."sourceRecordVersionId"
            and snapshots.vulnerability_id = items."vulnerabilityId" and snapshots.record_state = 'active'))
        or (items."outcome" = 'affected' and (
          char_length(btrim(coalesce(items."canonicalAdvisoryId", ''))) not between 1 and 300
          or items."confidence" is null or items."confidence" < 0 or items."confidence" > 1
          or char_length(btrim(coalesce(items."confidenceTableVersion", ''))) not between 1 and 100
          or char_length(btrim(coalesce(items."confidenceExplanation", ''))) not between 1 and 1000
          or items."affectedRange" is null or jsonb_typeof(items."affectedRange") not in ('object','array')
          or items."eventSequence" is null or jsonb_typeof(items."eventSequence") <> 'array'
          or char_length(btrim(coalesce(items."comparatorName", ''))) not between 1 and 100
          or char_length(btrim(coalesce(items."comparatorVersion", ''))) not between 1 and 100))
    ) into v_invalid;
  exception when invalid_text_representation or invalid_datetime_format then v_invalid := true;
  end;
  if v_invalid then return query select 'invalid_request'::text, 0, 0, 0, 0, null::integer; return; end if;
  return query select * from public.persist_vulnerability_match_page_atomic_unchecked(
    p_organization_id, p_job_id, p_lease_owner, p_expected_checkpoint_version,
    p_processed_component_ids, p_results, p_is_final);
end;
$$;

-- M4-02 regression: compute the total before paging. A page beyond the end
-- retains the filtered cardinality instead of falsely reporting zero.
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
      'componentVersion', occurrences.component_version, 'advisoryId', findings.canonical_advisory_id,
      'sourceFeedKey', findings.source_feed_key, 'sourceRecordId', findings.source_record_id,
      'sourceRecordVersionId', findings.source_record_version_id, 'affectedRangeId', findings.affected_range_id,
      'outcome', 'affected', 'matchMethod', findings.match_method,
      'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
      'affectedRange', findings.affected_range, 'eventSequence', findings.event_sequence,
      'confidence', findings.confidence, 'confidenceTableVersion', findings.confidence_table_version,
      'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
      'lastEvaluatedAt', findings.last_evaluated_at) as payload,
      findings.confidence as confidence, 0 as kind, findings.id as result_id,
      concat_ws(' ', findings.canonical_advisory_id, occurrences.canonical_purl, occurrences.component_version) as search_text
    from public.vulnerability_findings findings
    join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
      and links.organization_id = findings.organization_id and links.state = 'active'
    join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
      and occurrences.organization_id = findings.organization_id
    where findings.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and findings.status = 'active' and (p_include_low_confidence or findings.confidence >= 0.9)
  ), reviewable as (
    select jsonb_build_object('id', evaluations.id, 'releaseId', occurrences.release_id,
      'componentId', occurrences.component_id, 'componentPurl', occurrences.canonical_purl,
      'componentVersion', coalesce(nullif(occurrences.component_version, ''), 'unknown'),
      'outcome', 'reviewable', 'reviewCode', evaluations.review_code, 'matchMethod', evaluations.match_method,
      'comparatorName', evaluations.comparator_name, 'comparatorVersion', evaluations.comparator_version,
      'sourceFeedKey', evaluations.source_feed_key, 'sourceRecordId', evaluations.source_record_id,
      'sourceRecordVersionId', evaluations.source_record_version_id, 'affectedRangeId', evaluations.affected_range_id,
      'evaluatedAt', evaluations.evaluated_at) as payload, 0::numeric as confidence, 1 as kind,
      evaluations.id as result_id,
      concat_ws(' ', evaluations.review_code, occurrences.canonical_purl, occurrences.component_version) as search_text
    from public.vulnerability_match_evaluations evaluations
    join latest_completed_job latest on latest.id = evaluations.match_job_id
    join public.vulnerability_component_occurrences occurrences on occurrences.id = evaluations.occurrence_id
      and occurrences.organization_id = evaluations.organization_id
    where evaluations.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and evaluations.outcome = 'reviewable' and p_include_reviewable
  ), results as (select * from affected union all select * from reviewable), filtered as (
    select * from results where p_q is null or search_text ilike '%' || btrim(p_q) || '%'
  ), paged as (
    select * from filtered order by kind, confidence desc, result_id
    offset (p_page - 1) * p_page_size limit p_page_size
  )
  select (select count(*)::integer from filtered),
    coalesce((select jsonb_agg(payload order by kind, confidence desc, result_id) from paged), '[]'::jsonb)
  into v_total, v_results;
  return query select 'found'::text, jsonb_build_object('results', v_results, 'total', v_total);
end;
$$;

alter function public.m4_03_current_kev_evidence(uuid) owner to postgres;
alter function public.reconcile_vulnerability_kev_alerts_for_release(uuid, uuid) owner to postgres;
alter function public.m4_03_reconcile_kev_alert_after_finding_change() owner to postgres;
alter function public.m4_03_reconcile_kev_alert_after_release_change() owner to postgres;
alter function public.m4_03_reconcile_kev_alert_after_kev_source_change() owner to postgres;
alter function public.m4_03_reconcile_kev_alert_after_enrichment_change() owner to postgres;
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid, uuid, uuid, boolean, integer, integer, text) owner to postgres;
alter function public.m4_03_actor_can_edit_findings(uuid, uuid) owner to postgres;
alter function public.acknowledge_vulnerability_kev_alert_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.record_vulnerability_kev_reporting_intent_atomic(uuid, uuid, uuid, uuid, text, text) owner to postgres;
alter function public.list_due_vulnerability_kev_alert_organizations(integer) owner to postgres;
alter function public.claim_vulnerability_kev_alert_delivery(uuid, text, integer) owner to postgres;
alter function public.complete_vulnerability_kev_alert_delivery(uuid, uuid, text, boolean, text, text) owner to postgres;
alter function public.persist_vulnerability_match_page_atomic_unchecked(uuid, uuid, text, integer, jsonb, jsonb, boolean) owner to postgres;
alter function public.persist_vulnerability_match_page_atomic(uuid, uuid, text, integer, jsonb, jsonb, boolean) owner to postgres;
alter function public.list_vulnerability_match_results_for_document_page(uuid, uuid, uuid, boolean, boolean, integer, integer, text) owner to postgres;

revoke all on function
  public.m4_03_current_kev_evidence(uuid),
  public.reconcile_vulnerability_kev_alerts_for_release(uuid, uuid),
  public.list_vulnerability_enriched_findings_for_document_page(uuid, uuid, uuid, boolean, integer, integer, text),
  public.m4_03_actor_can_edit_findings(uuid, uuid),
  public.acknowledge_vulnerability_kev_alert_atomic(uuid, uuid, uuid, uuid),
  public.record_vulnerability_kev_reporting_intent_atomic(uuid, uuid, uuid, uuid, text, text),
  public.list_due_vulnerability_kev_alert_organizations(integer),
  public.claim_vulnerability_kev_alert_delivery(uuid, text, integer),
  public.complete_vulnerability_kev_alert_delivery(uuid, uuid, text, boolean, text, text),
  public.persist_vulnerability_match_page_atomic_unchecked(uuid, uuid, text, integer, jsonb, jsonb, boolean),
  public.persist_vulnerability_match_page_atomic(uuid, uuid, text, integer, jsonb, jsonb, boolean),
  public.list_vulnerability_match_results_for_document_page(uuid, uuid, uuid, boolean, boolean, integer, integer, text)
from public, anon, authenticated;
grant execute on function
  public.reconcile_vulnerability_kev_alerts_for_release(uuid, uuid),
  public.list_vulnerability_enriched_findings_for_document_page(uuid, uuid, uuid, boolean, integer, integer, text),
  public.list_due_vulnerability_kev_alert_organizations(integer),
  public.claim_vulnerability_kev_alert_delivery(uuid, text, integer),
  public.complete_vulnerability_kev_alert_delivery(uuid, uuid, text, boolean, text, text),
  public.persist_vulnerability_match_page_atomic(uuid, uuid, text, integer, jsonb, jsonb, boolean),
  public.list_vulnerability_match_results_for_document_page(uuid, uuid, uuid, boolean, boolean, integer, integer, text)
to service_role;
