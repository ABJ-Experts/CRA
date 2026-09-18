-- Durable service-role leasing for the existing relationship graph outbox.
-- Relationship events retain their source payload in the outbox, but worker
-- responses and audit records intentionally contain operational metadata only.

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
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.product_regulatory_outbox_events%rowtype;
  v_previous_state text;
begin
  if p_organization_id is null
     or p_lease_owner is null
     or p_lease_seconds is null
     or p_lease_seconds not between 1 and 3600 then
    return query select
      'invalid_request'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::text,
      null::integer, null::uuid, null::integer, null::text;
    return;
  end if;

  -- Older graph events predate due_at and are immediately due. Never use an
  -- unqualified queue lookup: a service worker must name its organization.
  select * into v_event
    from public.product_regulatory_outbox_events queued_event
   where queued_event.organization_id = p_organization_id
     and queued_event.event_type = 'product_relationship.graph_changed'
     and (
       (
         queued_event.delivery_state in ('scheduled', 'retrying')
         and coalesce(queued_event.due_at, queued_event.occurred_at) <= clock_timestamp()
       )
       or (
         queued_event.delivery_state = 'leased'
         and queued_event.lease_expires_at <= clock_timestamp()
       )
     )
   order by coalesce(queued_event.due_at, queued_event.occurred_at), queued_event.id
   for update skip locked
   limit 1;
  if not found then
    return query select
      'none_available'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::text,
      null::integer, null::uuid, null::integer, null::text;
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

  insert into public.audit_logs(
    organization_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id,
    'product.relationship_graph_event_leased',
    'product_relationship_graph_event',
    v_event.id::text,
    jsonb_build_object(
      'fromState', v_previous_state,
      'toState', v_event.delivery_state,
      'checkpointVersion', v_event.checkpoint_version,
      'retryCount', v_event.delivery_attempts
    )
  );

  return query select
    'claimed'::text,
    v_event.id,
    v_event.organization_id,
    v_event.product_id,
    v_event.graph_version,
    v_event.event_key,
    v_event.checkpoint_version,
    v_event.lease_owner,
    v_event.delivery_attempts,
    null::text;
end;
$$;

