-- Step 5 — product releases + SBOM documents/components (FR-PROD-002, FR-SBOM-*).

create table product_release (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisation(id),
  product_id       uuid not null references product(id),
  version_label    text not null,
  lifecycle_state  text not null default 'development'
                     check (lifecycle_state in ('development','placed_on_market','in_support','end_of_support','withdrawn')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  unique (organisation_id, product_id, version_label)
);
create index product_release_product_idx on product_release (organisation_id, product_id);

create table sbom_document (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisation(id),
  product_release_id uuid not null references product_release(id),
  format             text not null check (format in ('cyclonedx','spdx')),
  spec_version       text not null,
  serial_number      text,
  source             text not null default 'manual_upload'
                       check (source in ('ci_upload','manual_upload','integration','supplier','generated')),
  raw_object_key     text not null,                   -- storage key of the byte-exact original
  content_hash       text not null,                   -- sha256 of raw bytes (FR-SBOM-003)
  validation_status  text not null default 'valid'
                       check (validation_status in ('valid','valid_with_warnings','invalid')),
  validation_report  jsonb not null default '{}'::jsonb,
  component_count    integer not null default 0,
  depth_max          integer not null default 0,
  supersedes_id      uuid references sbom_document(id),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  unique (organisation_id, product_release_id, content_hash)  -- dedup identical uploads
);
create index sbom_document_release_idx on sbom_document (organisation_id, product_release_id);

create table sbom_component (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisation(id),
  sbom_document_id    uuid not null references sbom_document(id),
  purl                text,
  cpe                 text,
  name                text not null,
  version             text,
  ecosystem           text,
  version_normalised  text,
  scope               text,
  depth               integer not null default 0,
  supplier_name       text,
  hashes              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index sbom_component_purl_idx on sbom_component (organisation_id, purl);
create index sbom_component_doc_idx  on sbom_component (organisation_id, sbom_document_id);
create index sbom_component_name_idx on sbom_component (organisation_id, name, version_normalised);

-- RLS: enable + force + the standard org policy on all three (BRD §6.2).
do $$
declare t text;
begin
  foreach t in array array['product_release','sbom_document','sbom_component'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$create policy tenant_isolation on %I
      using      (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
      with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)$f$, t);
    execute format('grant select, insert, update, delete on %I to cras_app', t);
  end loop;
end$$;
