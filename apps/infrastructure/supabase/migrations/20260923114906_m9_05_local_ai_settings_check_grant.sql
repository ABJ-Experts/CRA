-- Every organization_settings UPDATE evaluates the M9-04 reminder CHECK.
-- Its pure validator had no service-role grant, blocking legitimate updates
-- to the new local-AI policy columns. Keep browser roles revoked.
grant execute on function public.m9_04_reminder_offsets_valid(integer[]) to service_role;
