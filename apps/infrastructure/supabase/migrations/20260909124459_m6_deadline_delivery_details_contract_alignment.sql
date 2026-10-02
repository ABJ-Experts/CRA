-- Align environments that applied the original expand migration before the
-- provider contract gained its stable alert idempotency key. Delivery remains
-- tenant-first and revalidates every eligibility condition immediately before
-- the mail adapter may send.
create or replace function public.get_reporting_deadline_alert_delivery_details(
  p_organization_id uuid,
  p_delivery_id uuid,
  p_worker_id text,
  p_expected_checkpoint_version integer
)
returns table(outcome text, details jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery public.reporting_deadline_alert_deliveries%rowtype;
  v_alert public.reporting_deadline_alerts%rowtype;
  v_stage public.reporting_obligation_stages%rowtype;
  v_obligation public.reporting_obligations%rowtype;
  v_email_enabled boolean;
begin
  select * into v_delivery
  from public.reporting_deadline_alert_deliveries d
  where d.organization_id = p_organization_id and d.id = p_delivery_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_owner is distinct from btrim(p_worker_id)
     or v_delivery.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;

  select * into v_alert from public.reporting_deadline_alerts a
  where a.organization_id = p_organization_id and a.id = v_delivery.alert_id;
  select * into v_stage from public.reporting_obligation_stages s
  where s.organization_id = p_organization_id and s.id = v_alert.stage_id;
  select * into v_obligation from public.reporting_obligations o
  where o.organization_id = p_organization_id and o.id = v_alert.obligation_id;
  select 'email' = any(settings.notification_channel_ids) into v_email_enabled
  from public.organization_settings settings
  where settings.organization_id = p_organization_id;

  if not found
     or v_alert.id is null
     or v_stage.id is null
     or v_obligation.id is null
     or v_obligation.status = 'cancelled'
     or v_stage.state in ('submitted', 'not_required')
     or not coalesce(v_email_enabled, false)
     or not exists (
       select 1
       from public.organization_members m
       join public.users u on u.id = m.user_id and u.is_active
       where m.organization_id = p_organization_id
         and m.user_id = v_delivery.recipient_user_id
         and m.role in ('owner', 'admin')
         and public.m5_triage_actor_has_permission(
           p_organization_id, m.user_id, 'can_view_findings'
         )
     ) then
    update public.reporting_deadline_alert_deliveries
    set delivery_state = 'cancelled',
        cancelled_at = clock_timestamp(),
        lease_owner = null,
        lease_expires_at = null
    where organization_id = p_organization_id and id = v_delivery.id;
    return query select 'cancelled'::text, null::jsonb;
    return;
  end if;

  return query select 'found'::text, jsonb_build_object(
    'deliveryId', v_delivery.id,
    'recipient', jsonb_build_object(
      'userId', v_delivery.recipient_user_id,
      'email', (select u.email from public.users u where u.id = v_delivery.recipient_user_id)
    ),
    'obligationId', v_obligation.id,
    'stageKind', v_stage.stage_kind,
    'thresholdPercent', v_alert.threshold_percent,
    'dueAt', public.m6_utc_second_z(v_alert.due_at),
    'idempotencyKey', v_alert.idempotency_key
  );
end;
$$;

alter function public.get_reporting_deadline_alert_delivery_details(uuid, uuid, text, integer)
  owner to postgres;
revoke all on function public.get_reporting_deadline_alert_delivery_details(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_reporting_deadline_alert_delivery_details(uuid, uuid, text, integer)
  to service_role;
