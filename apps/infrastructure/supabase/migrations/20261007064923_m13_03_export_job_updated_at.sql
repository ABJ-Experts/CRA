-- Keep the existing workspace timestamp invariant for export job transitions.
-- RPC version/lease checks remain authoritative; this trigger changes no audit rows.
create trigger set_audit_export_jobs_updated_at
before update on public.audit_export_jobs
for each row execute function public.set_updated_at();
