-- =============================================================================
-- M1 V2 multi-entity tenancy and organization-controlled branding.
--
-- This is an additive, database-first rollout. It deliberately preserves the
-- V1 `organization_legal_profiles` contract: legal entities add the new
-- multi-entity boundary without changing onboarding/session behavior. Product,
-- reporting, evidence, supplier-portal, and document owners remain external;
-- they report tenant-scoped dependency projections through the narrow RPC
-- below and retain their own immutable source snapshots.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Canonical server-side helpers. The public API normalizes inputs too, but the
-- storage boundary repeats all security-relevant normalization and validation.
-- ---------------------------------------------------------------------------
create or replace function public.m1_v2_normalize_legal_identifier(p_value text)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select nullif(
    upper(regexp_replace(btrim(normalize(p_value, NFKC)), '\s+', '', 'g')),
    ''
  );
$$;

create or replace function public.m1_v2_legal_entity_request_digest(
  p_identifier text,
  p_display_name text,
  p_legal_name text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_locality text,
  p_administrative_area text,
  p_postal_code text,
  p_registered_address_country text,
  p_main_establishment_country text,
  p_manufacturer_contact_name text,
  p_manufacturer_contact_email text,
  p_phone text,
  p_registration_identifier text,
  p_tax_identifier text
)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select encode(extensions.digest(
    jsonb_build_object(
      'identifier', lower(regexp_replace(btrim(p_identifier), '\s+', ' ', 'g')),
      'displayName', regexp_replace(btrim(p_display_name), '\s+', ' ', 'g'),
      'legalName', regexp_replace(btrim(p_legal_name), '\s+', ' ', 'g'),
      'addressLine1', regexp_replace(btrim(p_address_line_1), '\s+', ' ', 'g'),
      'addressLine2', nullif(regexp_replace(btrim(coalesce(p_address_line_2, '')), '\s+', ' ', 'g'), ''),
      'locality', regexp_replace(btrim(p_locality), '\s+', ' ', 'g'),
      'administrativeArea', nullif(regexp_replace(btrim(coalesce(p_administrative_area, '')), '\s+', ' ', 'g'), ''),
      'postalCode', regexp_replace(btrim(p_postal_code), '\s+', ' ', 'g'),
      'registeredAddressCountry', upper(btrim(p_registered_address_country)),
      'mainEstablishmentCountry', upper(btrim(p_main_establishment_country)),
      'manufacturerContactName', regexp_replace(btrim(p_manufacturer_contact_name), '\s+', ' ', 'g'),
      'manufacturerContactEmail', lower(btrim(p_manufacturer_contact_email)),
      'phone', nullif(btrim(coalesce(p_phone, '')), ''),
      'registrationIdentifier', public.m1_v2_normalize_legal_identifier(p_registration_identifier),
      'taxIdentifier', public.m1_v2_normalize_legal_identifier(p_tax_identifier)
    )::text,
    'sha256'
  ), 'hex');
$$;

create or replace function public.m1_v2_hex_luminance(p_color text)
  returns double precision
  language plpgsql
  immutable
  set search_path = public, pg_temp
as $$
declare
  v_red double precision;
  v_green double precision;
  v_blue double precision;
begin
  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    return null;
  end if;
  v_red := get_byte(decode(substring(p_color from 2 for 2), 'hex'), 0)::double precision / 255;
  v_green := get_byte(decode(substring(p_color from 4 for 2), 'hex'), 0)::double precision / 255;
  v_blue := get_byte(decode(substring(p_color from 6 for 2), 'hex'), 0)::double precision / 255;
  v_red := case when v_red <= 0.03928 then v_red / 12.92 else power((v_red + 0.055) / 1.055, 2.4) end;
  v_green := case when v_green <= 0.03928 then v_green / 12.92 else power((v_green + 0.055) / 1.055, 2.4) end;
  v_blue := case when v_blue <= 0.03928 then v_blue / 12.92 else power((v_blue + 0.055) / 1.055, 2.4) end;
  return 0.2126 * v_red + 0.7152 * v_green + 0.0722 * v_blue;
end;
$$;

create or replace function public.m1_v2_hex_contrast(p_first text, p_second text)
  returns double precision
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select case
    when public.m1_v2_hex_luminance(p_first) is null
      or public.m1_v2_hex_luminance(p_second) is null then null
    else (
      greatest(public.m1_v2_hex_luminance(p_first), public.m1_v2_hex_luminance(p_second)) + 0.05
    ) / (
      least(public.m1_v2_hex_luminance(p_first), public.m1_v2_hex_luminance(p_second)) + 0.05
    )
  end;
$$;

create or replace function public.m1_v2_brand_text_color(p_background text)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select case
    when public.m1_v2_hex_contrast('#000000', p_background)
       >= public.m1_v2_hex_contrast('#FFFFFF', p_background)
    then '#000000'
    else '#FFFFFF'
  end;
$$;

create or replace function public.m1_v2_is_active_organization_member(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.organization_members memberships
      join public.users users on users.id = memberships.user_id and users.is_active
      join public.organizations organizations on organizations.id = memberships.organization_id
     where memberships.organization_id = p_organization_id
       and memberships.user_id = p_actor_user_id
       and organizations.is_active
  );
$$;

create or replace function public.m1_v2_is_active_organization_owner(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.organization_members memberships
      join public.users users on users.id = memberships.user_id and users.is_active
      join public.organizations organizations on organizations.id = memberships.organization_id
     where memberships.organization_id = p_organization_id
       and memberships.user_id = p_actor_user_id
       and memberships.role = 'owner'
       and organizations.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Tenant-scoped legal entities. V2 intentionally permits a legacy default
-- row with unknown legal fields, but only an entirely complete row may become
-- active. No product/report table is invented here: future owners provide
-- projection facts through the authoritative integration boundary below.
-- ---------------------------------------------------------------------------
create table public.organization_legal_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  identifier text not null,
  display_name text not null,
  legal_name text,
  registered_address_line_1 text,
  registered_address_line_2 text,
  registered_address_locality text,
  registered_address_administrative_area text,
  registered_address_postal_code text,
  registered_address_country text,
  main_establishment_country text,
  manufacturer_contact_name text,
  manufacturer_contact_email text,
  phone text,
  registration_identifier text,
  registration_identifier_normalized text,
  tax_identifier text,
  tax_identifier_normalized text,
  completion_status text not null default 'complete',
  status text not null default 'active',
  is_default boolean not null default false,
  version integer not null default 0,
  created_by uuid not null references public.users (id) on delete restrict,
  updated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (organization_id, id),
  constraint organization_legal_entities_identifier_check
    check (identifier = lower(identifier) and identifier ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint organization_legal_entities_display_name_check
    check (length(btrim(display_name)) between 1 and 200),
  constraint organization_legal_entities_legal_name_check
    check (legal_name is null or length(btrim(legal_name)) between 1 and 200),
  constraint organization_legal_entities_address_line_1_check
    check (registered_address_line_1 is null or length(btrim(registered_address_line_1)) between 1 and 200),
  constraint organization_legal_entities_address_line_2_check
    check (registered_address_line_2 is null or length(btrim(registered_address_line_2)) between 1 and 200),
  constraint organization_legal_entities_locality_check
    check (registered_address_locality is null or length(btrim(registered_address_locality)) between 1 and 120),
  constraint organization_legal_entities_area_check
    check (registered_address_administrative_area is null or length(btrim(registered_address_administrative_area)) between 1 and 120),
  constraint organization_legal_entities_postal_code_check
    check (registered_address_postal_code is null or length(btrim(registered_address_postal_code)) between 1 and 32),
  constraint organization_legal_entities_address_country_check
    check (registered_address_country is null or public.is_iso_3166_alpha_2(registered_address_country)),
  constraint organization_legal_entities_establishment_country_check
    check (main_establishment_country is null or public.is_iso_3166_alpha_2(main_establishment_country)),
  constraint organization_legal_entities_contact_name_check
    check (manufacturer_contact_name is null or length(btrim(manufacturer_contact_name)) between 1 and 160),
  constraint organization_legal_entities_contact_email_check
    check (manufacturer_contact_email is null or (
      manufacturer_contact_email = lower(manufacturer_contact_email)
      and length(btrim(manufacturer_contact_email)) between 3 and 254
    )),
  constraint organization_legal_entities_phone_check
    check (phone is null or phone ~ '^\\+[1-9][0-9]{1,14}$'),
  constraint organization_legal_entities_registration_identifier_check
    check ((registration_identifier is null) = (registration_identifier_normalized is null)),
  constraint organization_legal_entities_tax_identifier_check
    check ((tax_identifier is null) = (tax_identifier_normalized is null)),
  constraint organization_legal_entities_normalized_identifier_check
    check (
      (registration_identifier_normalized is null
       or registration_identifier_normalized = public.m1_v2_normalize_legal_identifier(registration_identifier))
      and (tax_identifier_normalized is null
       or tax_identifier_normalized = public.m1_v2_normalize_legal_identifier(tax_identifier))
    ),
  constraint organization_legal_entities_completion_check check (
    (completion_status = 'complete'
      and legal_name is not null
      and registered_address_line_1 is not null
      and registered_address_locality is not null
      and registered_address_postal_code is not null
      and registered_address_country is not null
      and main_establishment_country is not null
      and manufacturer_contact_name is not null
      and manufacturer_contact_email is not null)
    or
    (completion_status = 'needs_completion'
      and status = 'inactive'
      and legal_name is null
      and registered_address_line_1 is null
      and registered_address_line_2 is null
      and registered_address_locality is null
      and registered_address_administrative_area is null
      and registered_address_postal_code is null
      and registered_address_country is null
      and main_establishment_country is null
      and manufacturer_contact_name is null
      and manufacturer_contact_email is null
      and phone is null
      and registration_identifier is null
      and registration_identifier_normalized is null
      and tax_identifier is null
      and tax_identifier_normalized is null)
  ),
  constraint organization_legal_entities_status_check
    check (status in ('active', 'inactive', 'deleted')),
  constraint organization_legal_entities_completion_status_check
    check (completion_status in ('complete', 'needs_completion')),
  constraint organization_legal_entities_version_check check (version >= 0),
  constraint organization_legal_entities_deletion_check check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  )
);

create unique index organization_legal_entities_identifier_key
  on public.organization_legal_entities (organization_id, identifier);
create unique index organization_legal_entities_default_key
  on public.organization_legal_entities (organization_id) where is_default;
create unique index organization_legal_entities_registration_identifier_key
  on public.organization_legal_entities (organization_id, registration_identifier_normalized)
  where registration_identifier_normalized is not null;
create unique index organization_legal_entities_tax_identifier_key
  on public.organization_legal_entities (organization_id, tax_identifier_normalized)
  where tax_identifier_normalized is not null;
