-- Product and baseline lifecycle owners consume these compact projections
-- instead of reading finding-owned source/association tables. The projections
-- are derived, rebuildable facts: their historical source remains in the four
-- finding-owned records and audit_log.
create table public.software_baseline_lifecycle_dependency_facts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  baseline_revision_id uuid not null,
  authority_kind text not null check (authority_kind in ('finding')),
  record_id uuid not null,
  active boolean not null default true,
  reconciled_at timestamptz not null default now(),
  reconciled_by uuid not null references public.users(id) on delete restrict,
  primary key (organization_id, authority_kind, record_id),
  foreign key (organization_id, baseline_revision_id)
    references public.software_baselines(organization_id, id) on delete cascade
);

create index software_baseline_dependencies_active_idx
  on public.software_baseline_lifecycle_dependency_facts(
    organization_id, baseline_revision_id, active
  );

alter table public.software_baseline_lifecycle_dependency_facts
  enable row level security;
revoke all on table public.software_baseline_lifecycle_dependency_facts
  from public, anon, authenticated;
grant all on table public.software_baseline_lifecycle_dependency_facts
  to service_role;

-- One association produces one product/release lifecycle blocker only while
-- it is a current candidate or active impact. Superseded/closed records stay
-- historically queryable but obey the controlled historical-preservation rule
-- and no longer prevent product archive.
create or replace function public.m2_sync_finding_impact_product_dependency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_actor_id uuid;
begin
  select coalesce(j.requested_by, s.updated_by) into v_actor_id
    from public.finding_propagation_sources s
    left join public.finding_propagation_jobs j
      on j.organization_id = new.organization_id
     and j.id = new.last_seen_job_id
   where s.organization_id = new.organization_id
     and s.id = new.source_finding_id;

  if v_actor_id is null then
    raise exception 'missing finding propagation source actor';
  end if;

  insert into public.product_lifecycle_dependency_facts(
    organization_id, product_id, release_id, authority_kind, record_id,
    active, reconciled_at, reconciled_by
  ) values (
    new.organization_id, new.affected_product_id, new.affected_release_id,
    'finding', new.id, new.status in ('candidate', 'active'),
    clock_timestamp(), v_actor_id
  ) on conflict (organization_id, authority_kind, record_id) do update set
    product_id = excluded.product_id,
    release_id = excluded.release_id,
    active = excluded.active,
    reconciled_at = excluded.reconciled_at,
    reconciled_by = excluded.reconciled_by;
  return new;
end;
$$;

drop trigger if exists sync_finding_impact_product_dependency
  on public.finding_impact_associations;
create trigger sync_finding_impact_product_dependency
  after insert or update of status, affected_product_id, affected_release_id,
    last_seen_job_id on public.finding_impact_associations
  for each row execute function public.m2_sync_finding_impact_product_dependency();

-- A baseline source has no product dependency fact. Project exactly its active
-- source status into a baseline-owned fact so archiving checks do not cross the
-- published database boundary into finding tables.
create or replace function public.m2_sync_finding_source_baseline_dependency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source_baseline_revision_id is null then
    update public.software_baseline_lifecycle_dependency_facts f
       set active = false,
           reconciled_at = clock_timestamp(),
           reconciled_by = new.updated_by
     where f.organization_id = new.organization_id
       and f.authority_kind = 'finding'
       and f.record_id = new.id;
  else
    insert into public.software_baseline_lifecycle_dependency_facts(
      organization_id, baseline_revision_id, authority_kind, record_id,
      active, reconciled_at, reconciled_by
    ) values (
      new.organization_id, new.source_baseline_revision_id, 'finding', new.id,
      new.status = 'active', clock_timestamp(), new.updated_by
    ) on conflict (organization_id, authority_kind, record_id) do update set
      baseline_revision_id = excluded.baseline_revision_id,
      active = excluded.active,
      reconciled_at = excluded.reconciled_at,
      reconciled_by = excluded.reconciled_by;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_finding_source_baseline_dependency
  on public.finding_propagation_sources;
create trigger sync_finding_source_baseline_dependency
  after insert or update of source_baseline_revision_id, status
  on public.finding_propagation_sources
  for each row execute function public.m2_sync_finding_source_baseline_dependency();

-- Backfill is safe for a newly installed feature and enables the archive guard
-- if a deployment already registered source rows before this projection exists.
insert into public.software_baseline_lifecycle_dependency_facts(
  organization_id, baseline_revision_id, authority_kind, record_id,
  active, reconciled_at, reconciled_by
)
select
  s.organization_id, s.source_baseline_revision_id, 'finding', s.id,
  s.status = 'active', clock_timestamp(), s.updated_by
from public.finding_propagation_sources s
where s.source_baseline_revision_id is not null
on conflict (organization_id, authority_kind, record_id) do update set
  baseline_revision_id = excluded.baseline_revision_id,
  active = excluded.active,
  reconciled_at = excluded.reconciled_at,
  reconciled_by = excluded.reconciled_by;

-- The baseline module reads only its compact lifecycle projection. It blocks
-- archive when an active finding source still relies on any baseline revision;
-- no product/M2 adapter joins a finding-owned table.
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
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_current from public.software_baselines
   where organization_id = p_organization_id and baseline_id = p_baseline_id and is_current
   for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_current.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_software_baseline_json(v_current); return;
  end if;
  if v_current.archived_at is not null then
    return query select 'blocked'::text, null::jsonb; return;
  end if;
  if exists(
      select 1 from public.software_baseline_release_memberships
       where organization_id = p_organization_id and baseline_id = p_baseline_id and ended_at is null
    )
    or exists(
      select 1 from public.product_relationships r
      join public.software_baselines b
        on b.organization_id = r.organization_id and b.id = r.baseline_revision_id
     where r.organization_id = p_organization_id
       and b.baseline_id = p_baseline_id
       and r.relationship_type = 'variant'
       and r.ended_at is null
    )
    or exists(
      select 1 from public.software_baseline_lifecycle_dependency_facts f
      join public.software_baselines b
        on b.organization_id = f.organization_id and b.id = f.baseline_revision_id
     where f.organization_id = p_organization_id
       and b.baseline_id = p_baseline_id
       and f.active
    ) then
    return query select 'blocked'::text, null::jsonb; return;
  end if;
  update public.software_baselines set archived_at = now(), archived_by = p_actor_user_id,
    archive_reason = btrim(p_reason), version = version + 1, updated_by = p_actor_user_id
   where organization_id = p_organization_id and baseline_id = p_baseline_id;
  select * into v_after from public.software_baselines where id = v_current.id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values(p_organization_id, p_actor_user_id, 'product.software_baseline_archived',
    'software_baseline', v_current.id::text,
    jsonb_build_object('before', public.m2_software_baseline_json(v_current),
      'after', public.m2_software_baseline_json(v_after), 'reason', btrim(p_reason),
      'correlationId', p_correlation_id));
  return query select 'archived'::text, public.m2_software_baseline_json(v_after);
end;
$$;

alter function public.m2_sync_finding_impact_product_dependency() owner to postgres;
alter function public.m2_sync_finding_source_baseline_dependency() owner to postgres;
alter function public.archive_software_baseline_atomic(uuid,uuid,uuid,integer,text,uuid) owner to postgres;
revoke all on function public.m2_sync_finding_impact_product_dependency(),
  public.m2_sync_finding_source_baseline_dependency()
  from public, anon, authenticated;
