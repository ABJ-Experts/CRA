-- M2 V1 relationship history. This deliberately uses only three tenant
-- tables: baseline revisions, memberships, and discriminated relationships.
-- Graph coordination is a column on organization_settings and events reuse the
-- established product regulatory outbox.

alter table public.organization_settings
  add column if not exists product_relationship_graph_version integer not null default 0
    check (product_relationship_graph_version >= 0);

create table public.software_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  baseline_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  identifier text not null check (char_length(btrim(identifier)) between 1 and 128),
  identifier_normalized text generated always as (
    lower(regexp_replace(normalize(identifier, NFKC), '\\s+', '', 'g'))
  ) stored,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(btrim(description)) between 1 and 4000),
  revision_summary text not null check (char_length(btrim(revision_summary)) between 1 and 1000),
  source text not null check (char_length(btrim(source)) between 1 and 1000),
  provenance text not null check (char_length(btrim(provenance)) between 1 and 1000),
  effective_starts_at timestamptz not null,
  effective_ends_at timestamptz,
  is_current boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete set null,
  archive_reason text,
  version integer not null default 0 check (version >= 0),
  idempotency_key uuid,
  idempotency_request_digest text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, id, baseline_id),
  unique (organization_id, baseline_id, revision_number),
  check (effective_ends_at is null or effective_ends_at > effective_starts_at),
  check ((archived_at is null) = (archived_by is null)),
  check (archive_reason is null or char_length(btrim(archive_reason)) between 1 and 1000),
  check (
    (idempotency_key is null and idempotency_request_digest is null)
    or (idempotency_key is not null and idempotency_request_digest ~ '^[a-f0-9]{64}$')
  )
);

create table public.software_baseline_release_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid not null,
  baseline_id uuid not null,
  baseline_revision_id uuid not null,
  source text not null check (char_length(btrim(source)) between 1 and 1000),
  provenance text not null check (char_length(btrim(provenance)) between 1 and 1000),
  effective_starts_at timestamptz not null,
  effective_ends_at timestamptz,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references public.users(id) on delete restrict,
  ended_at timestamptz,
  ended_by uuid references public.users(id) on delete set null,
  end_reason text,
  version integer not null default 0 check (version >= 0),
  idempotency_key uuid,
  idempotency_request_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, baseline_revision_id, baseline_id)
    references public.software_baselines(organization_id, id, baseline_id) on delete restrict,
  check (effective_ends_at is null or effective_ends_at > effective_starts_at),
  check ((ended_at is null) = (ended_by is null)),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= effective_starts_at),
  check (end_reason is null or char_length(btrim(end_reason)) between 1 and 1000),
  check (
    (idempotency_key is null and idempotency_request_digest is null)
    or (idempotency_key is not null and idempotency_request_digest ~ '^[a-f0-9]{64}$')
  )
);

create table public.product_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('embedded', 'variant')),
  source_type text check (source_type in ('base_release', 'baseline_revision')),
  source_product_id uuid,
  target_product_id uuid not null,
  source_release_id uuid,
  target_release_id uuid,
  baseline_revision_id uuid,
  quantity integer,
  source text not null check (char_length(btrim(source)) between 1 and 1000),
  provenance text not null check (char_length(btrim(provenance)) between 1 and 1000),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  effective_starts_at timestamptz not null,
  effective_ends_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  ended_at timestamptz,
  ended_by uuid references public.users(id) on delete set null,
  end_reason text,
  superseded_by_id uuid,
  version integer not null default 0 check (version >= 0),
  graph_version integer not null check (graph_version >= 0),
  idempotency_key uuid,
  idempotency_request_digest text,
  unique (organization_id, id),
  foreign key (organization_id, source_product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, target_product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, source_product_id, source_release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, target_product_id, target_release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, baseline_revision_id)
    references public.software_baselines(organization_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_id)
    references public.product_relationships(organization_id, id) on delete restrict,
  check (effective_ends_at is null or effective_ends_at > effective_starts_at),
  check ((ended_at is null) = (ended_by is null)),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= effective_starts_at),
  check (end_reason is null or char_length(btrim(end_reason)) between 1 and 1000),
  check (
    (idempotency_key is null and idempotency_request_digest is null)
    or (idempotency_key is not null and idempotency_request_digest ~ '^[a-f0-9]{64}$')
  ),
  check (
    (relationship_type = 'variant'
      and quantity is null
      and target_release_id is not null
      and ((source_type = 'base_release' and source_product_id is not null
            and source_release_id is not null and baseline_revision_id is null)
        or (source_type = 'baseline_revision' and source_product_id is null
            and source_release_id is null and baseline_revision_id is not null)))
    or (relationship_type = 'embedded'
      and source_type is null
      and source_product_id is not null
      and baseline_revision_id is null
      and quantity between 1 and 1000000
      and source_product_id <> target_product_id)
  )
);

create unique index software_baselines_identifier_current_key
  on public.software_baselines(organization_id, identifier_normalized)
  where is_current and archived_at is null;
create unique index software_baselines_actor_idempotency_key
  on public.software_baselines(organization_id, created_by, idempotency_key)
  where idempotency_key is not null;
create index software_baselines_history_idx
  on public.software_baselines(organization_id, baseline_id, revision_number desc);
create index software_baselines_active_idx
  on public.software_baselines(organization_id, archived_at, effective_starts_at desc, id desc);
create unique index software_baseline_membership_active_release_key
  on public.software_baseline_release_memberships(organization_id, release_id)
  where ended_at is null;
create unique index software_baseline_membership_actor_idempotency_key
  on public.software_baseline_release_memberships(organization_id, assigned_by, idempotency_key)
  where idempotency_key is not null;
create index software_baseline_memberships_product_as_of_idx
  on public.software_baseline_release_memberships(organization_id, product_id, effective_starts_at desc, release_id)
  where ended_at is null;
create index software_baseline_memberships_baseline_active_idx
  on public.software_baseline_release_memberships(organization_id, baseline_id, effective_starts_at desc)
  where ended_at is null;
create unique index product_relationships_embedded_active_key
  on public.product_relationships(
    organization_id, source_product_id, target_product_id,
    source_release_id, target_release_id
  ) nulls not distinct where relationship_type = 'embedded' and ended_at is null;
create unique index product_relationships_variant_release_active_key
  on public.product_relationships(organization_id, source_release_id, target_release_id)
  where relationship_type = 'variant' and source_type = 'base_release' and ended_at is null;
create unique index product_relationships_variant_baseline_active_key
  on public.product_relationships(organization_id, baseline_revision_id, target_release_id)
  where relationship_type = 'variant' and source_type = 'baseline_revision' and ended_at is null;
create unique index product_relationships_actor_idempotency_key
  on public.product_relationships(organization_id, created_by, idempotency_key)
  where idempotency_key is not null;
create index product_relationships_embedded_source_idx
  on public.product_relationships(organization_id, source_product_id, target_product_id, id)
  where relationship_type = 'embedded' and ended_at is null;
create index product_relationships_embedded_target_idx
  on public.product_relationships(organization_id, target_product_id, source_product_id, id)
  where relationship_type = 'embedded' and ended_at is null;
create index product_relationships_subject_active_idx
  on public.product_relationships(organization_id, target_product_id, source_product_id, effective_starts_at desc)
  where ended_at is null;

alter table public.software_baselines enable row level security;
alter table public.software_baseline_release_memberships enable row level security;
alter table public.product_relationships enable row level security;
revoke all on table
  public.software_baselines,
  public.software_baseline_release_memberships,
  public.product_relationships
from public, anon, authenticated;
grant all on table
  public.software_baselines,
  public.software_baseline_release_memberships,
  public.product_relationships
to service_role;

drop trigger if exists set_software_baselines_updated_at on public.software_baselines;
create trigger set_software_baselines_updated_at before update on public.software_baselines
for each row execute function public.set_updated_at();
drop trigger if exists set_software_baseline_memberships_updated_at on public.software_baseline_release_memberships;
create trigger set_software_baseline_memberships_updated_at before update on public.software_baseline_release_memberships
for each row execute function public.set_updated_at();
drop trigger if exists set_product_relationships_updated_at on public.product_relationships;
create trigger set_product_relationships_updated_at before update on public.product_relationships
for each row execute function public.set_updated_at();

-- Add a graph-version snapshot to the existing durable outbox; no separate
-- relationship outbox is needed.
alter table public.product_regulatory_outbox_events
  add column if not exists graph_version integer;
alter table public.product_regulatory_outbox_events
  drop constraint if exists product_regulatory_outbox_events_event_type_check,
  add constraint product_regulatory_outbox_events_event_type_check check (event_type in (
    'release.market_availability_changed', 'release.lifecycle_changed',
    'release.placed_on_market_changed', 'support_period.alert',
    'product.retention.recalculated', 'product_relationship.graph_changed'
  ));
create index product_relationship_outbox_graph_idx
  on public.product_regulatory_outbox_events(organization_id, graph_version, occurred_at, id)
  where event_type = 'product_relationship.graph_changed';

