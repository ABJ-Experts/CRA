-- M2 V1 release-owned market availability and lifecycle foundation.
-- Classification remains deferred until an approved deterministic rule set exists.

create or replace function public.m2_assert_no_legacy_release_lifecycle()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.product_releases
     where lifecycle in ('released', 'retired')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'M2 V1 migration blocked: released/retired rows require an approved legal-data remediation';
  end if;
end;
$$;

-- This call intentionally precedes every lifecycle alteration. Never invent a
-- legally significant placed-on-market date from the legacy state label.
select public.m2_assert_no_legacy_release_lifecycle();

alter table public.product_releases
  drop constraint if exists product_releases_lifecycle_check;
update public.product_releases set lifecycle = 'development' where lifecycle = 'draft';
alter table public.product_releases
  alter column lifecycle set default 'development',
  add column if not exists placed_on_market_at timestamptz,
  add constraint product_releases_lifecycle_check check (
    lifecycle in (
      'development', 'placed_on_market', 'in_support',
      'end_of_support', 'withdrawn'
    )
  ),
  add constraint product_releases_organization_product_id_key
    unique (organization_id, product_id, id);

alter table public.product_lifecycle_dependency_facts
  add constraint product_dependencies_release_product_fkey
  foreign key (organization_id, product_id, release_id)
  references public.product_releases (organization_id, product_id, id)
  on delete cascade;

create table public.member_state_reference_versions (
  id uuid primary key default gen_random_uuid(),
  reference_set_id text not null
    check (char_length(btrim(reference_set_id)) between 1 and 100),
  version integer not null check (version >= 0),
  effective_from date not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (reference_set_id, version),
  unique (id, version)
);

create unique index member_state_one_active_version_idx
  on public.member_state_reference_versions (reference_set_id)
  where active;

create table public.member_state_reference_entries (
  reference_version_id uuid not null
    references public.member_state_reference_versions (id) on delete restrict,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (reference_version_id, country_code)
);

insert into public.member_state_reference_versions (
  id, reference_set_id, version, effective_from, active
) values (
  '27000000-0000-4000-8000-000000000001',
  'eu_member_states', 1, date '2026-08-12', true
);

insert into public.member_state_reference_entries (
  reference_version_id, country_code, name
) values
  ('27000000-0000-4000-8000-000000000001', 'AT', 'Austria'),
  ('27000000-0000-4000-8000-000000000001', 'BE', 'Belgium'),
  ('27000000-0000-4000-8000-000000000001', 'BG', 'Bulgaria'),
  ('27000000-0000-4000-8000-000000000001', 'HR', 'Croatia'),
  ('27000000-0000-4000-8000-000000000001', 'CY', 'Cyprus'),
  ('27000000-0000-4000-8000-000000000001', 'CZ', 'Czechia'),
  ('27000000-0000-4000-8000-000000000001', 'DK', 'Denmark'),
  ('27000000-0000-4000-8000-000000000001', 'EE', 'Estonia'),
  ('27000000-0000-4000-8000-000000000001', 'FI', 'Finland'),
  ('27000000-0000-4000-8000-000000000001', 'FR', 'France'),
  ('27000000-0000-4000-8000-000000000001', 'DE', 'Germany'),
  ('27000000-0000-4000-8000-000000000001', 'GR', 'Greece'),
  ('27000000-0000-4000-8000-000000000001', 'HU', 'Hungary'),
  ('27000000-0000-4000-8000-000000000001', 'IE', 'Ireland'),
  ('27000000-0000-4000-8000-000000000001', 'IT', 'Italy'),
  ('27000000-0000-4000-8000-000000000001', 'LV', 'Latvia'),
  ('27000000-0000-4000-8000-000000000001', 'LT', 'Lithuania'),
  ('27000000-0000-4000-8000-000000000001', 'LU', 'Luxembourg'),
  ('27000000-0000-4000-8000-000000000001', 'MT', 'Malta'),
  ('27000000-0000-4000-8000-000000000001', 'NL', 'Netherlands'),
  ('27000000-0000-4000-8000-000000000001', 'PL', 'Poland'),
  ('27000000-0000-4000-8000-000000000001', 'PT', 'Portugal'),
  ('27000000-0000-4000-8000-000000000001', 'RO', 'Romania'),
  ('27000000-0000-4000-8000-000000000001', 'SK', 'Slovakia'),
  ('27000000-0000-4000-8000-000000000001', 'SI', 'Slovenia'),
  ('27000000-0000-4000-8000-000000000001', 'ES', 'Spain'),
  ('27000000-0000-4000-8000-000000000001', 'SE', 'Sweden');

