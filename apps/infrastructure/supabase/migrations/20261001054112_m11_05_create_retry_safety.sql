-- CRA-M11-05: a create retry is safe only after every prior attempt is known not to have created an issue.

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
  v_safe_retry boolean := false;
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
      if v_ticket.status <> 'sync_error'
        or not exists (select 1 from public.vulnerability_remediation_ticket_operations prior
          where prior.organization_id = p_organization_id and prior.ticket_id = v_ticket.id
            and prior.operation = 'reserve_outbound')
        or exists (select 1 from public.vulnerability_remediation_ticket_operations prior
          where prior.organization_id = p_organization_id and prior.ticket_id = v_ticket.id
            and prior.operation = 'reserve_outbound'
            and (prior.state <> 'failed' or prior.result->>'safeNoCreate' is distinct from 'true')) then
        return query select 'conflict'::text, v_ticket.id, null::uuid, null::uuid, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
        return;
      end if;
      v_safe_retry := true;
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
    connector_connection_revision, connector_credential_revision, next_attempt_at
  ) values (
    p_organization_id, p_actor_user_id, v_ticket.id, p_binding_id, p_finding_id, v_operation_kind,
    p_idempotency_key, p_context_digest, 'reserved',
    jsonb_build_object('ticket', public.m11_05_ticket_json(p_organization_id, v_ticket.id))
      || case when v_operation_kind = 'reserve_outbound' then jsonb_build_object('createProtocolVersion', 1) else '{}'::jsonb end,
    v_ticket.correlation_id,
    (select c.connection_revision from public.connectors c where c.organization_id = p_organization_id and c.id = v_binding.connector_id),
    (select c.credential_revision from public.connectors c where c.organization_id = p_organization_id and c.id = v_binding.connector_id),
    case when v_operation_kind = 'reserve_outbound' then v_now + interval '5 minutes' else v_now end
  ) returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id,
    case when v_operation_kind = 'sync_context' then 'vulnerability.remediation_ticket_context_sync_reserved' else 'vulnerability.remediation_ticket_sync_reserved' end,
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('bindingId', p_binding_id, 'operationId', v_operation.id,
      'operation', v_operation_kind, 'idempotencyKey', p_idempotency_key, 'contextDigest', p_context_digest,
      'safeRetry', v_safe_retry));
  return query select case when v_operation_kind = 'sync_context' then 'sync_reserved'
    when v_safe_retry then 'safe_retry_reserved' else 'reserved' end,
    v_ticket.id, v_operation.id, v_operation.correlation_id, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
exception when unique_violation then
  return query select 'conflict'::text, null::uuid, null::uuid, null::uuid, null::jsonb;
end;
$$;

revoke all on function public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)
  to service_role;

create or replace function public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_actor_user_id uuid
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_operation_id is null or p_actor_user_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and id = p_operation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_operation.actor_user_id is distinct from p_actor_user_id then
    return query select 'forbidden'::text, null::jsonb; return;
  end if;
  if v_operation.operation <> 'reserve_outbound' or v_operation.state <> 'reserved'
    or v_operation.lease_owner is not null or v_operation.result->>'createProtocolVersion' is distinct from '1' then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  if v_operation.result ? 'providerCreateAttemptedAt' then
    return query select 'replayed'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = v_operation.ticket_id for update;
  if not found or v_ticket.external_issue_id is not null or v_ticket.status <> 'sync_pending'
    or v_ticket.finding_id <> v_operation.finding_id or v_ticket.binding_id <> v_operation.binding_id then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  if not public.m5_triage_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'forbidden'::text, null::jsonb; return;
  end if;
  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = v_operation.binding_id and status = 'active';
  if not found or not exists (
    select 1 from public.vulnerability_findings f
    join public.product_releases r on r.organization_id = f.organization_id and r.id = f.release_id
    where f.organization_id = p_organization_id and f.id = v_operation.finding_id
      and f.status = 'active' and r.product_id = v_binding.product_id
  ) or not exists (
    select 1 from public.connectors c
    join public.connector_secrets s on s.organization_id = c.organization_id
      and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
    where c.organization_id = p_organization_id and c.id = v_binding.connector_id
      and c.connector_type = 'jira' and c.enabled and c.archived_at is null
      and c.connection_config->>'providerHost' = v_binding.provider_host
      and c.connection_config->>'cloudId' = v_binding.provider_cloud_id
      and c.connection_config->>'siteHost' = v_binding.site_host
      and c.connection_revision = v_operation.connector_connection_revision
      and c.credential_revision = v_operation.connector_credential_revision
  ) then
    return query select 'forbidden'::text, null::jsonb; return;
  end if;
  update public.vulnerability_remediation_ticket_operations
  set result = result || jsonb_build_object('providerCreateAttemptedAt', public.m2_utc_z(v_now)),
    next_attempt_at = greatest(next_attempt_at, v_now + interval '5 minutes')
  where organization_id = p_organization_id and id = p_operation_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.remediation_ticket_create_attempted',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('operationId', p_operation_id, 'correlationId', v_operation.correlation_id));
  return query select 'marked'::text, public.m11_05_remediation_ticket_operation_json(p_operation_id);
