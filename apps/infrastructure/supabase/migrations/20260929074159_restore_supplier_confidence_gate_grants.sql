-- Restore the private legacy core boundary retained by 20260923114524.
-- The public atomic wrapper still enforces confidence and current authorization.
revoke all on function public.m9_05_decide_supplier_document_field_core(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, uuid, text, uuid, integer, text, text, uuid
) from public, anon, authenticated, service_role;
