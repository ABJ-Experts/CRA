-- Safe notification projection for the durable KEV alert worker. This function
-- returns only display labels and a current owner/admin recipient; it does not
-- expose raw SBOM content, component inventories, or regulatory report payloads.
create or replace function public.get_vulnerability_kev_alert_notification_details(
  p_organization_id uuid,
  p_alert_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
  v_has_alert boolean;
begin
  if p_organization_id is null or p_alert_id is null then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select exists (
    select 1
    from public.vulnerability_kev_alerts alerts
    where alerts.organization_id = p_organization_id
      and alerts.id = p_alert_id
      and alerts.state <> 'resolved'
  ) into v_has_alert;

  if not coalesce(v_has_alert, false) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select jsonb_build_object(
    'recipient', jsonb_build_object(
      'userId', recipient.user_id,
      'email', recipient.email
    ),
    'alert', jsonb_build_object(
      'productName', product.name,
      'releaseName', release.label,
      'advisoryId', finding.canonical_advisory_id,
      'lifecycleState', alert.lifecycle_state,
      'kevListingDate', alert.kev_listing_date
    )
  )
  into v_result
  from public.vulnerability_kev_alerts alert
  join public.vulnerability_findings finding
    on finding.id = alert.triggering_finding_id
   and finding.organization_id = alert.organization_id
  join public.product_releases release
    on release.organization_id = alert.organization_id
   and release.id = alert.release_id
  join public.products product
    on product.organization_id = release.organization_id
   and product.id = release.product_id
  cross join lateral (
    select member.user_id, "user".email
    from public.organization_members member
    join public.users "user"
      on "user".id = member.user_id
     and "user".is_active
     and "user".email_verified_at is not null
    where member.organization_id = alert.organization_id
      and member.role in ('owner', 'admin')
    order by case member.role when 'owner' then 0 else 1 end,
      member.created_at,
      member.user_id
    limit 1
  ) recipient
  where alert.organization_id = p_organization_id
    and alert.id = p_alert_id
    and alert.state <> 'resolved';

  if v_result is null then
    return query select 'recipient_unavailable'::text, null::jsonb;
    return;
  end if;

  return query select 'found'::text, v_result;
end;
$$;

alter function public.get_vulnerability_kev_alert_notification_details(uuid, uuid)
  owner to postgres;
revoke all on function public.get_vulnerability_kev_alert_notification_details(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_vulnerability_kev_alert_notification_details(uuid, uuid)
  to service_role;