create or replace function public.m2_relationship_digest(p_payload jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex')
$$;

create or replace function public.m2_software_baseline_json(
  p_baseline public.software_baselines
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_baseline.id, 'organizationId', p_baseline.organization_id,
    'baselineId', p_baseline.baseline_id, 'revisionNumber', p_baseline.revision_number,
    'identifier', p_baseline.identifier, 'name', p_baseline.name,
    'description', p_baseline.description, 'revisionSummary', p_baseline.revision_summary,
    'source', p_baseline.source, 'provenance', p_baseline.provenance,
    'effectiveStartsAt', public.m2_utc_z(p_baseline.effective_starts_at),
    'effectiveEndsAt', case when p_baseline.effective_ends_at is null then null else public.m2_utc_z(p_baseline.effective_ends_at) end,
    'version', p_baseline.version,
    'archivedAt', case when p_baseline.archived_at is null then null else public.m2_utc_z(p_baseline.archived_at) end,
    'createdAt', public.m2_utc_z(p_baseline.created_at), 'createdBy', p_baseline.created_by,
    'updatedAt', public.m2_utc_z(p_baseline.updated_at), 'updatedBy', p_baseline.updated_by
  )
$$;

create or replace function public.m2_baseline_membership_json(
  p_membership public.software_baseline_release_memberships
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_membership.id, 'organizationId', p_membership.organization_id,
    'productId', p_membership.product_id, 'releaseId', p_membership.release_id,
    'baselineId', p_membership.baseline_id, 'baselineRevisionId', p_membership.baseline_revision_id,
    'baselineRevisionNumber', baseline.revision_number, 'source', p_membership.source,
    'provenance', p_membership.provenance,
    'effectiveStartsAt', public.m2_utc_z(p_membership.effective_starts_at),
    'effectiveEndsAt', case when p_membership.effective_ends_at is null then null else public.m2_utc_z(p_membership.effective_ends_at) end,
    'assignedAt', public.m2_utc_z(p_membership.assigned_at), 'assignedBy', p_membership.assigned_by,
    'endedAt', case when p_membership.ended_at is null then null else public.m2_utc_z(p_membership.ended_at) end,
    'endedBy', p_membership.ended_by, 'endReason', p_membership.end_reason,
    'version', p_membership.version,
    'updatedAt', public.m2_utc_z(p_membership.updated_at), 'updatedBy', p_membership.updated_by
  ) from public.software_baselines baseline
    where baseline.organization_id = p_membership.organization_id
      and baseline.id = p_membership.baseline_revision_id
$$;

create or replace function public.m2_product_relationship_json(
  p_relationship public.product_relationships
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_relationship.id, 'organizationId', p_relationship.organization_id,
    'relationshipType', p_relationship.relationship_type,
    'source', p_relationship.source, 'provenance', p_relationship.provenance,
    'reason', p_relationship.reason,
    'effectiveStartsAt', public.m2_utc_z(p_relationship.effective_starts_at),
    'effectiveEndsAt', case when p_relationship.effective_ends_at is null then null else public.m2_utc_z(p_relationship.effective_ends_at) end,
    'createdAt', public.m2_utc_z(p_relationship.created_at), 'createdBy', p_relationship.created_by,
    'endedAt', case when p_relationship.ended_at is null then null else public.m2_utc_z(p_relationship.ended_at) end,
    'endedBy', p_relationship.ended_by, 'endReason', p_relationship.end_reason,
    'version', p_relationship.version,
    'updatedAt', public.m2_utc_z(p_relationship.updated_at), 'updatedBy', p_relationship.updated_by,
    case when p_relationship.relationship_type = 'variant' then 'sourceType' else 'parentProductId' end,
    case when p_relationship.relationship_type = 'variant' then to_jsonb(p_relationship.source_type) else to_jsonb(p_relationship.source_product_id) end,
    case when p_relationship.relationship_type = 'variant' then 'sourceProductId' else 'componentProductId' end,
    case when p_relationship.relationship_type = 'variant' then to_jsonb(p_relationship.source_product_id) else to_jsonb(p_relationship.target_product_id) end,
    case when p_relationship.relationship_type = 'variant' then 'targetProductId' else 'parentReleaseId' end,
    case when p_relationship.relationship_type = 'variant' then to_jsonb(p_relationship.target_product_id) else to_jsonb(p_relationship.source_release_id) end,
    case when p_relationship.relationship_type = 'variant' then 'sourceReleaseId' else 'componentReleaseId' end,
    case when p_relationship.relationship_type = 'variant' then to_jsonb(p_relationship.source_release_id) else to_jsonb(p_relationship.target_release_id) end,
    case when p_relationship.relationship_type = 'variant' then 'targetReleaseId' else 'quantity' end,
    case when p_relationship.relationship_type = 'variant' then to_jsonb(p_relationship.target_release_id) else to_jsonb(p_relationship.quantity) end,
    case when p_relationship.relationship_type = 'variant' then 'baselineRevisionId' else 'unused' end,
    case when p_relationship.relationship_type = 'variant' then to_jsonb(p_relationship.baseline_revision_id) else 'null'::jsonb end
  ) - 'unused'
$$;

create or replace function public.m2_relationship_outbox_event_json(
  p_event public.product_regulatory_outbox_events
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_event.id, 'organizationId', p_event.organization_id,
    'graphVersion', p_event.graph_version, 'eventKey', p_event.event_key,
    'eventType', p_event.event_type, 'deliveryState', p_event.delivery_state,
    'correlationId', p_event.correlation_id,
    'occurredAt', public.m2_utc_z(p_event.occurred_at),
    'deliveredAt', case when p_event.delivered_at is null then null else public.m2_utc_z(p_event.delivered_at) end,
    'retryCount', p_event.delivery_attempts
  )
$$;

create or replace function public.m2_relationship_graph_event_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_graph_version integer,
  p_subject_kind text,
  p_subject_id uuid,
  p_correlation_id uuid,
  p_payload jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state, graph_version
  ) values (
    p_organization_id, p_product_id, null, 'product_relationship.graph_changed',
    concat('relationship:', p_subject_kind, ':', p_subject_id::text, ':', p_graph_version::text),
    p_payload || jsonb_build_object('subjectKind', p_subject_kind, 'subjectId', p_subject_id, 'graphVersion', p_graph_version),
    p_correlation_id, now(), 'scheduled', p_graph_version
  ) on conflict (organization_id, event_key) do nothing;
end;
$$;

create or replace function public.create_software_baseline_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_identifier text, p_name text,
  p_description text, p_revision_summary text, p_source text, p_provenance text,
  p_effective_starts_at timestamptz, p_effective_ends_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, baseline jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_baseline public.software_baselines%rowtype;
  v_replay public.software_baselines%rowtype;
  v_digest text;
