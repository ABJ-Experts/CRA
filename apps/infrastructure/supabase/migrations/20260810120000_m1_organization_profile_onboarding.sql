-- =============================================================================
-- M1 organization legal profile and durable onboarding.
--
-- Existing organizations/memberships continue to own session display and RBAC.
-- This migration is additive: `organizations.name` remains the legal name used
-- by those existing consumers, while the one-to-one profile holds the M1 data.
-- All mutation RPCs are service_role-only, pin search_path, and write their
-- security/business audit fact in the same transaction as the state change.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ISO validation is duplicated at the storage boundary so a direct service-role
-- caller cannot persist a made-up country after the shared Zod boundary rejects
-- it. This is deliberately static: no browser locale, IP, or deployment region
-- can influence a legal establishment country.
-- ---------------------------------------------------------------------------
create or replace function public.is_iso_3166_alpha_2(p_country text)
  returns boolean
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select upper(p_country) = any (array[
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
    'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
    'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
    'CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE',
    'EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF',
    'GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM',
    'HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
    'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC',
    'LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK',
    'ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA',
    'NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG',
    'PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
    'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
    'ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
    'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
    'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
  ]);
$$;

alter function public.is_iso_3166_alpha_2(text) owner to postgres;
revoke all on function public.is_iso_3166_alpha_2(text)
  from public, anon, authenticated;

create or replace function public.m1_canonical_text(p_value text)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

alter function public.m1_canonical_text(text) owner to postgres;
revoke all on function public.m1_canonical_text(text)
  from public, anon, authenticated;

create or replace function public.m1_legal_identity_digest(
  p_legal_name text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_locality text,
  p_administrative_area text,
  p_postal_code text,
  p_registered_address_country text,
  p_main_establishment_country text
)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select encode(extensions.digest(
    jsonb_build_object(
      'legalName', public.m1_canonical_text(p_legal_name),
      'addressLine1', public.m1_canonical_text(p_address_line_1),
      'addressLine2', public.m1_canonical_text(p_address_line_2),
      'locality', public.m1_canonical_text(p_locality),
      'administrativeArea', public.m1_canonical_text(p_administrative_area),
      'postalCode', public.m1_canonical_text(p_postal_code),
      'registeredAddressCountry', upper(btrim(p_registered_address_country)),
      'mainEstablishmentCountry', upper(btrim(p_main_establishment_country))
    )::text,
    'sha256'
  ), 'hex');
$$;

create or replace function public.m1_organization_request_digest(
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
  p_manufacturer_contact_phone text
)
  returns text
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select encode(extensions.digest(
    jsonb_build_object(
      'identity', public.m1_legal_identity_digest(
        p_legal_name, p_address_line_1, p_address_line_2, p_locality,
        p_administrative_area, p_postal_code, p_registered_address_country,
        p_main_establishment_country
      ),
      'manufacturerContactName', public.m1_canonical_text(p_manufacturer_contact_name),
      'manufacturerContactEmail', lower(btrim(p_manufacturer_contact_email)),
      'manufacturerContactPhone', coalesce(btrim(p_manufacturer_contact_phone), '')
    )::text,
    'sha256'
  ), 'hex');
$$;

alter function public.m1_legal_identity_digest(text, text, text, text, text, text, text, text)
  owner to postgres;
alter function public.m1_organization_request_digest(text, text, text, text, text, text, text, text, text, text, text)
  owner to postgres;
