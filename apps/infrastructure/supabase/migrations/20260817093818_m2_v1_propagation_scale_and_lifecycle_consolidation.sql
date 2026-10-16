-- M2 V1 completion: keep the relationship graph's durable state compact while
-- bounding inverse fan-out. This is deliberately forward-only because the
-- preceding M2 migrations may already be applied in development environments.

-- A baseline finding blocker is the same kind of compact, rebuildable archive
-- fact as a product finding blocker. Reuse the existing projection rather than
-- keep a second lifecycle table with the same lifecycle and access boundary.
alter table public.product_lifecycle_dependency_facts
  add column if not exists subject_kind text not null default 'product',
  add column if not exists baseline_revision_id uuid;

alter table public.product_lifecycle_dependency_facts
  alter column product_id drop not null,
  drop constraint if exists product_lifecycle_dependency_facts_pkey,
  add constraint product_lifecycle_dependency_facts_subject_kind_check
    check (subject_kind in ('product', 'baseline')),
  add constraint product_lifecycle_dependency_facts_subject_scope_check
    check (
      (subject_kind = 'product'
        and product_id is not null
        and baseline_revision_id is null)
      or
      (subject_kind = 'baseline'
        and product_id is null
        and release_id is null
        and baseline_revision_id is not null)
    ),
  add constraint product_lifecycle_dependency_facts_baseline_fkey
    foreign key (organization_id, baseline_revision_id)
    references public.software_baselines(organization_id, id)
    on delete cascade,
  add primary key (organization_id, subject_kind, authority_kind, record_id);

create index product_dependencies_baseline_active_idx
  on public.product_lifecycle_dependency_facts(
    organization_id, baseline_revision_id, active
  )
  where subject_kind = 'baseline';

-- Existing data is entirely product scoped. Copy projection rows first, verify
-- that every old row has a faithful successor, then remove only the redundant
-- projection. The source records and their historical audit facts are retained.
insert into public.product_lifecycle_dependency_facts(
  organization_id, subject_kind, baseline_revision_id, authority_kind,
  record_id, active, reconciled_at, reconciled_by
)
select
  f.organization_id, 'baseline', f.baseline_revision_id, f.authority_kind,
  f.record_id, f.active, f.reconciled_at, f.reconciled_by
from public.software_baseline_lifecycle_dependency_facts f
on conflict (organization_id, subject_kind, authority_kind, record_id)
do update set
  baseline_revision_id = excluded.baseline_revision_id,
  active = excluded.active,
  reconciled_at = excluded.reconciled_at,
  reconciled_by = excluded.reconciled_by;

do $$
begin
  if exists (
    select 1
      from public.software_baseline_lifecycle_dependency_facts legacy
      left join public.product_lifecycle_dependency_facts unified
        on unified.organization_id = legacy.organization_id
       and unified.subject_kind = 'baseline'
       and unified.authority_kind = legacy.authority_kind
       and unified.record_id = legacy.record_id
     where unified.baseline_revision_id is distinct from legacy.baseline_revision_id
        or unified.active is distinct from legacy.active
        or unified.reconciled_by is distinct from legacy.reconciled_by
  ) then
    raise exception 'M2 baseline lifecycle projection consolidation verification failed';
  end if;
end;
$$;

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
    organization_id, subject_kind, product_id, release_id, authority_kind,
    record_id, active, reconciled_at, reconciled_by
  ) values (
    new.organization_id, 'product', new.affected_product_id,
    new.affected_release_id, 'finding', new.id,
    new.status in ('candidate', 'active'), clock_timestamp(), v_actor_id
  ) on conflict (organization_id, subject_kind, authority_kind, record_id)
  do update set
    product_id = excluded.product_id,
    release_id = excluded.release_id,
    active = excluded.active,
    reconciled_at = excluded.reconciled_at,
    reconciled_by = excluded.reconciled_by;
  return new;
end;
$$;

