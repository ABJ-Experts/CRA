-- CRA-M11-05: audit completed outbound remediation ticket worker operations atomically.

create or replace function public.complete_vulnerability_remediation_ticket_operation_atomic(
  p_organization_id uuid,
  p_operation_id uuid,
  p_worker_id uuid,
  p_result jsonb
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_now timestamptz := clock_timestamp();
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
  if v_operation.state <> 'reserved' or v_operation.lease_owner is distinct from p_worker_id or v_operation.lease_expires_at <= v_now then
    return query select 'conflict'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id); return;
  end if;

  if v_operation.ticket_id is not null and v_operation.operation in ('sync_context','reserve_transition') then
    select * into v_ticket from public.vulnerability_remediation_tickets
    where organization_id = p_organization_id and id = v_operation.ticket_id for update;
    if found then
      update public.vulnerability_remediation_tickets
      set last_sync_direction = 'outbound',
        last_sync_at = v_now,
        status = case
          when status = 'sync_error' and external_issue_id is not null then 'linked'
          when status = 'sync_error' then 'sync_pending'
          else status
        end,
        conflict_reason = case when status = 'sync_error' then null else conflict_reason end,
        sync_revision = sync_revision + 1,
        version = version + 1,
        updated_at = v_now
      where organization_id = p_organization_id and id = v_operation.ticket_id;
    end if;
  end if;

  update public.vulnerability_remediation_ticket_operations
  set state = 'completed', completed_at = v_now, lease_owner = null, lease_expires_at = null,
    result = coalesce(result,'{}'::jsonb) || p_result
  where organization_id = p_organization_id and id = p_operation_id
  returning * into v_operation;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  select p_organization_id, v_operation.actor_user_id,
    'vulnerability.remediation_ticket_operation_completed',
    'vulnerability_remediation_ticket', v_operation.ticket_id::text,
    jsonb_build_object('operationId', v_operation.id, 'operation', v_operation.operation,
      'workerId', p_worker_id, 'hasProviderResult', p_result <> '{}'::jsonb)
  where v_operation.ticket_id is not null;

  return query select 'completed'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id);
end;
$$;

revoke all on function public.complete_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,uuid,jsonb)
  to service_role;