end;
$$;

create or replace function public.mark_vulnerability_remediation_ticket_create_rejected_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_rejection_code text
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_operation_id is null or p_actor_user_id is null
    or p_rejection_code is null
    or p_rejection_code not in ('http_400','http_401','http_403','http_404','http_422') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and id = p_operation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_operation.actor_user_id is distinct from p_actor_user_id then
    return query select 'forbidden'::text, null::jsonb; return;
  end if;
  if v_operation.operation <> 'reserve_outbound' then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  if v_operation.state = 'failed' and v_operation.result->>'safeNoCreate' = 'true'
    and v_operation.result->>'providerCreateRejectedCode' = p_rejection_code then
    return query select 'replayed'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  if v_operation.state <> 'reserved' or v_operation.lease_owner is not null
    or not (v_operation.result ? 'providerCreateAttemptedAt')
    or v_operation.result->>'createProtocolVersion' is distinct from '1' then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = v_operation.ticket_id for update;
  if not found or v_ticket.external_issue_id is not null or v_ticket.binding_id <> v_operation.binding_id
    or v_ticket.finding_id <> v_operation.finding_id then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;
  update public.vulnerability_remediation_tickets
  set status = 'sync_error', conflict_reason = 'sync_failed', last_sync_at = v_now,
    sync_revision = sync_revision + 1, version = version + 1, updated_at = v_now
  where organization_id = p_organization_id and id = v_ticket.id;
  update public.vulnerability_remediation_ticket_operations
  set state = 'failed', completed_at = v_now, lease_owner = null, lease_expires_at = null,
    last_error = 'provider_create_rejected',
    result = result || jsonb_build_object('safeNoCreate', true, 'providerCreateRejectedCode', p_rejection_code)
  where organization_id = p_organization_id and id = p_operation_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.remediation_ticket_create_rejected',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('operationId', p_operation_id, 'rejectionCode', p_rejection_code));
  return query select 'rejected'::text, public.m11_05_remediation_ticket_operation_json(p_operation_id);
end;
$$;