begin
  if p_idempotency_key is null
    or p_effective_starts_at is null
    or (p_effective_ends_at is not null and p_effective_ends_at <= p_effective_starts_at)
    or char_length(btrim(coalesce(p_identifier, ''))) = 0
    or char_length(btrim(coalesce(p_name, ''))) = 0
    or char_length(btrim(coalesce(p_revision_summary, ''))) = 0
    or char_length(btrim(coalesce(p_source, ''))) = 0
    or char_length(btrim(coalesce(p_provenance, ''))) = 0 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  v_digest := public.m2_relationship_digest(jsonb_build_object(
    'action', 'createBaseline', 'identifier', btrim(p_identifier), 'name', btrim(p_name),
    'description', nullif(btrim(p_description), ''), 'revisionSummary', btrim(p_revision_summary),
    'source', btrim(p_source), 'provenance', btrim(p_provenance),
    'effectiveStartsAt', public.m2_utc_z(p_effective_starts_at),
    'effectiveEndsAt', case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end
  ));
  select * into v_replay from public.software_baselines
   where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key
   for update;
  if found then
    if v_replay.idempotency_request_digest = v_digest then
      return query select 'replayed'::text, public.m2_software_baseline_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;
  insert into public.software_baselines(
    organization_id, baseline_id, revision_number, identifier, name, description,
    revision_summary, source, provenance, effective_starts_at, effective_ends_at,
    idempotency_key, idempotency_request_digest, created_by, updated_by
  ) values (
    p_organization_id, gen_random_uuid(), 1, btrim(p_identifier), btrim(p_name),
    nullif(btrim(p_description), ''), btrim(p_revision_summary), btrim(p_source),
    btrim(p_provenance), p_effective_starts_at, p_effective_ends_at,
    p_idempotency_key, v_digest, p_actor_user_id, p_actor_user_id
  ) returning * into v_baseline;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values(p_organization_id, p_actor_user_id, 'product.software_baseline_created',
    'software_baseline', v_baseline.id::text,
    jsonb_build_object('after', public.m2_software_baseline_json(v_baseline),
      'correlationId', p_correlation_id, 'requestDigest', v_digest));
  return query select 'created'::text, public.m2_software_baseline_json(v_baseline);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.append_software_baseline_revision_atomic(
  p_organization_id uuid, p_baseline_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_name text, p_description text,
  p_revision_summary text, p_source text, p_provenance text,
  p_effective_starts_at timestamptz, p_effective_ends_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, baseline jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_current public.software_baselines%rowtype;
  v_new public.software_baselines%rowtype;
  v_replay public.software_baselines%rowtype;
  v_digest text;
begin
  if p_idempotency_key is null or p_expected_version is null
    or p_effective_starts_at is null
    or (p_effective_ends_at is not null and p_effective_ends_at <= p_effective_starts_at)
    or char_length(btrim(coalesce(p_name, ''))) = 0
    or char_length(btrim(coalesce(p_revision_summary, ''))) = 0
    or char_length(btrim(coalesce(p_source, ''))) = 0
    or char_length(btrim(coalesce(p_provenance, ''))) = 0 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_current from public.software_baselines
   where organization_id=p_organization_id and baseline_id=p_baseline_id and is_current and archived_at is null
   for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_current.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_software_baseline_json(v_current); return;
  end if;
  v_digest := public.m2_relationship_digest(jsonb_build_object(
    'action', 'appendBaselineRevision', 'baselineId', p_baseline_id, 'expectedVersion', p_expected_version,
    'name', btrim(p_name), 'description', nullif(btrim(p_description), ''),
    'revisionSummary', btrim(p_revision_summary), 'source', btrim(p_source),
    'provenance', btrim(p_provenance), 'effectiveStartsAt', public.m2_utc_z(p_effective_starts_at),
    'effectiveEndsAt', case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end
  ));
  select * into v_replay from public.software_baselines
   where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key
   for update;
  if found then
    if v_replay.idempotency_request_digest = v_digest then return query select 'replayed'::text, public.m2_software_baseline_json(v_replay); end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;
  update public.software_baselines set is_current=false, version=version+1, updated_by=p_actor_user_id
   where organization_id=p_organization_id and id=v_current.id;
  insert into public.software_baselines(
    organization_id, baseline_id, revision_number, identifier, name, description,
    revision_summary, source, provenance, effective_starts_at, effective_ends_at,
    idempotency_key, idempotency_request_digest, created_by, updated_by
  ) values (
    p_organization_id, p_baseline_id, v_current.revision_number+1, v_current.identifier,
    btrim(p_name), nullif(btrim(p_description), ''), btrim(p_revision_summary),
    btrim(p_source), btrim(p_provenance), p_effective_starts_at, p_effective_ends_at,
    p_idempotency_key, v_digest, p_actor_user_id, p_actor_user_id
  ) returning * into v_new;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values(p_organization_id, p_actor_user_id, 'product.software_baseline_revision_appended',
    'software_baseline', v_new.id::text,
    jsonb_build_object('before', public.m2_software_baseline_json(v_current),
      'after', public.m2_software_baseline_json(v_new), 'correlationId', p_correlation_id,
      'requestDigest', v_digest));
  return query select 'updated'::text, public.m2_software_baseline_json(v_new);
exception when unique_violation then return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.get_software_baseline_history(
  p_organization_id uuid, p_baseline_id uuid, p_actor_user_id uuid
) returns table(outcome text, baselines jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
    or not exists(select 1 from public.software_baselines where organization_id=p_organization_id and baseline_id=p_baseline_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, coalesce(jsonb_agg(public.m2_software_baseline_json(b) order by b.revision_number desc), '[]'::jsonb)
   from public.software_baselines b where b.organization_id=p_organization_id and b.baseline_id=p_baseline_id;
end;
$$;

create or replace function public.archive_software_baseline_atomic(
  p_organization_id uuid, p_baseline_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_reason text, p_correlation_id uuid
) returns table(outcome text, baseline jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_current public.software_baselines%rowtype; v_after public.software_baselines%rowtype;
begin
  if p_expected_version is null or char_length(btrim(coalesce(p_reason, ''))) = 0 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_current from public.software_baselines
   where organization_id=p_organization_id and baseline_id=p_baseline_id and is_current
   for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_current.version<>p_expected_version then return query select 'conflict'::text, public.m2_software_baseline_json(v_current); return; end if;
  if v_current.archived_at is not null then return query select 'blocked'::text, null::jsonb; return; end if;
  if exists(select 1 from public.software_baseline_release_memberships where organization_id=p_organization_id and baseline_id=p_baseline_id and ended_at is null)
    or exists(select 1 from public.product_relationships r join public.software_baselines b on b.organization_id=r.organization_id and b.id=r.baseline_revision_id
      where r.organization_id=p_organization_id and b.baseline_id=p_baseline_id and r.relationship_type='variant' and r.ended_at is null) then
    return query select 'blocked'::text, null::jsonb; return;
  end if;
  update public.software_baselines set archived_at=now(), archived_by=p_actor_user_id,
    archive_reason=btrim(p_reason), version=version+1, updated_by=p_actor_user_id
   where organization_id=p_organization_id and baseline_id=p_baseline_id;
  select * into v_after from public.software_baselines where id=v_current.id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product.software_baseline_archived','software_baseline',v_current.id::text,
    jsonb_build_object('before',public.m2_software_baseline_json(v_current),'after',public.m2_software_baseline_json(v_after),'reason',btrim(p_reason),'correlationId',p_correlation_id));
  return query select 'archived'::text, public.m2_software_baseline_json(v_after);
end;
$$;

create or replace function public.m2_lock_relationship_graph(
  p_organization_id uuid,
  p_expected_graph_version integer,
  p_actor_user_id uuid
) returns table(outcome text, graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.organization_settings%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::integer; return;
  end if;
  select * into v_settings from public.organization_settings
   where organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if p_expected_graph_version is not null and v_settings.product_relationship_graph_version<>p_expected_graph_version then
    return query select 'conflict'::text, v_settings.product_relationship_graph_version; return;
  end if;
  return query select 'found'::text, v_settings.product_relationship_graph_version;
end;
$$;

create or replace function public.m2_bump_relationship_graph(
  p_organization_id uuid, p_actor_user_id uuid
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version integer;
begin
  update public.organization_settings set
    product_relationship_graph_version=product_relationship_graph_version+1,
    updated_at=now(), updated_by=p_actor_user_id
  where organization_id=p_organization_id
  returning product_relationship_graph_version into v_version;
  return v_version;
end;
$$;

create or replace function public.m2_component_link_preview(
  p_organization_id uuid,
  p_parent_product_id uuid,
  p_component_product_id uuid,
  p_effective_at timestamptz,
  p_graph_version integer,
  p_excluding_relationship_id uuid default null
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_current_graph_version integer;
  v_cycle_products uuid[];
  v_cycle_links uuid[];
  v_upstream_depth integer := 0;
  v_downstream_depth integer := 0;
  v_candidate_depth integer;
begin
  select product_relationship_graph_version into v_current_graph_version
   from public.organization_settings where organization_id=p_organization_id;
  if v_current_graph_version is null then return jsonb_build_object('outcome','not_found'); end if;
  if p_graph_version is null or p_graph_version<>v_current_graph_version then
    return jsonb_build_object('outcome','conflict','graphVersion',v_current_graph_version);
  end if;
  if p_parent_product_id=p_component_product_id then
    return jsonb_build_object('outcome','cycle_detected','graphVersion',v_current_graph_version,
      'candidateDepth',1,'productPathIds',jsonb_build_array(p_parent_product_id,p_component_product_id),'relationshipPathIds','[]'::jsonb);
  end if;
  with recursive active_edges as (
    select r.* from public.product_relationships r
     where r.organization_id=p_organization_id and r.relationship_type='embedded'
       and r.ended_at is null
       and r.effective_starts_at<=p_effective_at
       and (r.effective_ends_at is null or r.effective_ends_at>p_effective_at)
       and (p_excluding_relationship_id is null or r.id<>p_excluding_relationship_id)
  ), walk as (
    select p_component_product_id as node, array[p_component_product_id]::uuid[] as products,
      array[]::uuid[] as links, 0 as depth
    union all
    select edge.target_product_id, walk.products||edge.target_product_id, walk.links||edge.id, walk.depth+1
      from walk join active_edges edge on edge.source_product_id=walk.node
     where walk.depth<64 and not edge.target_product_id=any(walk.products)
  )
  select products, links into v_cycle_products, v_cycle_links from walk
   where node=p_parent_product_id order by depth, links::text limit 1;
  if v_cycle_products is not null then
    return jsonb_build_object('outcome','cycle_detected','graphVersion',v_current_graph_version,
      'candidateDepth',cardinality(v_cycle_links)+1,
      'productPathIds',to_jsonb(v_cycle_products||p_component_product_id),
      'relationshipPathIds',to_jsonb(v_cycle_links));
  end if;
  with recursive active_edges as (
    select r.* from public.product_relationships r
     where r.organization_id=p_organization_id and r.relationship_type='embedded'
       and r.ended_at is null and r.effective_starts_at<=p_effective_at
       and (r.effective_ends_at is null or r.effective_ends_at>p_effective_at)
       and (p_excluding_relationship_id is null or r.id<>p_excluding_relationship_id)
  ), ancestors as (
    select p_parent_product_id as node, array[p_parent_product_id]::uuid[] as path, 0 as depth
    union all
    select edge.source_product_id, ancestors.path||edge.source_product_id, ancestors.depth+1
      from ancestors join active_edges edge on edge.target_product_id=ancestors.node
     where ancestors.depth<64 and not edge.source_product_id=any(ancestors.path)
  ), descendants as (
    select p_component_product_id as node, array[p_component_product_id]::uuid[] as path, 0 as depth
    union all
    select edge.target_product_id, descendants.path||edge.target_product_id, descendants.depth+1
      from descendants join active_edges edge on edge.source_product_id=descendants.node
     where descendants.depth<64 and not edge.target_product_id=any(descendants.path)
  )
  select
    coalesce((select max(depth) from ancestors),0),
    coalesce((select max(depth) from descendants),0)
  into v_upstream_depth, v_downstream_depth;
  v_candidate_depth := v_upstream_depth+1+v_downstream_depth;
  if v_candidate_depth>64 then
    return jsonb_build_object('outcome','depth_exceeded','graphVersion',v_current_graph_version,
      'candidateDepth',v_candidate_depth,'productPathIds','[]'::jsonb,'relationshipPathIds','[]'::jsonb);
  end if;
  return jsonb_build_object('outcome','allowed','graphVersion',v_current_graph_version,
    'candidateDepth',v_candidate_depth,'productPathIds','[]'::jsonb,'relationshipPathIds','[]'::jsonb);
end;
$$;

create or replace function public.assign_software_baseline_membership_atomic(
  p_organization_id uuid, p_product_id uuid, p_baseline_id uuid,
  p_baseline_revision_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_expected_baseline_version integer, p_source text, p_provenance text,
  p_effective_starts_at timestamptz, p_effective_ends_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, membership jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_product public.products%rowtype; v_release public.product_releases%rowtype;
  v_baseline public.software_baselines%rowtype; v_membership public.software_baseline_release_memberships%rowtype;
  v_previous public.software_baseline_release_memberships%rowtype; v_replay public.software_baseline_release_memberships%rowtype;
  v_digest text; v_graph integer;
begin
  if p_idempotency_key is null or p_expected_baseline_version is null or p_effective_starts_at is null
    or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at)
    or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id and archived_at is null for update;
  select * into v_release from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id and archived_at is null for update;
  select * into v_baseline from public.software_baselines where organization_id=p_organization_id and id=p_baseline_revision_id and baseline_id=p_baseline_id and archived_at is null for update;
  if v_product.id is null or v_release.id is null or v_baseline.id is null then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_baseline.version<>p_expected_baseline_version then return query select 'conflict'::text,null::jsonb; return; end if;
  v_digest:=public.m2_relationship_digest(jsonb_build_object('action','assignBaselineMembership','productId',p_product_id,'releaseId',p_release_id,'baselineId',p_baseline_id,'baselineRevisionId',p_baseline_revision_id,'expectedBaselineVersion',p_expected_baseline_version,'source',btrim(p_source),'provenance',btrim(p_provenance),'effectiveStartsAt',public.m2_utc_z(p_effective_starts_at),'effectiveEndsAt',case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end));
  select * into v_replay from public.software_baseline_release_memberships where organization_id=p_organization_id and assigned_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_replay.idempotency_request_digest=v_digest then return query select 'replayed'::text,public.m2_baseline_membership_json(v_replay); end if;
    return query select 'idempotency_mismatch'::text,null::jsonb; return;
  end if;
  select * into v_previous from public.software_baseline_release_memberships where organization_id=p_organization_id and release_id=p_release_id and ended_at is null for update;
  if found then
    if p_effective_starts_at<=v_previous.effective_starts_at then return query select 'invalid_request'::text,null::jsonb; return; end if;
    update public.software_baseline_release_memberships set effective_ends_at=p_effective_starts_at, ended_at=now(), ended_by=p_actor_user_id,
      end_reason='superseded by later baseline membership', version=version+1, updated_by=p_actor_user_id where id=v_previous.id;
  end if;
  insert into public.software_baseline_release_memberships(organization_id,product_id,release_id,baseline_id,baseline_revision_id,source,provenance,effective_starts_at,effective_ends_at,assigned_by,updated_by,idempotency_key,idempotency_request_digest)
  values(p_organization_id,p_product_id,p_release_id,p_baseline_id,p_baseline_revision_id,btrim(p_source),btrim(p_provenance),p_effective_starts_at,p_effective_ends_at,p_actor_user_id,p_actor_user_id,p_idempotency_key,v_digest) returning * into v_membership;
  perform 1 from public.organization_settings where organization_id=p_organization_id for update;
  v_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_product_id,v_graph,'baseline_membership',v_membership.id,p_correlation_id,jsonb_build_object('action','assigned','baselineRevisionId',p_baseline_revision_id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.software_baseline_membership_assigned','software_baseline_release_membership',v_membership.id::text,jsonb_build_object('before',case when v_previous.id is null then null else public.m2_baseline_membership_json(v_previous) end,'after',public.m2_baseline_membership_json(v_membership),'graphVersion',v_graph,'correlationId',p_correlation_id,'requestDigest',v_digest));
  return query select 'created'::text,public.m2_baseline_membership_json(v_membership);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$$;

create or replace function public.end_software_baseline_membership_atomic(
  p_organization_id uuid, p_product_id uuid, p_membership_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_reason text, p_effective_ends_at timestamptz, p_correlation_id uuid
) returns table(outcome text,membership jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_membership public.software_baseline_release_memberships%rowtype; v_graph integer;
begin
  if p_expected_version is null or p_effective_ends_at is null or char_length(btrim(coalesce(p_reason,'')))=0 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_membership from public.software_baseline_release_memberships where organization_id=p_organization_id and product_id=p_product_id and id=p_membership_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_membership.version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
  if v_membership.ended_at is not null then return query select 'blocked'::text,null::jsonb; return; end if;
  if p_effective_ends_at<=v_membership.effective_starts_at then return query select 'invalid_request'::text,null::jsonb; return; end if;
  update public.software_baseline_release_memberships set effective_ends_at=p_effective_ends_at,ended_at=now(),ended_by=p_actor_user_id,end_reason=btrim(p_reason),version=version+1,updated_by=p_actor_user_id where id=v_membership.id returning * into v_membership;
  perform 1 from public.organization_settings where organization_id=p_organization_id for update;
  v_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_product_id,v_graph,'baseline_membership',v_membership.id,p_correlation_id,jsonb_build_object('action','ended'));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.software_baseline_membership_ended','software_baseline_release_membership',v_membership.id::text,jsonb_build_object('after',public.m2_baseline_membership_json(v_membership),'reason',btrim(p_reason),'graphVersion',v_graph,'correlationId',p_correlation_id));
  return query select 'ended'::text,public.m2_baseline_membership_json(v_membership);
end;
$$;

create or replace function public.get_product_software_baseline_memberships(
  p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_as_of timestamptz default null
) returns table(outcome text,memberships jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,coalesce(jsonb_agg(public.m2_baseline_membership_json(m) order by m.effective_starts_at desc,m.id desc),'[]'::jsonb)
    from public.software_baseline_release_memberships m where m.organization_id=p_organization_id and m.product_id=p_product_id
      and (p_as_of is null or (m.effective_starts_at<=p_as_of and (m.effective_ends_at is null or m.effective_ends_at>p_as_of)));
end;
$$;

create or replace function public.create_product_variant_relationship_atomic(
  p_organization_id uuid, p_base_release_id uuid, p_baseline_revision_id uuid,
  p_variant_product_id uuid, p_variant_release_id uuid, p_actor_user_id uuid,
  p_expected_graph_version integer, p_source text, p_provenance text, p_reason text,
  p_effective_starts_at timestamptz, p_effective_ends_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text,relationship jsonb,graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base_release public.product_releases%rowtype; v_baseline public.software_baselines%rowtype;
  v_variant_release public.product_releases%rowtype; v_relation public.product_relationships%rowtype;
  v_replay public.product_relationships%rowtype; v_lock_outcome text; v_current_graph integer; v_next_graph integer; v_digest text;
begin
  if p_idempotency_key is null or ((p_base_release_id is null)=(p_baseline_revision_id is null))
    or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at)
    or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 or char_length(btrim(coalesce(p_reason,'')))=0 then
    return query select 'invalid_request'::text,null::jsonb,null::integer; return;
  end if;
  select lock_result.outcome, lock_result.graph_version into v_lock_outcome, v_current_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb,v_current_graph; return; end if;
  select * into v_variant_release from public.product_releases where organization_id=p_organization_id and product_id=p_variant_product_id and id=p_variant_release_id and archived_at is null for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  if p_base_release_id is not null then
    select * into v_base_release from public.product_releases where organization_id=p_organization_id and id=p_base_release_id and archived_at is null for update;
    if not found or v_base_release.product_id=p_variant_product_id then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  else
    select * into v_baseline from public.software_baselines where organization_id=p_organization_id and id=p_baseline_revision_id and archived_at is null for update;
    if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  end if;
  v_digest:=public.m2_relationship_digest(jsonb_build_object('action','createVariant','baseReleaseId',p_base_release_id,'baselineRevisionId',p_baseline_revision_id,'variantProductId',p_variant_product_id,'variantReleaseId',p_variant_release_id,'expectedGraphVersion',p_expected_graph_version,'source',btrim(p_source),'provenance',btrim(p_provenance),'reason',btrim(p_reason),'effectiveStartsAt',public.m2_utc_z(p_effective_starts_at),'effectiveEndsAt',case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end));
  select * into v_replay from public.product_relationships where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_replay.idempotency_request_digest=v_digest then return query select 'replayed'::text,public.m2_product_relationship_json(v_replay),v_replay.graph_version; end if;
    return query select 'idempotency_mismatch'::text,null::jsonb,null::integer; return;
  end if;
  v_next_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  insert into public.product_relationships(organization_id,relationship_type,source_type,source_product_id,target_product_id,source_release_id,target_release_id,baseline_revision_id,source,provenance,reason,effective_starts_at,effective_ends_at,created_by,updated_by,graph_version,idempotency_key,idempotency_request_digest)
  values(p_organization_id,'variant',case when p_base_release_id is null then 'baseline_revision' else 'base_release' end,
    case when p_base_release_id is null then null else v_base_release.product_id end,p_variant_product_id,p_base_release_id,p_variant_release_id,p_baseline_revision_id,btrim(p_source),btrim(p_provenance),btrim(p_reason),p_effective_starts_at,p_effective_ends_at,p_actor_user_id,p_actor_user_id,v_next_graph,p_idempotency_key,v_digest) returning * into v_relation;
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_variant_product_id,v_next_graph,'variant_relationship',v_relation.id,p_correlation_id,jsonb_build_object('action','created','relationshipId',v_relation.id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.variant_relationship_created','product_relationship',v_relation.id::text,jsonb_build_object('after',public.m2_product_relationship_json(v_relation),'graphVersion',v_next_graph,'correlationId',p_correlation_id,'requestDigest',v_digest));
  return query select 'created'::text,public.m2_product_relationship_json(v_relation),v_next_graph;
exception when unique_violation then return query select 'conflict'::text,null::jsonb,null::integer;
end;
$$;

create or replace function public.end_product_variant_relationship_atomic(
  p_organization_id uuid,p_product_id uuid,p_relationship_id uuid,p_actor_user_id uuid,
  p_expected_version integer,p_expected_graph_version integer,p_reason text,p_effective_ends_at timestamptz,p_correlation_id uuid
) returns table(outcome text,relationship jsonb,graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_relation public.product_relationships%rowtype; v_lock_outcome text; v_current_graph integer; v_next_graph integer;
begin
  if p_expected_version is null or p_effective_ends_at is null or char_length(btrim(coalesce(p_reason,'')))=0 then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  select lock_result.outcome,lock_result.graph_version into v_lock_outcome,v_current_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb,v_current_graph; return; end if;
  select * into v_relation from public.product_relationships where organization_id=p_organization_id and id=p_relationship_id and relationship_type='variant' and target_product_id=p_product_id for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  if v_relation.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_relationship_json(v_relation),v_current_graph; return; end if;
  if v_relation.ended_at is not null then return query select 'blocked'::text,null::jsonb,null::integer; return; end if;
  if p_effective_ends_at<=v_relation.effective_starts_at then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  v_next_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  update public.product_relationships set effective_ends_at=p_effective_ends_at,ended_at=now(),ended_by=p_actor_user_id,end_reason=btrim(p_reason),version=version+1,updated_by=p_actor_user_id,graph_version=v_next_graph where id=v_relation.id returning * into v_relation;
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_product_id,v_next_graph,'variant_relationship',v_relation.id,p_correlation_id,jsonb_build_object('action','ended','relationshipId',v_relation.id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.variant_relationship_ended','product_relationship',v_relation.id::text,jsonb_build_object('after',public.m2_product_relationship_json(v_relation),'reason',btrim(p_reason),'graphVersion',v_next_graph,'correlationId',p_correlation_id));
  return query select 'ended'::text,public.m2_product_relationship_json(v_relation),v_next_graph;
end;
$$;

create or replace function public.get_product_variant_relationships(
  p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_as_of timestamptz default null
) returns table(outcome text,relationships jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,coalesce(jsonb_agg(public.m2_product_relationship_json(r) order by r.effective_starts_at desc,r.id desc),'[]'::jsonb)
   from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='variant'
     and (r.target_product_id=p_product_id or r.source_product_id=p_product_id)
     and (p_as_of is null or (r.effective_starts_at<=p_as_of and (r.effective_ends_at is null or r.effective_ends_at>p_as_of)));
end;
$$;

create or replace function public.preview_product_component_link(
  p_organization_id uuid,p_parent_product_id uuid,p_component_product_id uuid,p_actor_user_id uuid,
  p_expected_graph_version integer,p_parent_release_id uuid,p_component_release_id uuid,p_quantity integer,
  p_source text,p_provenance text,p_reason text,p_effective_starts_at timestamptz,p_effective_ends_at timestamptz
) returns table(outcome text,preview jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_preview jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>1000000 or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at) or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 or char_length(btrim(coalesce(p_reason,'')))=0 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not exists(select 1 from public.products where organization_id=p_organization_id and id=p_parent_product_id and archived_at is null)
    or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_component_product_id and archived_at is null)
    or (p_parent_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_parent_product_id and id=p_parent_release_id and archived_at is null))
    or (p_component_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_component_product_id and id=p_component_release_id and archived_at is null)) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  v_preview:=public.m2_component_link_preview(p_organization_id,p_parent_product_id,p_component_product_id,p_effective_starts_at,p_expected_graph_version);
  return query select (v_preview->>'outcome')::text,v_preview;
end;
$$;

create or replace function public.create_product_component_link_atomic(
  p_organization_id uuid,p_parent_product_id uuid,p_component_product_id uuid,p_actor_user_id uuid,
  p_expected_graph_version integer,p_parent_release_id uuid,p_component_release_id uuid,p_quantity integer,
  p_source text,p_provenance text,p_reason text,p_effective_starts_at timestamptz,p_effective_ends_at timestamptz,
  p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,relationship jsonb,graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_preview jsonb; v_relation public.product_relationships%rowtype; v_replay public.product_relationships%rowtype; v_lock_outcome text; v_current_graph integer; v_next_graph integer; v_digest text;
begin
  if p_idempotency_key is null then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  select lock_result.outcome,lock_result.graph_version into v_lock_outcome,v_current_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb,v_current_graph; return; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>1000000 or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at) or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 or char_length(btrim(coalesce(p_reason,'')))=0 then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  if not exists(select 1 from public.products where organization_id=p_organization_id and id=p_parent_product_id and archived_at is null) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_component_product_id and archived_at is null) or (p_parent_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_parent_product_id and id=p_parent_release_id and archived_at is null)) or (p_component_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_component_product_id and id=p_component_release_id and archived_at is null)) then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  v_digest:=public.m2_relationship_digest(jsonb_build_object('action','createComponent','parentProductId',p_parent_product_id,'componentProductId',p_component_product_id,'parentReleaseId',p_parent_release_id,'componentReleaseId',p_component_release_id,'quantity',p_quantity,'source',btrim(p_source),'provenance',btrim(p_provenance),'reason',btrim(p_reason),'effectiveStartsAt',public.m2_utc_z(p_effective_starts_at),'effectiveEndsAt',case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end,'expectedGraphVersion',p_expected_graph_version));
  select * into v_replay from public.product_relationships where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then if v_replay.idempotency_request_digest=v_digest then return query select 'replayed'::text,public.m2_product_relationship_json(v_replay),v_replay.graph_version; end if; return query select 'idempotency_mismatch'::text,null::jsonb,null::integer; return; end if;
  v_preview:=public.m2_component_link_preview(p_organization_id,p_parent_product_id,p_component_product_id,p_effective_starts_at,p_expected_graph_version);
  if v_preview->>'outcome'<>'allowed' then return query select (v_preview->>'outcome')::text,null::jsonb,(v_preview->>'graphVersion')::integer; return; end if;
  v_next_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  insert into public.product_relationships(organization_id,relationship_type,source_product_id,target_product_id,source_release_id,target_release_id,quantity,source,provenance,reason,effective_starts_at,effective_ends_at,created_by,updated_by,graph_version,idempotency_key,idempotency_request_digest)
  values(p_organization_id,'embedded',p_parent_product_id,p_component_product_id,p_parent_release_id,p_component_release_id,p_quantity,btrim(p_source),btrim(p_provenance),btrim(p_reason),p_effective_starts_at,p_effective_ends_at,p_actor_user_id,p_actor_user_id,v_next_graph,p_idempotency_key,v_digest) returning * into v_relation;
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_parent_product_id,v_next_graph,'component_link',v_relation.id,p_correlation_id,jsonb_build_object('action','created','relationshipId',v_relation.id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.component_link_created','product_relationship',v_relation.id::text,jsonb_build_object('after',public.m2_product_relationship_json(v_relation),'graphVersion',v_next_graph,'correlationId',p_correlation_id,'requestDigest',v_digest));
  return query select 'created'::text,public.m2_product_relationship_json(v_relation),v_next_graph;
exception when unique_violation then return query select 'conflict'::text,null::jsonb,null::integer;
end;
$$;

create or replace function public.end_product_component_link_atomic(
  p_organization_id uuid,p_product_id uuid,p_relationship_id uuid,p_actor_user_id uuid,
  p_expected_version integer,p_expected_graph_version integer,p_reason text,p_effective_ends_at timestamptz,p_correlation_id uuid
) returns table(outcome text,relationship jsonb,graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_relation public.product_relationships%rowtype; v_lock_outcome text; v_current_graph integer; v_next_graph integer;
begin
  if p_expected_version is null or p_effective_ends_at is null or char_length(btrim(coalesce(p_reason,'')))=0 then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  select lock_result.outcome,lock_result.graph_version into v_lock_outcome,v_current_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb,v_current_graph; return; end if;
  select * into v_relation from public.product_relationships where organization_id=p_organization_id and id=p_relationship_id and relationship_type='embedded' and source_product_id=p_product_id for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  if v_relation.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_relationship_json(v_relation),v_current_graph; return; end if;
  if v_relation.ended_at is not null then return query select 'blocked'::text,null::jsonb,null::integer; return; end if;
  if p_effective_ends_at<=v_relation.effective_starts_at then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  v_next_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  update public.product_relationships set effective_ends_at=p_effective_ends_at,ended_at=now(),ended_by=p_actor_user_id,end_reason=btrim(p_reason),version=version+1,updated_by=p_actor_user_id,graph_version=v_next_graph where id=v_relation.id returning * into v_relation;
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_product_id,v_next_graph,'component_link',v_relation.id,p_correlation_id,jsonb_build_object('action','ended','relationshipId',v_relation.id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.component_link_ended','product_relationship',v_relation.id::text,jsonb_build_object('after',public.m2_product_relationship_json(v_relation),'reason',btrim(p_reason),'graphVersion',v_next_graph,'correlationId',p_correlation_id));
  return query select 'ended'::text,public.m2_product_relationship_json(v_relation),v_next_graph;
end;
$$;

create or replace function public.supersede_product_component_link_atomic(
  p_organization_id uuid,p_product_id uuid,p_relationship_id uuid,p_actor_user_id uuid,
  p_expected_version integer,p_expected_graph_version integer,p_component_product_id uuid,
  p_parent_release_id uuid,p_component_release_id uuid,p_quantity integer,p_reason text,
  p_source text,p_provenance text,p_effective_starts_at timestamptz,p_effective_ends_at timestamptz,
  p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,relationship jsonb,graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.product_relationships%rowtype; v_new public.product_relationships%rowtype; v_replay public.product_relationships%rowtype;
  v_preview jsonb; v_lock_outcome text; v_current_graph integer; v_next_graph integer; v_digest text; v_new_id uuid:=gen_random_uuid();
begin
  if p_idempotency_key is null or p_expected_version is null or p_quantity is null or p_quantity<1 or p_quantity>1000000
    or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at)
    or char_length(btrim(coalesce(p_reason,'')))=0 or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 then return query select 'invalid_request'::text,null::jsonb,null::integer; return; end if;
  select lock_result.outcome,lock_result.graph_version into v_lock_outcome,v_current_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb,v_current_graph; return; end if;
  select * into v_old from public.product_relationships where organization_id=p_organization_id and id=p_relationship_id and relationship_type='embedded' and source_product_id=p_product_id for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  if v_old.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_relationship_json(v_old),v_current_graph; return; end if;
  if v_old.ended_at is not null or p_effective_starts_at<=v_old.effective_starts_at then return query select 'blocked'::text,null::jsonb,null::integer; return; end if;
  if not exists(select 1 from public.products where organization_id=p_organization_id and id=p_component_product_id and archived_at is null)
    or (p_parent_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_parent_release_id and archived_at is null))
    or (p_component_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_component_product_id and id=p_component_release_id and archived_at is null)) then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  v_digest:=public.m2_relationship_digest(jsonb_build_object('action','supersedeComponent','relationshipId',p_relationship_id,'expectedVersion',p_expected_version,'componentProductId',p_component_product_id,'parentReleaseId',p_parent_release_id,'componentReleaseId',p_component_release_id,'quantity',p_quantity,'reason',btrim(p_reason),'source',btrim(p_source),'provenance',btrim(p_provenance),'effectiveStartsAt',public.m2_utc_z(p_effective_starts_at),'effectiveEndsAt',case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end,'expectedGraphVersion',p_expected_graph_version));
  select * into v_replay from public.product_relationships where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then if v_replay.idempotency_request_digest=v_digest then return query select 'replayed'::text,public.m2_product_relationship_json(v_replay),v_replay.graph_version; end if; return query select 'idempotency_mismatch'::text,null::jsonb,null::integer; return; end if;
  v_preview:=public.m2_component_link_preview(p_organization_id,p_product_id,p_component_product_id,p_effective_starts_at,p_expected_graph_version,p_relationship_id);
  if v_preview->>'outcome'<>'allowed' then return query select (v_preview->>'outcome')::text,null::jsonb,(v_preview->>'graphVersion')::integer; return; end if;
  v_next_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  update public.product_relationships set effective_ends_at=p_effective_starts_at,ended_at=now(),ended_by=p_actor_user_id,end_reason=btrim(p_reason),superseded_by_id=v_new_id,version=version+1,updated_by=p_actor_user_id,graph_version=v_next_graph where id=v_old.id;
  insert into public.product_relationships(id,organization_id,relationship_type,source_product_id,target_product_id,source_release_id,target_release_id,quantity,source,provenance,reason,effective_starts_at,effective_ends_at,created_by,updated_by,graph_version,idempotency_key,idempotency_request_digest)
  values(v_new_id,p_organization_id,'embedded',p_product_id,p_component_product_id,p_parent_release_id,p_component_release_id,p_quantity,btrim(p_source),btrim(p_provenance),btrim(p_reason),p_effective_starts_at,p_effective_ends_at,p_actor_user_id,p_actor_user_id,v_next_graph,p_idempotency_key,v_digest) returning * into v_new;
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_product_id,v_next_graph,'component_link',v_new.id,p_correlation_id,jsonb_build_object('action','superseded','priorRelationshipId',v_old.id,'relationshipId',v_new.id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.component_link_superseded','product_relationship',v_new.id::text,jsonb_build_object('before',public.m2_product_relationship_json(v_old),'after',public.m2_product_relationship_json(v_new),'reason',btrim(p_reason),'graphVersion',v_next_graph,'correlationId',p_correlation_id,'requestDigest',v_digest));
  return query select 'created'::text,public.m2_product_relationship_json(v_new),v_next_graph;
exception when unique_violation then return query select 'conflict'::text,null::jsonb,null::integer;
end;
$$;

create or replace function public.get_product_component_links(
  p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_as_of timestamptz default null
) returns table(outcome text,links jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,coalesce(jsonb_agg(public.m2_product_relationship_json(r) order by r.effective_starts_at desc,r.id desc),'[]'::jsonb)
   from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='embedded'
     and (r.source_product_id=p_product_id or r.target_product_id=p_product_id)
     and (p_as_of is null or (r.effective_starts_at<=p_as_of and (r.effective_ends_at is null or r.effective_ends_at>p_as_of)));
end;
$$;

create or replace function public.get_product_relationship_graph(
  p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_as_of timestamptz,
  p_root_release_id uuid,p_max_depth integer,p_include_ended boolean
) returns table(outcome text,graph jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_as_of timestamptz:=coalesce(p_as_of,now()); v_graph_version integer; v_max integer:=coalesce(p_max_depth,64);
begin
  if v_max<1 or v_max>64 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) or (p_root_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_root_release_id)) then return query select 'not_found'::text,null::jsonb; return; end if;
  select product_relationship_graph_version into v_graph_version from public.organization_settings where organization_id=p_organization_id;
  return query with recursive active_edges as (
    select r.* from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='embedded'
      and (p_include_ended or r.ended_at is null) and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), walk as (
    select p_product_id as product_id,array[p_product_id]::uuid[] as product_path,array[]::uuid[] as relationship_path,0 as depth
    union all
    select case when e.source_product_id=walk.product_id then e.target_product_id else e.source_product_id end,
      walk.product_path || case when e.source_product_id=walk.product_id then e.target_product_id else e.source_product_id end,
      walk.relationship_path||e.id,walk.depth+1
    from walk join active_edges e on e.source_product_id=walk.product_id or e.target_product_id=walk.product_id
    where walk.depth<v_max and not (case when e.source_product_id=walk.product_id then e.target_product_id else e.source_product_id end)=any(walk.product_path)
  ), nodes as (
    select distinct on(product_id) product_id,depth,relationship_path from walk order by product_id,depth,relationship_path::text
  ), links as (
    select e.* from active_edges e where exists(select 1 from nodes n where n.product_id=e.source_product_id) and exists(select 1 from nodes n where n.product_id=e.target_product_id)
  ) select 'found'::text,jsonb_build_object('organizationId',p_organization_id,'rootProductId',p_product_id,'rootReleaseId',p_root_release_id,'graphVersion',v_graph_version,'evaluatedAt',public.m2_utc_z(v_as_of),'nodes',coalesce((select jsonb_agg(jsonb_build_object('productId',n.product_id,'releaseId',case when n.product_id=p_product_id then p_root_release_id else null end,'depth',n.depth,'relationshipPathIds',to_jsonb(n.relationship_path)) order by n.depth,n.product_id) from nodes n),'[]'::jsonb),'links',coalesce((select jsonb_agg(public.m2_product_relationship_json(l) order by l.id) from links l),'[]'::jsonb));
end;
$$;

create or replace function public.get_product_relationship_propagation_candidates(
  p_organization_id uuid,p_source_release_id uuid,p_source_baseline_revision_id uuid,p_actor_user_id uuid,
  p_graph_version integer,p_as_of timestamptz,p_page_size integer,p_cursor text
) returns table(outcome text,candidates jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_as_of timestamptz:=coalesce(p_as_of,now()); v_current_graph integer; v_page_size integer:=coalesce(p_page_size,25);
begin
  if (p_source_release_id is null)=(p_source_baseline_revision_id is null) or v_page_size<1 or v_page_size>100 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select product_relationship_graph_version into v_current_graph from public.organization_settings where organization_id=p_organization_id;
  if p_graph_version<>v_current_graph then return query select 'conflict'::text,null::jsonb; return; end if;
  if (p_source_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and id=p_source_release_id)) or (p_source_baseline_revision_id is not null and not exists(select 1 from public.software_baselines where organization_id=p_organization_id and id=p_source_baseline_revision_id)) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query with recursive active_edges as (
    select r.* from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='embedded' and r.ended_at is null and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), seed as (
    select r.product_id,r.id as release_id,array[]::uuid[] as relationship_path from public.product_releases r where p_source_release_id is not null and r.organization_id=p_organization_id and r.id=p_source_release_id
    union
    select m.product_id,m.release_id,array[]::uuid[] from public.software_baseline_release_memberships m where p_source_baseline_revision_id is not null and m.organization_id=p_organization_id and m.baseline_revision_id=p_source_baseline_revision_id and m.ended_at is null and m.effective_starts_at<=v_as_of and (m.effective_ends_at is null or m.effective_ends_at>v_as_of)
    union
    select r.target_product_id,r.target_release_id,array[r.id]::uuid[] from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='variant' and r.ended_at is null and ((p_source_release_id is not null and r.source_release_id=p_source_release_id) or (p_source_baseline_revision_id is not null and r.baseline_revision_id=p_source_baseline_revision_id)) and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), walk as (
    select seed.product_id,seed.release_id,seed.relationship_path,array[seed.product_id]::uuid[] as product_path,0 as depth from seed
    union all
    select edge.source_product_id,edge.source_release_id,walk.relationship_path||edge.id,walk.product_path||edge.source_product_id,walk.depth+1
    from walk join active_edges edge on edge.target_product_id=walk.product_id
    where walk.depth<64 and not edge.source_product_id=any(walk.product_path)
  ), canonical as (
    select distinct on(product_id,coalesce(release_id,'00000000-0000-0000-0000-000000000000'::uuid)) product_id,release_id,relationship_path
    from walk order by product_id,coalesce(release_id,'00000000-0000-0000-0000-000000000000'::uuid),array_length(relationship_path,1) nulls first,relationship_path::text
  ), paged as (
    select * from canonical where p_cursor is null or (product_id::text||':'||coalesce(release_id::text,''))>p_cursor order by product_id,release_id nulls first limit v_page_size+1
  ), selected as (select * from paged limit v_page_size), next_row as (select * from paged offset v_page_size limit 1)
  select 'found'::text,jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('productId',s.product_id,'releaseId',s.release_id,'relationshipPathIds',to_jsonb(s.relationship_path),'graphVersion',v_current_graph,'evaluatedAt',public.m2_utc_z(v_as_of)) order by s.product_id,s.release_id) from selected s),'[]'::jsonb),'nextCursor',(select n.product_id::text||':'||coalesce(n.release_id::text,'') from next_row n),'graphVersion',v_current_graph,'evaluatedAt',public.m2_utc_z(v_as_of));
end;
$$;

create or replace function public.get_product_relationship_propagation_events(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_cursor text,p_page_size integer,p_delivery_state text
) returns table(outcome text,events jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_page_size integer:=coalesce(p_page_size,25);
begin
  if v_page_size<1 or v_page_size>100 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query with paged as (
    select e.* from public.product_regulatory_outbox_events e where e.organization_id=p_organization_id and e.product_id=p_product_id and e.event_type='product_relationship.graph_changed' and (p_delivery_state is null or e.delivery_state=p_delivery_state) and (p_cursor is null or e.id::text>p_cursor) order by e.id limit v_page_size+1
  ), selected as (select * from paged limit v_page_size), next_row as (select * from paged offset v_page_size limit 1)
  select 'found'::text,jsonb_build_object('events',coalesce((select jsonb_agg(public.m2_relationship_outbox_event_json(s) order by s.id) from selected s),'[]'::jsonb),'nextCursor',(select id::text from next_row));
end;
$$;

create or replace function public.request_product_relationship_reevaluation_atomic(
  p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_graph_version integer,
  p_reason text,p_source text,p_provenance text,p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,event jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_lock_outcome text; v_graph integer; v_event public.product_regulatory_outbox_events%rowtype; v_digest text; v_key text;
begin
  if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,'')))=0 or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select lock_result.outcome,lock_result.graph_version into v_lock_outcome,v_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb; return; end if;
  if not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  v_digest:=public.m2_relationship_digest(jsonb_build_object('action','requestReevaluation','productId',p_product_id,'expectedGraphVersion',p_expected_graph_version,'reason',btrim(p_reason),'source',btrim(p_source),'provenance',btrim(p_provenance)));
  v_key:=concat('relationship:manual:',p_product_id::text,':',p_actor_user_id::text,':',p_idempotency_key::text);
  select * into v_event from public.product_regulatory_outbox_events where organization_id=p_organization_id and event_key=v_key for update;
  if found then
    if v_event.payload->>'requestDigest'<>v_digest then return query select 'invalid_request'::text,null::jsonb; return; end if;
    return query select 'created'::text,public.m2_relationship_outbox_event_json(v_event); return;
  end if;
  insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,occurred_at,delivery_state,graph_version)
  values(p_organization_id,p_product_id,null,'product_relationship.graph_changed',v_key,jsonb_build_object('action','manual_reevaluation_requested','reason',btrim(p_reason),'source',btrim(p_source),'provenance',btrim(p_provenance),'requestDigest',v_digest,'graphVersion',v_graph),p_correlation_id,now(),'scheduled',v_graph) returning * into v_event;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.relationship_reevaluation_requested','product',p_product_id::text,jsonb_build_object('eventId',v_event.id,'reason',btrim(p_reason),'graphVersion',v_graph,'correlationId',p_correlation_id,'requestDigest',v_digest));
  return query select 'created'::text,public.m2_relationship_outbox_event_json(v_event);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$$;

create or replace function public.archive_product_atomic(
  p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_reason text
) returns table(outcome text,product jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_before jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_expected_version is null or v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
  if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
  if exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and archived_at is null)
    or exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=p_organization_id and product_id=p_product_id and active)
    or exists(select 1 from public.software_baseline_release_memberships where organization_id=p_organization_id and product_id=p_product_id and ended_at is null)
    or exists(select 1 from public.product_relationships where organization_id=p_organization_id and (source_product_id=p_product_id or target_product_id=p_product_id) and ended_at is null) then
    return query select 'blocked'::text,null::jsonb; return;
  end if;
  v_before:=public.m2_product_json(p_organization_id,p_product_id);
  update public.products set archived_at=now(),archived_by=p_actor_user_id,version=version+1,updated_by=p_actor_user_id where id=p_product_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.archived','product',p_product_id::text,jsonb_build_object('before',v_before,'after',public.m2_product_json(p_organization_id,p_product_id),'reason',nullif(btrim(p_reason),''),'relationshipArchiveBlockersChecked',true));
  return query select 'archived'::text,public.m2_product_json(p_organization_id,p_product_id);
end;
$$;

create or replace function public.archive_product_release_atomic(
  p_organization_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid,p_expected_version integer,p_reason text
) returns table(outcome text,release jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_release public.product_releases%rowtype; v_before jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_release from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_expected_version is null or v_release.version<>p_expected_version then return query select 'conflict'::text,public.m2_release_json(p_organization_id,p_release_id); return; end if;
  if v_release.lifecycle<>'withdrawn' or v_release.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
  if exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=p_organization_id and product_id=p_product_id and release_id=p_release_id and active)
    or exists(select 1 from public.software_baseline_release_memberships where organization_id=p_organization_id and release_id=p_release_id and ended_at is null)
    or exists(select 1 from public.product_relationships where organization_id=p_organization_id and (source_release_id=p_release_id or target_release_id=p_release_id) and ended_at is null) then
    return query select 'blocked'::text,null::jsonb; return;
  end if;
  v_before:=public.m2_release_json(p_organization_id,p_release_id);
  update public.product_releases set archived_at=now(),archived_by=p_actor_user_id,version=version+1,updated_by=p_actor_user_id where id=p_release_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.release_archived','product_release',p_release_id::text,jsonb_build_object('before',v_before,'after',public.m2_release_json(p_organization_id,p_release_id),'reason',nullif(btrim(p_reason),''),'relationshipArchiveBlockersChecked',true));
  return query select 'archived'::text,public.m2_release_json(p_organization_id,p_release_id);
end;
$$;

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
values
  ('product_registry', 'software_baselines', 'organization_id', 'id', 8),
  ('product_registry', 'software_baseline_release_memberships', 'organization_id', 'id', 9),
  ('product_registry', 'product_relationships', 'organization_id', 'id', 10)
on conflict(source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;

create or replace view public.m2_product_relationship_operations
with (security_invoker = true) as
select organization_id,
  count(*) filter (where relationship_type='embedded' and ended_at is null) as active_component_links,
  count(*) filter (where relationship_type='variant' and ended_at is null) as active_variant_relationships,
  count(*) filter (where ended_at is not null) as historical_relationships
from public.product_relationships group by organization_id;
revoke all on public.m2_product_relationship_operations from public, anon, authenticated;
grant select on public.m2_product_relationship_operations to service_role;

alter function public.m2_relationship_digest(jsonb) owner to postgres;
alter function public.m2_software_baseline_json(public.software_baselines) owner to postgres;
alter function public.m2_baseline_membership_json(public.software_baseline_release_memberships) owner to postgres;
alter function public.m2_product_relationship_json(public.product_relationships) owner to postgres;
alter function public.m2_relationship_outbox_event_json(public.product_regulatory_outbox_events) owner to postgres;

revoke all on function
  public.create_software_baseline_atomic(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.append_software_baseline_revision_atomic(uuid,uuid,uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.get_software_baseline_history(uuid,uuid,uuid),
  public.archive_software_baseline_atomic(uuid,uuid,uuid,integer,text,uuid),
  public.assign_software_baseline_membership_atomic(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,timestamptz,uuid,uuid),
  public.end_software_baseline_membership_atomic(uuid,uuid,uuid,uuid,integer,text,timestamptz,uuid),
  public.get_product_software_baseline_memberships(uuid,uuid,uuid,timestamptz),
  public.create_product_variant_relationship_atomic(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.end_product_variant_relationship_atomic(uuid,uuid,uuid,uuid,integer,integer,text,timestamptz,uuid),
  public.get_product_variant_relationships(uuid,uuid,uuid,timestamptz),
  public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz),
  public.create_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.end_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,integer,text,timestamptz,uuid),
  public.supersede_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,integer,uuid,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.get_product_component_links(uuid,uuid,uuid,timestamptz),
  public.get_product_relationship_graph(uuid,uuid,uuid,timestamptz,uuid,integer,boolean),
  public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text),
  public.get_product_relationship_propagation_events(uuid,uuid,uuid,text,integer,text),
  public.request_product_relationship_reevaluation_atomic(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)
from public, anon, authenticated;
grant execute on function
  public.create_software_baseline_atomic(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.append_software_baseline_revision_atomic(uuid,uuid,uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.get_software_baseline_history(uuid,uuid,uuid),
  public.archive_software_baseline_atomic(uuid,uuid,uuid,integer,text,uuid),
  public.assign_software_baseline_membership_atomic(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,timestamptz,uuid,uuid),
  public.end_software_baseline_membership_atomic(uuid,uuid,uuid,uuid,integer,text,timestamptz,uuid),
  public.get_product_software_baseline_memberships(uuid,uuid,uuid,timestamptz),
  public.create_product_variant_relationship_atomic(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.end_product_variant_relationship_atomic(uuid,uuid,uuid,uuid,integer,integer,text,timestamptz,uuid),
  public.get_product_variant_relationships(uuid,uuid,uuid,timestamptz),
  public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz),
  public.create_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.end_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,integer,text,timestamptz,uuid),
  public.supersede_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,integer,uuid,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid),
  public.get_product_component_links(uuid,uuid,uuid,timestamptz),
  public.get_product_relationship_graph(uuid,uuid,uuid,timestamptz,uuid,integer,boolean),
  public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text),
  public.get_product_relationship_propagation_events(uuid,uuid,uuid,text,integer,text),
  public.request_product_relationship_reevaluation_atomic(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)
to service_role;

-- The export registry is dynamic, but its source tables must also participate
-- in the snapshot lock. Otherwise an export could observe a graph revision
-- without the relationship history that made it authoritative.
create or replace function public.materialize_organization_export_snapshot_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_snapshot public.organization_export_snapshots%rowtype;
  v_mapping public.organization_export_source_tables%rowtype;
  v_source_id text;
  v_source_count integer := 0;
begin
  lock table
    public.organizations,
    public.organization_legal_profiles,
    public.organization_members,
    public.audit_logs,
    public.invitations,
    public.custom_roles,
    public.base_role_permission_overrides,
    public.menu_permissions,
    public.user_role_assignments,
    public.user_table_preferences,
    public.organization_onboarding,
    public.organization_onboarding_stages,
    public.organization_onboarding_evidence,
    public.organization_settings,
    public.organization_lifecycles,
    public.organization_retention_policies,
    public.retention_authority_states,
    public.retention_authoritative_facts,
    public.retention_floor_snapshots,
    public.retention_floor_reasons,
    public.evidence_protection_watermarks,
    public.retention_cleanup_runs,
    public.retention_cleanup_items,
    public.organization_export_jobs,
    public.organization_export_parts,
    public.organization_export_snapshots,
    public.organization_purge_jobs,
    public.organization_purge_work_items,
    public.organization_permissions_version,
    public.organization_legal_entities,
    public.organization_legal_entity_dependency_authorities,
    public.organization_legal_entity_dependency_facts,
    public.organization_branding_drafts,
    public.organization_branding_assets,
    public.organization_branding_versions,
    public.products,
    public.product_releases,
    public.product_legal_entity_assignments,
    public.product_lifecycle_dependency_facts,
    public.product_release_market_availability,
    public.product_regulatory_outbox_events,
    public.product_support_periods,
    public.software_baselines,
    public.software_baseline_release_memberships,
    public.product_relationships
  in share mode;

  select * into v_job
    from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id
   for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;
  select * into v_snapshot from public.organization_export_snapshots
   where organization_id = p_organization_id and export_job_id = p_export_job_id
   order by snapshot_version desc limit 1 for update;
  if not found or cardinality(v_snapshot.source_ids) = 0 then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  if v_snapshot.materialized_at is not null then
    return query select 'replayed'::text, v_job.checkpoint_version; return;
  end if;
  if exists (select 1 from public.organization_export_snapshot_records records
    where records.organization_id = p_organization_id and records.export_job_id = p_export_job_id) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  if exists (select 1 from unnest(v_snapshot.source_ids) as requested(source_id)
    where not exists (select 1 from public.organization_export_source_tables mappings
      where mappings.source_id = requested.source_id)) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  foreach v_source_id in array v_snapshot.source_ids loop
    for v_mapping in select * from public.organization_export_source_tables mappings
      where mappings.source_id = v_source_id order by mappings.table_sort
    loop
      execute format(
        'insert into public.organization_export_snapshot_records
          (organization_id, export_job_id, source_id, table_name, table_sort, record_index, record_payload)
         select $1, $2, $3, $4, $5,
                row_number() over (order by source.%I),
                public.m1_export_redact_jsonb(to_jsonb(source))
           from public.%I source
          where source.%I = $1
          order by source.%I',
        v_mapping.record_order_column, v_mapping.table_name,
        v_mapping.tenant_key_column, v_mapping.record_order_column
      ) using p_organization_id, p_export_job_id, v_source_id,
        v_mapping.table_name, v_mapping.table_sort;
      v_source_count := v_source_count + 1;
    end loop;
  end loop;
  if v_source_count <> (select count(*) from public.organization_export_source_tables mappings
    where mappings.source_id = any(v_snapshot.source_ids)) then
    return query select 'invalid_request'::text, v_job.checkpoint_version; return;
  end if;
  update public.organization_export_snapshots snapshots set
    materialized_at = now(), materialized_by = v_job.actor_user_id,
    materialized_checkpoint_version = v_job.checkpoint_version
   where snapshots.id = v_snapshot.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_snapshot_materialized',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('sourceCount', v_source_count, 'checkpointVersion', v_job.checkpoint_version));
  return query select 'materialized'::text, v_job.checkpoint_version;
end;
$$;

alter function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) to service_role;

