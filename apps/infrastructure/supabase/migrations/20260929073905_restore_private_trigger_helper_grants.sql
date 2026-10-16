-- Restore the trigger-only boundary from 20260831120006 after local reconstruction.
-- PostgreSQL invokes this through its trigger; no direct runtime RPC is intended.
revoke all on function public.m4_07_mark_reachability_stale_after_occurrence_change()
  from public, anon, authenticated, service_role;
