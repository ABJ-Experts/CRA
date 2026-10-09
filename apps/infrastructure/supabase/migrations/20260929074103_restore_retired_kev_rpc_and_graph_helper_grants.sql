-- Restore the retained KEV ledger and retired overload boundaries from
-- 20260826134545; current UUID-idempotency action overloads remain granted.
revoke all on table public.vulnerability_kev_alerts from service_role;
grant select, insert, update on table public.vulnerability_kev_alerts to service_role;
revoke all on function
  public.acknowledge_vulnerability_kev_alert_atomic(uuid, uuid, uuid, uuid),
  public.record_vulnerability_kev_reporting_intent_atomic(uuid, uuid, uuid, uuid, text, text)
from public, anon, authenticated, service_role;

-- The completed-graph guard is invoked only by PostgreSQL triggers, as in
-- 20260928082452. Direct execution is not a runtime application capability.
revoke all on function public.guard_completed_sbom_graph()
  from public, anon, authenticated, service_role;
