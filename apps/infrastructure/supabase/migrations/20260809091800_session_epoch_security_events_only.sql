-- =============================================================================
-- Bump session_epoch_at for SECURITY events only — not for role changes.
-- =============================================================================
-- The earlier triggers bumped the epoch whenever a membership or role changed.
-- Two things are wrong with that:
--
--   1. IT IS UNNECESSARY. The auth guard resolves the caller's membership and
--      base role from the database on EVERY request, so a role change already
--      takes effect on the very next call. Nothing is cached in the token.
--      Cache invalidation for the resolved permission set is separately handled
--      by organization_permissions_version.
--
--   2. IT IS HARMFUL. Bumping the epoch invalidates every live access token for
--      that user, so an administrator tidying up someone's role silently signs
--      them out mid-task. Being logged out is a reasonable consequence of
--      changing your password; it is not a reasonable consequence of someone
--      else editing your job title.
--
-- The epoch now moves only on genuine security events, all driven explicitly by
-- the API: password reset, sign-out-everywhere, and deactivation.
--
-- Deactivation gets a trigger because it can happen through a direct UPDATE as
-- well as through the API, and a deactivated user must lose access immediately
-- rather than at the end of their token's hour.
-- =============================================================================

drop trigger if exists bump_epoch_on_membership_change on public.organization_members;
drop trigger if exists bump_epoch_on_role_change       on public.organization_members;

-- The helper the dropped triggers used is no longer referenced.
drop function if exists public.bump_session_epoch_for_member();

-- ---------------------------------------------------------------------------
-- Deactivation ends every live session.
-- ---------------------------------------------------------------------------
create or replace function public.bump_epoch_on_deactivation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if old.is_active = true and new.is_active = false then
    new.session_epoch_at := now();
  end if;
  return new;
end;
$$;

alter function public.bump_epoch_on_deactivation() owner to postgres;
revoke all on function public.bump_epoch_on_deactivation() from public, anon, authenticated;

-- BEFORE, so the new value is written as part of the same UPDATE rather than
-- costing a second write.
drop trigger if exists bump_epoch_on_deactivation on public.users;
create trigger bump_epoch_on_deactivation
  before update of is_active on public.users
  for each row execute function public.bump_epoch_on_deactivation();