create table public.product_release_market_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  release_id uuid not null,
  reference_version_id uuid not null,
  country_code text not null,
  available_at timestamptz not null default now(),
  available_by uuid not null references public.users (id) on delete restrict,
  unavailable_at timestamptz,
  unavailable_by uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, release_id, country_code),
  unique (organization_id, id),
  foreign key (organization_id, product_id, release_id)
    references public.product_releases (organization_id, product_id, id)
    on delete cascade,
  foreign key (reference_version_id, country_code)
    references public.member_state_reference_entries (reference_version_id, country_code)
    on delete restrict,
  check ((unavailable_at is null) = (unavailable_by is null)),
  check (unavailable_at is null or unavailable_at >= available_at)
);

create table public.product_regulatory_outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null,
  release_id uuid not null,
  event_type text not null check (event_type in (
    'release.market_availability_changed',
    'release.lifecycle_changed',
    'release.placed_on_market_changed'
  )),
  event_key text not null check (char_length(event_key) between 1 and 300),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  last_delivery_error text,
  delivered_at timestamptz,
  unique (organization_id, event_key),
  unique (organization_id, id),
  foreign key (organization_id, product_id, release_id)
    references public.product_releases (organization_id, product_id, id)
    on delete cascade
);

create index product_release_market_current_idx
  on public.product_release_market_availability
    (organization_id, release_id, country_code)
  where unavailable_at is null;
create index product_regulatory_outbox_pending_idx
  on public.product_regulatory_outbox_events
    (occurred_at, id) where delivered_at is null;
create index product_release_regulatory_audit_timeline_idx
  on public.audit_logs
    (organization_id, entity_type, entity_id, created_at desc, id desc)
  where action in (
    'product.release_lifecycle_transitioned',
    'product.release_placed_on_market_date_corrected'
  );

drop trigger if exists set_product_release_market_availability_updated_at
  on public.product_release_market_availability;
create trigger set_product_release_market_availability_updated_at
before update on public.product_release_market_availability
for each row execute function public.set_updated_at();

alter table public.member_state_reference_versions enable row level security;
alter table public.member_state_reference_entries enable row level security;
alter table public.product_release_market_availability enable row level security;
alter table public.product_regulatory_outbox_events enable row level security;

revoke all on table
  public.member_state_reference_versions,
  public.member_state_reference_entries,
  public.product_release_market_availability,
  public.product_regulatory_outbox_events
from public, anon, authenticated;
grant select on table
  public.member_state_reference_versions,
  public.member_state_reference_entries,
  public.product_release_market_availability,
  public.product_regulatory_outbox_events
to service_role;
grant update (delivery_attempts, last_delivery_error, delivered_at)
  on public.product_regulatory_outbox_events to service_role;

-- Regulatory history is sourced from audit rows, so external service-role
-- clients may append and read it but never rewrite or erase it.
revoke update, delete, truncate on table public.audit_logs from service_role;
grant select, insert on table public.audit_logs to service_role;

create or replace function public.m2_utc_z(p_value timestamptz)
returns text
language sql immutable strict
set search_path = public, pg_temp
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create or replace function public.m2_parse_utc_z(p_value text)
returns timestamptz
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if p_value is null
     or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.m2_market_availability_item_json(
  p_availability public.product_release_market_availability
)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'countryCode', p_availability.country_code,
    'memberStateName', entries.name,
    'referenceVersion', versions.version,
    'availableAt', public.m2_utc_z(p_availability.available_at),
    'unavailableAt', case when p_availability.unavailable_at is null then null
      else public.m2_utc_z(p_availability.unavailable_at) end,
    'active', p_availability.unavailable_at is null
  )
  from public.member_state_reference_versions versions
  join public.member_state_reference_entries entries
    on entries.reference_version_id = versions.id
   and entries.country_code = p_availability.country_code
  where versions.id = p_availability.reference_version_id
$$;

create or replace function public.m2_market_availability_json(
  p_organization_id uuid,
  p_release_id uuid
)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'marketAvailability',
    coalesce(jsonb_agg(
      public.m2_market_availability_item_json(availability)
      order by availability.country_code
    ) filter (where availability.id is not null), '[]'::jsonb)
  )
  from public.product_release_market_availability availability
  where availability.organization_id = p_organization_id
    and availability.release_id = p_release_id
    and availability.unavailable_at is null
