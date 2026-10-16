-- CRA-M11-05: webhook binding resolver and Jira issue-property correlation checks.

create or replace function public.resolve_vulnerability_remediation_ticket_webhook_binding(
  p_binding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
begin
  if p_binding_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  select b.* into v_binding
  from public.vulnerability_remediation_ticket_bindings b
  join public.connectors c on c.organization_id = b.organization_id and c.id = b.connector_id
  join public.connector_secrets s on s.organization_id = c.organization_id
    and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
  where b.id = p_binding_id
    and b.provider = 'jira'
    and b.status = 'active'
    and c.connector_type = 'jira'
    and c.enabled
    and c.archived_at is null
    and c.connection_config->>'providerHost' = 'api.atlassian.com'
    and c.connection_config->>'cloudId' = b.provider_cloud_id
    and c.connection_config->>'siteHost' = b.site_host
  limit 1;

  if not found then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  return query select 'found'::text, jsonb_build_object(
    'organizationId', v_binding.organization_id,
    'connectorId', v_binding.connector_id,
    'bindingId', v_binding.id,
    'cloudId', v_binding.provider_cloud_id
  );
end;
$$;


create or replace function public.resolve_vulnerability_remediation_ticket_webhook_ticket(
  p_organization_id uuid,
  p_binding_id uuid,
  p_external_issue_id text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket public.vulnerability_remediation_tickets%rowtype;
begin
  if p_organization_id is null or p_binding_id is null
    or char_length(btrim(coalesce(p_external_issue_id,''))) not between 1 and 200 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  select t.* into v_ticket
  from public.vulnerability_remediation_tickets t
  join public.vulnerability_remediation_ticket_bindings b
    on b.organization_id = t.organization_id and b.id = t.binding_id
  where t.organization_id = p_organization_id
    and t.binding_id = p_binding_id
    and t.external_issue_id = btrim(p_external_issue_id)
    and t.provider = 'jira'
    and b.provider = 'jira'
    and b.status = 'active'
  limit 1;

  if not found then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  return query select 'found'::text, jsonb_build_object(
    'organizationId', v_ticket.organization_id,
    'bindingId', v_ticket.binding_id,
    'ticketId', v_ticket.id,
    'correlationId', v_ticket.correlation_id
  );
end;
$$;

create or replace function public.record_verified_vulnerability_ticket_event_atomic(
  p_organization_id uuid,
  p_binding_id uuid,
  p_ticket_id uuid,
  p_delivery_id text,
  p_external_issue_id text,
  p_external_issue_key text,
  p_external_status_id text,
  p_external_status_name text,
  p_provider_project_id text,
  p_provider_updated_at timestamptz,
  p_correlation_id uuid
) returns table(outcome text, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.vulnerability_remediation_ticket_events%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_status text;
  v_outcome text;
  v_now timestamptz := clock_timestamp();
begin
  if p_ticket_id is null
    or char_length(btrim(coalesce(p_delivery_id,''))) not between 1 and 300
    or char_length(btrim(coalesce(p_external_issue_id,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_issue_key,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_status_id,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_external_status_name,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_provider_project_id,''))) not between 1 and 120
    or p_provider_updated_at is null
    or p_correlation_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_existing from public.vulnerability_remediation_ticket_events
  where provider = 'jira' and delivery_id = btrim(p_delivery_id);
  if found then
    return query select 'duplicate'::text,
      case when v_existing.organization_id <> p_organization_id or v_existing.binding_id <> p_binding_id or v_existing.ticket_id <> p_ticket_id then null::jsonb
        when v_existing.ticket_id is null then null::jsonb
        else public.m11_05_ticket_json(v_existing.organization_id, v_existing.ticket_id) end;
    return;
  end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = p_binding_id and provider = 'jira'
    and status = 'active' and project_id = btrim(p_provider_project_id)
  for share;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = p_ticket_id and binding_id = p_binding_id
    and provider = 'jira'
    and external_issue_id = btrim(p_external_issue_id)
    and external_issue_key = btrim(p_external_issue_key)
  for update;
  if not found then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, 'unbound'
    );
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_ticket.correlation_id <> p_correlation_id then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, 'unbound'
    );
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_ticket.last_provider_event_at is not null and p_provider_updated_at < v_ticket.last_provider_event_at then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, 'stale'
    );
    return query select 'stale'::text, public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;
  v_status := public.m11_05_ticket_status(p_organization_id, p_binding_id, p_external_status_id, p_external_status_name);
  v_outcome := case when v_status = 'conflict' then 'unknown_status' else 'processed' end;
  if v_ticket.external_status_id = btrim(p_external_status_id)
    and v_ticket.external_status_name = btrim(p_external_status_name)
    and v_ticket.status = v_status
    and v_ticket.last_provider_event_at is not null
    and p_provider_updated_at <= v_ticket.last_provider_event_at then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      btrim(p_provider_project_id), p_provider_updated_at, v_outcome
    );
    return query select case when v_outcome = 'unknown_status' then 'unknown_status' else 'recorded' end,
      public.m11_05_ticket_json(p_organization_id, v_ticket.id);
    return;
  end if;
  update public.vulnerability_remediation_tickets
  set external_status_id = btrim(p_external_status_id),
    external_status_name = btrim(p_external_status_name),
    provider_project_id = btrim(p_provider_project_id),
    status = v_status,
    last_sync_direction = 'inbound',
    last_sync_at = v_now,
    last_provider_event_at = p_provider_updated_at,
    last_inbound_delivery_id = btrim(p_delivery_id),
    conflict_reason = case when v_status = 'conflict' then 'unknown_external_status' else null end,
    sync_revision = sync_revision + 1,
    version = version + 1,
    updated_at = v_now
  where organization_id = p_organization_id and id = v_ticket.id
  returning * into v_ticket;
  insert into public.vulnerability_remediation_ticket_events(
    organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
    external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
  ) values (
    p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
    btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
    btrim(p_provider_project_id), p_provider_updated_at, v_outcome
  );
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.remediation_ticket_event_recorded',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('deliveryId', p_delivery_id, 'externalStatusId', p_external_status_id,
      'externalStatusName', p_external_status_name, 'mappedStatus', v_status));
  return query select case when v_outcome = 'unknown_status' then 'unknown_status' else 'recorded' end,
    public.m11_05_ticket_json(p_organization_id, v_ticket.id);
