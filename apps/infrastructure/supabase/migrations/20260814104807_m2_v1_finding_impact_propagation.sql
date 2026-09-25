-- Finding-owned propagation state. Product graph data remains behind product
-- RPCs; these records retain only opaque source identity and evaluated impacts.

create table public.finding_propagation_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null check (char_length(btrim(source_system)) between 1 and 100),
  source_finding_key text not null check (char_length(btrim(source_finding_key)) between 1 and 256),
  source_product_id uuid not null,
  source_release_id uuid,
  source_baseline_revision_id uuid,
  rule_version text not null check (char_length(btrim(rule_version)) between 1 and 100),
  status text not null default 'active' check (status in ('active', 'resolved', 'archived')),
  source text not null check (char_length(btrim(source)) between 1 and 1000),
  provenance text not null check (char_length(btrim(provenance)) between 1 and 1000),
  version integer not null default 0 check (version >= 0),
  idempotency_key uuid,
  idempotency_request_digest text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, source_system, source_finding_key),
  foreign key (organization_id, source_product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, source_product_id, source_release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, source_baseline_revision_id)
    references public.software_baselines(organization_id, id) on delete restrict,
  check ((source_release_id is null) <> (source_baseline_revision_id is null)),
  check ((idempotency_key is null) = (idempotency_request_digest is null)),
  check (idempotency_request_digest is null or idempotency_request_digest ~ '^[a-f0-9]{64}$')
);

create table public.finding_propagation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_finding_id uuid not null,
  trigger_key text not null check (char_length(btrim(trigger_key)) between 1 and 300),
  graph_version integer not null check (graph_version >= 0),
  source_release_id uuid,
  source_baseline_revision_id uuid,
  rule_version text not null check (char_length(btrim(rule_version)) between 1 and 100),
  as_of timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'leased', 'retrying', 'completed', 'dead_letter', 'obsolete')),
  cursor text,
  processed_count bigint not null default 0 check (processed_count >= 0),
  upserted_count bigint not null default 0 check (upserted_count >= 0),
  superseded_count bigint not null default 0 check (superseded_count >= 0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  checkpoint_version integer not null default 0 check (checkpoint_version >= 0),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  due_at timestamptz not null default now(),
  last_error_code text,
  requested_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, trigger_key),
  foreign key (organization_id, source_finding_id)
    references public.finding_propagation_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, source_release_id)
    references public.product_releases(organization_id, id) on delete restrict,
  foreign key (organization_id, source_baseline_revision_id)
    references public.software_baselines(organization_id, id) on delete restrict,
  check ((source_release_id is null) <> (source_baseline_revision_id is null)),
  check ((lease_owner is null) = (lease_expires_at is null)),
  check (last_error_code is null or last_error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$')
);

create table public.finding_impact_associations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_finding_id uuid not null,
  affected_product_id uuid not null,
  affected_release_id uuid,
  relationship_path_ids uuid[] not null default '{}',
  relationship_path_hash text not null check (relationship_path_hash ~ '^[a-f0-9]{64}$'),
  source_graph_version integer not null check (source_graph_version >= 0),
  rule_version text not null check (char_length(btrim(rule_version)) between 1 and 100),
  status text not null default 'active' check (status in ('candidate', 'active', 'superseded', 'closed')),
  first_evaluated_at timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  superseded_at timestamptz,
  last_seen_job_id uuid,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, source_finding_id)
    references public.finding_propagation_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, affected_product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, affected_product_id, affected_release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  foreign key (organization_id, last_seen_job_id)
    references public.finding_propagation_jobs(organization_id, id) on delete restrict,
  unique nulls not distinct (
    organization_id, source_finding_id, affected_product_id, affected_release_id,
    relationship_path_hash, source_graph_version, rule_version
  )
);

create table public.finding_product_impact_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_finding_id uuid not null,
  affected_product_id uuid not null,
  affected_release_id uuid,
  override_state text not null check (override_state in ('applicable', 'not_applicable', 'accepted_risk', 'suppressed')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  source text not null check (char_length(btrim(source)) between 1 and 1000),
  provenance text not null check (char_length(btrim(provenance)) between 1 and 1000),
  effective_starts_at timestamptz not null,
  effective_ends_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.users(id) on delete set null,
  end_reason text,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  foreign key (organization_id, source_finding_id)
    references public.finding_propagation_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, affected_product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, affected_product_id, affected_release_id)
    references public.product_releases(organization_id, product_id, id) on delete restrict,
  check (effective_ends_at is null or effective_ends_at > effective_starts_at),
  check ((ended_at is null) = (ended_by is null)),
  check ((ended_at is null) = (end_reason is null)),
  check (end_reason is null or char_length(btrim(end_reason)) between 1 and 1000)
);

