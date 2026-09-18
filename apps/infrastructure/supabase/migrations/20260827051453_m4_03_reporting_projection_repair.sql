-- Preserve an existing M6 obligation link in the safe M4 projection. A linked
-- alert is an auditable terminal handoff, not an unavailable downstream state.
create or replace function public.m4_03_kev_alert_json(
  p_organization_id uuid,
  p_alert_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', alerts.id,
    'findingId', alerts.triggering_finding_id,
    'releaseId', alerts.release_id,
    'productName', products.name,
    'releaseName', releases.label,
    'advisoryId', findings.canonical_advisory_id,
    'lifecycleState', alerts.lifecycle_state,
    'severity', 'high',
    'status', case
      when alerts.reporting_status = 'linked' then 'obligation_exists'
      when alerts.state = 'new' then 'newly_listed'
      when alerts.state = 'acknowledged' then 'acknowledged'
      else 'resolved'
    end,
    'notificationStatus', case alerts.delivery_status
      when 'queued' then 'pending'
      when 'leased' then 'pending'
      else alerts.delivery_status
    end,
    'reportingStatus', case
      when alerts.reporting_status = 'linked' then 'available'
      else 'downstream_reporting_unavailable'
    end,
    'kev', jsonb_build_object(
      'freshness', case configs.freshness_state
        when 'healthy' then 'fresh'
        when 'stale' then 'stale'
        else 'unavailable'
      end,
      'assessedAt', versions.promoted_at,
      'status', case records.record_state
        when 'active' then 'listed'
        when 'withdrawn' then 'removed'
        when 'rejected' then 'disputed'
        else 'not_listed'
      end,
      'listingDate', alerts.kev_listing_date,
      'provenance', jsonb_build_object(
        'sourceFeed', 'cisa_kev',
        'sourceRecordId', records.source_record_key,
        'sourceRecordVersionId', versions.id,
        'observedAt', coalesce(records.source_updated_at, versions.source_updated_at),
        'retrievedAt', versions.promoted_at
      )
    ),
    'createdAt', alerts.created_at,
    'updatedAt', alerts.updated_at,
    'acknowledgedAt', alerts.acknowledged_at,
    'obligation', case when alerts.reporting_status = 'linked' then
      jsonb_build_object('id', alerts.external_obligation_id::uuid, 'status', 'active')
      else null
    end
  )
  from public.vulnerability_kev_alerts alerts
  join public.vulnerability_findings findings on findings.id = alerts.triggering_finding_id
  join public.product_releases releases
    on releases.organization_id = alerts.organization_id and releases.id = alerts.release_id
  join public.products products
    on products.organization_id = releases.organization_id and products.id = releases.product_id
  join public.vulnerability_source_records records on records.id = alerts.kev_source_record_id
  join public.vulnerability_source_record_versions versions on versions.id = alerts.kev_source_record_version_id
  join public.vulnerability_feed_configs configs on configs.feed_key = 'cisa_kev'
  where alerts.organization_id = p_organization_id and alerts.id = p_alert_id;
$$;

alter table public.vulnerability_kev_alerts
  add constraint vulnerability_kev_alerts_external_obligation_uuid_check
  check (
    external_obligation_id is null
    or external_obligation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

alter function public.m4_03_kev_alert_json(uuid, uuid) owner to postgres;
revoke all on function public.m4_03_kev_alert_json(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.m4_03_kev_alert_json(uuid, uuid) to service_role;