end;
$$;



alter table public.vulnerability_remediation_ticket_operations
  add column if not exists lease_owner uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists next_attempt_at timestamptz not null default clock_timestamp(),
  add column if not exists last_error text check (last_error is null or char_length(btrim(last_error)) between 1 and 1000),
  add column if not exists connector_connection_revision integer,
  add column if not exists connector_credential_revision integer;

alter table public.vulnerability_remediation_ticket_operations
  drop constraint if exists vulnerability_remediation_ticket_operations_state_check,
  add constraint vulnerability_remediation_ticket_operations_state_check check (state in ('reserved','completed','conflict','failed'));

alter table public.vulnerability_remediation_ticket_operations
  drop constraint if exists vulnerability_remediation_ticket_operations_operation_check,
  add constraint vulnerability_remediation_ticket_operations_operation_check check (
    operation in ('reserve_outbound','finalize_outbound','reserve_transition','sync_context')
  );

create or replace function public.reserve_vulnerability_remediation_ticket_transition_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid,
  p_ticket_id uuid,
  p_expected_version integer,
  p_target_status_id text,
  p_idempotency_key uuid
) returns table(outcome text, ticket_id uuid, operation_id uuid, correlation_id uuid, transition_id text, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_product_id uuid;
  v_transition_id text;
  v_digest text;
  v_now timestamptz := clock_timestamp();
begin
  if p_ticket_id is null or p_finding_id is null or p_idempotency_key is null
    or p_expected_version is null or p_expected_version < 1
    or char_length(btrim(coalesce(p_target_status_id,''))) not between 1 and 120 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid, null::text, null::jsonb; return;
  end if;
  if not public.m5_triage_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::uuid, null::text, null::jsonb; return;
  end if;

  select r.product_id into v_product_id
  from public.vulnerability_findings f
  join public.product_releases r on r.organization_id = f.organization_id and r.id = f.release_id
  where f.organization_id = p_organization_id and f.id = p_finding_id and f.status = 'active'
  for share;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::text, null::jsonb; return;
  end if;

  select * into v_ticket
  from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = p_ticket_id and finding_id = p_finding_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::text, null::jsonb; return;
  end if;

  select * into v_binding
  from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = v_ticket.binding_id and status = 'active'
    and product_id = v_product_id and provider = 'jira'
  for share;
  if not found
    or v_ticket.external_issue_id is null
    or v_ticket.external_issue_key is null
    or v_ticket.provider_project_id <> v_binding.project_id
    or not exists(select 1 from public.connectors c join public.connector_secrets s
      on s.organization_id = c.organization_id and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
      where c.organization_id = p_organization_id and c.id = v_binding.connector_id
        and c.connector_type = 'jira' and c.enabled and c.archived_at is null
        and c.connection_config->>'providerHost' = 'api.atlassian.com'
        and c.connection_config->>'cloudId' = v_binding.provider_cloud_id
        and c.connection_config->>'siteHost' = v_binding.site_host) then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::text, null::jsonb; return;
  end if;

  if v_ticket.version <> p_expected_version then
    return query select 'conflict'::text, v_ticket.id, null::uuid, null::uuid, null::text,
      public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;

  select * into v_operation
  from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_operation.operation <> 'reserve_transition' or v_operation.ticket_id <> p_ticket_id
      or v_operation.result->>'targetStatusId' <> btrim(p_target_status_id) then
      return query select 'idempotency_mismatch'::text, p_ticket_id, v_operation.id, v_operation.correlation_id, null::text, null::jsonb; return;
    end if;
    return query select 'replayed'::text, v_operation.ticket_id, v_operation.id, v_operation.correlation_id,
      v_operation.result->>'transitionId', public.m11_05_ticket_json(p_organization_id, v_operation.ticket_id);
    return;
  end if;

  select transition.value->>'transitionId' into v_transition_id
  from jsonb_array_elements(v_binding.status_transitions) transition(value)
  where transition.value->>'fromStatusId' = coalesce(v_ticket.external_status_id,'')
    and transition.value->>'toStatusId' = btrim(p_target_status_id)
  limit 1;
  if v_transition_id is null then
    return query select 'conflict'::text, v_ticket.id, null::uuid, null::uuid, null::text,
      public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;

  v_digest := encode(extensions.digest(jsonb_build_object(
    'operation','reserve_transition',
    'ticketId', p_ticket_id,
    'findingId', p_finding_id,
    'expectedVersion', p_expected_version,
    'targetStatusId', btrim(p_target_status_id),
    'transitionId', v_transition_id,
    'correlationId', v_ticket.correlation_id
  )::text, 'sha256'), 'hex');

  insert into public.vulnerability_remediation_ticket_operations(
    organization_id, actor_user_id, ticket_id, binding_id, finding_id, operation,
    idempotency_key, context_digest, state, result, correlation_id,
    connector_connection_revision, connector_credential_revision
  ) values (
    p_organization_id, p_actor_user_id, v_ticket.id, v_ticket.binding_id, p_finding_id, 'reserve_transition',
    p_idempotency_key, v_digest, 'reserved',
    jsonb_build_object('ticket', public.m11_05_ticket_json(p_organization_id, v_ticket.id),
      'targetStatusId', btrim(p_target_status_id), 'transitionId', v_transition_id),
    v_ticket.correlation_id,
    (select c.connection_revision from public.connectors c where c.organization_id = p_organization_id and c.id = v_binding.connector_id),
    (select c.credential_revision from public.connectors c where c.organization_id = p_organization_id and c.id = v_binding.connector_id)
  ) returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.remediation_ticket_transition_reserved',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('operationId', v_operation.id, 'targetStatusId', btrim(p_target_status_id),
      'transitionId', v_transition_id, 'idempotencyKey', p_idempotency_key));

  return query select 'reserved'::text, v_ticket.id, v_operation.id, v_operation.correlation_id,
    v_transition_id, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