create or replace function public.m2_sync_finding_source_baseline_dependency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source_baseline_revision_id is null then
    update public.product_lifecycle_dependency_facts f
       set active = false,
           reconciled_at = clock_timestamp(),
           reconciled_by = new.updated_by
     where f.organization_id = new.organization_id
       and f.subject_kind = 'baseline'
       and f.authority_kind = 'finding'
       and f.record_id = new.id;
  else
    insert into public.product_lifecycle_dependency_facts(
      organization_id, subject_kind, baseline_revision_id, authority_kind,
      record_id, active, reconciled_at, reconciled_by
    ) values (
      new.organization_id, 'baseline', new.source_baseline_revision_id,
      'finding', new.id, new.status = 'active', clock_timestamp(), new.updated_by
    ) on conflict (organization_id, subject_kind, authority_kind, record_id)
    do update set
      baseline_revision_id = excluded.baseline_revision_id,
      active = excluded.active,
      reconciled_at = excluded.reconciled_at,
      reconciled_by = excluded.reconciled_by;
  end if;
  return new;
end;
$$;

create or replace function public.m2_recalculate_retention_after_legal_fact_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Baseline-scoped facts deliberately have no product identifier and must not
  -- enter product retention logic.
  if new.subject_kind <> 'product'
     or new.authority_kind not in ('legal_hold', 'retention') then
    return new;
  end if;
  perform public.m2_record_retention_recalculation(
    new.organization_id, new.product_id, new.reconciled_by, 'binding_fact_changed'
  );
  return new;
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
      select 1 from public.product_lifecycle_dependency_facts f
      join public.software_baselines b
        on b.organization_id = f.organization_id and b.id = f.baseline_revision_id
     where f.organization_id = p_organization_id
       and f.subject_kind = 'baseline'
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

drop table public.software_baseline_lifecycle_dependency_facts;

-- A graph event checkpoints an opaque, bounded source-page continuation. The
-- same product outbox remains the single durable coordination record.
alter table public.product_regulatory_outbox_events
  add column if not exists delivery_cursor text;

alter table public.product_regulatory_outbox_events
  add constraint product_regulatory_outbox_events_delivery_cursor_length_check
  check (delivery_cursor is null or char_length(delivery_cursor) between 1 and 160);

create index product_relationship_outbox_due_idx
  on public.product_regulatory_outbox_events(organization_id, due_at, id)
  where event_type = 'product_relationship.graph_changed'
    and delivery_state in ('scheduled', 'retrying');

create index finding_propagation_sources_product_active_idx
  on public.finding_propagation_sources(organization_id, source_product_id, id)
  where status = 'active';
create index finding_propagation_jobs_source_idx
  on public.finding_propagation_jobs(organization_id, source_finding_id, status, id);

-- The lease payload exposes only operational identifiers. It carries the
-- continuation cursor so a restarted worker can replay one source page.
drop function public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer);
create or replace function public.claim_product_relationship_graph_event_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
) returns table(
  outcome text,
  event_id uuid,
  organization_id uuid,
  product_id uuid,
  graph_version integer,
  event_key text,
  checkpoint_version integer,
  lease_owner uuid,
  retry_count integer,
  error_code text,
  delivery_cursor text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.product_regulatory_outbox_events%rowtype; v_previous_state text;
begin
  if p_organization_id is null or p_lease_owner is null
     or p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::integer, null::uuid,
      null::integer, null::text, null::text;
    return;
  end if;
  select * into v_event
    from public.product_regulatory_outbox_events queued_event
   where queued_event.organization_id = p_organization_id
     and queued_event.event_type = 'product_relationship.graph_changed'
     and (
       (queued_event.delivery_state in ('scheduled', 'retrying')
         and coalesce(queued_event.due_at, queued_event.occurred_at) <= clock_timestamp())
       or (queued_event.delivery_state = 'leased'
         and queued_event.lease_expires_at <= clock_timestamp())
     )
   order by coalesce(queued_event.due_at, queued_event.occurred_at), queued_event.id
   for update skip locked
   limit 1;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::integer, null::uuid,
      null::integer, null::text, null::text;
    return;
  end if;
  v_previous_state := v_event.delivery_state;
  update public.product_regulatory_outbox_events queued_event
     set delivery_state = 'leased',
         lease_owner = p_lease_owner,
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         checkpoint_version = queued_event.checkpoint_version + 1,
         delivery_attempts = queued_event.delivery_attempts + 1,
         last_delivery_error = null,
         last_error_code = null
   where queued_event.organization_id = p_organization_id
     and queued_event.id = v_event.id
     and queued_event.event_type = 'product_relationship.graph_changed'
  returning * into v_event;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, 'product.relationship_graph_event_leased',
    'product_relationship_graph_event', v_event.id::text,
    jsonb_build_object('fromState', v_previous_state, 'toState', v_event.delivery_state,
      'checkpointVersion', v_event.checkpoint_version,
      'retryCount', v_event.delivery_attempts)
  );
  return query select
    'claimed'::text, v_event.id, v_event.organization_id, v_event.product_id,
    v_event.graph_version, v_event.event_key, v_event.checkpoint_version,
    v_event.lease_owner, v_event.delivery_attempts, null::text,
    v_event.delivery_cursor;
