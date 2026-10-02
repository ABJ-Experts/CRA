-- M9 registry records are archive-only; restore the intended select/insert/update
-- runtime surface from 20260921170000 and the existing registry security gate.
-- Removing inherited ALL privileges does not delete or backfill any records.
revoke all on table public.supplier_organizations, public.supplier_contacts,
  public.supplier_component_responsibilities from service_role;
grant select, insert, update on table public.supplier_organizations,
  public.supplier_contacts, public.supplier_component_responsibilities to service_role;
