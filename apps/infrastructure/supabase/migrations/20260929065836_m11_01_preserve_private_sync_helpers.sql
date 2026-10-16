-- Match the existing connector hardening contract: these value helpers are
-- private to owner-executed SQL, including denial to service_role callers.
revoke all on function public.m2_v2_sync_field_external_value(jsonb,text),
 public.m2_v2_sync_text_field_value(jsonb,boolean,text)
 from public,anon,authenticated,service_role;