revoke all on function public.mark_vulnerability_remediation_ticket_create_attempt_atomic(uuid,uuid,uuid),
  public.mark_vulnerability_remediation_ticket_create_rejected_atomic(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.mark_vulnerability_remediation_ticket_create_attempt_atomic(uuid,uuid,uuid),
  public.mark_vulnerability_remediation_ticket_create_rejected_atomic(uuid,uuid,uuid,text)
  to service_role;
-- A worker may prove no POST occurred only for a new-protocol operation with no attempt marker.

create or replace function public.fail_vulnerability_remediation_ticket_operation_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_worker_id uuid,
  p_retryable boolean,
  p_error text,
  p_retry_after_seconds integer
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_retry boolean;
  v_now timestamptz := clock_timestamp();
  v_backoff_seconds integer;
  v_retry_after_seconds integer;
  v_safe_no_create boolean;
begin
  if p_organization_id is null or p_operation_id is null or p_worker_id is null
    or char_length(btrim(coalesce(p_error,''))) not between 1 and 1000
    or (p_retry_after_seconds is not null and p_retry_after_seconds not between 0 and 3600) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  select * into v_operation from public.vulnerability_remediation_ticket_operations
  where organization_id = p_organization_id and id = p_operation_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_operation.state <> 'reserved' or v_operation.lease_owner is distinct from p_worker_id or v_operation.lease_expires_at <= v_now then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;

  v_retry := coalesce(p_retryable,false) and v_operation.attempt_count < 5;
  v_safe_no_create := not v_retry and v_operation.operation = 'reserve_outbound'
    and coalesce(v_operation.result->>'createProtocolVersion' = '1', false)
    and not (v_operation.result ? 'providerCreateAttemptedAt')
    and exists (select 1 from public.vulnerability_remediation_tickets t
      where t.organization_id = p_organization_id and t.id = v_operation.ticket_id
        and t.external_issue_id is null);
  v_backoff_seconds := (30 * (2 ^ greatest(v_operation.attempt_count - 1,0)))::integer;
  v_retry_after_seconds := greatest(v_backoff_seconds, coalesce(p_retry_after_seconds, 0));

  if v_operation.ticket_id is not null and v_operation.operation in ('reserve_outbound','sync_context','reserve_transition') then
    update public.vulnerability_remediation_tickets
    set status = case when v_retry then 'sync_pending' else 'sync_error' end,
      last_sync_direction = 'outbound',
      last_sync_at = v_now,
      conflict_reason = case when v_retry then null else 'sync_failed' end,
      sync_revision = sync_revision + 1,
      version = version + 1,
      updated_at = v_now
    where organization_id = p_organization_id and id = v_operation.ticket_id;
  end if;

  update public.vulnerability_remediation_ticket_operations
  set state = case when v_retry then 'reserved' else 'failed' end,
    lease_owner = null, lease_expires_at = null,
    next_attempt_at = case when v_retry then v_now + make_interval(secs => v_retry_after_seconds) else next_attempt_at end,
    last_error = btrim(p_error),
    completed_at = case when v_retry then completed_at else v_now end,
    result = coalesce(result, '{}'::jsonb)
      || case when v_retry and p_retry_after_seconds is not null then
        jsonb_build_object('retryAfterSeconds', p_retry_after_seconds, 'scheduledBackoffSeconds', v_retry_after_seconds)
      else '{}'::jsonb end
      || case when v_safe_no_create then jsonb_build_object('safeNoCreate', true) else '{}'::jsonb end
  where organization_id = p_organization_id and id = p_operation_id
  returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  select p_organization_id, v_operation.actor_user_id,
    case when v_retry then 'vulnerability.remediation_ticket_sync_retry_scheduled' else 'vulnerability.remediation_ticket_sync_failed' end,
    'vulnerability_remediation_ticket', v_operation.ticket_id::text,
    jsonb_build_object('operationId', v_operation.id, 'operation', v_operation.operation,
      'retryable', v_retry, 'reason', case when v_retry then 'retry_scheduled' else 'sync_failed' end,
      'retryAfterSeconds', p_retry_after_seconds, 'scheduledBackoffSeconds', case when v_retry then v_retry_after_seconds else null end,
      'safeNoCreate', v_safe_no_create)
  where v_operation.ticket_id is not null;

  return query select case when v_retry then 'retry_scheduled' else 'failed' end, public.m11_05_remediation_ticket_operation_json(v_operation.id);
end;
$$;

create or replace function public.fail_vulnerability_remediation_ticket_operation_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_worker_id uuid,
  p_retryable boolean,
  p_error text
) returns table(outcome text, operation jsonb)
language sql security definer set search_path = public, pg_temp as $$
  select * from public.fail_vulnerability_remediation_ticket_operation_atomic(
    p_organization_id, p_operation_id, p_worker_id, p_retryable, p_error, null::integer
  )
$$;

revoke all on function public.fail_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,boolean,text),
  public.fail_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,boolean,text,integer)
  from public, anon, authenticated;
grant execute on function public.fail_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,boolean,text),
  public.fail_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,boolean,text,integer)
  to service_role;
