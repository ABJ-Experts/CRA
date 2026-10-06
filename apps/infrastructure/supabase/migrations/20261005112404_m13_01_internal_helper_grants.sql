-- Internal helpers run under the audited SECURITY DEFINER entry points and
-- audit trigger. Supabase's default function ACL gives service_role direct
-- EXECUTE unless revoked explicitly; direct calls are unnecessary.
revoke all on function public.m13_01_identity_actor_has_permission(uuid,uuid,text),
  public.m13_01_project_v2_audit_json(jsonb),
  public.m13_01_project_v2_reason(text),
  public.m13_01_redact_audit_json(jsonb,text),
  public.m13_01_redact_audit_text(text)
  from service_role;