end;
$$;

-- Convert an event to a strict source scope. A product-wide embedded edge or
-- manual request is intentionally represented as `product`, never as a pair
-- of ambiguous null release/baseline identifiers.
create or replace function public.describe_product_relationship_graph_event_atomic(
  p_organization_id uuid, p_event_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer
) returns table(outcome text, event jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event public.product_regulatory_outbox_events%rowtype;
  v_relationship public.product_relationships%rowtype;
  v_membership public.software_baseline_release_memberships%rowtype;
  v_scopes jsonb := '[]'::jsonb;
  v_current_graph integer;
begin
  if p_organization_id is null or p_event_id is null or p_lease_owner is null
     or p_expected_checkpoint_version is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_event from public.product_regulatory_outbox_events e
   where e.organization_id = p_organization_id
     and e.id = p_event_id
     and e.event_type = 'product_relationship.graph_changed'
   for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_event.delivery_state <> 'leased'
     or v_event.lease_owner is distinct from p_lease_owner
     or v_event.checkpoint_version <> p_expected_checkpoint_version
     or v_event.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  select product_relationship_graph_version into v_current_graph
    from public.organization_settings
   where organization_id = p_organization_id;
  if v_current_graph is null or v_current_graph <> v_event.graph_version then
    update public.product_regulatory_outbox_events e
       set delivery_state = 'obsolete', obsolete_at = clock_timestamp(),
           lease_owner = null, lease_expires_at = null,
           last_delivery_error = null, last_error_code = 'stale_graph',
           delivery_cursor = null
     where e.organization_id = p_organization_id and e.id = v_event.id;
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'product.relationship_graph_event_obsoleted',
      'product_relationship_graph_event', v_event.id::text,
      jsonb_build_object('reason', 'stale_graph', 'eventGraphVersion', v_event.graph_version,
        'currentGraphVersion', v_current_graph));
    return query select 'obsolete'::text, null::jsonb; return;
  end if;
  if v_event.payload->>'subjectKind' in ('component_link', 'variant_relationship') then
    select * into v_relationship from public.product_relationships r
     where r.organization_id = p_organization_id
       and r.id = (v_event.payload->>'subjectId')::uuid;
    if found then
      if v_relationship.relationship_type = 'embedded' then
        if v_relationship.target_release_id is null then
          v_scopes := jsonb_build_array(jsonb_build_object(
            'scopeKind', 'product',
            'sourceProductId', v_relationship.target_product_id
          ));
        else
          v_scopes := jsonb_build_array(jsonb_build_object(
            'scopeKind', 'release',
            'sourceProductId', v_relationship.target_product_id,
            'sourceReleaseId', v_relationship.target_release_id
          ));
        end if;
      elsif v_relationship.source_type = 'base_release' then
        v_scopes := jsonb_build_array(jsonb_build_object(
          'scopeKind', 'release',
          'sourceProductId', v_relationship.source_product_id,
          'sourceReleaseId', v_relationship.source_release_id
        ));
      else
        v_scopes := jsonb_build_array(jsonb_build_object(
          'scopeKind', 'baseline',
          'sourceProductId', v_relationship.target_product_id,
          'sourceBaselineRevisionId', v_relationship.baseline_revision_id
        ));
      end if;
    end if;
  elsif v_event.payload->>'subjectKind' = 'baseline_membership' then
    select * into v_membership from public.software_baseline_release_memberships m
     where m.organization_id = p_organization_id
       and m.id = (v_event.payload->>'subjectId')::uuid;
    if found then
      v_scopes := jsonb_build_array(
        jsonb_build_object('scopeKind', 'release',
          'sourceProductId', v_membership.product_id,
          'sourceReleaseId', v_membership.release_id),
        jsonb_build_object('scopeKind', 'baseline',
          'sourceProductId', v_membership.product_id,
          'sourceBaselineRevisionId', v_membership.baseline_revision_id)
      );
    end if;
  end if;
  if jsonb_array_length(v_scopes) = 0 then
    v_scopes := jsonb_build_array(jsonb_build_object(
      'scopeKind', 'product', 'sourceProductId', v_event.product_id
    ));
  end if;
  return query select 'found'::text, jsonb_build_object(
    'eventId', v_event.id,
    'organizationId', v_event.organization_id,
    'graphVersion', v_event.graph_version,
    'eventKey', v_event.event_key,
    'occurredAt', public.m2_utc_z(v_event.occurred_at),
    'deliveryCursor', v_event.delivery_cursor,
    'sourceScopes', v_scopes
  );