create index organization_legal_entities_org_status_idx
  on public.organization_legal_entities (organization_id, status, updated_at desc);
create index organization_legal_entities_created_by_idx
  on public.organization_legal_entities (created_by);
create index organization_legal_entities_updated_by_idx
  on public.organization_legal_entities (updated_by, updated_at desc);

drop trigger if exists set_organization_legal_entities_updated_at on public.organization_legal_entities;
create trigger set_organization_legal_entities_updated_at
  before update on public.organization_legal_entities
  for each row execute function public.set_updated_at();

create table public.organization_legal_entity_create_idempotencies (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references public.users (id) on delete cascade,
  idempotency_key uuid not null,
  request_digest text not null,
  legal_entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, legal_entity_id)
    references public.organization_legal_entities (organization_id, id) on delete cascade,
  constraint organization_legal_entity_create_idempotencies_digest_check
    check (request_digest ~ '^[0-9a-f]{64}$')
);

create index organization_legal_entity_create_idempotencies_entity_idx
  on public.organization_legal_entity_create_idempotencies (organization_id, legal_entity_id);
create index organization_legal_entity_create_idempotencies_actor_idx
  on public.organization_legal_entity_create_idempotencies (actor_user_id);

create table public.organization_legal_entity_dependency_authorities (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  authority_kind text not null,
  available boolean not null default false,
  last_reconciled_at timestamptz,
  reconciled_by uuid references public.users (id) on delete set null,
  safe_error_code text,
  primary key (organization_id, legal_entity_id, authority_kind),
  foreign key (organization_id, legal_entity_id)
    references public.organization_legal_entities (organization_id, id) on delete cascade,
  constraint organization_legal_entity_dependency_authority_kind_check
    check (authority_kind in (
      'product', 'report', 'obligation', 'legal_hold', 'retention',
      'supplier_portal', 'document_generation'
    )),
  constraint organization_legal_entity_dependency_authority_error_check
    check (safe_error_code is null or safe_error_code ~ '^[a-z][a-z0-9_]{0,63}$')
);

create index organization_legal_entity_dependency_authorities_org_idx
  on public.organization_legal_entity_dependency_authorities (organization_id, authority_kind, available);
create index organization_legal_entity_dependency_authorities_reconciled_by_idx
  on public.organization_legal_entity_dependency_authorities (reconciled_by);

-- A source record is unique per tenant/kind, not per entity. During a product
-- move, an authoritative projection therefore relocates the record rather than
-- allowing old and new entity rows to coexist and inflate group rollups.
create table public.organization_legal_entity_dependency_facts (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authority_kind text not null,
  source_record_id uuid not null,
  legal_entity_id uuid not null,
  record_count integer not null,
  reconciled_at timestamptz not null default now(),
  reconciled_by uuid references public.users (id) on delete set null,
  primary key (organization_id, authority_kind, source_record_id),
  foreign key (organization_id, legal_entity_id)
    references public.organization_legal_entities (organization_id, id) on delete cascade,
  constraint organization_legal_entity_dependency_fact_kind_check
    check (authority_kind in (
      'product', 'report', 'obligation', 'legal_hold', 'retention',
      'supplier_portal', 'document_generation'
    )),
  constraint organization_legal_entity_dependency_fact_count_check
    check (record_count >= 0)
);

create index organization_legal_entity_dependency_facts_entity_idx
  on public.organization_legal_entity_dependency_facts (organization_id, legal_entity_id, authority_kind);
create index organization_legal_entity_dependency_facts_reconciled_by_idx
  on public.organization_legal_entity_dependency_facts (reconciled_by);

-- ---------------------------------------------------------------------------
-- Versioned organization branding. Inputs remain in a private Storage bucket;
-- tables retain only approved metadata and server-generated object keys. The
-- resolved consumer JSON never emits that key or a signed/public URL.
-- ---------------------------------------------------------------------------
create table public.organization_branding_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  state text not null default 'reserved',
  source_mime_type text,
  normalized_mime_type text,
  content_hash text,
  object_path text,
  input_bytes integer,
  normalized_bytes integer,
  width integer,
  height integer,
  alt_text text,
  scanner_status text not null default 'pending',
  failure_code text,
  created_by uuid not null references public.users (id) on delete restrict,
  updated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint organization_branding_assets_state_check
    check (state in ('reserved', 'approved', 'quarantined', 'failed', 'removed')),
  constraint organization_branding_assets_source_mime_check
    check (source_mime_type is null or source_mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint organization_branding_assets_normalized_mime_check
    check (normalized_mime_type is null or normalized_mime_type = 'image/webp'),
  constraint organization_branding_assets_hash_check
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  constraint organization_branding_assets_input_bytes_check
    check (input_bytes is null or input_bytes between 1 and 2097152),
  constraint organization_branding_assets_normalized_bytes_check
    check (normalized_bytes is null or normalized_bytes between 1 and 2097152),
  constraint organization_branding_assets_dimensions_check
    check ((width is null and height is null) or (
      width between 64 and 2048 and height between 64 and 2048 and width * height <= 16000000
    )),
  constraint organization_branding_assets_alt_text_check
    check (alt_text is null or length(btrim(alt_text)) between 1 and 160),
  constraint organization_branding_assets_scanner_check
    check (scanner_status in ('pending', 'clean', 'scanner_not_available', 'infected', 'unavailable')),
  constraint organization_branding_assets_failure_code_check
    check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint organization_branding_assets_path_check check (
    object_path is null or object_path = organization_id::text || '/' || id::text || '/' || content_hash || '.webp'
  ),
  constraint organization_branding_assets_state_metadata_check check (
    (state = 'reserved' and content_hash is null and object_path is null and width is null and height is null)
    or (state = 'approved'
      and source_mime_type is not null
      and normalized_mime_type = 'image/webp'
      and content_hash is not null
      and object_path is not null
      and input_bytes is not null
      and width is not null
      and height is not null
      and scanner_status in ('clean', 'scanner_not_available')
      and failure_code is null)
    or (state in ('quarantined', 'failed', 'removed') and failure_code is not null)
  )
);

create index organization_branding_assets_org_state_idx
  on public.organization_branding_assets (organization_id, state, created_at desc);
create index organization_branding_assets_created_by_idx
  on public.organization_branding_assets (created_by);
create index organization_branding_assets_updated_by_idx
  on public.organization_branding_assets (updated_by, updated_at desc);

drop trigger if exists set_organization_branding_assets_updated_at on public.organization_branding_assets;
create trigger set_organization_branding_assets_updated_at
  before update on public.organization_branding_assets
  for each row execute function public.set_updated_at();

create table public.organization_branding_drafts (
  id uuid not null default gen_random_uuid() unique,
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  display_name text not null,
  primary_color text not null,
  secondary_color text not null,
  footer_text text,
  contact_text text,
  logo_asset_id uuid,
  version integer not null default 0,
  created_by uuid not null references public.users (id) on delete restrict,
  updated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, logo_asset_id)
    references public.organization_branding_assets (organization_id, id) on delete restrict,
  constraint organization_branding_drafts_display_name_check
    check (length(btrim(display_name)) between 1 and 200),
  constraint organization_branding_drafts_footer_text_check
    check (footer_text is null or length(btrim(footer_text)) between 1 and 280),
  constraint organization_branding_drafts_contact_text_check
    check (contact_text is null or length(btrim(contact_text)) between 1 and 280),
  constraint organization_branding_drafts_primary_color_check
    check (primary_color ~ '^#[0-9A-F]{6}$' and public.m1_v2_hex_contrast(primary_color, public.m1_v2_brand_text_color(primary_color)) >= 4.5),
  constraint organization_branding_drafts_secondary_color_check
    check (secondary_color ~ '^#[0-9A-F]{6}$' and public.m1_v2_hex_contrast(secondary_color, public.m1_v2_brand_text_color(secondary_color)) >= 4.5),
  constraint organization_branding_drafts_version_check check (version >= 0)
);

create index organization_branding_drafts_updated_by_idx
  on public.organization_branding_drafts (updated_by, updated_at desc);
create index organization_branding_drafts_created_by_idx
  on public.organization_branding_drafts (created_by);
create index organization_branding_drafts_logo_asset_idx
  on public.organization_branding_drafts (organization_id, logo_asset_id)
  where logo_asset_id is not null;

drop trigger if exists set_organization_branding_drafts_updated_at on public.organization_branding_drafts;
create trigger set_organization_branding_drafts_updated_at
  before update on public.organization_branding_drafts
  for each row execute function public.set_updated_at();

create table public.organization_branding_versions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version integer not null,
  draft_version integer not null,
  display_name text not null,
  footer_text text,
  contact_text text,
  primary_color text not null,
  primary_text_color text not null,
  secondary_color text not null,
  secondary_text_color text not null,
  logo_asset_id uuid,
  logo_width integer,
  logo_height integer,
  logo_sha256 text,
  logo_alt_text text,
  published_by uuid not null references public.users (id) on delete restrict,
  published_at timestamptz not null default now(),
  primary key (organization_id, version),
  foreign key (organization_id, logo_asset_id)
    references public.organization_branding_assets (organization_id, id) on delete restrict,
  constraint organization_branding_versions_version_check check (version > 0 and draft_version >= 0),
  constraint organization_branding_versions_display_name_check check (length(btrim(display_name)) between 1 and 200),
  constraint organization_branding_versions_footer_text_check
    check (footer_text is null or length(btrim(footer_text)) between 1 and 280),
  constraint organization_branding_versions_contact_text_check
    check (contact_text is null or length(btrim(contact_text)) between 1 and 280),
  constraint organization_branding_versions_primary_color_check check (
    primary_color ~ '^#[0-9A-F]{6}$'
    and primary_text_color in ('#000000', '#FFFFFF')
    and primary_text_color = public.m1_v2_brand_text_color(primary_color)
    and public.m1_v2_hex_contrast(primary_color, primary_text_color) >= 4.5
  ),
  constraint organization_branding_versions_secondary_color_check check (
    secondary_color ~ '^#[0-9A-F]{6}$'
    and secondary_text_color in ('#000000', '#FFFFFF')
    and secondary_text_color = public.m1_v2_brand_text_color(secondary_color)
    and public.m1_v2_hex_contrast(secondary_color, secondary_text_color) >= 4.5
  ),
  constraint organization_branding_versions_logo_snapshot_check check (
    (logo_asset_id is null and logo_width is null and logo_height is null and logo_sha256 is null and logo_alt_text is null)
    or (logo_asset_id is not null
      and logo_width between 64 and 2048
      and logo_height between 64 and 2048
      and logo_width * logo_height <= 16000000
      and logo_sha256 ~ '^[0-9a-f]{64}$'
      and (logo_alt_text is null or length(btrim(logo_alt_text)) between 1 and 160))
  )
);