create or replace function public.complete_product_relationship_graph_event_atomic(
  p_organization_id uuid,
  p_event_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
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
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.product_regulatory_outbox_events%rowtype;
  v_updated_event public.product_regulatory_outbox_events%rowtype;
begin
  if p_organization_id is null
     or p_event_id is null
     or p_lease_owner is null
     or p_expected_checkpoint_version is null
     or p_expected_checkpoint_version < 0 then
    return query select
      'invalid_request'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::text,
      null::integer, null::uuid, null::integer, null::text;
    return;
  end if;

  select * into v_event
    from public.product_regulatory_outbox_events queued_event
   where queued_event.organization_id = p_organization_id
     and queued_event.id = p_event_id
     and queued_event.event_type = 'product_relationship.graph_changed'
   for update;
  if not found then
    return query select
      'not_found'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::text,
      null::integer, null::uuid, null::integer, null::text;
    return;
  end if;

  -- A delivered event retains its checkpoint after the lease is cleared. This
  -- makes a retried acknowledgement with the same checkpoint harmless.
  if v_event.delivery_state = 'delivered' then
    if v_event.checkpoint_version = p_expected_checkpoint_version then
      return query select
        'delivered'::text,
        v_event.id,
        v_event.organization_id,
        v_event.product_id,
        v_event.graph_version,
        v_event.event_key,
        v_event.checkpoint_version,
        v_event.lease_owner,
        v_event.delivery_attempts,
        v_event.last_error_code;
      return;
    end if;
    return query select
      'conflict'::text,
      v_event.id,
      v_event.organization_id,
      v_event.product_id,
      v_event.graph_version,
      v_event.event_key,
      v_event.checkpoint_version,
      v_event.lease_owner,
      v_event.delivery_attempts,
      v_event.last_error_code;
    return;
  end if;

  if v_event.delivery_state <> 'leased'
     or v_event.lease_owner is distinct from p_lease_owner
     or v_event.checkpoint_version <> p_expected_checkpoint_version
     or v_event.lease_expires_at is null
     or v_event.lease_expires_at <= clock_timestamp() then
    return query select
      'conflict'::text,
      v_event.id,
      v_event.organization_id,
      v_event.product_id,
      v_event.graph_version,
      v_event.event_key,
      v_event.checkpoint_version,
      v_event.lease_owner,
      v_event.delivery_attempts,
      v_event.last_error_code;
    return;
  end if;

  update public.product_regulatory_outbox_events queued_event
     set delivery_state = 'delivered',
         delivered_at = clock_timestamp(),
         lease_owner = null,
         lease_expires_at = null,
         last_delivery_error = null,
         last_error_code = null
   where queued_event.organization_id = p_organization_id
     and queued_event.id = p_event_id
     and queued_event.event_type = 'product_relationship.graph_changed'
     and queued_event.delivery_state = 'leased'
     and queued_event.lease_owner = p_lease_owner
     and queued_event.checkpoint_version = p_expected_checkpoint_version
     and queued_event.lease_expires_at > clock_timestamp()
  returning * into v_updated_event;
  if not found then
    return query select
      'conflict'::text,
      v_event.id,
      v_event.organization_id,
      v_event.product_id,
      v_event.graph_version,
      v_event.event_key,
      v_event.checkpoint_version,
      v_event.lease_owner,
      v_event.delivery_attempts,
      v_event.last_error_code;
    return;
  end if;
  v_event := v_updated_event;

  insert into public.audit_logs(
    organization_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id,
    'product.relationship_graph_event_delivered',
    'product_relationship_graph_event',
    v_event.id::text,
    jsonb_build_object(
      'fromState', 'leased',
      'toState', v_event.delivery_state,
      'checkpointVersion', v_event.checkpoint_version,
      'retryCount', v_event.delivery_attempts
    )
  );

  return query select
    'completed'::text,
    v_event.id,
    v_event.organization_id,
    v_event.product_id,
    v_event.graph_version,
    v_event.event_key,
    v_event.checkpoint_version,
    v_event.lease_owner,
    v_event.delivery_attempts,
    null::text;
end;
$$;

create or replace function public.fail_product_relationship_graph_event_atomic(
  p_organization_id uuid,
  p_event_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer,
  p_error_code text,
  p_retryable boolean
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
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.product_regulatory_outbox_events%rowtype;
  v_updated_event public.product_regulatory_outbox_events%rowtype;
  v_next_state text;
  v_next_due_at timestamptz;
  v_sanitized_error_code text;
begin
  v_sanitized_error_code := lower(btrim(p_error_code));
  if p_organization_id is null
     or p_event_id is null
     or p_lease_owner is null
     or p_expected_checkpoint_version is null
     or p_expected_checkpoint_version < 0
     or p_retryable is null
     or v_sanitized_error_code is null
     or char_length(v_sanitized_error_code) not between 1 and 100
     or v_sanitized_error_code !~ '^[a-z0-9][a-z0-9_.:-]*$' then
    return query select
      'invalid_request'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::text,
      null::integer, null::uuid, null::integer, null::text;
    return;
  end if;

  select * into v_event
    from public.product_regulatory_outbox_events queued_event
   where queued_event.organization_id = p_organization_id
     and queued_event.id = p_event_id
     and queued_event.event_type = 'product_relationship.graph_changed'
   for update;
  if not found then
    return query select
      'not_found'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::text,
      null::integer, null::uuid, null::integer, null::text;
    return;
  end if;

  if v_event.delivery_state <> 'leased'
     or v_event.lease_owner is distinct from p_lease_owner
     or v_event.checkpoint_version <> p_expected_checkpoint_version
     or v_event.lease_expires_at is null
     or v_event.lease_expires_at <= clock_timestamp() then
    return query select
      'conflict'::text,
      v_event.id,
      v_event.organization_id,
      v_event.product_id,
      v_event.graph_version,
      v_event.event_key,
      v_event.checkpoint_version,
      v_event.lease_owner,
      v_event.delivery_attempts,
      v_event.last_error_code;
    return;
  end if;

  v_next_state := case
    when not p_retryable or v_event.delivery_attempts >= 12 then 'dead_letter'
    else 'retrying'
  end;
  v_next_due_at := case
    when v_next_state = 'dead_letter' then v_event.due_at
    else clock_timestamp() + make_interval(
      secs => least(3600, greatest(30, 30 * power(2, least(v_event.delivery_attempts, 7))::integer))
    )
  end;

  update public.product_regulatory_outbox_events queued_event
     set delivery_state = v_next_state,
         due_at = v_next_due_at,
         lease_owner = null,
         lease_expires_at = null,
         last_delivery_error = null,
         last_error_code = v_sanitized_error_code
   where queued_event.organization_id = p_organization_id
     and queued_event.id = p_event_id
     and queued_event.event_type = 'product_relationship.graph_changed'
     and queued_event.delivery_state = 'leased'
     and queued_event.lease_owner = p_lease_owner
     and queued_event.checkpoint_version = p_expected_checkpoint_version
     and queued_event.lease_expires_at > clock_timestamp()
  returning * into v_updated_event;
  if not found then
    return query select
      'conflict'::text,
      v_event.id,
      v_event.organization_id,
      v_event.product_id,
      v_event.graph_version,
      v_event.event_key,
      v_event.checkpoint_version,
      v_event.lease_owner,
      v_event.delivery_attempts,
      v_event.last_error_code;
    return;
  end if;
  v_event := v_updated_event;

  insert into public.audit_logs(
    organization_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id,
    case when v_next_state = 'dead_letter'
      then 'product.relationship_graph_event_dead_lettered'
      else 'product.relationship_graph_event_retry_scheduled'
    end,
    'product_relationship_graph_event',
    v_event.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'fromState', 'leased',
      'toState', v_event.delivery_state,
      'checkpointVersion', v_event.checkpoint_version,
      'retryCount', v_event.delivery_attempts,
      'errorCode', v_event.last_error_code,
      'nextDueAt', case when v_next_due_at is null then null else public.m2_utc_z(v_next_due_at) end
    ))
  );

  return query select
    case when v_next_state = 'dead_letter' then 'dead_letter'::text else 'retry_scheduled'::text end,
    v_event.id,
    v_event.organization_id,
    v_event.product_id,
    v_event.graph_version,
    v_event.event_key,
    v_event.checkpoint_version,
    v_event.lease_owner,
    v_event.delivery_attempts,
    v_event.last_error_code;
end;
$$;

alter function public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer) owner to postgres;
alter function public.complete_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer) owner to postgres;
alter function public.fail_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean) owner to postgres;

revoke all on function
  public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer),
  public.complete_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer),
  public.fail_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.claim_product_relationship_graph_event_atomic(uuid, uuid, integer),
  public.complete_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer),
  public.fail_product_relationship_graph_event_atomic(uuid, uuid, uuid, integer, text, boolean)
to service_role;