create unique index finding_propagation_source_actor_idempotency_key
  on public.finding_propagation_sources(organization_id, created_by, idempotency_key)
  where idempotency_key is not null;
create index finding_propagation_sources_release_active_idx
  on public.finding_propagation_sources(organization_id, source_release_id, id)
  where status = 'active' and source_release_id is not null;
create index finding_propagation_sources_baseline_active_idx
  on public.finding_propagation_sources(organization_id, source_baseline_revision_id, id)
  where status = 'active' and source_baseline_revision_id is not null;
create index finding_propagation_jobs_due_idx
  on public.finding_propagation_jobs(organization_id, due_at, id)
  where status in ('scheduled', 'retrying');
create index finding_propagation_jobs_expired_lease_idx
  on public.finding_propagation_jobs(organization_id, lease_expires_at, id)
  where status = 'leased';
create index finding_impact_associations_product_idx
  on public.finding_impact_associations(organization_id, affected_product_id, affected_release_id, status, id);
create index finding_impact_associations_source_idx
  on public.finding_impact_associations(organization_id, source_finding_id, status, source_graph_version desc, id);
create unique index finding_product_impact_overrides_active_key
  on public.finding_product_impact_overrides(
    organization_id, source_finding_id, affected_product_id, affected_release_id
  ) nulls not distinct where ended_at is null;

alter table public.finding_propagation_sources enable row level security;
alter table public.finding_propagation_jobs enable row level security;
alter table public.finding_impact_associations enable row level security;
alter table public.finding_product_impact_overrides enable row level security;
revoke all on table public.finding_propagation_sources, public.finding_propagation_jobs,
  public.finding_impact_associations, public.finding_product_impact_overrides
from public, anon, authenticated;
grant all on table public.finding_propagation_sources, public.finding_propagation_jobs,
  public.finding_impact_associations, public.finding_product_impact_overrides
to service_role;

create trigger set_finding_propagation_sources_updated_at before update
  on public.finding_propagation_sources for each row execute function public.set_updated_at();
create trigger set_finding_propagation_jobs_updated_at before update
  on public.finding_propagation_jobs for each row execute function public.set_updated_at();
create trigger set_finding_impact_associations_updated_at before update
  on public.finding_impact_associations for each row execute function public.set_updated_at();
create trigger set_finding_product_impact_overrides_updated_at before update
  on public.finding_product_impact_overrides for each row execute function public.set_updated_at();

create or replace function public.claim_finding_propagation_job_atomic(
  p_organization_id uuid, p_lease_owner uuid, p_lease_seconds integer
) returns table(
  outcome text, job_id uuid, source_finding_id uuid, source_release_id uuid,
  source_baseline_revision_id uuid, graph_version integer, rule_version text,
  as_of timestamptz, cursor text, checkpoint_version integer, retry_count integer
) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.finding_propagation_jobs%rowtype;
begin
  if p_organization_id is null or p_lease_owner is null
     or p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::timestamptz, null::text, null::integer, null::integer;
    return;
  end if;
  select * into v_job from public.finding_propagation_jobs q
   where q.organization_id = p_organization_id
     and ((q.status in ('scheduled', 'retrying') and q.due_at <= clock_timestamp())
       or (q.status = 'leased' and q.lease_expires_at <= clock_timestamp()))
   order by q.due_at, q.id for update skip locked limit 1;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::timestamptz, null::text, null::integer, null::integer;
    return;
  end if;
  update public.finding_propagation_jobs q set status = 'leased', lease_owner = p_lease_owner,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    checkpoint_version = q.checkpoint_version + 1, delivery_attempts = q.delivery_attempts + 1,
    last_error_code = null
   where q.organization_id = p_organization_id and q.id = v_job.id returning * into v_job;
  return query select 'claimed'::text, v_job.id, v_job.source_finding_id,
    v_job.source_release_id, v_job.source_baseline_revision_id, v_job.graph_version,
    v_job.rule_version, v_job.as_of, v_job.cursor, v_job.checkpoint_version, v_job.delivery_attempts;
end;
$$;

alter function public.claim_finding_propagation_job_atomic(uuid,uuid,integer) owner to postgres;
revoke all on function public.claim_finding_propagation_job_atomic(uuid,uuid,integer)
from public, anon, authenticated;
grant execute on function public.claim_finding_propagation_job_atomic(uuid,uuid,integer)
to service_role;
