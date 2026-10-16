begin;
create extension if not exists pgtap;
select plan(3);

select ok(not exists (
  select 1 from public.product_releases r
  where r.id = '90100000-0000-4000-8000-000000000002'::uuid
    and (jsonb_typeof(r.legal_entity_snapshot) <> 'object'
      or nullif(btrim(r.legal_entity_snapshot ->> 'identifier'), '') is null
      or nullif(btrim(r.legal_entity_snapshot ->> 'legalName'), '') is null
      or nullif(btrim(r.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is null)
), 'known release has a complete legal-entity snapshot if present');

select ok(not exists (
  select 1 from public.product_releases r
  join public.products p on p.organization_id = r.organization_id and p.id = r.product_id
  join public.organization_legal_entities e on e.organization_id = r.organization_id and e.id = r.legal_entity_id
  where r.id = '90100000-0000-4000-8000-000000000002'::uuid
    and (r.legal_entity_id is distinct from p.legal_entity_id
      or r.legal_entity_version is distinct from p.legal_entity_version
      or r.legal_entity_version is distinct from e.version
      or r.legal_entity_snapshot is distinct from p.legal_entity_snapshot)
), 'repaired release retains the exact same-version product snapshot');

select ok((select count(*) <= 1 from public.audit_logs
  where action = 'product.release_legal_entity_snapshot_backfilled'
    and entity_type = 'product_release'
    and entity_id = '90100000-0000-4000-8000-000000000002')
  and not exists (
    select 1 from public.audit_logs a
    join public.product_releases r on r.id::text = a.entity_id
    where a.action = 'product.release_legal_entity_snapshot_backfilled'
      and a.entity_id = '90100000-0000-4000-8000-000000000002'
      and a.changes ->> 'sourceSnapshotSha256' is distinct from
        encode(extensions.digest(r.legal_entity_snapshot::text, 'sha256'), 'hex')
  ), 'repair audit is unique and binds the exact snapshot digest');

select * from finish();
rollback;
