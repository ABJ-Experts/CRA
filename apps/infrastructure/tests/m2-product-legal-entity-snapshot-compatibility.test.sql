begin;

create extension if not exists pgtap;
select plan(9);

select is(
  (
    select count(*)
      from public.products products
     where jsonb_typeof(products.legal_entity_snapshot) <> 'object'
        or nullif(btrim(products.legal_entity_snapshot ->> 'identifier'), '') is null
        or nullif(btrim(products.legal_entity_snapshot ->> 'legalName'), '') is null
        or nullif(btrim(products.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is null
  ),
  0::bigint,
  'every product legal-entity snapshot satisfies the strict product response contract'
);

select is(
  (
    select count(*)
      from public.products products
     cross join lateral public.m2_product_json(
       products.organization_id,
       products.id
     ) projection
     where nullif(btrim(projection -> 'legalEntity' ->> 'identifier'), '') is null
        or nullif(btrim(projection -> 'legalEntity' ->> 'legalName'), '') is null
        or nullif(btrim(projection -> 'legalEntity' ->> 'mainEstablishmentCountry'), '') is null
  ),
  0::bigint,
  'list_products projections cannot emit null legal-entity fields required by the shared contract'
);

select is(
  (
    select count(*)
      from public.product_releases releases
     where jsonb_typeof(releases.legal_entity_snapshot) <> 'object'
        or nullif(btrim(releases.legal_entity_snapshot ->> 'identifier'), '') is null
        or nullif(btrim(releases.legal_entity_snapshot ->> 'legalName'), '') is null
        or nullif(btrim(releases.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is null
  ),
  0::bigint,
  'every release legal-entity snapshot satisfies the strict release response contract'
);

select is(
  (
    select count(*)
      from public.product_releases releases
     cross join lateral public.m2_release_json(
       releases.organization_id,
       releases.id
     ) projection
     where nullif(btrim(projection -> 'legalEntity' ->> 'identifier'), '') is null
        or nullif(btrim(projection -> 'legalEntity' ->> 'legalName'), '') is null
        or nullif(btrim(projection -> 'legalEntity' ->> 'mainEstablishmentCountry'), '') is null
  ),
  0::bigint,
  'list_releases projections cannot emit null legal-entity fields required by the shared contract'
);

create temp table m2_snapshot_repair_fixture on commit drop as
  select
    products.organization_id,
    products.id as product_id,
    releases.id as release_id,
    products.legal_entity_id,
    null::uuid as preserved_product_id,
    null::uuid as preserved_release_id,
    null::jsonb as product_snapshot,
    null::jsonb as release_snapshot
  from public.products products
  join public.product_releases releases
    on releases.organization_id = products.organization_id
   and releases.product_id = products.id
  join public.organization_legal_entities entities
    on entities.organization_id = products.organization_id
   and entities.id = products.legal_entity_id
  where nullif(btrim(entities.identifier), '') is not null
    and nullif(btrim(entities.legal_name), '') is not null
    and nullif(btrim(entities.main_establishment_country), '') is not null
  order by products.id, releases.id
  limit 1
;

with inserted_product as (
  insert into public.products (
    organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_by, updated_by
  )
  select
    fixture.organization_id,
    fixture.legal_entity_id,
    88,
    jsonb_build_object(
      'identifier', 'historical-snapshot',
      'legalName', 'Historical snapshot',
      'mainEstablishmentCountry', 'DE'
    ),
    'Historical snapshot preservation fixture',
    'snapshot-preserve-' || left(fixture.product_id::text, 8),
    products.product_type,
    products.responsible_owner_id,
    products.created_by,
    products.updated_by
  from m2_snapshot_repair_fixture fixture
  join public.products products
    on products.organization_id = fixture.organization_id
   and products.id = fixture.product_id
  returning id, organization_id, legal_entity_snapshot
), inserted_release as (
  insert into public.product_releases (
    organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  )
  select
    products.organization_id,
    products.id,
    fixture.legal_entity_id,
    89,
    jsonb_build_object(
      'identifier', 'historical-release-snapshot',
      'legalName', 'Historical release snapshot',
      'mainEstablishmentCountry', 'DE'
    ),
    'Historical snapshot preservation fixture',
    'snapshot-preserve-' || left(products.id::text, 8),
    'development',
    source.created_by,
    source.updated_by
  from inserted_product products
  join m2_snapshot_repair_fixture fixture
    on fixture.organization_id = products.organization_id
  join public.products source
    on source.organization_id = fixture.organization_id
   and source.id = fixture.product_id
  returning id, organization_id, product_id, legal_entity_snapshot
)
update m2_snapshot_repair_fixture fixture
set
  preserved_product_id = inserted_product.id,
  preserved_release_id = releases.id,
  product_snapshot = inserted_product.legal_entity_snapshot,
  release_snapshot = releases.legal_entity_snapshot
from inserted_product inserted_product
join inserted_release releases
  on releases.organization_id = inserted_product.organization_id
 and releases.product_id = inserted_product.id
where fixture.organization_id = inserted_product.organization_id;

select is(
  (select count(*) from m2_snapshot_repair_fixture),
  1::bigint,
  'the local fixture contains malformed and preserved snapshot candidates'
);

update public.organization_legal_entities entities
set status = 'inactive'
from m2_snapshot_repair_fixture fixture
where entities.organization_id = fixture.organization_id
  and entities.id = fixture.legal_entity_id;

update public.products products
set legal_entity_snapshot = '{}'::jsonb
from m2_snapshot_repair_fixture fixture
where products.organization_id = fixture.organization_id
  and products.id = fixture.product_id;

update public.product_releases releases
set legal_entity_snapshot = '{}'::jsonb
from m2_snapshot_repair_fixture fixture
where releases.organization_id = fixture.organization_id
  and releases.id = fixture.release_id;

-- Mirrors the inactive-entity compatibility migration under transaction so
-- its repair and preservation behavior is exercised without changing seed data.
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

select ok(
  (
    select products.legal_entity_snapshot = public.m1_v2_legal_entity_json(
      fixture.legal_entity_id
    )
    from public.products products
    join m2_snapshot_repair_fixture fixture
      on fixture.organization_id = products.organization_id
     and fixture.product_id = products.id
  ),
  'an inactive entity with complete fields repairs a malformed product snapshot'
);

select ok(
  (
    select releases.legal_entity_snapshot = public.m1_v2_legal_entity_json(
      fixture.legal_entity_id
    )
    from public.product_releases releases
    join m2_snapshot_repair_fixture fixture
      on fixture.organization_id = releases.organization_id
     and fixture.release_id = releases.id
  ),
  'an inactive entity with complete fields repairs a malformed release snapshot'
);

select ok(
  (
    select products.legal_entity_snapshot = fixture.product_snapshot
    from public.products products
    join m2_snapshot_repair_fixture fixture
      on fixture.organization_id = products.organization_id
     and fixture.preserved_product_id = products.id
  ),
  'a valid historical product snapshot remains unchanged'
);

select ok(
  (
    select releases.legal_entity_snapshot = fixture.release_snapshot
    from public.product_releases releases
    join m2_snapshot_repair_fixture fixture
      on fixture.organization_id = releases.organization_id
     and fixture.preserved_release_id = releases.id
  ),
  'a valid historical release snapshot remains unchanged'
);

select * from finish();
rollback;
