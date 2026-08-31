-- Complete the bounded inverse fan-out boundary. A baseline is shared by
-- several products, so a baseline-scoped source page is tenant + revision
-- scoped; product/release scopes remain product scoped.
create or replace function public.enqueue_finding_propagation_source_page_atomic(
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
  select settings.product_relationship_graph_version into v_current_graph
    from public.organization_settings settings
   where settings.organization_id = p_organization_id;
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
       and (p_cursor is null or s.id > p_cursor)
       and (
         (p_scope_kind = 'product' and s.source_product_id = p_source_product_id)
         or (p_scope_kind = 'release'
           and s.source_product_id = p_source_product_id
           and s.source_release_id = p_source_release_id)
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

-- Final acknowledgement can be retried after the worker loses its response:
-- once delivered, it is a terminal idempotent acknowledgement regardless of
-- the caller's older lease checkpoint. Non-final checkpoint conflicts remain
-- strict so a stale worker cannot move a continuation backwards.
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
  select * into v_event from public.product_regulatory_outbox_events event_row
   where event_row.organization_id = p_organization_id
     and event_row.id = p_event_id
     and event_row.event_type = 'product_relationship.graph_changed'
   for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid,
      null::uuid, null::integer, null::text, null::integer, null::uuid,
      null::integer, null::text, null::text;
    return;
  end if;
  if v_event.delivery_state = 'delivered' and p_is_final then
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
  select settings.product_relationship_graph_version into v_current_graph
    from public.organization_settings settings
   where settings.organization_id = p_organization_id;
  if v_current_graph is null or v_event.graph_version <> v_current_graph then
    update public.product_regulatory_outbox_events event_row
       set delivery_state = 'obsolete', obsolete_at = clock_timestamp(),
           lease_owner = null, lease_expires_at = null, delivery_cursor = null,
           last_delivery_error = null, last_error_code = 'stale_graph',
           checkpoint_version = event_row.checkpoint_version + 1
     where event_row.organization_id = p_organization_id and event_row.id = v_event.id
    returning * into v_event;
    return query select 'obsolete'::text, v_event.id, v_event.organization_id,
      v_event.product_id, v_event.graph_version, v_event.event_key,
      v_event.checkpoint_version, v_event.lease_owner, v_event.delivery_attempts,
      v_event.last_error_code, v_event.delivery_cursor;
    return;
  end if;
  update public.product_regulatory_outbox_events event_row
     set delivery_state = case when p_is_final then 'delivered' else 'scheduled' end,
         delivered_at = case when p_is_final then clock_timestamp() else null end,
         due_at = case when p_is_final then event_row.due_at else clock_timestamp() end,
         lease_owner = null,
         lease_expires_at = null,
         delivery_cursor = case when p_is_final then null else p_delivery_cursor end,
         last_delivery_error = null,
         last_error_code = null,
         checkpoint_version = event_row.checkpoint_version + 1
   where event_row.organization_id = p_organization_id and event_row.id = v_event.id
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

-- History must expose terminal stale work so operators can distinguish it from
-- a transient queue delay, without returning graph payload or finding data.
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
    'obsoleteAt', case when p_event.obsolete_at is null then null else public.m2_utc_z(p_event.obsolete_at) end,
    'lastErrorCode', p_event.last_error_code,
    'retryCount', p_event.delivery_attempts
  )
$$;

create or replace function public.get_product_relationship_propagation_events(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid,
  p_cursor text, p_page_size integer, p_delivery_state text
) returns table(outcome text, events jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_page_size integer := coalesce(p_page_size, 25);
begin
  if v_page_size not between 1 and 100
     or (p_delivery_state is not null and p_delivery_state not in (
       'scheduled', 'retrying', 'leased', 'delivered', 'dead_letter', 'obsolete'
     )) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists(
       select 1 from public.products product_row
        where product_row.organization_id = p_organization_id
          and product_row.id = p_product_id
     ) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query with paged as (
    select event_row.*
      from public.product_regulatory_outbox_events event_row
     where event_row.organization_id = p_organization_id
       and event_row.product_id = p_product_id
       and event_row.event_type = 'product_relationship.graph_changed'
       and (p_delivery_state is null or event_row.delivery_state = p_delivery_state)
       and (p_cursor is null or event_row.id::text > p_cursor)
     order by event_row.id
     limit v_page_size + 1
  ), selected as (
    select * from paged order by id limit v_page_size
  ), next_row as (
    select id from paged offset v_page_size limit 1
  )
  select 'found'::text, jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(public.m2_relationship_outbox_event_json(event_row) order by event_row.id)
        from selected event_row
    ), '[]'::jsonb),
    'nextCursor', (select id::text from next_row)
  );
end;
$$;

alter function public.enqueue_finding_propagation_source_page_atomic(uuid, text, integer, text, uuid, uuid, uuid, timestamptz, uuid, integer) owner to postgres;
alter function public.checkpoint_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean) owner to postgres;
alter function public.m2_relationship_outbox_event_json(public.product_regulatory_outbox_events) owner to postgres;
alter function public.get_product_relationship_propagation_events(uuid, uuid, uuid, text, integer, text) owner to postgres;

revoke all on function
  public.enqueue_finding_propagation_source_page_atomic(uuid, text, integer, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.checkpoint_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean),
  public.m2_relationship_outbox_event_json(public.product_regulatory_outbox_events),
  public.get_product_relationship_propagation_events(uuid, uuid, uuid, text, integer, text)
from public, anon, authenticated;
grant execute on function
  public.enqueue_finding_propagation_source_page_atomic(uuid, text, integer, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.checkpoint_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean),
  public.get_product_relationship_propagation_events(uuid, uuid, uuid, text, integer, text)
to service_role;
