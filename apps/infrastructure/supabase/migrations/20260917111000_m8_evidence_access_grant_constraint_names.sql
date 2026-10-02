-- Explicit names keep generated Supabase relationships unambiguous when other
-- organization/product composite foreign keys exist in the schema.
alter table public.evidence_document_access_grants
  drop constraint evidence_document_access_grant_organization_id_document_id_fkey,
  drop constraint evidence_document_access_grants_organization_id_version_id_fkey,
  drop constraint evidence_document_access_grants_organization_id_product_id_fkey,
  add constraint evidence_access_grants_document_fkey
    foreign key (organization_id, document_id)
    references public.evidence_documents(organization_id, id) on delete restrict,
  add constraint evidence_access_grants_version_fkey
    foreign key (organization_id, version_id)
    references public.evidence_document_versions(organization_id, id) on delete restrict,
  add constraint evidence_access_grants_product_fkey
    foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete restrict;
