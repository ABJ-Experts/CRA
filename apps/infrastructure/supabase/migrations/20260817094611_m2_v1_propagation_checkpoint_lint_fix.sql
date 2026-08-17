-- Correct the only execution-time ambiguity found by the local SQL linter in
-- the preceding forward migration. No data or graph history is rewritten.
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
  select settings.product_relationship_graph_version into v_current_graph
    from public.organization_settings settings
   where settings.organization_id = p_organization_id;
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

alter function public.checkpoint_product_relationship_graph_event_atomic(
  uuid, uuid, uuid, integer, text, boolean
) owner to postgres;
revoke all on function public.checkpoint_product_relationship_graph_event_atomic(
  uuid, uuid, uuid, integer, text, boolean
) from public, anon, authenticated;
grant execute on function public.checkpoint_product_relationship_graph_event_atomic(
  uuid, uuid, uuid, integer, text, boolean
) to service_role;