create index organization_branding_versions_published_by_idx
  on public.organization_branding_versions (published_by, published_at desc);
create index organization_branding_versions_logo_asset_idx
  on public.organization_branding_versions (organization_id, logo_asset_id)
  where logo_asset_id is not null;

create table public.organization_branding_publish_idempotencies (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references public.users (id) on delete cascade,
  idempotency_key uuid not null,
  operation text not null,
  request_digest text not null,
  version integer not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, version)
    references public.organization_branding_versions (organization_id, version) on delete cascade,
  constraint organization_branding_publish_idempotencies_operation_check
    check (operation in ('publish', 'remove_logo')),
  constraint organization_branding_publish_idempotencies_digest_check
    check (request_digest ~ '^[0-9a-f]{64}$')
);

create index organization_branding_publish_idempotencies_version_idx
  on public.organization_branding_publish_idempotencies (organization_id, version);
create index organization_branding_publish_idempotencies_actor_idx
  on public.organization_branding_publish_idempotencies (actor_user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-branding', 'organization-branding', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']::text[];

-- Every entity begins fail-closed until each external authoritative owner has
-- reconciled its projection. This makes lifecycle changes safe even while the
-- future product/report applications are not yet installed.
create or replace function public.initialize_organization_legal_entity_dependencies()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  insert into public.organization_legal_entity_dependency_authorities (
    organization_id, legal_entity_id, authority_kind
  )
  select new.organization_id, new.id, kind
    from unnest(array[
      'product', 'report', 'obligation', 'legal_hold', 'retention'
    ]) as kind
  on conflict (organization_id, legal_entity_id, authority_kind) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_organization_legal_entity_dependencies_on_insert
  on public.organization_legal_entities;
create trigger initialize_organization_legal_entity_dependencies_on_insert
  after insert on public.organization_legal_entities
  for each row execute function public.initialize_organization_legal_entity_dependencies();

-- Profile creation remains the established M1 organization onboarding flow.
-- This trigger adds the default V2 entity in the same transaction, preserving
-- the RPC signature and allowing a legacy incomplete default to be completed
-- if a profile is subsequently supplied.
create or replace function public.ensure_default_legal_entity_for_profile()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_entity public.organization_legal_entities%rowtype;
begin
  select * into v_entity
    from public.organization_legal_entities
   where organization_id = new.organization_id and is_default
   for update;

  if not found then
    insert into public.organization_legal_entities (
      organization_id, identifier, display_name, legal_name,
      registered_address_line_1, registered_address_line_2,
      registered_address_locality, registered_address_administrative_area,
      registered_address_postal_code, registered_address_country,
      main_establishment_country, manufacturer_contact_name,
      manufacturer_contact_email, phone, completion_status, status,
      is_default, created_by, updated_by
    ) values (
      new.organization_id, 'default', new.legal_name, new.legal_name,
      new.registered_address_line_1, new.registered_address_line_2,
      new.registered_address_locality, new.registered_address_administrative_area,
      new.registered_address_postal_code, new.registered_address_country,
      new.main_establishment_country, new.manufacturer_contact_name,
      new.manufacturer_contact_email, new.manufacturer_contact_phone,
      'complete', 'active', true, new.created_by, new.updated_by
    );
  elsif v_entity.completion_status = 'needs_completion' then
    update public.organization_legal_entities
       set display_name = new.legal_name,
           legal_name = new.legal_name,
           registered_address_line_1 = new.registered_address_line_1,
           registered_address_line_2 = new.registered_address_line_2,
           registered_address_locality = new.registered_address_locality,
           registered_address_administrative_area = new.registered_address_administrative_area,
           registered_address_postal_code = new.registered_address_postal_code,
           registered_address_country = new.registered_address_country,
           main_establishment_country = new.main_establishment_country,
           manufacturer_contact_name = new.manufacturer_contact_name,
           manufacturer_contact_email = new.manufacturer_contact_email,
           phone = new.manufacturer_contact_phone,
           completion_status = 'complete',
           status = 'active',
           version = version + 1,
           updated_by = new.updated_by,
           deleted_at = null
     where id = v_entity.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_default_legal_entity_for_profile_on_insert
  on public.organization_legal_profiles;
create trigger ensure_default_legal_entity_for_profile_on_insert
  after insert on public.organization_legal_profiles
  for each row execute function public.ensure_default_legal_entity_for_profile();

-- The helper is deliberately idempotent so an interrupted migration/backfill
-- can be rerun safely by an operator. A historical organization without a
-- profile has no truthful legal/contact values to copy, so it receives only
-- its existing display name and remains inactive until completed.
create or replace function public.backfill_organization_legal_entities()
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_system_actor uuid;
begin
  -- A malformed legacy tenant can theoretically have no remaining active
  -- member. Do not silently skip it: retain an inactive, non-authenticated
  -- system actor purely for attributable migration provenance. It can never
  -- satisfy member/owner authorization because it has no membership and is
  -- inactive.
  insert into public.users (email, is_active)
  values ('system-legal-entity-backfill@cra.invalid', false)
  on conflict do nothing;
  select id into v_system_actor from public.users
   where lower(email) = 'system-legal-entity-backfill@cra.invalid'
   order by created_at
   limit 1;

  insert into public.organization_legal_entities (
    organization_id, identifier, display_name, legal_name,
    registered_address_line_1, registered_address_line_2,
    registered_address_locality, registered_address_administrative_area,
    registered_address_postal_code, registered_address_country,
    main_establishment_country, manufacturer_contact_name,
    manufacturer_contact_email, phone, completion_status, status,
    is_default, created_by, updated_by
  )
  select profiles.organization_id, 'default', profiles.legal_name, profiles.legal_name,
    profiles.registered_address_line_1, profiles.registered_address_line_2,
    profiles.registered_address_locality, profiles.registered_address_administrative_area,
    profiles.registered_address_postal_code, profiles.registered_address_country,
    profiles.main_establishment_country, profiles.manufacturer_contact_name,
    profiles.manufacturer_contact_email, profiles.manufacturer_contact_phone,
    'complete', 'active', true, profiles.created_by, profiles.updated_by
  from public.organization_legal_profiles profiles
  where not exists (
    select 1 from public.organization_legal_entities entities
     where entities.organization_id = profiles.organization_id and entities.is_default
  );

  insert into public.organization_legal_entities (
    organization_id, identifier, display_name, completion_status, status,
    is_default, created_by, updated_by
  )
  select organizations.id, 'default', organizations.name, 'needs_completion', 'inactive',
    true, coalesce(actors.user_id, v_system_actor), coalesce(actors.user_id, v_system_actor)
  from public.organizations organizations
  left join lateral (
    select memberships.user_id
      from public.organization_members memberships
      join public.users users on users.id = memberships.user_id and users.is_active
     where memberships.organization_id = organizations.id
     order by (memberships.role = 'owner') desc, memberships.created_at, memberships.id
     limit 1
  ) actors on true
  where not exists (
    select 1 from public.organization_legal_entities entities
     where entities.organization_id = organizations.id and entities.is_default
  );

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  select entities.organization_id, entities.created_by, 'organization.legal_entity_backfilled',
    'organization_legal_entity', entities.id::text,
    jsonb_build_object(
      'completionStatus', entities.completion_status,
      'status', entities.status,
      'isDefault', true
    )
  from public.organization_legal_entities entities
  where entities.is_default
    and not exists (
      select 1 from public.audit_logs logs
       where logs.organization_id = entities.organization_id
         and logs.action = 'organization.legal_entity_backfilled'
         and logs.entity_id = entities.id::text
    );
end;
$$;

select public.backfill_organization_legal_entities();

create or replace function public.m1_v2_legal_entity_dependency_json(
  p_organization_id uuid,
  p_legal_entity_id uuid
)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('kind', kinds.kind, 'count', coalesce(facts.record_count, 0))
    order by kinds.sort_order
  ), '[]'::jsonb)
  from (values
    ('product', 1), ('report', 2), ('obligation', 3), ('legal_hold', 4),
    ('supplier_portal', 5), ('document_generation', 6)
  ) as kinds(kind, sort_order)
  left join lateral (
    select sum(record_count)::integer as record_count
      from public.organization_legal_entity_dependency_facts facts
     where facts.organization_id = p_organization_id
       and facts.legal_entity_id = p_legal_entity_id
       and facts.authority_kind = kinds.kind
  ) facts on true;
$$;

create or replace function public.m1_v2_legal_entity_json(p_legal_entity_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', entities.id,
    'organizationId', entities.organization_id,
    'identifier', entities.identifier,
    'displayName', entities.display_name,
    'legalName', entities.legal_name,
    'registeredAddress', case
      when entities.registered_address_line_1 is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'addressLine1', entities.registered_address_line_1,
        'addressLine2', entities.registered_address_line_2,
        'locality', entities.registered_address_locality,
        'administrativeArea', entities.registered_address_administrative_area,
        'postalCode', entities.registered_address_postal_code,
        'country', entities.registered_address_country
      ))
    end,
    'mainEstablishmentCountry', entities.main_establishment_country,
    'phone', entities.phone,
    'registrationIdentifier', entities.registration_identifier_normalized,
    'taxIdentifier', entities.tax_identifier_normalized,
    'manufacturerContactName', entities.manufacturer_contact_name,
    'manufacturerContactEmail', entities.manufacturer_contact_email,
    'status', entities.status,
    'completionStatus', entities.completion_status,
    'isDefault', entities.is_default,
    'version', entities.version,
    'dependencyProjections', public.m1_v2_legal_entity_dependency_json(
      entities.organization_id, entities.id
    ),
    'createdAt', entities.created_at,
    'updatedAt', entities.updated_at,
    'createdBy', entities.created_by,
    'updatedBy', entities.updated_by,
    'deletedAt', entities.deleted_at
  )
  from public.organization_legal_entities entities
  where entities.id = p_legal_entity_id;
$$;