exception when invalid_text_representation then
  return query select 'not_found'::text, null::jsonb;
end;
$$;

-- A worker acknowledges only after a source page has committed. If it dies
-- beforehand the source page is selected again and unique event+source job
-- keys make that replay harmless.
create or replace function public.checkpoint_product_relationship_graph_event_atomic(
  p_organization_id uuid, p_event_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer, p_delivery_cursor text,
  p_is_final boolean
) returns table(
  outcome text, event_id uuid, organization_id uuid, product_id uuid,
  graph_version integer, event_key text, checkpoint_version integer,
  lease_owner uuid, retry_count integer, error_code text, delivery_cursor text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.product_regulatory_outbox_events%rowtype; v_current_graph integer;
begin
  if p_organization_id is null or p_event_id is null or p_lease_owner is null
     or p_expected_checkpoint_version is null or p_is_final is null
     or (not p_is_final and char_length(coalesce(p_delivery_cursor, '')) not between 1 and 160)
     or (p_is_final and p_delivery_cursor is not null) then
    return query select 'invalid_request'::text, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::integer, null::uuid,
      null::integer, null::text, null::text;
    return;
  end if;
  select * into v_event from public.product_regulatory_outbox_events e
   where e.organization_id = p_organization_id
     and e.id = p_event_id
     and e.event_type = 'product_relationship.graph_changed'
   for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::integer, null::uuid,
      null::integer, null::text, null::text;
    return;
  end if;
  if v_event.delivery_state = 'delivered'
     and v_event.checkpoint_version = p_expected_checkpoint_version
     and p_is_final then
    return query select 'delivered'::text, v_event.id, v_event.organization_id,
      v_event.product_id, v_event.graph_version, v_event.event_key,
      v_event.checkpoint_version, v_event.lease_owner, v_event.delivery_attempts,
      v_event.last_error_code, v_event.delivery_cursor;
    return;
  end if;
  if v_event.delivery_state <> 'leased'
     or v_event.lease_owner is distinct from p_lease_owner
     or v_event.checkpoint_version <> p_expected_checkpoint_version
     or v_event.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text, v_event.id, v_event.organization_id,
      v_event.product_id, v_event.graph_version, v_event.event_key,
      v_event.checkpoint_version, v_event.lease_owner, v_event.delivery_attempts,
      v_event.last_error_code, v_event.delivery_cursor;
    return;
  end if;
  select product_relationship_graph_version into v_current_graph
    from public.organization_settings where organization_id = p_organization_id;
  if v_current_graph is null or v_event.graph_version <> v_current_graph then
    update public.product_regulatory_outbox_events e
       set delivery_state = 'obsolete', obsolete_at = clock_timestamp(),
           lease_owner = null, lease_expires_at = null, delivery_cursor = null,
           last_delivery_error = null, last_error_code = 'stale_graph',
           checkpoint_version = e.checkpoint_version + 1
     where e.organization_id = p_organization_id and e.id = v_event.id
    returning * into v_event;
    return query select 'obsolete'::text, v_event.id, v_event.organization_id,
      v_event.product_id, v_event.graph_version, v_event.event_key,
      v_event.checkpoint_version, v_event.lease_owner, v_event.delivery_attempts,
      v_event.last_error_code, v_event.delivery_cursor;
    return;
  end if;
  update public.product_regulatory_outbox_events e
     set delivery_state = case when p_is_final then 'delivered' else 'scheduled' end,
         delivered_at = case when p_is_final then clock_timestamp() else null end,
         due_at = case when p_is_final then e.due_at else clock_timestamp() end,
         lease_owner = null,
         lease_expires_at = null,
         delivery_cursor = case when p_is_final then null else p_delivery_cursor end,
         last_delivery_error = null,
         last_error_code = null,
         checkpoint_version = e.checkpoint_version + 1
   where e.organization_id = p_organization_id and e.id = v_event.id
  returning * into v_event;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id,
    case when p_is_final then 'product.relationship_graph_event_delivered'
      else 'product.relationship_graph_event_checkpointed' end,
    'product_relationship_graph_event', v_event.id::text,
    jsonb_build_object('checkpointVersion', v_event.checkpoint_version,
      'retryCount', v_event.delivery_attempts, 'final', p_is_final));
  return query select case when p_is_final then 'completed' else 'scheduled' end,
    v_event.id, v_event.organization_id, v_event.product_id, v_event.graph_version,
    v_event.event_key, v_event.checkpoint_version, v_event.lease_owner,
    v_event.delivery_attempts, null::text, v_event.delivery_cursor;