$$;

create or replace function public.m2_member_states_json()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'memberStates', coalesce(jsonb_agg(jsonb_build_object(
      'countryCode', entries.country_code,
      'name', entries.name,
      'version', versions.version,
      'active', entries.active and versions.active
    ) order by entries.country_code), '[]'::jsonb)
  )
  from public.member_state_reference_versions versions
  join public.member_state_reference_entries entries
    on entries.reference_version_id = versions.id
  where versions.reference_set_id = 'eu_member_states'
    and versions.active
$$;

create or replace function public.m2_release_timeline_json(
  p_organization_id uuid,
  p_release_id uuid
)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'timeline', coalesce(jsonb_agg(events.payload order by events.occurred_at desc, events.id desc), '[]'::jsonb)
  )
  from (
    select audit.id, audit.created_at as occurred_at, jsonb_build_object(
      'id', audit.id,
      'eventType', case audit.action
        when 'product.release_lifecycle_transitioned' then 'transition'
        else 'placed_on_market_date_corrected'
      end,
      'beforeLifecycle', audit.changes->'before'->>'lifecycle',
      'afterLifecycle', audit.changes->'after'->>'lifecycle',
      'originalPlacedOnMarketAt', audit.changes->'before'->>'placedOnMarketAt',
      'correctedPlacedOnMarketAt', audit.changes->'after'->>'placedOnMarketAt',
      'actorId', audit.user_id,
      'reason', audit.changes->'reason',
      'correlationId', audit.changes->'correlationId',
      'occurredAt', public.m2_utc_z(audit.created_at)
    ) payload
    from public.audit_logs audit
    where audit.organization_id = p_organization_id
      and audit.entity_type = 'product_release'
      and audit.entity_id = p_release_id::text
      and audit.action in (
        'product.release_lifecycle_transitioned',
        'product.release_placed_on_market_date_corrected'
      )
      and audit.changes ?& array['before', 'after', 'reason', 'correlationId']
  ) events
$$;

create or replace function public.m2_release_json(
  p_organization_id uuid,
  p_release_id uuid
)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', releases.id,
    'organizationId', releases.organization_id,
    'productId', releases.product_id,
    'label', releases.label,
    'version', releases.release_version,
    'description', releases.description,
    'lifecycle', releases.lifecycle,
    'placedOnMarketAt', case when releases.placed_on_market_at is null then null
      else public.m2_utc_z(releases.placed_on_market_at) end,
    'marketAvailabilityWarning', case when exists (
      select 1 from public.product_release_market_availability availability
       where availability.organization_id = releases.organization_id
         and availability.release_id = releases.id
         and availability.unavailable_at is null
    ) then null else 'no_active_member_state_availability' end,
    'legalEntity', jsonb_build_object(
      'id', releases.legal_entity_id,
      'identifier', releases.legal_entity_snapshot->>'identifier',
      'legalName', releases.legal_entity_snapshot->>'legalName',
      'mainEstablishmentCountry', releases.legal_entity_snapshot->>'mainEstablishmentCountry',
      'version', releases.legal_entity_version
    ),
    'archivedAt', releases.archived_at,
    'versionNumber', releases.version,
    'createdAt', releases.created_at,
    'updatedAt', releases.updated_at,
    'createdBy', releases.created_by,
    'updatedBy', releases.updated_by
  )
  from public.product_releases releases
  where releases.organization_id = p_organization_id
    and releases.id = p_release_id
$$;

