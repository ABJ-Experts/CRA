-- Real local 50k corpus: root dependency page p95 2966ms because each child
-- count scanned the entire document. Cover the existing self-FK and exact
-- tenant/document/parent lookup without adding persistence or changing results.
create index sbom_components_org_document_parent_idx
  on public.sbom_components(organization_id, document_id, canonical_parent_component_id);
