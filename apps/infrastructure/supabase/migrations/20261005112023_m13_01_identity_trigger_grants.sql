-- Trigger functions run under their table triggers. They are not callable RPCs.
revoke all on function public.m13_01_bump_custom_role_version()
  from public, anon, authenticated, service_role;
revoke all on function public.m13_01_bump_override_version()
  from public, anon, authenticated, service_role;
