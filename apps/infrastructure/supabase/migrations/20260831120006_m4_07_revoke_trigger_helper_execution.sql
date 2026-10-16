-- Trigger helpers are invoked by PostgreSQL internals, not by API callers.
-- Keep the stale-marking trigger active while removing direct RPC execution.
revoke all on function public.m4_07_mark_reachability_stale_after_occurrence_change()
  from public, anon, authenticated, service_role;