create or replace function public.get_organization_legal_entities(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, legal_entities jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, coalesce(jsonb_agg(
    public.m1_v2_legal_entity_json(entities.id) order by entities.is_default desc, entities.display_name, entities.id
  ), '[]'::jsonb)
  from public.organization_legal_entities entities
  where entities.organization_id = p_organization_id
    and entities.status <> 'deleted';
end;
$$;

create or replace function public.get_organization_legal_entity(
  p_organization_id uuid,
  p_legal_entity_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, legal_entity jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id)
     or not exists (
       select 1 from public.organization_legal_entities entities
        where entities.organization_id = p_organization_id
          and entities.id = p_legal_entity_id
          and entities.status <> 'deleted'
     ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, public.m1_v2_legal_entity_json(p_legal_entity_id);
end;
$$;

create or replace function public.create_organization_legal_entity_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_identifier text,
  p_display_name text,
  p_legal_name text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_locality text,
  p_administrative_area text,
  p_postal_code text,
  p_registered_address_country text,
  p_main_establishment_country text,
  p_manufacturer_contact_name text,
  p_manufacturer_contact_email text,
  p_phone text,
  p_registration_identifier text,
  p_tax_identifier text
)
  returns table (outcome text, legal_entity jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_replay public.organization_legal_entity_create_idempotencies%rowtype;
  v_entity_id uuid;
  v_request_digest text;
  v_identifier text := lower(btrim(p_identifier));
  v_display_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_legal_name text := regexp_replace(btrim(p_legal_name), '\s+', ' ', 'g');
  v_line_1 text := regexp_replace(btrim(p_address_line_1), '\s+', ' ', 'g');
  v_line_2 text := nullif(regexp_replace(btrim(coalesce(p_address_line_2, '')), '\s+', ' ', 'g'), '');
  v_locality text := regexp_replace(btrim(p_locality), '\s+', ' ', 'g');
  v_area text := nullif(regexp_replace(btrim(coalesce(p_administrative_area, '')), '\s+', ' ', 'g'), '');
  v_postal_code text := regexp_replace(btrim(p_postal_code), '\s+', ' ', 'g');
  v_address_country text := upper(btrim(p_registered_address_country));
  v_establishment_country text := upper(btrim(p_main_establishment_country));
  v_contact_name text := regexp_replace(btrim(p_manufacturer_contact_name), '\s+', ' ', 'g');
  v_contact_email text := lower(btrim(p_manufacturer_contact_email));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_registration_identifier text := nullif(btrim(p_registration_identifier), '');
  v_registration_identifier_normalized text := public.m1_v2_normalize_legal_identifier(p_registration_identifier);
  v_tax_identifier text := nullif(btrim(p_tax_identifier), '');
  v_tax_identifier_normalized text := public.m1_v2_normalize_legal_identifier(p_tax_identifier);
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if p_idempotency_key is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  v_request_digest := public.m1_v2_legal_entity_request_digest(
    v_identifier, v_display_name, v_legal_name, v_line_1, v_line_2,
    v_locality, v_area, v_postal_code, v_address_country, v_establishment_country,
    v_contact_name, v_contact_email, v_phone, v_registration_identifier, v_tax_identifier
  );

  select * into v_replay
    from public.organization_legal_entity_create_idempotencies idempotencies
   where idempotencies.organization_id = p_organization_id
     and idempotencies.actor_user_id = p_actor_user_id
     and idempotencies.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_replay.request_digest = v_request_digest then
      return query select 'replayed'::text, public.m1_v2_legal_entity_json(v_replay.legal_entity_id);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;

  insert into public.organization_legal_entities (
    organization_id, identifier, display_name, legal_name,
    registered_address_line_1, registered_address_line_2,
    registered_address_locality, registered_address_administrative_area,
    registered_address_postal_code, registered_address_country,
    main_establishment_country, manufacturer_contact_name,
    manufacturer_contact_email, phone, registration_identifier,
    registration_identifier_normalized, tax_identifier, tax_identifier_normalized,
    completion_status, status, created_by, updated_by
  ) values (
    p_organization_id, v_identifier, v_display_name, v_legal_name,
    v_line_1, v_line_2, v_locality, v_area, v_postal_code, v_address_country,
    v_establishment_country, v_contact_name, v_contact_email, v_phone,
    v_registration_identifier, v_registration_identifier_normalized,
    v_tax_identifier, v_tax_identifier_normalized,
    'complete', 'active', p_actor_user_id, p_actor_user_id
  ) returning id into v_entity_id;

  insert into public.organization_legal_entity_create_idempotencies (
    organization_id, actor_user_id, idempotency_key, request_digest, legal_entity_id
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key, v_request_digest, v_entity_id
  );
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.legal_entity_created',
    'organization_legal_entity', v_entity_id::text,
    jsonb_build_object(
      'after', jsonb_build_object(
        'identifier', v_identifier, 'displayName', v_display_name,
        'status', 'active', 'completionStatus', 'complete', 'version', 0
      )
    )
  );
  return query select 'created'::text, public.m1_v2_legal_entity_json(v_entity_id);
exception
  when unique_violation then
    select * into v_replay
      from public.organization_legal_entity_create_idempotencies idempotencies
     where idempotencies.organization_id = p_organization_id
       and idempotencies.actor_user_id = p_actor_user_id
       and idempotencies.idempotency_key = p_idempotency_key;
    if found and v_replay.request_digest = v_request_digest then
      return query select 'replayed'::text, public.m1_v2_legal_entity_json(v_replay.legal_entity_id);
    end if;
    return query select 'conflict'::text, null::jsonb;
  when check_violation or invalid_parameter_value then
    return query select 'invalid_request'::text, null::jsonb;
end;
$$;

create or replace function public.update_organization_legal_entity_atomic(
  p_organization_id uuid,
  p_legal_entity_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_identifier text,
  p_display_name text,
  p_legal_name text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_locality text,
  p_administrative_area text,
  p_postal_code text,
  p_registered_address_country text,
  p_main_establishment_country text,
  p_manufacturer_contact_name text,
  p_manufacturer_contact_email text,
  p_phone text,
  p_registration_identifier text,
  p_tax_identifier text
)
  returns table (outcome text, legal_entity jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_entity public.organization_legal_entities%rowtype;
  v_identifier text := lower(btrim(p_identifier));
  v_display_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_legal_name text := regexp_replace(btrim(p_legal_name), '\s+', ' ', 'g');
  v_line_1 text := regexp_replace(btrim(p_address_line_1), '\s+', ' ', 'g');
  v_line_2 text := nullif(regexp_replace(btrim(coalesce(p_address_line_2, '')), '\s+', ' ', 'g'), '');
  v_locality text := regexp_replace(btrim(p_locality), '\s+', ' ', 'g');
  v_area text := nullif(regexp_replace(btrim(coalesce(p_administrative_area, '')), '\s+', ' ', 'g'), '');
  v_postal_code text := regexp_replace(btrim(p_postal_code), '\s+', ' ', 'g');
  v_address_country text := upper(btrim(p_registered_address_country));
  v_establishment_country text := upper(btrim(p_main_establishment_country));
  v_contact_name text := regexp_replace(btrim(p_manufacturer_contact_name), '\s+', ' ', 'g');
  v_contact_email text := lower(btrim(p_manufacturer_contact_email));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_registration_identifier text := nullif(btrim(p_registration_identifier), '');
  v_registration_identifier_normalized text := public.m1_v2_normalize_legal_identifier(p_registration_identifier);
  v_tax_identifier text := nullif(btrim(p_tax_identifier), '');
  v_tax_identifier_normalized text := public.m1_v2_normalize_legal_identifier(p_tax_identifier);
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_entity
    from public.organization_legal_entities entities
   where entities.organization_id = p_organization_id and entities.id = p_legal_entity_id
   for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_entity.status = 'deleted' then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  if p_expected_version is null or v_entity.version <> p_expected_version then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;

  update public.organization_legal_entities
     set identifier = v_identifier,
         display_name = v_display_name,
         legal_name = v_legal_name,
         registered_address_line_1 = v_line_1,
         registered_address_line_2 = v_line_2,
         registered_address_locality = v_locality,
         registered_address_administrative_area = v_area,
         registered_address_postal_code = v_postal_code,
         registered_address_country = v_address_country,
         main_establishment_country = v_establishment_country,
         manufacturer_contact_name = v_contact_name,
         manufacturer_contact_email = v_contact_email,
         phone = v_phone,
         registration_identifier = v_registration_identifier,
         registration_identifier_normalized = v_registration_identifier_normalized,
         tax_identifier = v_tax_identifier,
         tax_identifier_normalized = v_tax_identifier_normalized,
         completion_status = 'complete',
         version = version + 1,
         updated_by = p_actor_user_id
   where id = p_legal_entity_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.legal_entity_updated',
    'organization_legal_entity', p_legal_entity_id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'identifier', v_entity.identifier, 'displayName', v_entity.display_name,
        'status', v_entity.status, 'completionStatus', v_entity.completion_status,
        'version', v_entity.version
      ),
      'after', jsonb_build_object(
        'identifier', v_identifier, 'displayName', v_display_name,
        'status', v_entity.status, 'completionStatus', 'complete',
        'version', v_entity.version + 1
      )
    )
  );
  return query select 'updated'::text, public.m1_v2_legal_entity_json(p_legal_entity_id);
exception
  when unique_violation then
    return query select 'conflict'::text, null::jsonb;
  when check_violation or invalid_parameter_value then
    return query select 'invalid_request'::text, null::jsonb;
end;
$$;

create or replace function public.m1_v2_legal_entity_lifecycle_block_reason(
  p_organization_id uuid,
  p_legal_entity_id uuid
)
  returns text
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
declare v_kind text;
begin
  select required.kind into v_kind
    from unnest(array['product', 'report', 'obligation', 'legal_hold', 'retention']) required(kind)
   where not exists (
     select 1 from public.organization_legal_entity_dependency_authorities authorities
      where authorities.organization_id = p_organization_id
        and authorities.legal_entity_id = p_legal_entity_id
        and authorities.authority_kind = required.kind
        and authorities.available
   )
   limit 1;
  if v_kind is not null then return 'dependency_authority_unavailable'; end if;
  if exists (select 1 from public.organization_legal_entity_dependency_facts facts
    where facts.organization_id = p_organization_id and facts.legal_entity_id = p_legal_entity_id
      and facts.authority_kind = 'product' and facts.record_count > 0) then
    return 'active_products';
  end if;
  if exists (select 1 from public.organization_legal_entity_dependency_facts facts
    where facts.organization_id = p_organization_id and facts.legal_entity_id = p_legal_entity_id
      and facts.authority_kind in ('report', 'obligation') and facts.record_count > 0) then
    return 'reporting_obligations';
  end if;
  if exists (select 1 from public.organization_legal_entity_dependency_facts facts
    where facts.organization_id = p_organization_id and facts.legal_entity_id = p_legal_entity_id
      and facts.authority_kind = 'retention' and facts.record_count > 0) then
    return 'retention_requirements';
  end if;
  if exists (select 1 from public.organization_legal_entity_dependency_facts facts
    where facts.organization_id = p_organization_id and facts.legal_entity_id = p_legal_entity_id
      and facts.authority_kind = 'legal_hold' and facts.record_count > 0) then
    return 'legal_holds';
  end if;
  return null;
end;
$$;

