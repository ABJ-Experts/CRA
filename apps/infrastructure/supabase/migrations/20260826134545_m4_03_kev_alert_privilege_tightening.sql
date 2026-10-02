-- Tighten the live M4-03 surface after idempotent action RPCs replaced the
-- initial non-idempotent overloads. The API uses only the UUID-idempotency
-- signatures; helper overloads must not remain externally executable.
revoke all on table public.vulnerability_kev_alerts from service_role;
grant select, insert, update on table public.vulnerability_kev_alerts to service_role;

revoke all on function
  public.acknowledge_vulnerability_kev_alert_atomic(uuid, uuid, uuid, uuid),
  public.record_vulnerability_kev_reporting_intent_atomic(uuid, uuid, uuid, uuid, text, text)
from public, anon, authenticated, service_role;
