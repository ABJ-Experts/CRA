-- CRA-M11-05: only active unresolved create operations block owner-authorized unlinked ticket retry.

create or replace function public.reserve_vulnerability_remediation_ticket_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid,
  p_binding_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_context_digest text
) returns table(outcome text, ticket_id uuid, operation_id uuid, correlation_id uuid, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_product_id uuid;
  v_now timestamptz := clock_timestamp();
  v_operation_kind text;
begin
  if p_idempotency_key is null or p_context_digest !~ '^[a-f0-9]{64}$'
    or p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
  end if;
  if not public.m5_triage_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
  end if;
  select r.product_id into v_product_id
  from public.vulnerability_findings f
  join public.product_releases r on r.organization_id = f.organization_id and r.id = f.release_id
  where f.organization_id = p_organization_id and f.id = p_finding_id and f.status = 'active'
  for share;
  if not found then return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return; end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = p_binding_id and status = 'active' and product_id = v_product_id
  for share;
  if not found
    or not exists(select 1 from public.connectors c join public.connector_secrets s
      on s.organization_id = c.organization_id and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
      where c.organization_id = p_organization_id and c.id = v_binding.connector_id
        and c.connector_type = 'jira' and c.enabled and c.archived_at is null
        and c.connection_config->>'providerHost' = 'api.atlassian.com'
        and c.connection_config->>'cloudId' = v_binding.provider_cloud_id
        and c.connection_config->>'siteHost' = v_binding.site_host) then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
  end if;

  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_operation.context_digest <> p_context_digest then
      return query select 'idempotency_mismatch'::text, null::uuid, v_operation.id, v_operation.correlation_id, null::jsonb; return;
    end if;
    return query select case when v_operation.operation = 'sync_context' then 'sync_replayed' else 'replayed' end,
      v_operation.ticket_id, v_operation.id, v_operation.correlation_id,
      case when v_operation.ticket_id is null then null else public.m11_05_ticket_json(p_organization_id, v_operation.ticket_id) end;
    return;
  end if;

  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and binding_id = p_binding_id and finding_id = p_finding_id
  for update;
  if found then
    if v_ticket.version <> p_expected_version then
      return query select 'conflict'::text, v_ticket.id, null::uuid, null::uuid, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
      return;
    end if;
    if v_ticket.external_issue_id is null then
      if exists (select 1 from public.vulnerability_remediation_ticket_operations pending
        where pending.organization_id = p_organization_id
          and pending.ticket_id = v_ticket.id
          and pending.operation = 'reserve_outbound'
          and pending.state = 'reserved') then
        return query select 'conflict'::text, v_ticket.id, null::uuid, null::uuid, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
        return;
      end if;
      v_operation_kind := 'reserve_outbound';
      update public.vulnerability_remediation_tickets
      set status = 'sync_pending', last_sync_direction = 'outbound', last_sync_at = v_now,
        sync_revision = sync_revision + 1, version = version + 1, conflict_reason = null,
        updated_at = v_now
      where organization_id = p_organization_id and id = v_ticket.id
      returning * into v_ticket;
    else
      v_operation_kind := 'sync_context';
      update public.vulnerability_remediation_tickets
      set last_sync_direction = 'outbound', last_sync_at = v_now,
        sync_revision = sync_revision + 1, version = version + 1, conflict_reason = null,
        updated_at = v_now
      where organization_id = p_organization_id and id = v_ticket.id
      returning * into v_ticket;
    end if;
  else
    if p_expected_version <> 0 then
      return query select 'conflict'::text, null::uuid, null::uuid, null::uuid, null::jsonb; return;
    end if;
    v_operation_kind := 'reserve_outbound';
    insert into public.vulnerability_remediation_tickets(
      organization_id, finding_id, binding_id, provider, status, sync_revision,
      last_sync_direction, last_sync_at, created_at, updated_at
    ) values (
      p_organization_id, p_finding_id, p_binding_id, v_binding.provider, 'sync_pending',
      1, 'outbound', v_now, v_now, v_now
    ) returning * into v_ticket;
  end if;

  insert into public.vulnerability_remediation_ticket_operations(
    organization_id, actor_user_id, ticket_id, binding_id, finding_id, operation,
    idempotency_key, context_digest, state, result, correlation_id,
    connector_connection_revision, connector_credential_revision
  ) values (
    p_organization_id, p_actor_user_id, v_ticket.id, p_binding_id, p_finding_id, v_operation_kind,
    p_idempotency_key, p_context_digest, 'reserved',
    jsonb_build_object('ticket', public.m11_05_ticket_json(p_organization_id, v_ticket.id)),
    v_ticket.correlation_id,
    (select c.connection_revision from public.connectors c where c.organization_id = p_organization_id and c.id = v_binding.connector_id),
    (select c.credential_revision from public.connectors c where c.organization_id = p_organization_id and c.id = v_binding.connector_id)
  ) returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id,
    case when v_operation_kind = 'sync_context' then 'vulnerability.remediation_ticket_context_sync_reserved' else 'vulnerability.remediation_ticket_sync_reserved' end,
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('bindingId', p_binding_id, 'operationId', v_operation.id,
      'operation', v_operation_kind, 'idempotencyKey', p_idempotency_key, 'contextDigest', p_context_digest));
  return query select case when v_operation_kind = 'sync_context' then 'sync_reserved' else 'reserved' end,
    v_ticket.id, v_operation.id, v_operation.correlation_id, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
exception when unique_violation then
  return query select 'conflict'::text, null::uuid, null::uuid, null::uuid, null::jsonb;
end;
$$;

revoke all on function public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)
  to service_role;
