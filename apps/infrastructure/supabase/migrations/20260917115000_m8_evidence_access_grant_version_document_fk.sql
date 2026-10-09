-- A grant may never combine a real document with a version from another
-- document, even if a trusted service accidentally bypasses the RPC.
alter table public.evidence_document_versions
  add constraint evidence_versions_org_id_id_document_id_key
  unique (organization_id, id, document_id);
alter table public.evidence_document_access_grants
  add constraint evidence_access_grants_version_document_fkey
  foreign key (organization_id, version_id, document_id)
  references public.evidence_document_versions(organization_id, id, document_id)
  on delete restrict;
