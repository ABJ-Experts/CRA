#!/usr/bin/env bash
set -euo pipefail

source scripts/local-supabase-env.sh
load_local_supabase_env
database_url=${DB_URL:?Supabase status did not return DB_URL}
container_name="supabase_db_cra"
temporary_directory=$(mktemp -d)
result_one="$temporary_directory/result-one"
result_two="$temporary_directory/result-two"
product_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
release_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
correlation_one=$(uuidgen | tr '[:upper:]' '[:lower:]')
correlation_two=$(uuidgen | tr '[:upper:]' '[:lower:]')

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$database_url" "$@"
  else
    docker exec -i "$container_name" psql -U postgres -d postgres "$@"
  fi
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  run_psql -X -q -v ON_ERROR_STOP=1 \
    -v product_id="$product_id" -v release_id="$release_id" <<'SQL' \
    >/dev/null || cleanup_status=$?
delete from public.audit_logs
 where entity_type = 'product_release' and entity_id = :'release_id';
delete from public.product_releases where id = :'release_id'::uuid;
delete from public.products where id = :'product_id'::uuid;
SQL
  rm -rf "$temporary_directory"
  if [[ $cleanup_status -ne 0 ]]; then
    echo "M2 V1 concurrency fixture cleanup failed" >&2
    if [[ $original_status -eq 0 ]]; then exit "$cleanup_status"; fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

run_psql -X -q -v ON_ERROR_STOP=1 \
  -v product_id="$product_id" -v release_id="$release_id" <<'SQL'
insert into public.products (
  id, organization_id, legal_entity_id, legal_entity_version,
  legal_entity_snapshot, name, internal_code, product_type,
  responsible_owner_id, created_by, updated_by
)
select
  :'product_id'::uuid, organizations.id, entities.id, entities.version,
  jsonb_build_object(
    'identifier', entities.identifier,
    'legalName', coalesce(entities.legal_name, 'Concurrency fixture'),
    'mainEstablishmentCountry', coalesce(entities.main_establishment_country, 'IE')
  ),
  'M2 V1 concurrency product', 'M2-CONCURRENT-' || :'product_id',
  'standalone_software', users.id, users.id, users.id
from public.organizations organizations
join public.organization_legal_entities entities
  on entities.organization_id = organizations.id and entities.is_default
join public.users users on users.email = 'owner@cra.test'
where organizations.slug = 'cra';

insert into public.product_releases (
  id, organization_id, product_id, legal_entity_id, legal_entity_version,
  legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
)
select
  :'release_id'::uuid, products.organization_id, products.id,
  products.legal_entity_id, products.legal_entity_version,
  products.legal_entity_snapshot, 'M2 V1 concurrency release',
  'race-' || :'release_id', 'development', products.created_by, products.created_by
from public.products products where products.id = :'product_id'::uuid;
SQL

add_market() {
  local country_code=$1
  local correlation_id=$2
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v product_id="$product_id" -v release_id="$release_id" \
    -v country_code="$country_code" -v correlation_id="$correlation_id" <<'SQL'
select outcome from public.add_product_release_market_availability_atomic(
  (select id from public.organizations where slug = 'cra'),
  :'product_id'::uuid,
  :'release_id'::uuid,
  (select id from public.users where email = 'owner@cra.test'),
  0,
  :'country_code',
  null,
  :'correlation_id'::uuid
);
SQL
}

add_market DE "$correlation_one" >"$result_one" &
pid_one=$!
add_market FR "$correlation_two" >"$result_two" &
pid_two=$!

wait_status=0
wait "$pid_one" || wait_status=$?
wait "$pid_two" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "A concurrent release command failed" >&2
  exit "$wait_status"
fi

outcomes=$(
  printf '%s\n%s\n' \
    "$(tr -d '\r\n' <"$result_one")" \
    "$(tr -d '\r\n' <"$result_two")" | sort
)
if [[ $outcomes != $'conflict\nupdated' ]]; then
  printf 'Unexpected concurrent release outcomes:\n%s\n' "$outcomes" >&2
  exit 1
fi

effects=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v product_id="$product_id" -v release_id="$release_id" <<'SQL'
select
  releases.version::text || ':' ||
  (select count(*) from public.product_release_market_availability availability
    where availability.release_id = releases.id
      and availability.unavailable_at is null)::text || ':' ||
  (select count(*) from public.product_regulatory_outbox_events events
    where events.release_id = releases.id)::text || ':' ||
  (select count(*) from public.audit_logs audits
    where audits.entity_id = releases.id::text
      and audits.action = 'product.release_market_availability_added')::text
from public.product_releases releases
where releases.id = :'release_id'::uuid and releases.product_id = :'product_id'::uuid;
SQL
)

if [[ $effects != "1:1:1:1" ]]; then
  echo "Concurrent release commands produced mixed state: $effects" >&2
  exit 1
fi

echo "M2 V1 release concurrency: one aggregate-version command commits"