create or replace function public.transition_organization_legal_entity_atomic(
  p_organization_id uuid,
  p_legal_entity_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_status text
)
  returns table (outcome text, legal_entity jsonb, block_reason text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_entity public.organization_legal_entities%rowtype;
  v_block_reason text;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::text;
    return;
  end if;
  select * into v_entity from public.organization_legal_entities entities
   where entities.organization_id = p_organization_id and entities.id = p_legal_entity_id
   for update;
  if not found then
    return query select 'not_found'::text, null::jsonb, null::text;
    return;
  end if;
  if p_expected_version is null or v_entity.version <> p_expected_version then
    return query select 'conflict'::text, null::jsonb, null::text;
    return;
  end if;
  if p_status not in ('active', 'inactive', 'deleted') or p_status = v_entity.status then
    return query select 'invalid_state'::text, null::jsonb, null::text;
    return;
  end if;
  if p_status = 'active' then
    if v_entity.status = 'deleted' or v_entity.completion_status <> 'complete' then
      return query select 'invalid_state'::text, null::jsonb, null::text;
      return;
    end if;
  else
    if v_entity.is_default and p_status = 'deleted' then
      return query select 'invalid_state'::text, null::jsonb, null::text;
      return;
    end if;
    v_block_reason := public.m1_v2_legal_entity_lifecycle_block_reason(
      p_organization_id, p_legal_entity_id
    );
    if v_block_reason is not null then
      return query select 'blocked'::text, null::jsonb, v_block_reason;
      return;
    end if;
  end if;
  update public.organization_legal_entities
     set status = p_status,
         deleted_at = case when p_status = 'deleted' then now() else null end,
         version = version + 1,
         updated_by = p_actor_user_id
   where id = p_legal_entity_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.legal_entity_lifecycle_changed',
    'organization_legal_entity', p_legal_entity_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', v_entity.status, 'version', v_entity.version),
      'after', jsonb_build_object('status', p_status, 'version', v_entity.version + 1)
    )
  );
  return query select 'transitioned'::text,
    public.m1_v2_legal_entity_json(p_legal_entity_id), null::text;
end;
$$;

-- Inward-facing context resolver used only by the owning product/report
-- applications. It returns a value snapshot, not a mutable row reference, so
-- the owner can persist the legal entity context that was true at creation.
create or replace function public.resolve_active_organization_legal_entity_context(
  p_organization_id uuid,
  p_legal_entity_id uuid
)
  returns table (outcome text, context jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_entity public.organization_legal_entities%rowtype;
begin
  select * into v_entity
    from public.organization_legal_entities entities
   where entities.organization_id = p_organization_id and entities.id = p_legal_entity_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_entity.completion_status <> 'complete' then
    return query select 'incomplete'::text, null::jsonb;
    return;
  end if;
  if v_entity.status <> 'active' then
    return query select 'inactive'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, jsonb_build_object(
    'organizationId', v_entity.organization_id,
    'legalEntityId', v_entity.id,
    'legalEntityVersion', v_entity.version,
    'legalEntitySnapshot', public.m1_v2_legal_entity_json(v_entity.id)
  );
end;
$$;

create or replace function public.reconcile_organization_legal_entity_dependencies_atomic(
  p_organization_id uuid,
  p_legal_entity_id uuid,
  p_actor_user_id uuid,
  p_authority_kind text,
  p_available boolean,
  p_facts jsonb
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_entity_exists boolean;
  v_fact jsonb;
  v_record_id uuid;
  v_record_count integer;
  v_facts_count integer := 0;
begin
  -- This is an application-owner integration port, not a browser operation.
  -- An active member is still required for an attributable audit fact, while
  -- the calling application remains responsible for its own narrower grant.
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text;
    return;
  end if;
  select exists (
    select 1 from public.organization_legal_entities entities
     where entities.organization_id = p_organization_id and entities.id = p_legal_entity_id
  ) into v_entity_exists;
  if not v_entity_exists then
    return query select 'not_found'::text;
    return;
  end if;
  if p_authority_kind not in (
    'product', 'report', 'obligation', 'legal_hold', 'retention',
    'supplier_portal', 'document_generation'
  ) or p_available is null or p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    return query select 'invalid_authority'::text;
    return;
  end if;

  -- Serializing one tenant/authority projection ensures a move cannot create
  -- two entity rows for a stable source ID while concurrent reconcilers race.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_authority_kind, 0
  ));

  for v_fact in select value from jsonb_array_elements(p_facts) loop
    if jsonb_typeof(v_fact) <> 'object'
       or (select count(*) from jsonb_object_keys(v_fact)) <> 2
       or not (v_fact ? 'recordId' and v_fact ? 'count')
       or jsonb_typeof(v_fact->'recordId') <> 'string'
       or jsonb_typeof(v_fact->'count') <> 'number'
       or (v_fact->>'count') !~ '^(0|[1-9][0-9]*)$' then
      return query select 'invalid_facts'::text;
      return;
    end if;
    begin
      v_record_id := (v_fact->>'recordId')::uuid;
      v_record_count := (v_fact->>'count')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return query select 'invalid_facts'::text;
      return;
    end;
    if exists (
      select 1 from jsonb_array_elements(p_facts) existing(value)
       where existing.value->>'recordId' = v_record_id::text
         and existing.value is distinct from v_fact
    ) then
      return query select 'invalid_facts'::text;
      return;
    end if;
    v_facts_count := v_facts_count + 1;
  end loop;
  if not p_available and v_facts_count <> 0 then
    return query select 'invalid_facts'::text;
    return;
  end if;

  -- Deleting prior rows for this exact entity/kind makes the submitted list an
  -- authoritative snapshot. A source record moved to another entity is not
  -- touched by a late clear of the old entity because its entity id changed.
  delete from public.organization_legal_entity_dependency_facts facts
   where facts.organization_id = p_organization_id
     and facts.legal_entity_id = p_legal_entity_id
     and facts.authority_kind = p_authority_kind
     and not exists (
       select 1 from jsonb_array_elements(p_facts) submitted(value)
        where submitted.value->>'recordId' = facts.source_record_id::text
     );

  if p_available then
    insert into public.organization_legal_entity_dependency_facts (
      organization_id, authority_kind, source_record_id, legal_entity_id,
      record_count, reconciled_at, reconciled_by
    )
    select p_organization_id, p_authority_kind,
      (submitted.value->>'recordId')::uuid, p_legal_entity_id,
      (submitted.value->>'count')::integer, now(), p_actor_user_id
    from jsonb_array_elements(p_facts) submitted(value)
    on conflict (organization_id, authority_kind, source_record_id) do update
      set legal_entity_id = excluded.legal_entity_id,
          record_count = excluded.record_count,
          reconciled_at = excluded.reconciled_at,
          reconciled_by = excluded.reconciled_by;
  end if;

  insert into public.organization_legal_entity_dependency_authorities (
    organization_id, legal_entity_id, authority_kind, available,
    last_reconciled_at, reconciled_by, safe_error_code
  ) values (
    p_organization_id, p_legal_entity_id, p_authority_kind, p_available,
    now(), p_actor_user_id,
    case when p_available then null else 'dependency_unavailable' end
  ) on conflict (organization_id, legal_entity_id, authority_kind) do update
    set available = excluded.available,
        last_reconciled_at = excluded.last_reconciled_at,
        reconciled_by = excluded.reconciled_by,
        safe_error_code = excluded.safe_error_code;

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.legal_entity_dependencies_reconciled',
    'organization_legal_entity', p_legal_entity_id::text,
    jsonb_build_object(
      'authorityKind', p_authority_kind,
      'available', p_available,
      'sourceRecordCount', v_facts_count
    )
  );
  return query select 'reconciled'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Branding JSON resolvers. They deliberately return only presentation-safe
-- metadata. Object paths stay private to the storage adapter and the one
-- authenticated binary-render endpoint resolver below.
-- ---------------------------------------------------------------------------
create or replace function public.m1_v2_sentinel_branding_json()
  returns jsonb
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'source', 'sentinel',
    'displayName', 'CRA Sentinel',
    'footerText', 'CRA Sentinel',
    'contactText', null,
    'palette', jsonb_build_object(
      'primary', '#0167FF', 'primaryText', '#FFFFFF',
      'secondary', '#00A39B', 'secondaryText', '#000000'
    ),
    'logo', null,
    'version', 0,
    'publishedAt', null,
    'updatedAt', '1970-01-01T00:00:00.000Z'
  );
$$;

