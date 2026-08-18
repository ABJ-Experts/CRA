-- Worker-authorized M2 V2 effects. These functions let durable outbox work
-- resolve a current active owner/admin at execution time instead of trusting
-- the source event actor.

create or replace function public.m2_v2_resolve_security_update_artifact_worker_actor(
  p_organization_id uuid
) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  select member.user_id
  from public.organization_members member
  join public.users user_record
    on user_record.id = member.user_id and user_record.is_active
  where member.organization_id = p_organization_id
    and member.role in ('owner', 'admin')
  order by case member.role when 'owner' then 0 else 1 end, member.user_id
  limit 1
$$;

create or replace function public.finalize_product_security_update_artifact_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_verified_sha256 text, p_verified_byte_size bigint,
  p_verified_content_type text, p_integrity_status text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.finalize_product_security_update_artifact_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_verified_sha256, p_verified_byte_size, p_verified_content_type, p_integrity_status,
    p_correlation_id
  );
  if v_effect.outcome = 'finalized' then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'inspect', 'workerActorId', v_worker_actor,
        'sourceUpdatedBy', v_source_updated_by, 'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.recalc_security_update_artifact_availability_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.recalc_product_security_update_artifact_availability_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_correlation_id
  );
  if v_effect.outcome in ('recalculated', 'blocked') then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'availability_recalculate', 'workerActorId', v_worker_actor,
        'sourceUpdatedBy', v_source_updated_by, 'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.schedule_security_update_artifact_cleanup_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.schedule_product_security_update_artifact_cleanup_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_correlation_id
  );
  if v_effect.outcome = 'scheduled' then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'cleanup', 'workerActorId', v_worker_actor,
        'sourceUpdatedBy', v_source_updated_by, 'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.monitor_security_update_external_reference_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_monitor_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.monitor_product_security_update_external_reference_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_monitor_outcome, p_correlation_id
  );
  if v_effect.outcome = 'monitored' then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'external_reference_monitor',
        'workerActorId', v_worker_actor, 'sourceUpdatedBy', v_source_updated_by,
        'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

alter function public.m2_v2_resolve_security_update_artifact_worker_actor(uuid) owner to postgres;
alter function public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid) owner to postgres;
alter function public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid) owner to postgres;

revoke execute on function
  public.m2_v2_resolve_security_update_artifact_worker_actor(uuid),
  public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid),
  public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid),
  public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.m2_v2_resolve_security_update_artifact_worker_actor(uuid),
  public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid),
  public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid),
  public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid)
to service_role;
