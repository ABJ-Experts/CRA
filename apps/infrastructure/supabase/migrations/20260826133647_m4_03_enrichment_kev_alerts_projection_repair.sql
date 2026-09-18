-- Forward-only repair for the already-applied M4-03 ledger. It binds actions
-- to the document path and exposes contract-ready safe alert projections.
alter table public.vulnerability_kev_alerts
  add column if not exists triggering_finding_id uuid;
update public.vulnerability_kev_alerts alerts
set triggering_finding_id = (
  select findings.id from public.vulnerability_findings findings
  where findings.organization_id = alerts.organization_id and findings.release_id = alerts.release_id
    and findings.vulnerability_id = alerts.vulnerability_id
  order by findings.id limit 1
)
where alerts.triggering_finding_id is null;
alter table public.vulnerability_kev_alerts
  alter column triggering_finding_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.vulnerability_kev_alerts'::regclass
    and conname = 'vulnerability_kev_alerts_triggering_finding_fkey') then
    alter table public.vulnerability_kev_alerts add constraint vulnerability_kev_alerts_triggering_finding_fkey
      foreign key (triggering_finding_id) references public.vulnerability_findings(id) on delete restrict;
  end if;
end;
$$;
create index if not exists vulnerability_kev_alerts_finding_idx
  on public.vulnerability_kev_alerts(organization_id, triggering_finding_id);

create or replace function public.m4_03_actor_can_edit_findings(p_organization_id uuid, p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id and users.is_active
    left join public.base_role_permission_overrides overrides
      on overrides.organization_id = members.organization_id and overrides.base_role = members.role
    where members.organization_id = p_organization_id and members.user_id = p_actor_user_id
      and members.role in ('owner','admin')
      and coalesce(case when jsonb_typeof(overrides.permissions->'can_edit_findings') = 'boolean'
        then (overrides.permissions->>'can_edit_findings')::boolean end, true)
  );
$$;

create or replace function public.m4_03_kev_alert_json(p_organization_id uuid, p_alert_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', alerts.id, 'findingId', alerts.triggering_finding_id, 'releaseId', alerts.release_id,
    'productName', products.name, 'releaseName', releases.label, 'advisoryId', findings.canonical_advisory_id,
    'lifecycleState', alerts.lifecycle_state, 'severity', 'high',
    'status', case when alerts.state = 'new' then 'newly_listed' when alerts.state = 'acknowledged' then 'acknowledged'
      when alerts.reporting_status = 'linked' then 'obligation_exists' else 'resolved' end,
    'notificationStatus', case alerts.delivery_status when 'queued' then 'pending' when 'leased' then 'pending'
      else alerts.delivery_status end,
    'reportingStatus', 'downstream_reporting_unavailable',
    'kev', jsonb_build_object('freshness', case configs.freshness_state when 'healthy' then 'fresh'
      when 'stale' then 'stale' else 'unavailable' end, 'assessedAt', versions.promoted_at,
      'status', case records.record_state when 'active' then 'listed' when 'withdrawn' then 'removed'
        when 'rejected' then 'disputed' else 'not_listed' end, 'listingDate', alerts.kev_listing_date,
      'provenance', jsonb_build_object('sourceFeed','cisa_kev','sourceRecordId',records.source_record_key,
        'sourceRecordVersionId',versions.id,'observedAt',coalesce(records.source_updated_at,versions.source_updated_at),
        'retrievedAt',versions.promoted_at)),
    'createdAt', alerts.created_at, 'updatedAt', alerts.updated_at, 'acknowledgedAt', alerts.acknowledged_at,
    'obligation', null
  ) from public.vulnerability_kev_alerts alerts
  join public.vulnerability_findings findings on findings.id = alerts.triggering_finding_id
  join public.product_releases releases on releases.organization_id = alerts.organization_id and releases.id = alerts.release_id
  join public.products products on products.organization_id = releases.organization_id and products.id = releases.product_id
  join public.vulnerability_source_records records on records.id = alerts.kev_source_record_id
  join public.vulnerability_source_record_versions versions on versions.id = alerts.kev_source_record_version_id
  join public.vulnerability_feed_configs configs on configs.feed_key = 'cisa_kev'
  where alerts.organization_id = p_organization_id and alerts.id = p_alert_id;
$$;

create or replace function public.acknowledge_vulnerability_kev_alert_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid, p_alert_id uuid, p_idempotency_key uuid
) returns table(outcome text, alert jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alert public.vulnerability_kev_alerts%rowtype;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_alert_id is null or p_idempotency_key is null
     or not public.m4_03_actor_can_edit_findings(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select alerts.* into v_alert from public.vulnerability_kev_alerts alerts
  where alerts.organization_id=p_organization_id and alerts.id=p_alert_id and exists (
    select 1 from public.vulnerability_findings findings join public.vulnerability_finding_component_occurrences links
      on links.finding_id=findings.id and links.organization_id=findings.organization_id and links.state='active'
    join public.vulnerability_component_occurrences occurrences on occurrences.id=links.occurrence_id and occurrences.organization_id=findings.organization_id
    where findings.organization_id=p_organization_id and findings.release_id=alerts.release_id and findings.vulnerability_id=alerts.vulnerability_id
      and findings.status='active' and occurrences.document_id=p_document_id) for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_alert.state='resolved' then return query select 'invalid_state'::text,null::jsonb; return; end if;
  if v_alert.acknowledged_at is null then
    update public.vulnerability_kev_alerts set state='acknowledged',acknowledged_at=clock_timestamp(),acknowledged_by=p_actor_user_id
      where organization_id=p_organization_id and id=p_alert_id;
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,
      'vulnerability.kev_alert_acknowledged','vulnerability_kev_alert',p_alert_id::text,jsonb_build_object('documentId',p_document_id,'idempotencyKey',p_idempotency_key));
  end if;
  return query select 'acknowledged'::text,public.m4_03_kev_alert_json(p_organization_id,p_alert_id);
end;
$$;

alter function public.m4_03_actor_can_edit_findings(uuid,uuid) owner to postgres;
alter function public.m4_03_kev_alert_json(uuid,uuid) owner to postgres;
alter function public.acknowledge_vulnerability_kev_alert_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.m4_03_actor_can_edit_findings(uuid,uuid),public.m4_03_kev_alert_json(uuid,uuid),public.acknowledge_vulnerability_kev_alert_atomic(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.m4_03_kev_alert_json(uuid,uuid),public.acknowledge_vulnerability_kev_alert_atomic(uuid,uuid,uuid,uuid,uuid) to service_role;