create or replace function public.m2_enforce_release_regulatory_invariants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_created_at timestamptz;
begin
  select created_at into v_product_created_at
    from public.products
   where organization_id = new.organization_id and id = new.product_id;

  if new.placed_on_market_at is not null
     and (new.placed_on_market_at > clock_timestamp()
       or new.placed_on_market_at < v_product_created_at) then
    raise exception 'placed_on_market_at must be between product creation and now';
  end if;
  if new.lifecycle in ('placed_on_market', 'in_support', 'end_of_support')
     and new.placed_on_market_at is null then
    raise exception 'lifecycle requires placed_on_market_at';
  end if;
  if new.lifecycle = 'development' and new.placed_on_market_at is not null then
    raise exception 'development cannot carry placed_on_market_at';
  end if;
  if new.archived_at is not null and new.lifecycle <> 'withdrawn' then
    raise exception 'release must be withdrawn before archival';
  end if;

  if tg_op = 'UPDATE' then
    if old.placed_on_market_at is not null and new.placed_on_market_at is null then
      raise exception 'placed_on_market_at cannot be cleared';
    end if;
    if old.placed_on_market_at is distinct from new.placed_on_market_at
       and old.placed_on_market_at is not null
       and coalesce(current_setting('cra.allow_placed_date_correction', true), 'off') <> 'on' then
      raise exception 'placed_on_market_at changes require correction workflow';
    end if;
    if old.lifecycle is distinct from new.lifecycle and not (
      (old.lifecycle = 'development' and new.lifecycle in ('placed_on_market', 'withdrawn'))
      or (old.lifecycle = 'placed_on_market' and new.lifecycle in ('in_support', 'withdrawn'))
      or (old.lifecycle = 'in_support' and new.lifecycle in ('end_of_support', 'withdrawn'))
      or (old.lifecycle = 'end_of_support' and new.lifecycle = 'withdrawn')
    ) then
      raise exception 'invalid release lifecycle transition';
    end if;
    if old.lifecycle = 'development' and new.lifecycle = 'placed_on_market'
       and not exists (
         select 1 from public.product_release_market_availability availability
         join public.member_state_reference_versions versions
           on versions.id = availability.reference_version_id
         join public.member_state_reference_entries entries
           on entries.reference_version_id = availability.reference_version_id
          and entries.country_code = availability.country_code
          where availability.organization_id = new.organization_id
            and availability.release_id = new.id
            and availability.unavailable_at is null
            and versions.reference_set_id = 'eu_member_states'
            and versions.active
            and entries.active
       ) then
      raise exception 'placement requires active market availability';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_product_release_regulatory_invariants
  on public.product_releases;
create trigger enforce_product_release_regulatory_invariants
before insert or update on public.product_releases
for each row execute function public.m2_enforce_release_regulatory_invariants();

