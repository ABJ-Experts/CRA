-- Preserve expired/legal-unavailable state during external-reference monitoring.
-- A later successful monitor check may restore integrity, but it must not
-- reactivate an artifact whose availability has already expired.

create or replace function public.monitor_product_security_update_external_reference_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_monitor_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_integrity_status text;
  v_available boolean;
begin
  if p_expected_version is null or p_monitor_outcome not in (
    'verified', 'external_content_changed', 'unavailable', 'provider_unavailable'
  ) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.distribution_kind <> 'external_reference'
     or v_artifact.publication_status not in ('published', 'replaced') then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;

  v_available := p_monitor_outcome = 'verified'
    and v_artifact.availability_status = 'available'
    and v_artifact.availability_until is not null
    and v_artifact.availability_until >= now();
  v_integrity_status := case p_monitor_outcome
    when 'verified' then 'verified'
    when 'external_content_changed' then 'corrupt'
    else p_monitor_outcome
  end;
  update public.product_security_update_artifacts set
    integrity_status = v_integrity_status,
    availability_status = case
      when v_artifact.availability_status = 'expired'
        or (v_artifact.availability_until is not null and v_artifact.availability_until < now())
        then 'expired'
      when v_available then availability_status
      else 'blocked'
    end,
    availability_explanation = case
      when v_artifact.availability_status = 'expired'
        or (v_artifact.availability_until is not null and v_artifact.availability_until < now())
        then jsonb_build_object(
          'ruleVersion', 'm2.v2.security-update-availability.v1',
          'status', 'expired', 'code', 'availability_expired'
        )
      when v_available then availability_explanation else
      jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'blocked', 'code', p_monitor_outcome
      )
    end,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;

  perform public.m2_v2_set_lifecycle_dependency_fact(
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact', v_artifact.id, v_available, p_actor_user_id
  );
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state
  ) values (
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact.external_reference_monitor',
    concat(
      'security-update-artifact:external-reference-monitor:', v_artifact.id::text,
      ':', to_char((now() + interval '1 day')::date, 'YYYYMMDD')
    ),
    jsonb_build_object('artifactId', v_artifact.id), p_correlation_id,
    now(), now() + interval '1 day', 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id,
    'product.security_update_artifact_external_reference_monitored',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('monitorOutcome', p_monitor_outcome, 'correlationId', p_correlation_id)
  );
  return query select 'monitored'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

alter function public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid)
  owner to postgres;
revoke execute on function public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid)
  to service_role;