create or replace function public.m1_v2_branding_asset_logo_json(p_asset_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case when assets.state = 'approved' then jsonb_build_object(
    'assetId', assets.id,
    'width', assets.width,
    'height', assets.height,
    'mimeType', 'image/webp',
    'sha256', assets.content_hash,
    'altText', assets.alt_text
  ) else null end
  from public.organization_branding_assets assets
  where assets.id = p_asset_id;
$$;

create or replace function public.m1_v2_branding_draft_json(p_organization_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', drafts.id,
    'displayName', drafts.display_name,
    'palette', jsonb_build_object(
      'primary', drafts.primary_color, 'secondary', drafts.secondary_color
    ),
    'footerText', drafts.footer_text,
    'contactText', drafts.contact_text,
    'logoAsset', case
      when drafts.logo_asset_id is not null
        and assets.state = 'approved'
      then jsonb_build_object(
        'status', 'approved',
        'asset', public.m1_v2_branding_asset_logo_json(drafts.logo_asset_id)
      )
      else jsonb_build_object('status', 'none', 'asset', null)
    end,
    'version', drafts.version,
    'createdAt', drafts.created_at,
    'updatedAt', drafts.updated_at,
    'createdBy', drafts.created_by,
    'updatedBy', drafts.updated_by
  )
  from public.organization_branding_drafts drafts
  left join public.organization_branding_assets assets
    on assets.organization_id = drafts.organization_id and assets.id = drafts.logo_asset_id
  where drafts.organization_id = p_organization_id;
$$;

create or replace function public.m1_v2_branding_draft_preview_json(p_organization_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case when drafts.organization_id is null then public.m1_v2_sentinel_branding_json()
    else jsonb_build_object(
      'source', 'draft_preview',
      'displayName', drafts.display_name,
      'footerText', drafts.footer_text,
      'contactText', drafts.contact_text,
      'palette', jsonb_build_object(
        'primary', drafts.primary_color,
        'primaryText', public.m1_v2_brand_text_color(drafts.primary_color),
        'secondary', drafts.secondary_color,
        'secondaryText', public.m1_v2_brand_text_color(drafts.secondary_color)
      ),
      'logo', case when assets.state = 'approved' and exists (
        select 1 from storage.objects objects
         where objects.bucket_id = 'organization-branding' and objects.name = assets.object_path
      ) then public.m1_v2_branding_asset_logo_json(drafts.logo_asset_id) else null end,
      'version', drafts.version,
      'publishedAt', null,
      'updatedAt', drafts.updated_at
    )
  end
  from (select p_organization_id as organization_id) target
  left join public.organization_branding_drafts drafts
    on drafts.organization_id = target.organization_id
  left join public.organization_branding_assets assets
    on assets.organization_id = drafts.organization_id and assets.id = drafts.logo_asset_id;
$$;

create or replace function public.m1_v2_branding_version_json(
  p_organization_id uuid,
  p_version integer
)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case
    when versions.organization_id is null then public.m1_v2_sentinel_branding_json()
    when versions.logo_asset_id is not null and (
      assets.state is distinct from 'approved'
      or not exists (
        select 1 from storage.objects objects
         where objects.bucket_id = 'organization-branding'
           and objects.name = assets.object_path
      )
    )
      then public.m1_v2_sentinel_branding_json()
    else jsonb_build_object(
      'source', 'published',
      'displayName', versions.display_name,
      'footerText', versions.footer_text,
      'contactText', versions.contact_text,
      'palette', jsonb_build_object(
        'primary', versions.primary_color,
        'primaryText', versions.primary_text_color,
        'secondary', versions.secondary_color,
        'secondaryText', versions.secondary_text_color
      ),
      'logo', case when versions.logo_asset_id is null then null else jsonb_build_object(
        'assetId', versions.logo_asset_id,
        'width', versions.logo_width,
        'height', versions.logo_height,
        'mimeType', 'image/webp',
        'sha256', versions.logo_sha256,
        'altText', versions.logo_alt_text
      ) end,
      'version', versions.version,
      'publishedAt', versions.published_at,
      'updatedAt', versions.published_at
    )
  end
  from (select p_organization_id as organization_id) target
  left join public.organization_branding_versions versions
    on versions.organization_id = target.organization_id and versions.version = p_version
  left join public.organization_branding_assets assets
    on assets.organization_id = versions.organization_id and assets.id = versions.logo_asset_id;
$$;

create or replace function public.m1_v2_current_branding_json(p_organization_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(
    public.m1_v2_branding_version_json(versions.organization_id, versions.version),
    public.m1_v2_sentinel_branding_json()
  )
  from public.organization_branding_versions versions
  where versions.organization_id = p_organization_id
  order by versions.version desc
  limit 1;
$$;

create or replace function public.get_organization_branding(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, branding jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, coalesce(
    public.m1_v2_current_branding_json(p_organization_id), public.m1_v2_sentinel_branding_json()
  );
end;
$$;

-- A draft read includes both the resolved preview consumed by the existing API
-- adapter and the explicit mutable draft required by the owner-admin UI.
create or replace function public.get_organization_branding_draft(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, branding jsonb, draft jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    public.m1_v2_branding_draft_preview_json(p_organization_id),
    public.m1_v2_branding_draft_json(p_organization_id);
end;
$$;

create or replace function public.get_organization_branding_assets(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, assets jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, coalesce(jsonb_agg(
    jsonb_build_object(
      'status', assets.state,
      'asset', case when assets.state = 'approved'
        then public.m1_v2_branding_asset_logo_json(assets.id) else null end
    ) order by assets.created_at desc
  ), '[]'::jsonb)
  from public.organization_branding_assets assets
  where assets.organization_id = p_organization_id
    and assets.state in ('approved', 'quarantined', 'failed', 'removed');
end;
$$;

create or replace function public.ensure_organization_branding_draft(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_name text;
begin
  select name into v_name from public.organizations where id = p_organization_id;
  if not found then return; end if;
  insert into public.organization_branding_drafts (
    organization_id, display_name, primary_color, secondary_color,
    footer_text, contact_text, created_by, updated_by
  ) values (
    p_organization_id, v_name, '#0167FF', '#00A39B', null, null,
    p_actor_user_id, p_actor_user_id
  ) on conflict (organization_id) do nothing;
end;
$$;

-- `object_key` is a server-internal prefix, not an object URL. The storage
-- adapter appends the inspected normalized SHA-256 before upload, producing
-- the deterministic `<organization>/<asset>/<hash>.webp` final key.
create or replace function public.reserve_organization_branding_asset_upload_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_alt_text text
)
  returns table (outcome text, asset_id uuid, object_key text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_asset_id uuid;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::uuid, null::text;
    return;
  end if;
  if p_alt_text is not null and length(btrim(p_alt_text)) not between 1 and 160 then
    return query select 'invalid_request'::text, null::uuid, null::text;
    return;
  end if;
  perform public.ensure_organization_branding_draft(p_organization_id, p_actor_user_id);
  insert into public.organization_branding_assets (
    organization_id, state, alt_text, created_by, updated_by
  ) values (
    p_organization_id, 'reserved', nullif(btrim(p_alt_text), ''), p_actor_user_id, p_actor_user_id
  ) returning id into v_asset_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_asset_reserved',
    'organization_branding_asset', v_asset_id::text, jsonb_build_object('state', 'reserved')
  );
  return query select 'reserved'::text, v_asset_id,
    p_organization_id::text || '/' || v_asset_id::text || '/';
end;
$$;

create or replace function public.finalize_organization_branding_asset_upload_atomic(
  p_organization_id uuid,
  p_asset_id uuid,
  p_actor_user_id uuid,
  p_content_hash text,
  p_input_bytes integer,
  p_width integer,
  p_height integer,
  p_scanner_status text
)
  returns table (outcome text, draft jsonb, branding jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_asset public.organization_branding_assets%rowtype;
  v_object_path text;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;
  select * into v_asset from public.organization_branding_assets assets
   where assets.organization_id = p_organization_id and assets.id = p_asset_id
   for update;
  if not found then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;
  if v_asset.state <> 'reserved'
     or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_input_bytes not between 1 and 2097152
     or p_width not between 64 and 2048
     or p_height not between 64 and 2048
     or p_width * p_height > 16000000
     or p_scanner_status not in ('clean', 'scanner_not_available') then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;
  v_object_path := p_organization_id::text || '/' || p_asset_id::text || '/' || p_content_hash || '.webp';
  if not exists (
    select 1 from storage.objects objects
     where objects.bucket_id = 'organization-branding' and objects.name = v_object_path
  ) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;
  update public.organization_branding_assets
     set state = 'approved', source_mime_type = 'image/webp',
         normalized_mime_type = 'image/webp', content_hash = p_content_hash,
         object_path = v_object_path, input_bytes = p_input_bytes,
         width = p_width, height = p_height, scanner_status = p_scanner_status,
         failure_code = null, updated_by = p_actor_user_id
   where id = p_asset_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_asset_approved',
    'organization_branding_asset', p_asset_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('state', v_asset.state),
      'after', jsonb_build_object(
        'state', 'approved', 'sha256', p_content_hash,
        'width', p_width, 'height', p_height, 'scannerStatus', p_scanner_status
      )
    )
  );
  return query select 'finalized'::text,
    public.m1_v2_branding_draft_json(p_organization_id),
    public.m1_v2_branding_draft_preview_json(p_organization_id);
end;
$$;

create or replace function public.fail_organization_branding_asset_upload_atomic(
  p_organization_id uuid,
  p_asset_id uuid,
  p_actor_user_id uuid,
  p_failure_code text,
  p_quarantined boolean
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_asset public.organization_branding_assets%rowtype;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text;
    return;
  end if;
  if p_failure_code is null or p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$' or p_quarantined is null then
    return query select 'invalid_request'::text;
    return;
  end if;
  select * into v_asset from public.organization_branding_assets assets
   where assets.organization_id = p_organization_id and assets.id = p_asset_id
   for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_asset.state not in ('reserved', 'approved') then
    return query select 'invalid_request'::text;
    return;
  end if;
  update public.organization_branding_assets
     set state = case when p_quarantined then 'quarantined' else 'failed' end,
         scanner_status = case when p_quarantined then 'infected' else scanner_status end,
         failure_code = p_failure_code, updated_by = p_actor_user_id
   where id = p_asset_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_asset_failed',
    'organization_branding_asset', p_asset_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('state', v_asset.state),
      'after', jsonb_build_object(
        'state', case when p_quarantined then 'quarantined' else 'failed' end,
        'failureCode', p_failure_code
      )
    )
  );
  return query select 'recorded'::text;
end;
$$;

create or replace function public.save_organization_branding_draft_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_display_name text,
  p_primary_color text,
  p_secondary_color text,
  p_footer_text text,
  p_contact_text text,
  p_logo_asset_id uuid
)
  returns table (outcome text, draft jsonb, branding jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_draft public.organization_branding_drafts%rowtype;
  v_asset public.organization_branding_assets%rowtype;
  v_display_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_primary_color text := upper(btrim(p_primary_color));
  v_secondary_color text := upper(btrim(p_secondary_color));
  v_footer_text text := nullif(regexp_replace(btrim(coalesce(p_footer_text, '')), '\s+', ' ', 'g'), '');
  v_contact_text text := nullif(regexp_replace(btrim(coalesce(p_contact_text, '')), '\s+', ' ', 'g'), '');
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;
  if p_expected_version is null
     or v_display_name is null
     or v_primary_color !~ '^#[0-9A-F]{6}$'
     or v_secondary_color !~ '^#[0-9A-F]{6}$'
     or (v_footer_text is not null and length(v_footer_text) > 280)
     or (v_contact_text is not null and length(v_contact_text) > 280) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;
  perform public.ensure_organization_branding_draft(p_organization_id, p_actor_user_id);
  select * into v_draft from public.organization_branding_drafts drafts
   where drafts.organization_id = p_organization_id
   for update;
  if v_draft.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m1_v2_branding_draft_json(p_organization_id),
      public.m1_v2_branding_draft_preview_json(p_organization_id);
    return;
  end if;
  if p_logo_asset_id is not null then
    select * into v_asset from public.organization_branding_assets assets
     where assets.organization_id = p_organization_id and assets.id = p_logo_asset_id
     for share;
    if not found or v_asset.state <> 'approved' then
      return query select 'invalid_request'::text, null::jsonb, null::jsonb;
      return;
    end if;
  end if;
  update public.organization_branding_drafts
     set display_name = v_display_name,
         primary_color = v_primary_color,
         secondary_color = v_secondary_color,
         footer_text = v_footer_text,
         contact_text = v_contact_text,
         logo_asset_id = p_logo_asset_id,
         version = version + 1,
         updated_by = p_actor_user_id
   where organization_id = p_organization_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_draft_updated',
    'organization_branding_draft', v_draft.id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'displayName', v_draft.display_name, 'primaryColor', v_draft.primary_color,
        'secondaryColor', v_draft.secondary_color, 'footerText', v_draft.footer_text,
        'contactText', v_draft.contact_text, 'logoAssetId', v_draft.logo_asset_id,
        'version', v_draft.version
      ),
      'after', jsonb_build_object(
        'displayName', v_display_name, 'primaryColor', v_primary_color,
        'secondaryColor', v_secondary_color, 'footerText', v_footer_text,
        'contactText', v_contact_text, 'logoAssetId', p_logo_asset_id,
        'version', v_draft.version + 1
      )
    )
  );
  return query select 'updated'::text,
    public.m1_v2_branding_draft_json(p_organization_id),
    public.m1_v2_branding_draft_preview_json(p_organization_id);
exception when check_violation then
  return query select 'invalid_request'::text, null::jsonb, null::jsonb;
end;
$$;

create or replace function public.m1_v2_branding_operation_digest(
  p_request_digest text,
  p_operation text,
  p_expected_version integer
)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select encode(extensions.digest(
    coalesce(p_request_digest, '') || ':' || p_operation || ':' || coalesce(p_expected_version::text, ''),
    'sha256'
  ), 'hex');
$$;

create or replace function public.publish_organization_branding_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_request_digest text
)
  returns table (outcome text, branding jsonb, idempotent boolean)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_draft public.organization_branding_drafts%rowtype;
  v_asset public.organization_branding_assets%rowtype;
  v_replay public.organization_branding_publish_idempotencies%rowtype;
  v_version integer;
  v_digest text;
  v_before_branding jsonb;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::boolean;
    return;
  end if;
  if p_expected_version is null or p_idempotency_key is null or p_request_digest is null
     or p_request_digest !~ '^[0-9a-f]{64}$' then
    return query select 'invalid_request'::text, null::jsonb, null::boolean;
    return;
  end if;
  v_digest := public.m1_v2_branding_operation_digest(p_request_digest, 'publish', p_expected_version);
  select * into v_replay from public.organization_branding_publish_idempotencies idempotencies
   where idempotencies.organization_id = p_organization_id
     and idempotencies.actor_user_id = p_actor_user_id
     and idempotencies.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_replay.operation = 'publish' and v_replay.request_digest = v_digest then
      return query select 'published'::text,
        public.m1_v2_branding_version_json(p_organization_id, v_replay.version), true;
    end if;
    return query select 'invalid_request'::text, null::jsonb, null::boolean;
    return;
  end if;
  select * into v_draft from public.organization_branding_drafts drafts
   where drafts.organization_id = p_organization_id
   for update;
  if not found then
    return query select 'invalid_request'::text, null::jsonb, null::boolean;
    return;
  end if;
  if v_draft.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m1_v2_branding_draft_preview_json(p_organization_id), false;
    return;
  end if;
  if v_draft.logo_asset_id is not null then
    select * into v_asset from public.organization_branding_assets assets
     where assets.organization_id = p_organization_id and assets.id = v_draft.logo_asset_id
     for share;
    if not found or v_asset.state <> 'approved'
       or not exists (select 1 from storage.objects objects
         where objects.bucket_id = 'organization-branding' and objects.name = v_asset.object_path) then
      return query select 'invalid_request'::text, null::jsonb, null::boolean;
      return;
    end if;
  end if;
  select coalesce(max(version), 0) + 1 into v_version
    from public.organization_branding_versions
   where organization_id = p_organization_id;
  v_before_branding := coalesce(
    public.m1_v2_current_branding_json(p_organization_id), public.m1_v2_sentinel_branding_json()
  );
  insert into public.organization_branding_versions (
    organization_id, version, draft_version, display_name, footer_text, contact_text,
    primary_color, primary_text_color, secondary_color, secondary_text_color,
    logo_asset_id, logo_width, logo_height, logo_sha256, logo_alt_text, published_by
  ) values (
    p_organization_id, v_version, v_draft.version, v_draft.display_name,
    v_draft.footer_text, v_draft.contact_text, v_draft.primary_color,
    public.m1_v2_brand_text_color(v_draft.primary_color), v_draft.secondary_color,
    public.m1_v2_brand_text_color(v_draft.secondary_color), v_draft.logo_asset_id,
    v_asset.width, v_asset.height, v_asset.content_hash, v_asset.alt_text, p_actor_user_id
  );
  insert into public.organization_branding_publish_idempotencies (
    organization_id, actor_user_id, idempotency_key, operation, request_digest, version
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key, 'publish', v_digest, v_version
  );
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_published',
    'organization_branding_version', v_version::text,
    jsonb_build_object(
      'before', v_before_branding,
      'after', public.m1_v2_branding_version_json(p_organization_id, v_version)
    )
  );
  return query select 'published'::text,
    public.m1_v2_branding_version_json(p_organization_id, v_version), false;
