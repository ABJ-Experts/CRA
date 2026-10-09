-- The preceding compatibility migration repaired snapshots from active,
-- complete entities. Historical products and releases remain listable after an
-- entity is deactivated, so repair any remaining malformed snapshot whenever
-- its tenant-bound entity still has all three contract-required fields.
with repairable_entities as (
  select
    entities.organization_id,
    entities.id,
    entities.version,
    public.m1_v2_legal_entity_json(entities.id) as snapshot
  from public.organization_legal_entities entities
  where nullif(btrim(entities.identifier), '') is not null
    and nullif(btrim(entities.legal_name), '') is not null
    and nullif(btrim(entities.main_establishment_country), '') is not null
)
update public.products products
set
  legal_entity_version = entities.version,
  legal_entity_snapshot = entities.snapshot
from repairable_entities entities
where products.organization_id = entities.organization_id
  and products.legal_entity_id = entities.id
  and (
    jsonb_typeof(products.legal_entity_snapshot) <> 'object'
    or nullif(btrim(products.legal_entity_snapshot ->> 'identifier'), '') is null
    or nullif(btrim(products.legal_entity_snapshot ->> 'legalName'), '') is null
    or nullif(btrim(products.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is null
  );

with repairable_entities as (
  select
    entities.organization_id,
    entities.id,
    entities.version,
    public.m1_v2_legal_entity_json(entities.id) as snapshot
  from public.organization_legal_entities entities
  where nullif(btrim(entities.identifier), '') is not null
    and nullif(btrim(entities.legal_name), '') is not null
    and nullif(btrim(entities.main_establishment_country), '') is not null
)
update public.product_releases releases
set
  legal_entity_version = entities.version,
  legal_entity_snapshot = entities.snapshot
from repairable_entities entities
where releases.organization_id = entities.organization_id
  and releases.legal_entity_id = entities.id
  and (
    jsonb_typeof(releases.legal_entity_snapshot) <> 'object'
    or nullif(btrim(releases.legal_entity_snapshot ->> 'identifier'), '') is null
    or nullif(btrim(releases.legal_entity_snapshot ->> 'legalName'), '') is null
    or nullif(btrim(releases.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is null
  );
