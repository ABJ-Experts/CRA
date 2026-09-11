-- A successful completion must return exactly one terminal outcome. Without
-- this return, PostgreSQL appends the retry branch and callers resend mail.
create or replace function public.complete_vulnerability_kev_alert_delivery(
  p_organization_id uuid,
  p_alert_id uuid,
  p_worker_id text,
  p_delivered boolean,
  p_error_code text default null,
  p_error_message text default null
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alert public.vulnerability_kev_alerts%rowtype;
begin
  if p_organization_id is null or p_alert_id is null
    or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 100
    or p_delivered is null
    or (not p_delivered and (
      btrim(coalesce(p_error_code, '')) !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
      or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000
    )) then
    return query select 'invalid_request'::text;
    return;
  end if;

  select * into v_alert from public.vulnerability_kev_alerts alerts
  where alerts.organization_id = p_organization_id and alerts.id = p_alert_id
  for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_alert.delivery_status <> 'leased'
    or v_alert.lease_owner <> btrim(p_worker_id)
    or v_alert.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text;
    return;
  end if;

  if p_delivered then
    update public.vulnerability_kev_alerts
    set delivery_status = 'delivered', delivered_at = clock_timestamp(),
      lease_owner = null, lease_expires_at = null,
      last_delivery_error_code = null, last_delivery_error_message = null
    where organization_id = p_organization_id and id = p_alert_id;
    return query select 'delivered'::text;
    return;
  end if;

  update public.vulnerability_kev_alerts
  set delivery_status = case when delivery_attempts >= max_delivery_attempts
      then 'dead_letter' else 'retrying' end,
    lease_owner = null, lease_expires_at = null,
    last_delivery_error_code = btrim(p_error_code),
    last_delivery_error_message = btrim(p_error_message)
  where organization_id = p_organization_id and id = p_alert_id;
  return query select case when v_alert.delivery_attempts >= v_alert.max_delivery_attempts
    then 'dead_letter' else 'retry_scheduled' end;
end;
$$;

alter function public.complete_vulnerability_kev_alert_delivery(
  uuid, uuid, text, boolean, text, text
) owner to postgres;
revoke all on function public.complete_vulnerability_kev_alert_delivery(
  uuid, uuid, text, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.complete_vulnerability_kev_alert_delivery(
  uuid, uuid, text, boolean, text, text
) to service_role;