exception when unique_violation then
  return query select 'conflict'::text,
    public.m1_v2_branding_draft_preview_json(p_organization_id), false;
end;
$$;

create or replace function public.remove_organization_branding_logo_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_request_digest text
)
  returns table (outcome text, branding jsonb, idempotent boolean)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_current public.organization_branding_versions%rowtype;
  v_replay public.organization_branding_publish_idempotencies%rowtype;
  v_next_version integer;
  v_digest text;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::boolean;
    return;
  end if;
  if p_expected_version is null or p_idempotency_key is null
     or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' then
    return query select 'invalid_request'::text, null::jsonb, null::boolean;
    return;
  end if;
  v_digest := public.m1_v2_branding_operation_digest(p_request_digest, 'remove_logo', p_expected_version);
  select * into v_replay from public.organization_branding_publish_idempotencies idempotencies
   where idempotencies.organization_id = p_organization_id
     and idempotencies.actor_user_id = p_actor_user_id
     and idempotencies.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_replay.operation = 'remove_logo' and v_replay.request_digest = v_digest then
      return query select 'removed'::text,
        public.m1_v2_branding_version_json(p_organization_id, v_replay.version), true;
    end if;
    return query select 'invalid_request'::text, null::jsonb, null::boolean;
    return;
  end if;
  select * into v_current from public.organization_branding_versions versions
   where versions.organization_id = p_organization_id
   order by versions.version desc
   limit 1
   for update;
  if not found then
    return query select 'invalid_request'::text, null::jsonb, false;
    return;
  end if;
  if v_current.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m1_v2_branding_version_json(p_organization_id, v_current.version), false;
    return;
  end if;
  if v_current.logo_asset_id is null then
    return query select 'invalid_request'::text, null::jsonb, null::boolean;
    return;
  end if;
  v_next_version := v_current.version + 1;
  insert into public.organization_branding_versions (
    organization_id, version, draft_version, display_name, footer_text, contact_text,
    primary_color, primary_text_color, secondary_color, secondary_text_color,
    logo_asset_id, logo_width, logo_height, logo_sha256, logo_alt_text, published_by
  ) values (
    p_organization_id, v_next_version, v_current.draft_version, v_current.display_name,
    v_current.footer_text, v_current.contact_text, v_current.primary_color,
    v_current.primary_text_color, v_current.secondary_color, v_current.secondary_text_color,
    null, null, null, null, null, p_actor_user_id
  );
  insert into public.organization_branding_publish_idempotencies (
    organization_id, actor_user_id, idempotency_key, operation, request_digest, version
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key, 'remove_logo', v_digest, v_next_version
  );
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_logo_removed',
    'organization_branding_version', v_next_version::text,
    jsonb_build_object(
      'before', public.m1_v2_branding_version_json(p_organization_id, v_current.version),
      'after', public.m1_v2_branding_version_json(p_organization_id, v_next_version)
    )
  );
  return query select 'removed'::text,
    public.m1_v2_branding_version_json(p_organization_id, v_next_version), false;
exception when unique_violation then
  return query select 'conflict'::text,
    coalesce(public.m1_v2_current_branding_json(p_organization_id), public.m1_v2_sentinel_branding_json()), false;
end;
$$;

