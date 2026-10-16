-- Policy predicates execute as the querying role. Restore the five exact
-- authenticated-only helper grants from 20260809091500, removed by the broad
-- local recovery grant repair. No table privileges or mutation RPCs are granted.
revoke all on function public.get_current_user_id(), public.user_is_member_of(uuid),
  public.user_org_role(uuid), public.user_is_org_admin(uuid), public.user_shares_org_with(uuid)
  from public, anon;
grant execute on function public.get_current_user_id(), public.user_is_member_of(uuid),
  public.user_org_role(uuid), public.user_is_org_admin(uuid), public.user_shares_org_with(uuid)
  to authenticated;
