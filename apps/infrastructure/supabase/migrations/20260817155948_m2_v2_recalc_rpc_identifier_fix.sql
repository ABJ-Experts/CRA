-- Stable RPC name for the M2 V2 availability recalculation. The original
-- development name exceeded PostgreSQL's 63-byte identifier limit.

drop function if exists public.recalculate_product_security_update_artifact_availability_atomi(
  uuid, uuid, uuid, uuid, uuid
);

create or replace function public.recalc_product_security_update_artifact_availability_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_issued_candidate timestamptz;
  v_computed timestamptz;
  v_until timestamptz;
  v_winner text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, v_artifact.release_id
  );
  if not found or v_artifact.issued_at < v_support.support_starts_at
     or v_artifact.issued_at > v_support.support_ends_at then
    update public.product_security_update_artifacts set
      availability_status = 'blocked',
      availability_explanation = jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'blocked', 'code', case when not found then 'missing_support_period'
          else 'issued_at_outside_current_support_period' end
      ), version = version + 1, updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_availability_recalculated',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('status', 'blocked', 'correlationId', p_correlation_id));
    return query select 'blocked'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;

  v_issued_candidate := public.m2_v2_availability_candidate(v_artifact.issued_at);
  v_computed := greatest(v_issued_candidate, v_support.support_ends_at);
  v_until := greatest(coalesce(v_artifact.availability_until, '-infinity'::timestamptz), v_computed);
  v_winner := case when v_issued_candidate = v_support.support_ends_at then 'equal'
    when v_issued_candidate > v_support.support_ends_at then 'issued_at_plus_10_calendar_years'
    else 'support_period_end' end;

  update public.product_security_update_artifacts set
    support_period_id = v_support.id, support_period_revision = v_support.scope_revision,
    availability_status = case when publication_status in ('published', 'replaced')
      then 'available' else 'pending' end,
    issued_candidate_at = v_issued_candidate, support_candidate_at = v_support.support_ends_at,
    availability_winning_rule = v_winner, computed_availability_until = v_computed,
    availability_until = v_until, non_reduction_applied = v_until > v_computed,
    availability_explanation = jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1', 'status', 'current',
      'supportPeriodId', v_support.id, 'supportPeriodRevision', v_support.scope_revision,
      'issuedCandidate', public.m2_utc_z(v_issued_candidate),
      'supportCandidate', public.m2_utc_z(v_support.support_ends_at),
      'winningRule', v_winner, 'nonReductionApplied', v_until > v_computed
    ), version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;

  if v_artifact.publication_status in ('published', 'replaced') then
    perform public.m2_v2_set_artifact_retention_fact(v_artifact);
  end if;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_availability_recalculated',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('availabilityUntil', public.m2_utc_z(v_until),
      'nonReductionApplied', v_until > v_computed, 'correlationId', p_correlation_id));

  return query select 'recalculated'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

alter function public.recalc_product_security_update_artifact_availability_atomic(uuid, uuid, uuid, uuid, uuid)
owner to postgres;
revoke all on function public.recalc_product_security_update_artifact_availability_atomic(uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.recalc_product_security_update_artifact_availability_atomic(uuid, uuid, uuid, uuid, uuid)
to service_role;