-- This resolver is used only by the authenticated API binary endpoint. It is
-- intentionally separate from presentation JSON so storage paths cannot reach
-- React, supplier portal markup, exports, or document templates.
create or replace function public.get_organization_branding_logo_render(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, object_key text, sha256 text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_asset public.organization_branding_assets%rowtype;
begin
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;
  select assets.* into v_asset
    from (
      select versions.organization_id, versions.logo_asset_id
        from public.organization_branding_versions versions
       where versions.organization_id = p_organization_id
       order by versions.version desc
       limit 1
    ) current_version
    join public.organization_branding_assets assets
      on assets.organization_id = current_version.organization_id
     and assets.id = current_version.logo_asset_id;
  if not found or v_asset.state <> 'approved'
     or not exists (select 1 from storage.objects objects
       where objects.bucket_id = 'organization-branding' and objects.name = v_asset.object_path) then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;
  return query select 'found'::text, v_asset.object_path, v_asset.content_hash;
end;
$$;

-- Export/document workers request an immutable published version explicitly.
-- The safe Sentinel value is returned on absence, invalid state, or a missing
-- private object, so a branding outage can never block compliance evidence.
create or replace function public.get_organization_branding_export_snapshot(
  p_organization_id uuid,
  p_version integer
)
  returns table (outcome text, branding jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if p_version is null then
    return query select 'found'::text, coalesce(
      public.m1_v2_current_branding_json(p_organization_id), public.m1_v2_sentinel_branding_json()
    );
    return;
  end if;
  if not exists (select 1 from public.organization_branding_versions versions
    where versions.organization_id = p_organization_id and versions.version = p_version) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    public.m1_v2_branding_version_json(p_organization_id, p_version);
end;
$$;

-- Keep every V2 table in the durable export registry. The worker snapshots
-- these physical records under a single stable export snapshot; the API
-- export owner separately asks `get_organization_branding_export_snapshot`
-- for the exact resolved version it renders into documents.
insert into public.organization_export_sources (source_id, enabled, sort_order)
values
  ('legal_entities', true, 29),
  ('organization_branding', true, 30)
on conflict (source_id) do update
  set enabled = excluded.enabled, sort_order = excluded.sort_order;

insert into public.organization_export_source_tables (
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('legal_entities', 'organization_legal_entities', 'organization_id', 'id', 1),
  ('legal_entities', 'organization_legal_entity_dependency_authorities', 'organization_id', 'authority_kind', 2),
  ('legal_entities', 'organization_legal_entity_dependency_facts', 'organization_id', 'source_record_id', 3),
  ('organization_branding', 'organization_branding_drafts', 'organization_id', 'id', 1),
  ('organization_branding', 'organization_branding_assets', 'organization_id', 'id', 2),
  ('organization_branding', 'organization_branding_versions', 'organization_id', 'version', 3)
on conflict (source_id, table_name) do update
  set tenant_key_column = excluded.tenant_key_column,
      record_order_column = excluded.record_order_column,
      table_sort = excluded.table_sort;

-- A platform-purge proof is intentionally outside tenant cascades. Queue the
-- private branding prefix alongside the established export bucket cleanup so
-- expired branding assets cannot survive an organization purge.
create or replace function public.enqueue_organization_branding_purge_storage()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  insert into public.organization_deletion_artifact_work (
    deletion_proof_id, bucket_id, object_prefix
  ) values (
    new.id, 'organization-branding', new.deleted_organization_id::text || '/'
  );
  return new;
end;
$$;

drop trigger if exists enqueue_organization_branding_purge_storage_on_proof
  on public.organization_deletion_proofs;
create trigger enqueue_organization_branding_purge_storage_on_proof
  after insert on public.organization_deletion_proofs
  for each row execute function public.enqueue_organization_branding_purge_storage();

-- ---------------------------------------------------------------------------
-- Defence in depth. Browser roles have no grants; the select policies document
-- tenant membership for a future browser client, while service-role adapters
-- must still apply organization-first filters and call the scoped RPCs.
-- ---------------------------------------------------------------------------
alter table public.organization_legal_entities enable row level security;
alter table public.organization_legal_entity_create_idempotencies enable row level security;
alter table public.organization_legal_entity_dependency_authorities enable row level security;
alter table public.organization_legal_entity_dependency_facts enable row level security;
alter table public.organization_branding_drafts enable row level security;
alter table public.organization_branding_assets enable row level security;
alter table public.organization_branding_versions enable row level security;
alter table public.organization_branding_publish_idempotencies enable row level security;

grant all on table public.organization_legal_entities to service_role;
grant all on table public.organization_legal_entity_create_idempotencies to service_role;
grant all on table public.organization_legal_entity_dependency_authorities to service_role;
grant all on table public.organization_legal_entity_dependency_facts to service_role;
grant all on table public.organization_branding_drafts to service_role;
grant all on table public.organization_branding_assets to service_role;
grant all on table public.organization_branding_versions to service_role;
grant all on table public.organization_branding_publish_idempotencies to service_role;
revoke all on table public.organization_legal_entities from public, anon, authenticated;
revoke all on table public.organization_legal_entity_create_idempotencies from public, anon, authenticated;
revoke all on table public.organization_legal_entity_dependency_authorities from public, anon, authenticated;
revoke all on table public.organization_legal_entity_dependency_facts from public, anon, authenticated;
revoke all on table public.organization_branding_drafts from public, anon, authenticated;
revoke all on table public.organization_branding_assets from public, anon, authenticated;
revoke all on table public.organization_branding_versions from public, anon, authenticated;
revoke all on table public.organization_branding_publish_idempotencies from public, anon, authenticated;

create policy organization_legal_entities_select_member on public.organization_legal_entities
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy organization_legal_entity_dependency_authorities_select_member
  on public.organization_legal_entity_dependency_authorities
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy organization_legal_entity_dependency_facts_select_member
  on public.organization_legal_entity_dependency_facts
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy organization_branding_drafts_select_member on public.organization_branding_drafts
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy organization_branding_assets_select_member on public.organization_branding_assets
  for select to authenticated using (public.user_is_member_of(organization_id));
create policy organization_branding_versions_select_member on public.organization_branding_versions
  for select to authenticated using (public.user_is_member_of(organization_id));

-- Security-definer functions are private by default. Only narrow RPC entry
-- points are executable by the API service role; helpers and triggers remain
-- inaccessible even to the service adapter.
alter function public.m1_v2_normalize_legal_identifier(text) owner to postgres;
alter function public.m1_v2_legal_entity_request_digest(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) owner to postgres;
alter function public.m1_v2_hex_luminance(text) owner to postgres;
alter function public.m1_v2_hex_contrast(text, text) owner to postgres;
alter function public.m1_v2_brand_text_color(text) owner to postgres;
alter function public.m1_v2_is_active_organization_member(uuid, uuid) owner to postgres;
alter function public.m1_v2_is_active_organization_owner(uuid, uuid) owner to postgres;
alter function public.initialize_organization_legal_entity_dependencies() owner to postgres;
alter function public.ensure_default_legal_entity_for_profile() owner to postgres;
alter function public.backfill_organization_legal_entities() owner to postgres;
alter function public.m1_v2_legal_entity_dependency_json(uuid, uuid) owner to postgres;
alter function public.m1_v2_legal_entity_json(uuid) owner to postgres;
alter function public.get_organization_legal_entities(uuid, uuid) owner to postgres;
alter function public.get_organization_legal_entity(uuid, uuid, uuid) owner to postgres;
alter function public.create_organization_legal_entity_atomic(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) owner to postgres;
alter function public.update_organization_legal_entity_atomic(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) owner to postgres;
alter function public.m1_v2_legal_entity_lifecycle_block_reason(uuid, uuid) owner to postgres;
alter function public.transition_organization_legal_entity_atomic(uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.resolve_active_organization_legal_entity_context(uuid, uuid) owner to postgres;
alter function public.reconcile_organization_legal_entity_dependencies_atomic(uuid, uuid, uuid, text, boolean, jsonb) owner to postgres;
alter function public.m1_v2_sentinel_branding_json() owner to postgres;
alter function public.m1_v2_branding_asset_logo_json(uuid) owner to postgres;
alter function public.m1_v2_branding_draft_json(uuid) owner to postgres;
alter function public.m1_v2_branding_draft_preview_json(uuid) owner to postgres;
alter function public.m1_v2_branding_version_json(uuid, integer) owner to postgres;
alter function public.m1_v2_current_branding_json(uuid) owner to postgres;
alter function public.get_organization_branding(uuid, uuid) owner to postgres;
alter function public.get_organization_branding_draft(uuid, uuid) owner to postgres;
alter function public.get_organization_branding_assets(uuid, uuid) owner to postgres;
alter function public.ensure_organization_branding_draft(uuid, uuid) owner to postgres;
alter function public.reserve_organization_branding_asset_upload_atomic(uuid, uuid, text) owner to postgres;
alter function public.finalize_organization_branding_asset_upload_atomic(uuid, uuid, uuid, text, integer, integer, integer, text) owner to postgres;
alter function public.fail_organization_branding_asset_upload_atomic(uuid, uuid, uuid, text, boolean) owner to postgres;
alter function public.save_organization_branding_draft_atomic(uuid, uuid, integer, text, text, text, text, text, uuid) owner to postgres;
alter function public.m1_v2_branding_operation_digest(text, text, integer) owner to postgres;
alter function public.publish_organization_branding_atomic(uuid, uuid, integer, uuid, text) owner to postgres;
alter function public.remove_organization_branding_logo_atomic(uuid, uuid, integer, uuid, text) owner to postgres;
alter function public.get_organization_branding_logo_render(uuid, uuid) owner to postgres;
alter function public.get_organization_branding_export_snapshot(uuid, integer) owner to postgres;
alter function public.enqueue_organization_branding_purge_storage() owner to postgres;

revoke all on function public.m1_v2_normalize_legal_identifier(text) from public, anon, authenticated;
revoke all on function public.m1_v2_legal_entity_request_digest(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.m1_v2_hex_luminance(text) from public, anon, authenticated;
revoke all on function public.m1_v2_hex_contrast(text, text) from public, anon, authenticated;
revoke all on function public.m1_v2_brand_text_color(text) from public, anon, authenticated;
revoke all on function public.m1_v2_is_active_organization_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_is_active_organization_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.initialize_organization_legal_entity_dependencies() from public, anon, authenticated;
revoke all on function public.ensure_default_legal_entity_for_profile() from public, anon, authenticated;
revoke all on function public.backfill_organization_legal_entities() from public, anon, authenticated;
revoke all on function public.m1_v2_legal_entity_dependency_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_legal_entity_json(uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_legal_entity_lifecycle_block_reason(uuid, uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_sentinel_branding_json() from public, anon, authenticated;
revoke all on function public.m1_v2_branding_asset_logo_json(uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_branding_draft_json(uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_branding_draft_preview_json(uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_branding_version_json(uuid, integer) from public, anon, authenticated;
revoke all on function public.m1_v2_current_branding_json(uuid) from public, anon, authenticated;
revoke all on function public.ensure_organization_branding_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.m1_v2_branding_operation_digest(text, text, integer) from public, anon, authenticated;
revoke all on function public.enqueue_organization_branding_purge_storage() from public, anon, authenticated;

revoke all on function public.get_organization_legal_entities(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_organization_legal_entity(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_organization_legal_entity_atomic(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_organization_legal_entity_atomic(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.transition_organization_legal_entity_atomic(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.resolve_active_organization_legal_entity_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_organization_legal_entity_dependencies_atomic(uuid, uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.get_organization_branding(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_organization_branding_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_organization_branding_assets(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reserve_organization_branding_asset_upload_atomic(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_organization_branding_asset_upload_atomic(uuid, uuid, uuid, text, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.fail_organization_branding_asset_upload_atomic(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.save_organization_branding_draft_atomic(uuid, uuid, integer, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.publish_organization_branding_atomic(uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.remove_organization_branding_logo_atomic(uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.get_organization_branding_logo_render(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_organization_branding_export_snapshot(uuid, integer) from public, anon, authenticated;

grant execute on function public.get_organization_legal_entities(uuid, uuid) to service_role;
grant execute on function public.get_organization_legal_entity(uuid, uuid, uuid) to service_role;
grant execute on function public.create_organization_legal_entity_atomic(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.update_organization_legal_entity_atomic(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.transition_organization_legal_entity_atomic(uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.resolve_active_organization_legal_entity_context(uuid, uuid) to service_role;
grant execute on function public.reconcile_organization_legal_entity_dependencies_atomic(uuid, uuid, uuid, text, boolean, jsonb) to service_role;
grant execute on function public.get_organization_branding(uuid, uuid) to service_role;
grant execute on function public.get_organization_branding_draft(uuid, uuid) to service_role;
grant execute on function public.get_organization_branding_assets(uuid, uuid) to service_role;
grant execute on function public.reserve_organization_branding_asset_upload_atomic(uuid, uuid, text) to service_role;
grant execute on function public.finalize_organization_branding_asset_upload_atomic(uuid, uuid, uuid, text, integer, integer, integer, text) to service_role;
grant execute on function public.fail_organization_branding_asset_upload_atomic(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.save_organization_branding_draft_atomic(uuid, uuid, integer, text, text, text, text, text, uuid) to service_role;
grant execute on function public.publish_organization_branding_atomic(uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.remove_organization_branding_logo_atomic(uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.get_organization_branding_logo_render(uuid, uuid) to service_role;
grant execute on function public.get_organization_branding_export_snapshot(uuid, integer) to service_role;
