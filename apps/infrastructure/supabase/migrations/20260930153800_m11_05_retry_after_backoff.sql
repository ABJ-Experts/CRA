-- CRA-M11-05: honor bounded provider Retry-After when scheduling remediation ticket operation retries.

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
    result = coalesce(result, '{}'::jsonb) || case when v_retry and p_retry_after_seconds is not null then
      jsonb_build_object('retryAfterSeconds', p_retry_after_seconds, 'scheduledBackoffSeconds', v_retry_after_seconds)
    else '{}'::jsonb end
  where organization_id = p_organization_id and id = p_operation_id
  returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  select p_organization_id, v_operation.actor_user_id,
    case when v_retry then 'vulnerability.remediation_ticket_sync_retry_scheduled' else 'vulnerability.remediation_ticket_sync_failed' end,
    'vulnerability_remediation_ticket', v_operation.ticket_id::text,
    jsonb_build_object('operationId', v_operation.id, 'operation', v_operation.operation,
      'retryable', v_retry, 'reason', case when v_retry then 'retry_scheduled' else 'sync_failed' end,
      'retryAfterSeconds', p_retry_after_seconds, 'scheduledBackoffSeconds', case when v_retry then v_retry_after_seconds else null end)
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
