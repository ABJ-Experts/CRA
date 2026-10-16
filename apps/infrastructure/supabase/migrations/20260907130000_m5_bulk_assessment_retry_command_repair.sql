-- Preserve the proven bounded execution implementation while ensuring a retry
-- owns a distinct, replayable bulk_retry command record.
create or replace function public.retry_vulnerability_assessment_bulk_operation_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_id uuid, p_expected_version integer,
  p_snapshot_digest text, p_confirm_scope_changes boolean, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_internal_key uuid := gen_random_uuid(); v_internal_digest text;
  v_outcome text; v_result jsonb;
begin
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_id is null
    or p_expected_version is null or p_snapshot_digest !~ '^[a-f0-9]{64}$' or p_confirm_scope_changes is null
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    return query select 'invalid_state'::text,null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||':'||p_idempotency_key::text,0));
  return query select * from public.m5_vex_command_result(
    p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_retry',p_request_digest
  );
  if found then return; end if;
  if not exists(
    select 1 from public.vulnerability_finding_assessment_bulk_operations o
    where o.organization_id=p_organization_id and o.id=p_operation_id
      and o.version=p_expected_version and o.snapshot_digest=p_snapshot_digest for update
  ) then return query select 'conflict'::text,null::jsonb; return; end if;
  update public.vulnerability_finding_assessment_bulk_operation_targets
    set state='pending',failure_code=null
    where organization_id=p_organization_id and operation_id=p_operation_id
      and state='failed' and failure_code='conflict';
  v_internal_digest := encode(digest(v_internal_key::text,'sha256'),'hex');
  select execution.outcome,execution.result into v_outcome,v_result
  from public.execute_vulnerability_assessment_bulk_operation_atomic(
    p_organization_id,p_actor_user_id,p_operation_id,p_expected_version,p_snapshot_digest,
    p_confirm_scope_changes,v_internal_key,v_internal_digest
  ) execution limit 1;
  if v_outcome <> 'executed' then
    return query select v_outcome,v_result; return;
  end if;
  update public.vulnerability_finding_assessment_commands
    set idempotency_key=p_idempotency_key,operation='bulk_retry',request_digest=p_request_digest
    where organization_id=p_organization_id and actor_user_id=p_actor_user_id
      and idempotency_key=v_internal_key and operation='bulk_execute';
  if not found then raise exception 'bulk retry command promotion failed' using errcode='integrity_constraint_violation'; end if;
  return query select 'retried'::text,v_result;
end;
$$;

alter function public.retry_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text) owner to postgres;
revoke all on function public.retry_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.retry_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text) to service_role;