exception when unique_violation then
  return query select 'conflict'::text, null::uuid, null::uuid, null::uuid, null::text, null::jsonb;
end;
$$;

revoke all on function public.resolve_vulnerability_remediation_ticket_webhook_binding(uuid),
  public.resolve_vulnerability_remediation_ticket_webhook_ticket(uuid,uuid,text),
  public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid),
  public.reserve_vulnerability_remediation_ticket_transition_atomic(uuid,uuid,uuid,uuid,integer,text,uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_vulnerability_remediation_ticket_webhook_binding(uuid),
  public.resolve_vulnerability_remediation_ticket_webhook_ticket(uuid,uuid,text),
  public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid),
  public.reserve_vulnerability_remediation_ticket_transition_atomic(uuid,uuid,uuid,uuid,integer,text,uuid)
  to service_role;
revoke all on function public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,text,text,text,text,text,text,timestamp with time zone)
  from public, anon, authenticated, service_role;


create or replace function public.m11_05_remediation_ticket_operation_json(
  p_operation_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'operationId', o.id,
    'organizationId', o.organization_id,
    'operation', o.operation,
    'ticketId', o.ticket_id,
    'bindingId', o.binding_id,
    'findingId', o.finding_id,
    'correlationId', o.correlation_id,
    'state', o.state,
    'attemptCount', o.attempt_count,
    'leaseOwner', o.lease_owner,
    'leaseExpiresAt', case when o.lease_expires_at is null then null else public.m2_utc_z(o.lease_expires_at) end,
    'result', o.result,
    'connectorConnectionRevision', o.connector_connection_revision,
    'connectorCredentialRevision', o.connector_credential_revision
  )
  from public.vulnerability_remediation_ticket_operations o
  where o.id = p_operation_id