end;
$$;

-- Source selection is bounded by a UUID keyset. It never scans a tenant's
-- entire finding population or inserts an unbounded number of jobs in a graph
-- event transaction. `source_count` counts the page, including idempotent
-- replays, so the worker can measure actual fan-out without leaking source
-- identity in logs.
create function public.enqueue_finding_propagation_source_page_atomic(
  p_organization_id uuid,
  p_event_key text,
  p_graph_version integer,
  p_scope_kind text,
  p_source_product_id uuid,
  p_source_release_id uuid,
  p_source_baseline_revision_id uuid,
  p_as_of timestamptz,
  p_cursor uuid,
  p_page_size integer
) returns table(outcome text, source_count integer, next_cursor uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_current_graph integer;
  v_page_size integer := coalesce(p_page_size, 100);
  v_source_count integer := 0;
  v_next_cursor uuid;
begin
  if p_organization_id is null or p_source_product_id is null
     or p_graph_version is null
     or char_length(btrim(coalesce(p_event_key, ''))) not between 1 and 263
     or p_scope_kind not in ('product', 'release', 'baseline')
     or v_page_size not between 1 and 100
     or (p_scope_kind = 'product'
       and (p_source_release_id is not null or p_source_baseline_revision_id is not null))
     or (p_scope_kind = 'release'
       and (p_source_release_id is null or p_source_baseline_revision_id is not null))
     or (p_scope_kind = 'baseline'
       and (p_source_release_id is not null or p_source_baseline_revision_id is null)) then
    return query select 'invalid_request'::text, 0, null::uuid;
    return;
  end if;

  select product_relationship_graph_version into v_current_graph
    from public.organization_settings
   where organization_id = p_organization_id;
  if v_current_graph is null or v_current_graph <> p_graph_version then
    return query select 'obsolete'::text, 0, null::uuid;
    return;
  end if;

  with eligible as materialized (
    select s.id, s.organization_id, s.source_release_id,
      s.source_baseline_revision_id, s.rule_version, s.updated_by
      from public.finding_propagation_sources s
     where s.organization_id = p_organization_id
       and s.status = 'active'
       and s.source_product_id = p_source_product_id
       and (p_cursor is null or s.id > p_cursor)
       and (
         p_scope_kind = 'product'
         or (p_scope_kind = 'release' and s.source_release_id = p_source_release_id)
         or (p_scope_kind = 'baseline'
           and s.source_baseline_revision_id = p_source_baseline_revision_id)
       )
     order by s.id
     limit v_page_size + 1
  ), selected as materialized (
    select * from eligible order by id limit v_page_size
  ), inserted as (
    insert into public.finding_propagation_jobs(
      organization_id, source_finding_id, trigger_key, graph_version,
      source_release_id, source_baseline_revision_id, rule_version, as_of,
      requested_by
    )
    select s.organization_id, s.id, btrim(p_event_key) || ':' || s.id::text,
      p_graph_version, s.source_release_id, s.source_baseline_revision_id,
      s.rule_version, coalesce(p_as_of, clock_timestamp()), s.updated_by
      from selected s
    on conflict (organization_id, trigger_key) do nothing
    returning id
  )
  select
    (select count(*)::integer from selected),
    case when exists(select 1 from eligible offset v_page_size)
      then (select id from selected order by id desc limit 1)
      else null::uuid end
    into v_source_count, v_next_cursor;

  return query select 'enqueued_page'::text, v_source_count, v_next_cursor;
end;
$$;

-- Retire the previous set-based enqueue entrypoint. It could materialize every
-- matching source in one transaction and therefore is not a valid worker
-- boundary at NFR-009 scale. The page RPC above is the sole integration port.
drop function if exists public.enqueue_finding_propagation_jobs_atomic(
  uuid, text, integer, uuid, uuid, timestamptz
);
drop function if exists public.enqueue_finding_propagation_jobs_atomic(
  uuid, text, integer, uuid, uuid, uuid, timestamptz
);

-- Product-detail forms need discovery before history. This lists only current
-- baseline revisions; callers fetch a selected baseline's version history via
-- the existing history command. The UUID keyset remains stable while names
-- change and keeps the query bounded.
create index software_baselines_current_list_idx
  on public.software_baselines(organization_id, id)
  where is_current and archived_at is null;

create function public.list_software_baselines(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_query text,
  p_cursor uuid,
  p_page_size integer,
  p_include_archived boolean
) returns table(outcome text, baselines jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_page_size integer := coalesce(p_page_size, 25); v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if v_page_size not between 1 and 100 or char_length(v_query) > 128
     or p_include_archived is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query with paged as (
    select b.*
      from public.software_baselines b
     where b.organization_id = p_organization_id
       and b.is_current
       and (p_include_archived or b.archived_at is null)
       and (p_cursor is null or b.id > p_cursor)
       and (
         v_query = ''
         or lower(b.identifier) like '%' || v_query || '%'
         or lower(b.name) like '%' || v_query || '%'
       )
     order by b.id
     limit v_page_size + 1
  ), selected as (
    select * from paged order by id limit v_page_size
  ), next_row as (
    select id from paged offset v_page_size limit 1
  )
  select 'found'::text, jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.m2_software_baseline_json(s) order by s.id)
        from selected s
    ), '[]'::jsonb),
    'nextCursor', case when exists(select 1 from next_row)
      then (select id::text from selected order by id desc limit 1)
      else null end
  );
