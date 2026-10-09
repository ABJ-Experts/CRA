-- Complete the original authenticated-only RLS and trigger-only auth boundaries.
-- Runtime API code does not call these functions; trigger/RLS execution remains.
revoke all on function public.get_current_user_id(), public.user_is_member_of(uuid),
  public.user_org_role(uuid), public.user_is_org_admin(uuid), public.user_shares_org_with(uuid),
  public.handle_new_user(), public.handle_user_email_change()
  from service_role;

-- Retain durable supplier command replay facts rather than inherited ALL grants.
revoke all on table public.supplier_registry_commands from service_role;
grant select, insert, update on table public.supplier_registry_commands to service_role;