alter function public.m2_relationship_graph_event_atomic(uuid, uuid, integer, text, uuid, uuid, jsonb) owner to postgres;
alter function public.m2_lock_relationship_graph(uuid, integer, uuid) owner to postgres;
alter function public.m2_bump_relationship_graph(uuid, uuid) owner to postgres;
alter function public.m2_component_link_preview(uuid, uuid, uuid, timestamptz, integer, uuid) owner to postgres;
alter function public.archive_product_atomic(uuid, uuid, uuid, integer, text) owner to postgres;
alter function public.archive_product_release_atomic(uuid, uuid, uuid, uuid, integer, text) owner to postgres;
revoke all on function
  public.m2_relationship_digest(jsonb),
  public.m2_software_baseline_json(public.software_baselines),
  public.m2_baseline_membership_json(public.software_baseline_release_memberships),
  public.m2_product_relationship_json(public.product_relationships),
  public.m2_relationship_outbox_event_json(public.product_regulatory_outbox_events),
  public.m2_relationship_graph_event_atomic(uuid, uuid, integer, text, uuid, uuid, jsonb),
  public.m2_lock_relationship_graph(uuid, integer, uuid),
  public.m2_bump_relationship_graph(uuid, uuid),
  public.m2_component_link_preview(uuid, uuid, uuid, timestamptz, integer, uuid),
  public.archive_product_atomic(uuid, uuid, uuid, integer, text),
  public.archive_product_release_atomic(uuid, uuid, uuid, uuid, integer, text)
from public, anon, authenticated;
grant execute on function
  public.archive_product_atomic(uuid, uuid, uuid, integer, text),
  public.archive_product_release_atomic(uuid, uuid, uuid, uuid, integer, text)
to service_role;