revoke all on function public.m1_legal_identity_digest(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.m1_organization_request_digest(text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Legal profile, creation idempotency, and ordered onboarding state.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists legal_identity_digest text;

alter table public.organizations
  drop constraint if exists organizations_legal_identity_digest_length;
alter table public.organizations
  add constraint organizations_legal_identity_digest_length
    check (legal_identity_digest is null or legal_identity_digest ~ '^[0-9a-f]{64}$');

create unique index if not exists organizations_legal_identity_digest_key
  on public.organizations (legal_identity_digest)
  where legal_identity_digest is not null;

create table if not exists public.organization_legal_profiles (
  id                                 uuid primary key default gen_random_uuid(),
  organization_id                    uuid not null unique references public.organizations (id) on delete cascade,
  legal_name                         text not null,
  registered_address_line_1          text not null,
  registered_address_line_2          text,
  registered_address_locality        text not null,
  registered_address_administrative_area text,
  registered_address_postal_code     text not null,
  registered_address_country         text not null,
  main_establishment_country         text not null,
  manufacturer_contact_name          text not null,
  manufacturer_contact_email         text not null,
  manufacturer_contact_phone         text,
  version                            integer not null default 0,
  created_by                         uuid not null references public.users (id) on delete restrict,
  updated_by                         uuid not null references public.users (id) on delete restrict,
  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now(),

  constraint organization_legal_profiles_legal_name_check
    check (length(btrim(legal_name)) between 1 and 200),
  constraint organization_legal_profiles_line_1_check
    check (length(btrim(registered_address_line_1)) between 1 and 200),
  constraint organization_legal_profiles_line_2_check
    check (registered_address_line_2 is null or length(btrim(registered_address_line_2)) between 1 and 200),
  constraint organization_legal_profiles_locality_check
    check (length(btrim(registered_address_locality)) between 1 and 120),
  constraint organization_legal_profiles_area_check
    check (registered_address_administrative_area is null or length(btrim(registered_address_administrative_area)) between 1 and 120),
  constraint organization_legal_profiles_postal_check
    check (length(btrim(registered_address_postal_code)) between 1 and 32),
  constraint organization_legal_profiles_address_country_check
    check (public.is_iso_3166_alpha_2(registered_address_country)),
  constraint organization_legal_profiles_establishment_country_check
    check (public.is_iso_3166_alpha_2(main_establishment_country)),
  constraint organization_legal_profiles_contact_name_check
    check (length(btrim(manufacturer_contact_name)) between 1 and 160),
  constraint organization_legal_profiles_contact_email_check
    check (manufacturer_contact_email = lower(manufacturer_contact_email) and length(btrim(manufacturer_contact_email)) between 3 and 254),
  constraint organization_legal_profiles_contact_phone_check
    check (manufacturer_contact_phone is null or manufacturer_contact_phone ~ '^\\+[1-9][0-9]{1,14}$'),
  constraint organization_legal_profiles_version_check check (version >= 0)
);

create index if not exists organization_legal_profiles_updated_by_idx
  on public.organization_legal_profiles (updated_by, updated_at desc);

drop trigger if exists set_organization_legal_profiles_updated_at on public.organization_legal_profiles;
create trigger set_organization_legal_profiles_updated_at
  before update on public.organization_legal_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.organization_creation_idempotencies (
  user_id          uuid not null references public.users (id) on delete cascade,
  idempotency_key  uuid not null,
  request_digest   text not null,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),

  primary key (user_id, idempotency_key),
  constraint organization_creation_idempotencies_digest_check
    check (request_digest ~ '^[0-9a-f]{64}$')
);

create index if not exists organization_creation_idempotencies_organization_idx
  on public.organization_creation_idempotencies (organization_id);

create table if not exists public.organization_onboarding (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  completed_at     timestamptz,
  completed_by     uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organization_onboarding_completion_pair
    check ((completed_at is null) = (completed_by is null))
);

drop trigger if exists set_organization_onboarding_updated_at on public.organization_onboarding;
create trigger set_organization_onboarding_updated_at
  before update on public.organization_onboarding
  for each row execute function public.set_updated_at();

create table if not exists public.organization_onboarding_stages (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  stage            text not null,
  stage_order      smallint not null,
  status           text not null,
  block_reason     text,
  completed_at     timestamptz,
  completed_by     uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  primary key (organization_id, stage),
  constraint organization_onboarding_stages_stage_order_check check (
    (stage = 'organization_details' and stage_order = 1) or
    (stage = 'first_product' and stage_order = 2) or
    (stage = 'first_sbom' and stage_order = 3) or
    (stage = 'invite_team' and stage_order = 4) or
    (stage = 'completed' and stage_order = 5)
  ),
  constraint organization_onboarding_stages_status_check
    check (status in ('pending', 'blocked', 'completed')),
  constraint organization_onboarding_stages_block_reason_check
    check (block_reason is null or block_reason in (
      'awaiting_authoritative_product',
      'awaiting_authoritative_sbom',
      'awaiting_prior_stage'
    )),
  constraint organization_onboarding_stages_state_check check (
    (status = 'completed' and completed_at is not null and completed_by is not null and block_reason is null) or
    (status = 'blocked' and completed_at is null and completed_by is null and block_reason is not null) or
    (status = 'pending' and completed_at is null and completed_by is null and block_reason is null)
  )
);

create unique index if not exists organization_onboarding_stages_order_key
  on public.organization_onboarding_stages (organization_id, stage_order);

drop trigger if exists set_organization_onboarding_stages_updated_at on public.organization_onboarding_stages;
create trigger set_organization_onboarding_stages_updated_at
  before update on public.organization_onboarding_stages
  for each row execute function public.set_updated_at();

create table if not exists public.organization_onboarding_evidence (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  stage            text not null,
  resource_id      uuid not null,
  recorded_by      uuid not null references public.users (id) on delete restrict,
  recorded_at      timestamptz not null default now(),
  is_available     boolean not null default true,
  unavailable_at   timestamptz,
  updated_at       timestamptz not null default now(),

  unique (organization_id, stage, resource_id),
  constraint organization_onboarding_evidence_stage_check
    check (stage in ('first_product', 'first_sbom', 'invite_team')),
  constraint organization_onboarding_evidence_availability_check
    check ((is_available and unavailable_at is null) or (not is_available and unavailable_at is not null))
);

create index if not exists organization_onboarding_evidence_stage_idx
  on public.organization_onboarding_evidence (organization_id, stage, is_available, recorded_at);

drop trigger if exists set_organization_onboarding_evidence_updated_at on public.organization_onboarding_evidence;
create trigger set_organization_onboarding_evidence_updated_at
  before update on public.organization_onboarding_evidence
  for each row execute function public.set_updated_at();

-- Existing organizations must not gain invented countries or contacts. They get
-- an explicit pending-details onboarding record and can be completed through
-- the version-zero profile replacement path below.
insert into public.organization_onboarding (organization_id)
select o.id
  from public.organizations o
on conflict (organization_id) do nothing;

insert into public.organization_onboarding_stages (
  organization_id, stage, stage_order, status, block_reason
)
select o.id, stage_data.stage, stage_data.stage_order, stage_data.status, stage_data.block_reason
  from public.organizations o
 cross join (
   values
     ('organization_details'::text, 1::smallint, 'pending'::text, null::text),
     ('first_product', 2::smallint, 'blocked', 'awaiting_prior_stage'),
     ('first_sbom', 3::smallint, 'blocked', 'awaiting_prior_stage'),
     ('invite_team', 4::smallint, 'blocked', 'awaiting_prior_stage'),
     ('completed', 5::smallint, 'blocked', 'awaiting_prior_stage')
 ) as stage_data(stage, stage_order, status, block_reason)
on conflict (organization_id, stage) do nothing;

-- Delivery tracking is intentionally separate from invitation lifecycle. A row
-- can be persisted before SMTP succeeds; only the post-send RPC marks delivery
-- confirmed and records invite-team onboarding evidence.
alter table public.invitations
  add column if not exists delivery_confirmed_at timestamptz,
  add column if not exists last_delivery_attempt_at timestamptz,
  add column if not exists delivery_attempts integer not null default 0;

alter table public.invitations
  drop constraint if exists invitations_delivery_attempts_check;
alter table public.invitations
  add constraint invitations_delivery_attempts_check check (delivery_attempts >= 0);

-- ---------------------------------------------------------------------------
-- Defence-in-depth RLS. Browser roles still have no table grants; service_role
-- is constrained by the API repository's explicit org filters and RPC checks.
-- ---------------------------------------------------------------------------
alter table public.organization_legal_profiles enable row level security;
alter table public.organization_creation_idempotencies enable row level security;
alter table public.organization_onboarding enable row level security;
alter table public.organization_onboarding_stages enable row level security;
alter table public.organization_onboarding_evidence enable row level security;

grant all on table public.organization_legal_profiles to service_role;
grant all on table public.organization_creation_idempotencies to service_role;
grant all on table public.organization_onboarding to service_role;
grant all on table public.organization_onboarding_stages to service_role;
grant all on table public.organization_onboarding_evidence to service_role;
revoke all on table public.organization_legal_profiles from public, anon, authenticated;
revoke all on table public.organization_creation_idempotencies from public, anon, authenticated;
revoke all on table public.organization_onboarding from public, anon, authenticated;
revoke all on table public.organization_onboarding_stages from public, anon, authenticated;
revoke all on table public.organization_onboarding_evidence from public, anon, authenticated;

drop policy if exists organization_legal_profiles_select_member on public.organization_legal_profiles;
create policy organization_legal_profiles_select_member on public.organization_legal_profiles
  for select to authenticated
  using (public.user_is_member_of(organization_id));

drop policy if exists organization_onboarding_select_member on public.organization_onboarding;
create policy organization_onboarding_select_member on public.organization_onboarding
  for select to authenticated
  using (public.user_is_member_of(organization_id));

drop policy if exists organization_onboarding_stages_select_member on public.organization_onboarding_stages;
create policy organization_onboarding_stages_select_member on public.organization_onboarding_stages
  for select to authenticated
  using (public.user_is_member_of(organization_id));

drop policy if exists organization_onboarding_evidence_select_member on public.organization_onboarding_evidence;
create policy organization_onboarding_evidence_select_member on public.organization_onboarding_evidence
  for select to authenticated
  using (public.user_is_member_of(organization_id));

-- ---------------------------------------------------------------------------
-- Internal reconciliation. It serializes on the onboarding header, accepts
-- out-of-order evidence, only advances contiguous stages, and never regresses a
-- completed stage when later evidence becomes unavailable.
-- ---------------------------------------------------------------------------
create or replace function public.complete_organization_onboarding_stage(
  p_organization_id uuid,
  p_stage text,
  p_actor_user_id uuid,
  p_completed_at timestamptz,
  p_resource_id uuid
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_updated boolean := false;
  v_row_count bigint := 0;
begin
  update public.organization_onboarding_stages stages
     set status = 'completed',
         block_reason = null,
         completed_at = p_completed_at,
         completed_by = p_actor_user_id
   where stages.organization_id = p_organization_id
     and stages.stage = p_stage
     and stages.status <> 'completed';

  get diagnostics v_row_count = row_count;
  v_updated := v_row_count > 0;
  if v_updated then
    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, changes
    ) values (
      p_organization_id, p_actor_user_id, 'onboarding.stage_completed',
      'organization_onboarding_stage', p_stage,
      jsonb_build_object('stage', p_stage, 'resourceId', p_resource_id)
    );
  end if;
  return v_updated;
end;
$$;

alter function public.complete_organization_onboarding_stage(uuid, text, uuid, timestamptz, uuid)
  owner to postgres;
revoke all on function public.complete_organization_onboarding_stage(uuid, text, uuid, timestamptz, uuid)
  from public, anon, authenticated;

create or replace function public.reconcile_organization_onboarding(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_profile public.organization_legal_profiles%rowtype;
  v_details public.organization_onboarding_stages%rowtype;
  v_product public.organization_onboarding_stages%rowtype;
  v_sbom public.organization_onboarding_stages%rowtype;
  v_invite public.organization_onboarding_stages%rowtype;
  v_complete public.organization_onboarding_stages%rowtype;
  v_product_evidence public.organization_onboarding_evidence%rowtype;
  v_sbom_evidence public.organization_onboarding_evidence%rowtype;
  v_invite_evidence public.organization_onboarding_evidence%rowtype;
begin
  perform 1
    from public.organization_onboarding onboarding
   where onboarding.organization_id = p_organization_id
   for update;
  if not found then
    return;
  end if;

  select * into v_profile
    from public.organization_legal_profiles profiles
   where profiles.organization_id = p_organization_id;

  select * into v_details from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'organization_details' for update;
  select * into v_product from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'first_product' for update;
  select * into v_sbom from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'first_sbom' for update;
  select * into v_invite from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'invite_team' for update;
  select * into v_complete from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'completed' for update;

  if v_profile.id is not null then
    perform public.complete_organization_onboarding_stage(
      p_organization_id, 'organization_details', v_profile.updated_by,
      v_profile.updated_at, p_organization_id
    );
  else
    update public.organization_onboarding_stages
       set status = 'pending', block_reason = null, completed_at = null, completed_by = null
     where organization_id = p_organization_id
       and stage = 'organization_details'
       and status <> 'completed';
  end if;

  select * into v_details from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'organization_details';
  select * into v_product_evidence
    from public.organization_onboarding_evidence evidence
   where evidence.organization_id = p_organization_id
     and evidence.stage = 'first_product'
     and evidence.is_available
   order by evidence.recorded_at asc, evidence.id asc
   limit 1;

  if v_product.status <> 'completed' then
    if v_details.status <> 'completed' then
      update public.organization_onboarding_stages
         set status = 'blocked', block_reason = 'awaiting_prior_stage', completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'first_product';
    elsif v_product_evidence.id is not null then
      perform public.complete_organization_onboarding_stage(
        p_organization_id, 'first_product', v_product_evidence.recorded_by,
        v_product_evidence.recorded_at, v_product_evidence.resource_id
      );
    else
      update public.organization_onboarding_stages
         set status = 'blocked', block_reason = 'awaiting_authoritative_product', completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'first_product';
    end if;
  end if;

  select * into v_product from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'first_product';
  select * into v_sbom_evidence
    from public.organization_onboarding_evidence evidence
   where evidence.organization_id = p_organization_id
     and evidence.stage = 'first_sbom'
     and evidence.is_available
   order by evidence.recorded_at asc, evidence.id asc
   limit 1;

  if v_sbom.status <> 'completed' then
    if v_product.status <> 'completed' then
      update public.organization_onboarding_stages
         set status = 'blocked', block_reason = 'awaiting_prior_stage', completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'first_sbom';
    elsif v_sbom_evidence.id is not null then
      perform public.complete_organization_onboarding_stage(
        p_organization_id, 'first_sbom', v_sbom_evidence.recorded_by,
        v_sbom_evidence.recorded_at, v_sbom_evidence.resource_id
      );
    else
      update public.organization_onboarding_stages
         set status = 'blocked', block_reason = 'awaiting_authoritative_sbom', completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'first_sbom';
    end if;
  end if;

  select * into v_sbom from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'first_sbom';
  select * into v_invite_evidence
    from public.organization_onboarding_evidence evidence
   where evidence.organization_id = p_organization_id
     and evidence.stage = 'invite_team'
     and evidence.is_available
   order by evidence.recorded_at asc, evidence.id asc
   limit 1;

  if v_invite.status <> 'completed' then
    if v_sbom.status <> 'completed' then
      update public.organization_onboarding_stages
         set status = 'blocked', block_reason = 'awaiting_prior_stage', completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'invite_team';
    elsif v_invite_evidence.id is not null then
      perform public.complete_organization_onboarding_stage(
        p_organization_id, 'invite_team', v_invite_evidence.recorded_by,
        v_invite_evidence.recorded_at, v_invite_evidence.resource_id
      );
    else
      update public.organization_onboarding_stages
         set status = 'pending', block_reason = null, completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'invite_team';
    end if;
  end if;

  select * into v_invite from public.organization_onboarding_stages
   where organization_id = p_organization_id and stage = 'invite_team';
  if v_complete.status <> 'completed' then
    if v_invite.status = 'completed' then
      perform public.complete_organization_onboarding_stage(
        p_organization_id, 'completed', v_invite.completed_by,
        v_invite.completed_at, null
      );
      update public.organization_onboarding
         set completed_at = v_invite.completed_at,
             completed_by = v_invite.completed_by
       where organization_id = p_organization_id
         and completed_at is null;
      if found then
        insert into public.audit_logs (
          organization_id, user_id, action, entity_type, entity_id, changes
        ) values (
          p_organization_id, v_invite.completed_by, 'onboarding.completed',
          'organization_onboarding', p_organization_id::text,
          jsonb_build_object('finalStage', 'invite_team')
        );
      end if;
    else
      update public.organization_onboarding_stages
         set status = 'blocked', block_reason = 'awaiting_prior_stage', completed_at = null, completed_by = null
       where organization_id = p_organization_id and stage = 'completed';
    end if;
  end if;
end;
$$;

alter function public.reconcile_organization_onboarding(uuid, uuid) owner to postgres;
revoke all on function public.reconcile_organization_onboarding(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic create: legal profile + owner + onboarding + idempotency + audit.
-- A unique legal digest gives one organization under parallel equivalent create
-- requests; a per-actor key rejects changed payload reuse without exposing the
-- organization that caused either conflict.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization_atomic(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
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
  p_manufacturer_contact_phone text
)
  returns table (outcome text, organization_id uuid)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_user public.users%rowtype;
  v_replay public.organization_creation_idempotencies%rowtype;
  v_org_id uuid;
  v_identity_digest text;
  v_request_digest text;
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
  v_contact_phone text := nullif(btrim(coalesce(p_manufacturer_contact_phone, '')), '');
begin
  select * into v_user from public.users users
   where users.id = p_actor_user_id and users.is_active;
  if not found then
    return query select 'user_not_found'::text, null::uuid;
    return;
  end if;

  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = 'invalid_parameter_value';
  end if;

  v_identity_digest := public.m1_legal_identity_digest(
    v_legal_name, v_line_1, v_line_2, v_locality, v_area, v_postal_code,
    v_address_country, v_establishment_country
  );
  v_request_digest := public.m1_organization_request_digest(
    v_legal_name, v_line_1, v_line_2, v_locality, v_area, v_postal_code,
    v_address_country, v_establishment_country, v_contact_name, v_contact_email,
    v_contact_phone
  );

  select * into v_replay
    from public.organization_creation_idempotencies records
   where records.user_id = p_actor_user_id
     and records.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_replay.request_digest = v_request_digest then
      return query select 'replayed'::text, v_replay.organization_id;
    else
      return query select 'idempotency_mismatch'::text, null::uuid;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.organizations organizations
     where organizations.legal_identity_digest = v_identity_digest
  ) then
    insert into public.audit_logs (user_id, action, entity_type, changes)
    values (
      p_actor_user_id, 'organization.creation_rejected', 'organization',
      jsonb_build_object('reason', 'legal_identity_conflict', 'legalIdentityDigest', v_identity_digest)
    );
    return query select 'legal_identity_conflict'::text, null::uuid;
    return;
  end if;

  begin
    insert into public.organizations (name, slug, legal_identity_digest)
    values (
      v_legal_name,
      'org-' || replace(gen_random_uuid()::text, '-', ''),
      v_identity_digest
    )
    returning id into v_org_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (v_org_id, p_actor_user_id, 'owner');

    insert into public.organization_legal_profiles (
      organization_id, legal_name, registered_address_line_1,
      registered_address_line_2, registered_address_locality,
      registered_address_administrative_area, registered_address_postal_code,
      registered_address_country, main_establishment_country,
      manufacturer_contact_name, manufacturer_contact_email,
      manufacturer_contact_phone, created_by, updated_by
    ) values (
      v_org_id, v_legal_name, v_line_1, v_line_2, v_locality, v_area,
      v_postal_code, v_address_country, v_establishment_country,
      v_contact_name, v_contact_email, v_contact_phone, p_actor_user_id,
      p_actor_user_id
    );

    insert into public.organization_onboarding (organization_id)
    values (v_org_id);
    insert into public.organization_onboarding_stages (
      organization_id, stage, stage_order, status, block_reason, completed_at, completed_by
    ) values
      (v_org_id, 'organization_details', 1, 'completed', null, now(), p_actor_user_id),
      (v_org_id, 'first_product', 2, 'blocked', 'awaiting_authoritative_product', null, null),
      (v_org_id, 'first_sbom', 3, 'blocked', 'awaiting_prior_stage', null, null),
      (v_org_id, 'invite_team', 4, 'blocked', 'awaiting_prior_stage', null, null),
      (v_org_id, 'completed', 5, 'blocked', 'awaiting_prior_stage', null, null);

    insert into public.organization_creation_idempotencies (
      user_id, idempotency_key, request_digest, organization_id
    ) values (p_actor_user_id, p_idempotency_key, v_request_digest, v_org_id);

    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, changes
    ) values (
      v_org_id, p_actor_user_id, 'organization.created', 'organization',
      v_org_id::text,
      jsonb_build_object('legalIdentityDigest', v_identity_digest, 'profileVersion', 0)
    );
  exception when unique_violation then
    select * into v_replay
      from public.organization_creation_idempotencies records
     where records.user_id = p_actor_user_id
       and records.idempotency_key = p_idempotency_key;
    if found then
      if v_replay.request_digest = v_request_digest then
        return query select 'replayed'::text, v_replay.organization_id;
      else
        return query select 'idempotency_mismatch'::text, null::uuid;
      end if;
      return;
    end if;
    if exists (
      select 1 from public.organizations organizations
       where organizations.legal_identity_digest = v_identity_digest
    ) then
      insert into public.audit_logs (user_id, action, entity_type, changes)
      values (
        p_actor_user_id, 'organization.creation_rejected', 'organization',
        jsonb_build_object('reason', 'legal_identity_conflict', 'legalIdentityDigest', v_identity_digest)
      );
      return query select 'legal_identity_conflict'::text, null::uuid;
      return;
    end if;
    raise;
  end;

  return query select 'created'::text, v_org_id;
end;
$$;

alter function public.create_organization_atomic(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text)
  owner to postgres;
revoke all on function public.create_organization_atomic(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_organization_atomic(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Versioned legal-profile replacement. The adapter supplies only keyed contact
-- digests for audit redaction; old/new non-contact state is built in SQL under
-- the row lock. Version zero creates a profile for a legacy organization.
-- ---------------------------------------------------------------------------
create or replace function public.update_organization_legal_profile_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
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
  p_manufacturer_contact_phone text,
  p_contact_name_before_digest text,
  p_contact_name_after_digest text,
  p_contact_email_before_digest text,
  p_contact_email_after_digest text,
  p_contact_phone_before_digest text,
  p_contact_phone_after_digest text
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_profile public.organization_legal_profiles%rowtype;
  v_identity_digest text;
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
  v_contact_phone text := nullif(btrim(coalesce(p_manufacturer_contact_phone, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.users users
     join public.organization_members members on members.user_id = users.id
    where users.id = p_actor_user_id
      and users.is_active
      and members.organization_id = p_organization_id
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  select * into v_profile
    from public.organization_legal_profiles profiles
   where profiles.organization_id = p_organization_id
   for update;

  if not found then
    if p_expected_version <> 0 then
      return query select 'version_conflict'::text;
      return;
    end if;
    v_before := null;
  elsif v_profile.version <> p_expected_version then
    return query select 'version_conflict'::text;
    return;
  else
    v_before := jsonb_build_object(
      'legalName', v_profile.legal_name,
      'registeredAddress', jsonb_build_object(
        'addressLine1', v_profile.registered_address_line_1,
        'addressLine2', v_profile.registered_address_line_2,
        'locality', v_profile.registered_address_locality,
        'administrativeArea', v_profile.registered_address_administrative_area,
        'postalCode', v_profile.registered_address_postal_code,
        'country', v_profile.registered_address_country
      ),
      'mainEstablishmentCountry', v_profile.main_establishment_country
    );
  end if;

  v_identity_digest := public.m1_legal_identity_digest(
    v_legal_name, v_line_1, v_line_2, v_locality, v_area, v_postal_code,
    v_address_country, v_establishment_country
  );
  if exists (
    select 1 from public.organizations organizations
     where organizations.legal_identity_digest = v_identity_digest
       and organizations.id <> p_organization_id
  ) then
    return query select 'legal_identity_conflict'::text;
    return;
  end if;

  v_after := jsonb_build_object(
    'legalName', v_legal_name,
    'registeredAddress', jsonb_build_object(
      'addressLine1', v_line_1,
      'addressLine2', v_line_2,
      'locality', v_locality,
      'administrativeArea', v_area,
      'postalCode', v_postal_code,
      'country', v_address_country
    ),
    'mainEstablishmentCountry', v_establishment_country
  );

  if v_before is null or v_before ->> 'legalName' is distinct from v_after ->> 'legalName' then
    v_changed_fields := v_changed_fields || jsonb_build_array('legalName');
  end if;
  if v_before is null or v_before -> 'registeredAddress' is distinct from v_after -> 'registeredAddress' then
    v_changed_fields := v_changed_fields || jsonb_build_array('registeredAddress');
  end if;
  if v_before is null or v_before ->> 'mainEstablishmentCountry' is distinct from v_after ->> 'mainEstablishmentCountry' then
    v_changed_fields := v_changed_fields || jsonb_build_array('mainEstablishmentCountry');
  end if;
  if coalesce(p_contact_name_before_digest, '') is distinct from coalesce(p_contact_name_after_digest, '') then
    v_changed_fields := v_changed_fields || jsonb_build_array('manufacturerContactName');
  end if;
  if coalesce(p_contact_email_before_digest, '') is distinct from coalesce(p_contact_email_after_digest, '') then
    v_changed_fields := v_changed_fields || jsonb_build_array('manufacturerContactEmail');
  end if;
  if coalesce(p_contact_phone_before_digest, '') is distinct from coalesce(p_contact_phone_after_digest, '') then
    v_changed_fields := v_changed_fields || jsonb_build_array('manufacturerContactPhone');
  end if;

  begin
    if v_profile.id is null then
      insert into public.organization_legal_profiles (
        organization_id, legal_name, registered_address_line_1,
        registered_address_line_2, registered_address_locality,
        registered_address_administrative_area, registered_address_postal_code,
        registered_address_country, main_establishment_country,
        manufacturer_contact_name, manufacturer_contact_email,
        manufacturer_contact_phone, created_by, updated_by
      ) values (
        p_organization_id, v_legal_name, v_line_1, v_line_2, v_locality,
        v_area, v_postal_code, v_address_country, v_establishment_country,
        v_contact_name, v_contact_email, v_contact_phone, p_actor_user_id,
        p_actor_user_id
      );
    else
      update public.organization_legal_profiles profiles
         set legal_name = v_legal_name,
             registered_address_line_1 = v_line_1,
             registered_address_line_2 = v_line_2,
             registered_address_locality = v_locality,
             registered_address_administrative_area = v_area,
             registered_address_postal_code = v_postal_code,
             registered_address_country = v_address_country,
             main_establishment_country = v_establishment_country,
             manufacturer_contact_name = v_contact_name,
             manufacturer_contact_email = v_contact_email,
             manufacturer_contact_phone = v_contact_phone,
             version = profiles.version + 1,
             updated_by = p_actor_user_id
       where profiles.organization_id = p_organization_id;
    end if;

    update public.organizations organizations
       set name = v_legal_name,
           legal_identity_digest = v_identity_digest
     where organizations.id = p_organization_id;
  exception when unique_violation then
    return query select 'legal_identity_conflict'::text;
    return;
  end;

  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'organization.legal_profile_updated',
    'organization_legal_profile', p_organization_id::text,
    jsonb_build_object(
      'changedFields', v_changed_fields,
      'before', v_before,
      'after', v_after,
      'contactDigests', jsonb_build_object(
        'manufacturerContactName', jsonb_build_object('before', p_contact_name_before_digest, 'after', p_contact_name_after_digest),
        'manufacturerContactEmail', jsonb_build_object('before', p_contact_email_before_digest, 'after', p_contact_email_after_digest),
        'manufacturerContactPhone', jsonb_build_object('before', p_contact_phone_before_digest, 'after', p_contact_phone_after_digest)
      )
    )
  );

  perform public.reconcile_organization_onboarding(p_organization_id, p_actor_user_id);
  return query select 'updated'::text;
end;
$$;

alter function public.update_organization_legal_profile_atomic(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  owner to postgres;
revoke all on function public.update_organization_legal_profile_atomic(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_organization_legal_profile_atomic(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

-- Atomic selection audit. The cookie remains server-owned and is deliberately
-- set by Nest only after this committed membership/audit fact succeeds.
create or replace function public.switch_organization_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id
    where members.organization_id = p_organization_id
      and members.user_id = p_actor_user_id
      and users.is_active
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'organization.switched',
    'organization', p_organization_id::text,
    jsonb_build_object('selection', 'active_organization')
  );
  return query select 'switched'::text;
end;
$$;

alter function public.switch_organization_atomic(uuid, uuid) owner to postgres;
revoke all on function public.switch_organization_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.switch_organization_atomic(uuid, uuid)
  to service_role;

-- Future Product/SBOM integrations call this only after their own authoritative
-- commit. No HTTP route accepts a client completion flag.
create or replace function public.record_organization_onboarding_evidence_atomic(
  p_organization_id uuid,
  p_stage text,
  p_resource_id uuid,
  p_actor_user_id uuid,
  p_available boolean default true
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_stage not in ('first_product', 'first_sbom', 'invite_team') or p_resource_id is null then
    return query select 'invalid_evidence'::text;
    return;
  end if;

  if not exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id
    where members.organization_id = p_organization_id
      and members.user_id = p_actor_user_id
      and users.is_active
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  perform 1 from public.organization_onboarding onboarding
   where onboarding.organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  insert into public.organization_onboarding_evidence (
    organization_id, stage, resource_id, recorded_by, is_available, unavailable_at
  ) values (
    p_organization_id, p_stage, p_resource_id, p_actor_user_id, p_available,
    case when p_available then null else now() end
  )
  on conflict (organization_id, stage, resource_id) do update
    set recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at,
        is_available = excluded.is_available,
        unavailable_at = excluded.unavailable_at;

  perform public.reconcile_organization_onboarding(p_organization_id, p_actor_user_id);
  return query select 'recorded'::text;
end;
$$;

alter function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  owner to postgres;
revoke all on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  to service_role;

-- The existing invitation model is retained. This row-locked resend rotates the
-- hash and expiry in place; it never stores/returns a raw token and never
-- creates a second invitation row.
create or replace function public.resend_invitation_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
  returns table (outcome text, invitation_id uuid, email text, organization_name text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_invitation public.invitations%rowtype;
  v_actor public.users%rowtype;
  v_organization public.organizations%rowtype;
  v_actor_email text := lower(btrim(p_actor_email));
begin
  select * into v_actor from public.users users
   where users.id = p_actor_user_id and users.is_active;
  if not found then
    return query select 'actor_not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_actor_email is distinct from lower(btrim(v_actor.email)) then
    return query select 'actor_email_mismatch'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if not exists (
    select 1 from public.organization_members members
     where members.organization_id = p_organization_id
       and members.user_id = p_actor_user_id
  ) then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_invitation from public.invitations invitations
   where invitations.id = p_invitation_id
     and invitations.organization_id = p_organization_id
   for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select * into v_organization from public.organizations organizations
   where organizations.id = p_organization_id;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_invitation.status = 'accepted' then
    return query select 'accepted'::text, v_invitation.id, null::text, null::text;
    return;
  end if;
  if v_invitation.status <> 'pending' then
    return query select 'not_pending'::text, v_invitation.id, null::text, null::text;
    return;
  end if;
  if v_invitation.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_invitation.id;
    return query select 'expired'::text, v_invitation.id, null::text, null::text;
    return;
  end if;
  if exists (
    select 1 from public.users users
    join public.organization_members members on members.user_id = users.id
    where members.organization_id = p_organization_id
      and lower(users.email) = lower(v_invitation.email)
  ) then
    return query select 'already_member'::text, v_invitation.id, null::text, null::text;
    return;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() then
    raise exception 'invalid resend token or expiry' using errcode = 'invalid_parameter_value';
  end if;

  update public.invitations
     set token_hash = p_token_hash,
         expires_at = p_expires_at,
         delivery_confirmed_at = null,
         last_delivery_attempt_at = now(),
         delivery_attempts = delivery_attempts + 1
   where id = v_invitation.id;

  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, 'invitation.resent', 'invitation',
    v_invitation.id::text, jsonb_build_object('tokenRotated', true)
  );
  return query select 'resent'::text, v_invitation.id, v_invitation.email, v_organization.name;
end;
$$;

alter function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  owner to postgres;
revoke all on function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  to service_role;

-- Called only after SMTP succeeds. It marks delivery and records the same
-- idempotent invite-team evidence in one transaction, so an SMTP retry cannot
-- create duplicate onboarding completion or a false delivery confirmation.
create or replace function public.record_invitation_delivery_onboarding_atomic(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_was_confirmed boolean := false;
begin
  if not exists (
    select 1 from public.organization_members members
    join public.users users on users.id = members.user_id
    where members.organization_id = p_organization_id
      and members.user_id = p_actor_user_id
      and users.is_active
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  perform 1 from public.organization_onboarding onboarding
   where onboarding.organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  select delivery_confirmed_at is not null into v_was_confirmed
    from public.invitations invitations
   where invitations.id = p_invitation_id
     and invitations.organization_id = p_organization_id
   for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  update public.invitations
     set delivery_confirmed_at = now(),
         last_delivery_attempt_at = now(),
         delivery_attempts = greatest(delivery_attempts, 1)
   where id = p_invitation_id;

  insert into public.organization_onboarding_evidence (
    organization_id, stage, resource_id, recorded_by, is_available, unavailable_at
  ) values (
    p_organization_id, 'invite_team', p_invitation_id, p_actor_user_id, true, null
  )
  on conflict (organization_id, stage, resource_id) do update
    set recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at,
        is_available = true,
        unavailable_at = null;

  if not v_was_confirmed then
    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, changes
    ) values (
      p_organization_id, p_actor_user_id, 'invitation.delivery_confirmed',
      'invitation', p_invitation_id::text,
      jsonb_build_object('delivery', 'confirmed')
    );
  end if;
  perform public.reconcile_organization_onboarding(p_organization_id, p_actor_user_id);
  return query select 'recorded'::text;
end;
$$;

alter function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  to service_role;
