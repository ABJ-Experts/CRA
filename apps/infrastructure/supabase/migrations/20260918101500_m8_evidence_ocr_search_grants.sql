-- The list RPC overload was introduced after its original three-argument
-- signature; PostgreSQL grants are per signature, so preserve service-only use.
revoke all on function public.list_evidence_documents(
  uuid, uuid, uuid, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.list_evidence_documents(
  uuid, uuid, uuid, text, text, timestamptz, uuid, integer
) to service_role;
