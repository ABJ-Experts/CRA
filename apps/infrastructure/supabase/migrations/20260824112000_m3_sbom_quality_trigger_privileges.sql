-- The completion hook is an internal SECURITY DEFINER trigger function, not
-- an RPC surface.  Existing local databases already applied the M3-04 base
-- migration, so retain this small privilege correction as its own migration.
revoke all on function public.enqueue_sbom_quality_for_completed_document_trigger()
  from public, anon, authenticated;
