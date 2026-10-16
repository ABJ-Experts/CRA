-- An M1-approved organization purge cascades products and evidence applicability
-- before control rows on some plans. Let those scoped cascades remove dependent
-- links. The mapping-product immutability trigger still rejects deletion while
-- the organization exists, so ordinary product changes preserve history.
alter table public.framework_control_mapping_products
  drop constraint framework_control_mapping_produ_organization_id_product_id_fkey,
  add constraint m10_control_mapping_product_product_fkey
    foreign key (organization_id,product_id)
    references public.products(organization_id,id) on delete cascade;

alter table public.framework_control_evidence_links
  drop constraint framework_control_evidence_li_organization_id_evidence_ver_fkey,
  add constraint m10_control_evidence_version_product_fkey
    foreign key (organization_id,evidence_version_id,product_id)
    references public.evidence_document_version_products(organization_id,version_id,product_id)
    on delete cascade;