create or replace function public.get_m2_member_states(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns table (outcome text, member_states jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, public.m2_member_states_json();
end;
$$;

create or replace function public.get_product_release_market_availability(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid
)
returns table (outcome text, market_availability jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists (
       select 1 from public.product_releases releases
        where releases.organization_id = p_organization_id
          and releases.product_id = p_product_id
          and releases.id = p_release_id
     ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    public.m2_market_availability_json(p_organization_id, p_release_id);
end;
$$;

create or replace function public.get_product_release_lifecycle_timeline(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid
)
returns table (outcome text, timeline jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists (
       select 1 from public.product_releases releases
        where releases.organization_id = p_organization_id
          and releases.product_id = p_product_id
          and releases.id = p_release_id
     ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    public.m2_release_timeline_json(p_organization_id, p_release_id);
end;
$$;

-- Generic release CRUD no longer accepts lifecycle. Dedicated commands own it.
drop function if exists public.create_product_release_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text
);
create function public.create_product_release_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_label text,
  p_release_version text,
  p_description text
)
returns table (outcome text, release jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_release public.product_releases%rowtype;
  v_digest text;
  v_existing public.product_release_create_idempotencies%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_product from public.products
   where organization_id = p_organization_id and id = p_product_id for update;
  if not found or v_product.archived_at is not null then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object(
    'productId', p_product_id, 'label', p_label,
    'version', p_release_version, 'description', p_description
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.product_release_create_idempotencies
   where organization_id = p_organization_id
     and actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.payload_digest <> v_digest then
      return query select 'idempotency_mismatch'::text, null::jsonb;
    else
      return query select 'replayed'::text,
        public.m2_release_json(p_organization_id, v_existing.release_id);
    end if;
    return;
  end if;
  insert into public.product_releases (
    organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, description,
    lifecycle, created_by, updated_by
  ) values (
    p_organization_id, p_product_id, v_product.legal_entity_id,
    v_product.legal_entity_version, v_product.legal_entity_snapshot,
    btrim(p_label), btrim(p_release_version), nullif(btrim(p_description), ''),
    'development', p_actor_user_id, p_actor_user_id
  ) returning * into v_release;
  insert into public.product_release_create_idempotencies (
    organization_id, actor_user_id, idempotency_key, payload_digest, release_id
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key, v_digest, v_release.id
  );
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'product.release_created',
    'product_release', v_release.id::text,
    jsonb_build_object('productId', p_product_id,
      'after', public.m2_release_json(p_organization_id, v_release.id))
  );
  return query select 'created'::text,
    public.m2_release_json(p_organization_id, v_release.id);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

drop function if exists public.update_product_release_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, boolean, text
);
create function public.update_product_release_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_label text,
  p_release_version text,
  p_description text,
  p_description_provided boolean
)
returns table (outcome text, release jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_release public.product_releases%rowtype;
  v_before jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_release from public.product_releases
   where organization_id = p_organization_id and product_id = p_product_id
     and id = p_release_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.archived_at is not null then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  v_before := public.m2_release_json(p_organization_id, p_release_id);
  update public.product_releases set
    label = coalesce(btrim(p_label), label),
    release_version = coalesce(btrim(p_release_version), release_version),
    description = case when p_description_provided
      then nullif(btrim(p_description), '') else description end,
    version = version + 1,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_release_id;
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'product.release_updated',
    'product_release', p_release_id::text,
    jsonb_build_object('before', v_before,
      'after', public.m2_release_json(p_organization_id, p_release_id))
  );
  return query select 'updated'::text,
    public.m2_release_json(p_organization_id, p_release_id);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.archive_product_release_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_reason text
)
returns table (outcome text, release jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_release public.product_releases%rowtype;
  v_before jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_release from public.product_releases
   where organization_id = p_organization_id and product_id = p_product_id
     and id = p_release_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.lifecycle <> 'withdrawn' or v_release.archived_at is not null then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  if exists (
    select 1 from public.product_lifecycle_dependency_facts
     where organization_id = p_organization_id and product_id = p_product_id
       and release_id = p_release_id and active
  ) then
    return query select 'blocked'::text, null::jsonb; return;
  end if;
  v_before := public.m2_release_json(p_organization_id, p_release_id);
  update public.product_releases set
    archived_at = now(), archived_by = p_actor_user_id,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_release_id;
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'product.release_archived',
    'product_release', p_release_id::text,
    jsonb_build_object('before', v_before,
      'after', public.m2_release_json(p_organization_id, p_release_id),
      'reason', nullif(btrim(p_reason), ''))
  );
  return query select 'archived'::text,
    public.m2_release_json(p_organization_id, p_release_id);
end;
$$;

alter function public.m2_assert_no_legacy_release_lifecycle() owner to postgres;
alter function public.m2_utc_z(timestamptz) owner to postgres;
alter function public.m2_parse_utc_z(text) owner to postgres;
alter function public.m2_market_availability_item_json(public.product_release_market_availability) owner to postgres;
alter function public.m2_market_availability_json(uuid, uuid) owner to postgres;
alter function public.m2_member_states_json() owner to postgres;
alter function public.m2_release_timeline_json(uuid, uuid) owner to postgres;
alter function public.m2_release_json(uuid, uuid) owner to postgres;
alter function public.m2_enforce_release_regulatory_invariants() owner to postgres;
alter function public.get_m2_member_states(uuid, uuid) owner to postgres;
alter function public.get_product_release_market_availability(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.get_product_release_lifecycle_timeline(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.create_product_release_atomic(uuid, uuid, uuid, uuid, text, text, text) owner to postgres;
alter function public.update_product_release_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, boolean) owner to postgres;
alter function public.archive_product_release_atomic(uuid, uuid, uuid, uuid, integer, text) owner to postgres;

revoke all on function
  public.m2_assert_no_legacy_release_lifecycle(),
  public.m2_utc_z(timestamptz),
  public.m2_parse_utc_z(text),
  public.m2_market_availability_item_json(public.product_release_market_availability),
  public.m2_market_availability_json(uuid, uuid),
  public.m2_member_states_json(),
  public.m2_release_timeline_json(uuid, uuid),
  public.m2_enforce_release_regulatory_invariants(),
  public.get_m2_member_states(uuid, uuid),
  public.get_product_release_market_availability(uuid, uuid, uuid, uuid),
  public.get_product_release_lifecycle_timeline(uuid, uuid, uuid, uuid),
  public.create_product_release_atomic(uuid, uuid, uuid, uuid, text, text, text),
  public.update_product_release_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, boolean),
  public.archive_product_release_atomic(uuid, uuid, uuid, uuid, integer, text)
from public, anon, authenticated;

grant execute on function
  public.get_m2_member_states(uuid, uuid),
  public.get_product_release_market_availability(uuid, uuid, uuid, uuid),
  public.get_product_release_lifecycle_timeline(uuid, uuid, uuid, uuid),
  public.create_product_release_atomic(uuid, uuid, uuid, uuid, text, text, text),
  public.update_product_release_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, boolean),
  public.archive_product_release_atomic(uuid, uuid, uuid, uuid, integer, text)
to service_role;