end;
$$;

-- Summary state uses source IDs as the ownership boundary. A job can match
-- many impact rows, so always count distinct jobs. A source directly detected
-- on the requested product is included even before its first impact page has
-- persisted, making progress observable without exposing finding contents.
create or replace function public.get_finding_product_impact_summary(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid,
  p_actor_user_id uuid
) returns table(outcome text, summary jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_active integer; v_superseded integer; v_closed integer; v_overrides integer;
  v_graph integer; v_evaluated timestamptz; v_queued integer; v_leased integer;
  v_retrying integer; v_dead integer; v_stale integer; v_state text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists(
       select 1 from public.products
        where organization_id = p_organization_id and id = p_product_id
     )
     or (p_release_id is not null and not exists(
       select 1 from public.product_releases
        where organization_id = p_organization_id
          and product_id = p_product_id and id = p_release_id
     )) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select count(*) filter(where status = 'active')::integer,
    count(*) filter(where status = 'superseded')::integer,
    count(*) filter(where status = 'closed')::integer,
    max(source_graph_version), max(last_evaluated_at)
    into v_active, v_superseded, v_closed, v_graph, v_evaluated
    from public.finding_impact_associations a
   where a.organization_id = p_organization_id
     and a.affected_product_id = p_product_id
     and (p_release_id is null or a.affected_release_id = p_release_id);
  select count(*)::integer into v_overrides
    from public.finding_product_impact_overrides o
   where o.organization_id = p_organization_id
     and o.affected_product_id = p_product_id
     and (p_release_id is null or o.affected_release_id = p_release_id)
     and o.ended_at is null;
  with relevant_sources as (
    select distinct a.source_finding_id
      from public.finding_impact_associations a
     where a.organization_id = p_organization_id
       and a.affected_product_id = p_product_id
       and (p_release_id is null or a.affected_release_id = p_release_id)
    union
    select s.id
      from public.finding_propagation_sources s
     where s.organization_id = p_organization_id
       and s.source_product_id = p_product_id
       and (p_release_id is null or s.source_release_id = p_release_id)
  )
  select count(distinct j.id) filter(where j.status = 'scheduled')::integer,
    count(distinct j.id) filter(where j.status = 'leased')::integer,
    count(distinct j.id) filter(where j.status = 'retrying')::integer,
    count(distinct j.id) filter(where j.status = 'dead_letter')::integer,
    count(distinct j.id) filter(
      where j.status = 'obsolete' and j.last_error_code = 'stale_graph'
    )::integer
    into v_queued, v_leased, v_retrying, v_dead, v_stale
    from public.finding_propagation_jobs j
    join relevant_sources s on s.source_finding_id = j.source_finding_id
   where j.organization_id = p_organization_id;
  v_state := case
    when coalesce(v_dead, 0) > 0 then 'partial_failure'
    when coalesce(v_queued, 0) + coalesce(v_leased, 0) + coalesce(v_retrying, 0) > 0 then 'in_progress'
    when coalesce(v_stale, 0) > 0 then 'stale'
    else 'idle'
  end;
  return query select 'found'::text, jsonb_build_object(
    'productId', p_product_id,
    'releaseId', p_release_id,
    'activeImpactCount', coalesce(v_active, 0),
    'supersededImpactCount', coalesce(v_superseded, 0),
    'closedImpactCount', coalesce(v_closed, 0),
    'overrideCount', coalesce(v_overrides, 0),
    'latestGraphVersion', v_graph,
    'latestEvaluatedAt', case when v_evaluated is null then null else public.m2_utc_z(v_evaluated) end,
    'propagationState', v_state,
    'queuedJobCount', coalesce(v_queued, 0),
    'inProgressJobCount', coalesce(v_leased, 0),
    'retryingJobCount', coalesce(v_retrying, 0),
    'deadLetterJobCount', coalesce(v_dead, 0)
  );
end;
$$;

alter function public.m2_sync_finding_impact_product_dependency() owner to postgres;
alter function public.m2_sync_finding_source_baseline_dependency() owner to postgres;
alter function public.m2_recalculate_retention_after_legal_fact_change() owner to postgres;
alter function public.archive_software_baseline_atomic(uuid, uuid, uuid, integer, text, uuid) owner to postgres;
alter function public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer) owner to postgres;
alter function public.describe_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer) owner to postgres;
alter function public.checkpoint_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean) owner to postgres;
alter function public.enqueue_finding_propagation_source_page_atomic(uuid, text, integer, text, uuid, uuid, uuid, timestamptz, uuid, integer) owner to postgres;
alter function public.list_software_baselines(uuid, uuid, text, uuid, integer, boolean) owner to postgres;
alter function public.get_finding_product_impact_summary(uuid, uuid, uuid, uuid) owner to postgres;

revoke all on function
  public.m2_sync_finding_impact_product_dependency(),
  public.m2_sync_finding_source_baseline_dependency(),
  public.m2_recalculate_retention_after_legal_fact_change(),
  public.archive_software_baseline_atomic(uuid, uuid, uuid, integer, text, uuid),
  public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer),
  public.describe_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer),
  public.checkpoint_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean),
  public.enqueue_finding_propagation_source_page_atomic(uuid, text, integer, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.list_software_baselines(uuid, uuid, text, uuid, integer, boolean),
  public.get_finding_product_impact_summary(uuid, uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.archive_software_baseline_atomic(uuid, uuid, uuid, integer, text, uuid),
  public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer),
  public.describe_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer),
  public.checkpoint_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean),
  public.enqueue_finding_propagation_source_page_atomic(uuid, text, integer, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.list_software_baselines(uuid, uuid, text, uuid, integer, boolean),
  public.get_finding_product_impact_summary(uuid, uuid, uuid, uuid)
to service_role;
