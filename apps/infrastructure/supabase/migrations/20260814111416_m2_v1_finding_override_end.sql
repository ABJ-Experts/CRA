-- Ending an override preserves the original exception and its audit trail.
-- The caller supplies the expected version so concurrent administrators cannot
-- silently replace one another's product-specific applicability decision.
create or replace function public.end_finding_product_impact_override_atomic(
  p_organization_id uuid,
  p_override_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key uuid,
  p_correlation_id uuid
) returns table(outcome text, override jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_override public.finding_product_impact_overrides%rowtype;
  v_before jsonb;
  v_digest text;
begin
  if p_organization_id is null
     or p_override_id is null
     or p_actor_user_id is null
     or p_expected_version is null
     or p_expected_version < 0
     or p_idempotency_key is null
     or p_correlation_id is null
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  -- Do not disclose an override in another tenant, or to a removed member.
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select * into v_override
    from public.finding_product_impact_overrides o
   where o.organization_id = p_organization_id
     and o.id = p_override_id
   for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  v_digest := encode(
    extensions.digest(
      jsonb_build_object(
        'overrideId', p_override_id,
        'expectedVersion', p_expected_version,
        'reason', btrim(p_reason)
      )::text,
      'sha256'
    ),
    'hex'
  );

  if v_override.ended_at is not null then
    if v_override.ended_by = p_actor_user_id
       and v_override.end_idempotency_key = p_idempotency_key then
      if v_override.end_idempotency_request_digest = v_digest then
        return query select 'replayed'::text, public.m2_finding_override_json(v_override);
      else
        return query select 'idempotency_mismatch'::text, null::jsonb;
      end if;
    end if;
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;

  if v_override.version <> p_expected_version then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;

  v_before := public.m2_finding_override_json(v_override);
  update public.finding_product_impact_overrides o
     set ended_at = clock_timestamp(),
         ended_by = p_actor_user_id,
         end_reason = btrim(p_reason),
         end_idempotency_key = p_idempotency_key,
         end_idempotency_request_digest = v_digest,
         version = o.version + 1,
         updated_by = p_actor_user_id
   where o.organization_id = p_organization_id
     and o.id = p_override_id
     and o.ended_at is null
     and o.version = p_expected_version
  returning * into v_override;
  if not found then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;

  insert into public.audit_logs(
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id,
    p_actor_user_id,
    'finding.product_impact_override_ended',
    'finding_product_impact_override',
    v_override.id::text,
    jsonb_build_object(
      'before', v_before,
      'after', public.m2_finding_override_json(v_override),
      'correlationId', p_correlation_id
    )
  );

  return query select 'ended'::text, public.m2_finding_override_json(v_override);
exception
  when unique_violation then
    return query select 'conflict'::text, null::jsonb;
end;
$$;

alter function public.end_finding_product_impact_override_atomic(
  uuid, uuid, uuid, integer, text, uuid, uuid
) owner to postgres;
revoke all on function public.end_finding_product_impact_override_atomic(
  uuid, uuid, uuid, integer, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.end_finding_product_impact_override_atomic(
  uuid, uuid, uuid, integer, text, uuid, uuid
) to service_role;
