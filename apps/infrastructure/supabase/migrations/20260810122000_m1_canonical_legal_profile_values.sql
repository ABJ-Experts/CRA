-- Correct the whitespace matcher used by the initial M1 migration. PostgreSQL
-- regex strings use a single backslash for `\s`; the original doubled spelling
-- matched a literal backslash instead. Keep this upgrade additive so existing
-- databases converge without resetting local data.

create or replace function public.m1_normalize_text(p_value text)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g');
$$;

alter function public.m1_normalize_text(text) owner to postgres;
revoke all on function public.m1_normalize_text(text)
  from public, anon, authenticated;

create or replace function public.m1_canonical_text(p_value text)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select lower(public.m1_normalize_text(p_value));
$$;

alter function public.m1_canonical_text(text) owner to postgres;
revoke all on function public.m1_canonical_text(text)
  from public, anon, authenticated;

-- Atomic RPCs write legal-profile rows, but this trigger is the storage-level
-- backstop for all service-role writers and makes the persisted profile agree
-- with the global legal-identity digest.
create or replace function public.normalize_m1_legal_profile()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  new.legal_name := public.m1_normalize_text(new.legal_name);
  new.registered_address_line_1 := public.m1_normalize_text(new.registered_address_line_1);
  new.registered_address_line_2 := nullif(public.m1_normalize_text(new.registered_address_line_2), '');
  new.registered_address_locality := public.m1_normalize_text(new.registered_address_locality);
  new.registered_address_administrative_area := nullif(public.m1_normalize_text(new.registered_address_administrative_area), '');
  new.registered_address_postal_code := public.m1_normalize_text(new.registered_address_postal_code);
  new.registered_address_country := upper(btrim(new.registered_address_country));
  new.main_establishment_country := upper(btrim(new.main_establishment_country));
  new.manufacturer_contact_name := public.m1_normalize_text(new.manufacturer_contact_name);
  new.manufacturer_contact_email := lower(btrim(new.manufacturer_contact_email));
  new.manufacturer_contact_phone := nullif(btrim(new.manufacturer_contact_phone), '');
  return new;
end;
$$;

alter function public.normalize_m1_legal_profile() owner to postgres;
revoke all on function public.normalize_m1_legal_profile()
  from public, anon, authenticated;

drop trigger if exists normalize_m1_legal_profile_values on public.organization_legal_profiles;
create trigger normalize_m1_legal_profile_values
  before insert or update on public.organization_legal_profiles
  for each row execute function public.normalize_m1_legal_profile();

-- `organizations.name` is kept as the M1 legal-name/session display source.
-- Only rows participating in the M1 legal identity are normalized; legacy
-- organization display names remain untouched until a legal profile is added.
create or replace function public.normalize_m1_organization_name()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if new.legal_identity_digest is not null then
    new.name := public.m1_normalize_text(new.name);
  end if;
  return new;
end;
$$;

alter function public.normalize_m1_organization_name() owner to postgres;
revoke all on function public.normalize_m1_organization_name()
  from public, anon, authenticated;

drop trigger if exists normalize_m1_organization_name_value on public.organizations;
create trigger normalize_m1_organization_name_value
  before insert or update of name, legal_identity_digest on public.organizations
  for each row execute function public.normalize_m1_organization_name();
