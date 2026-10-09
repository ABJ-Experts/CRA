-- Explicit covering index gate for real 50k normalization/tree reads.
begin;
do $$ begin
  if not exists(select 1 from pg_indexes where schemaname='public'
    and tablename='sbom_components' and indexname='sbom_components_org_document_parent_idx'
    and indexdef like '%(organization_id, document_id, canonical_parent_component_id)%') then
    raise exception 'Scoped component-parent count lacks covering index';
  end if;
end $$;
rollback;