$$;

create or replace function public.list_due_vulnerability_remediation_ticket_operation_orgs(
  p_limit integer
) returns table(organization_id uuid, due_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.organization_id, count(*)::bigint
  from public.vulnerability_remediation_ticket_operations o
  join public.vulnerability_remediation_ticket_bindings b on b.organization_id = o.organization_id and b.id = o.binding_id
  join public.connectors c on c.organization_id = b.organization_id and c.id = b.connector_id
  join public.connector_secrets s on s.organization_id = c.organization_id and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
  where o.state = 'reserved'
    and o.next_attempt_at <= clock_timestamp()
    and (o.lease_expires_at is null or o.lease_expires_at <= clock_timestamp())
    and b.status = 'active'
    and c.enabled and c.archived_at is null
    and c.connector_type = 'jira'
    and (o.connector_connection_revision is null or o.connector_connection_revision = c.connection_revision)
    and (o.connector_credential_revision is null or o.connector_credential_revision = c.credential_revision)
  group by o.organization_id
  order by min(o.next_attempt_at), o.organization_id
  limit greatest(1, least(coalesce(p_limit, 10), 100))
$$;

create or replace function public.claim_vulnerability_remediation_ticket_operation_atomic(
  p_organization_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation public.vulnerability_remediation_ticket_operations%rowtype; v_lease_seconds integer;
begin
  if p_organization_id is null or p_worker_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  v_lease_seconds := greatest(30, least(coalesce(p_lease_seconds, 300), 1800));
  select o.* into v_operation
  from public.vulnerability_remediation_ticket_operations o
  join public.vulnerability_remediation_ticket_bindings b on b.organization_id = o.organization_id and b.id = o.binding_id
  join public.connectors c on c.organization_id = b.organization_id and c.id = b.connector_id
  join public.connector_secrets s on s.organization_id = c.organization_id and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
  where o.organization_id = p_organization_id
    and o.state = 'reserved'
    and o.next_attempt_at <= clock_timestamp()
    and (o.lease_expires_at is null or o.lease_expires_at <= clock_timestamp())
    and b.status = 'active'
    and c.enabled and c.archived_at is null and c.connector_type = 'jira'
    and (o.connector_connection_revision is null or o.connector_connection_revision = c.connection_revision)
    and (o.connector_credential_revision is null or o.connector_credential_revision = c.credential_revision)
  order by o.next_attempt_at, o.created_at, o.id
  for update of o skip locked
  limit 1;
  if not found then return query select 'empty'::text, null::jsonb; return; end if;
  update public.vulnerability_remediation_ticket_operations
  set lease_owner = p_worker_id, lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
    attempt_count = attempt_count + 1, last_error = null
  where organization_id = p_organization_id and id = v_operation.id
  returning * into v_operation;
  return query select 'claimed'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id);
end;
$$;

create or replace function public.complete_vulnerability_remediation_ticket_operation_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_worker_id uuid,
  p_result jsonb
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation public.vulnerability_remediation_ticket_operations%rowtype;
begin
  if p_organization_id is null or p_operation_id is null or p_worker_id is null
    or jsonb_typeof(coalesce(p_result,'{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_result,'{}'::jsonb)::text) > 20000 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and id = p_operation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_operation.state = 'completed' then return query select 'replayed'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return; end if;
  if v_operation.state <> 'reserved' or v_operation.lease_owner is distinct from p_worker_id or v_operation.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  update public.vulnerability_remediation_ticket_operations
  set state = 'completed', completed_at = clock_timestamp(), lease_owner = null, lease_expires_at = null,
    result = coalesce(result,'{}'::jsonb) || p_result
  where organization_id = p_organization_id and id = p_operation_id
  returning * into v_operation;
  return query select 'completed'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id);
end;
$$;

create or replace function public.fail_vulnerability_remediation_ticket_operation_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_worker_id uuid,
  p_retryable boolean,
  p_error text
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation public.vulnerability_remediation_ticket_operations%rowtype; v_retry boolean;
begin
  if p_organization_id is null or p_operation_id is null or p_worker_id is null
    or char_length(btrim(coalesce(p_error,''))) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and id = p_operation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_operation.state <> 'reserved' or v_operation.lease_owner is distinct from p_worker_id then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  v_retry := coalesce(p_retryable,false) and v_operation.attempt_count < 5;
  update public.vulnerability_remediation_ticket_operations
  set state = case when v_retry then 'reserved' else 'failed' end,
    lease_owner = null, lease_expires_at = null,
    next_attempt_at = case when v_retry then clock_timestamp() + make_interval(secs => (30 * (2 ^ greatest(attempt_count - 1,0)))::integer) else next_attempt_at end,
    last_error = btrim(p_error),
    completed_at = case when v_retry then completed_at else clock_timestamp() end
  where organization_id = p_organization_id and id = p_operation_id
  returning * into v_operation;
  return query select case when v_retry then 'retry_scheduled' else 'failed' end, public.m11_05_remediation_ticket_operation_json(v_operation.id);
end;
$$;

create or replace function public.enqueue_vulnerability_remediation_ticket_context_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket public.vulnerability_remediation_tickets%rowtype; v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
begin
  if tg_op <> 'INSERT' or not new.is_current then return new; end if;
  select t.* into v_ticket
  from public.vulnerability_remediation_tickets t
  where t.organization_id = new.organization_id and t.finding_id = new.finding_id
    and t.external_issue_id is not null and t.status in ('linked','external_closed_pending_review','conflict')
  order by t.updated_at desc limit 1;
  if not found then return new; end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = v_ticket.organization_id and id = v_ticket.binding_id and status = 'active';
  if not found then return new; end if;
  insert into public.vulnerability_remediation_ticket_operations(
    organization_id, actor_user_id, ticket_id, binding_id, finding_id, operation,
    idempotency_key, context_digest, state, result, correlation_id,
    connector_connection_revision, connector_credential_revision
  ) values (
    new.organization_id, new.recorded_by, v_ticket.id, v_ticket.binding_id, new.finding_id, 'sync_context',
    gen_random_uuid(), encode(extensions.digest(jsonb_build_object('operation','sync_context','anchorId',new.id,'ticketId',v_ticket.id)::text,'sha256'),'hex'),
    'reserved', jsonb_build_object('reason','remediation_anchor_current','anchorId',new.id), v_ticket.correlation_id,
    (select c.connection_revision from public.connectors c where c.organization_id = new.organization_id and c.id = v_binding.connector_id),
    (select c.credential_revision from public.connectors c where c.organization_id = new.organization_id and c.id = v_binding.connector_id)
  ) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists enqueue_vulnerability_remediation_ticket_context_sync on public.vulnerability_finding_remediation_anchors;
create trigger enqueue_vulnerability_remediation_ticket_context_sync
  after insert on public.vulnerability_finding_remediation_anchors
  for each row execute function public.enqueue_vulnerability_remediation_ticket_context_sync();

revoke all on function public.m11_05_remediation_ticket_operation_json(uuid),
  public.list_due_vulnerability_remediation_ticket_operation_orgs(integer),
  public.claim_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,integer),
  public.complete_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,jsonb),
  public.fail_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,boolean,text),
  public.enqueue_vulnerability_remediation_ticket_context_sync()
  from public, anon, authenticated;
grant execute on function public.list_due_vulnerability_remediation_ticket_operation_orgs(integer),
  public.claim_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,integer),
  public.complete_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,jsonb),
  public.fail_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,boolean,text)
  to service_role;
