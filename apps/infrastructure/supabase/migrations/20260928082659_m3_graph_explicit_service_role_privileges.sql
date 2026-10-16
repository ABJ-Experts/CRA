-- Supabase default table ACLs include TRUNCATE/TRIGGER/REFERENCES. The original
-- GRANT of CRUD privileges did not remove those defaults. Retained normalized
-- graphs and provenance aliases must not allow service-role bulk destruction
-- that bypasses row-level immutable guards. Existing scoped CRUD/RPCs remain.
revoke truncate, trigger, references on public.sbom_documents,
  public.sbom_document_sources, public.sbom_components,
  public.sbom_component_identities, public.sbom_component_dependencies,
  public.sbom_raw_objects, public.sbom_sources
  from service_role;
