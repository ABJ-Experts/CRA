-- Require a current active EU Member State reference entry before placement.
-- Existing retired projections remain removable/correctable but cannot satisfy
-- the placed-on-market prerequisite.

create or replace function public.m2_enforce_release_regulatory_invariants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_created_at timestamptz;
begin
  select created_at into v_product_created_at
    from public.products
   where organization_id = new.organization_id and id = new.product_id;

  if new.placed_on_market_at is not null
     and (new.placed_on_market_at > clock_timestamp()
       or new.placed_on_market_at < v_product_created_at) then
    raise exception 'placed_on_market_at must be between product creation and now';
  end if;
  if new.lifecycle in ('placed_on_market', 'in_support', 'end_of_support')
     and new.placed_on_market_at is null then
    raise exception 'lifecycle requires placed_on_market_at';
  end if;
  if new.lifecycle = 'development' and new.placed_on_market_at is not null then
    raise exception 'development cannot carry placed_on_market_at';
  end if;
  if new.archived_at is not null and new.lifecycle <> 'withdrawn' then
    raise exception 'release must be withdrawn before archival';
  end if;

  if tg_op = 'UPDATE' then
    if old.placed_on_market_at is not null and new.placed_on_market_at is null then
      raise exception 'placed_on_market_at cannot be cleared';
    end if;
    if old.placed_on_market_at is distinct from new.placed_on_market_at
       and old.placed_on_market_at is not null
       and coalesce(current_setting('cra.allow_placed_date_correction', true), 'off') <> 'on' then
      raise exception 'placed_on_market_at changes require correction workflow';
    end if;
    if old.lifecycle is distinct from new.lifecycle and not (
      (old.lifecycle = 'development' and new.lifecycle in ('placed_on_market', 'withdrawn'))
      or (old.lifecycle = 'placed_on_market' and new.lifecycle in ('in_support', 'withdrawn'))
      or (old.lifecycle = 'in_support' and new.lifecycle in ('end_of_support', 'withdrawn'))
      or (old.lifecycle = 'end_of_support' and new.lifecycle = 'withdrawn')
    ) then
      raise exception 'invalid release lifecycle transition';
    end if;
    if old.lifecycle = 'development' and new.lifecycle = 'placed_on_market'
       and not exists (
         select 1 from public.product_release_market_availability availability
         join public.member_state_reference_versions versions
           on versions.id = availability.reference_version_id
         join public.member_state_reference_entries entries
           on entries.reference_version_id = availability.reference_version_id
          and entries.country_code = availability.country_code
          where availability.organization_id = new.organization_id
            and availability.release_id = new.id
            and availability.unavailable_at is null
            and versions.reference_set_id = 'eu_member_states'
            and versions.active
            and entries.active
       ) then
      raise exception 'placement requires active market availability';
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.transition_product_release_lifecycle_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_target_lifecycle text,
  p_placed_on_market_at text,
  p_reason text,
  p_correlation_id uuid
)
returns table (outcome text, release jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_release public.product_releases%rowtype;
  v_before jsonb;
  v_placed_at timestamptz;
  v_product_created_at timestamptz;
  v_error text;
  v_event_type text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_release from public.product_releases
   where organization_id = p_organization_id and product_id = p_product_id
     and id = p_release_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  v_before := public.m2_release_json(p_organization_id, p_release_id);
  if p_expected_version is null or p_expected_version < 0 then
    perform public.m2_audit_release_command_rejection(
      p_organization_id, p_actor_user_id, p_release_id,
      'product.release_lifecycle_transition_rejected', 'invalid_request',
      p_correlation_id, v_before,
      jsonb_build_object('targetLifecycle', p_target_lifecycle,
        'expectedVersionPresent', p_expected_version is not null)
    );
    return query select 'invalid_request'::text, v_before; return;
  end if;
  if v_release.version <> p_expected_version then
    perform public.m2_audit_release_command_rejection(
      p_organization_id, p_actor_user_id, p_release_id,
      'product.release_lifecycle_transition_rejected', 'conflict',
      p_correlation_id, v_before,
      jsonb_build_object('targetLifecycle', p_target_lifecycle,
        'expectedVersion', p_expected_version, 'currentVersion', v_release.version)
    );
    return query select 'conflict'::text, v_before; return;
  end if;
  if v_release.archived_at is not null then v_error := 'invalid_state'; end if;
  if v_error is null and (p_target_lifecycle is null or p_target_lifecycle not in (
    'development', 'placed_on_market', 'in_support', 'end_of_support', 'withdrawn'
  )) then v_error := 'invalid_transition'; end if;
  if v_error is null and p_target_lifecycle = 'withdrawn'
     and nullif(btrim(p_reason), '') is null then v_error := 'invalid_request'; end if;
  if v_error is null and p_target_lifecycle <> 'placed_on_market'
     and p_placed_on_market_at is not null then v_error := 'invalid_request'; end if;
  if v_error is null and not (
    (v_release.lifecycle = 'development' and p_target_lifecycle in ('placed_on_market', 'withdrawn'))
    or (v_release.lifecycle = 'placed_on_market' and p_target_lifecycle in ('in_support', 'withdrawn'))
    or (v_release.lifecycle = 'in_support' and p_target_lifecycle in ('end_of_support', 'withdrawn'))
    or (v_release.lifecycle = 'end_of_support' and p_target_lifecycle = 'withdrawn')
  ) then v_error := 'invalid_transition'; end if;

  if v_error is null and p_target_lifecycle = 'placed_on_market' then
    if p_placed_on_market_at is null then
      v_error := 'placement_requires_placed_on_market_at';
    else
      v_placed_at := public.m2_parse_utc_z(p_placed_on_market_at);
      select created_at into v_product_created_at from public.products
       where organization_id = p_organization_id and id = p_product_id;
      if v_placed_at is null or v_placed_at > clock_timestamp()
         or v_placed_at < v_product_created_at then
        v_error := 'invalid_request';
      elsif not exists (
        select 1 from public.product_release_market_availability availability
        join public.member_state_reference_versions versions
          on versions.id = availability.reference_version_id
        join public.member_state_reference_entries entries
          on entries.reference_version_id = availability.reference_version_id
         and entries.country_code = availability.country_code
         where availability.organization_id = p_organization_id
           and availability.release_id = p_release_id
           and availability.unavailable_at is null
           and versions.reference_set_id = 'eu_member_states'
           and versions.active
           and entries.active
      ) then
        v_error := 'placement_requires_active_market_availability';
      end if;
    end if;
  end if;
  if v_error is not null then
    perform public.m2_audit_release_command_rejection(
      p_organization_id, p_actor_user_id, p_release_id,
      'product.release_lifecycle_transition_rejected', v_error,
      p_correlation_id, v_before,
      jsonb_build_object('targetLifecycle', p_target_lifecycle,
        'expectedVersion', p_expected_version,
        'placedOnMarketAtPresent', p_placed_on_market_at is not null,
        'reasonPresent', nullif(btrim(p_reason), '') is not null)
    );
    return query select v_error, v_before; return;
  end if;

  update public.product_releases set
    lifecycle = p_target_lifecycle,
    placed_on_market_at = case when p_target_lifecycle = 'placed_on_market'
      then v_placed_at else placed_on_market_at end,
    version = version + 1,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_release_id
  returning * into v_release;
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id,
    'product.release_lifecycle_transitioned', 'product_release',
    p_release_id::text, jsonb_build_object(
      'before', v_before,
      'after', public.m2_release_json(p_organization_id, p_release_id),
      'reason', nullif(btrim(p_reason), ''),
      'correlationId', p_correlation_id
    )
  );
  v_event_type := case when p_target_lifecycle = 'placed_on_market'
    then 'release.placed_on_market_changed' else 'release.lifecycle_changed' end;
  perform public.m2_emit_product_regulatory_event(
    p_organization_id, p_product_id, p_release_id, v_release.version,
    v_event_type, jsonb_build_object(
      'productId', p_product_id, 'releaseId', p_release_id,
      'releaseVersion', v_release.version,
      'before', v_before,
      'after', public.m2_release_json(p_organization_id, p_release_id)
    ), p_correlation_id
  );
  return query select 'transitioned'::text,
    public.m2_release_json(p_organization_id, p_release_id);
end;
$$;

alter function public.m2_enforce_release_regulatory_invariants() owner to postgres;
alter function public.transition_product_release_lifecycle_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) owner to postgres;

revoke all on function
  public.m2_enforce_release_regulatory_invariants(),
  public.transition_product_release_lifecycle_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, uuid
  )
from public, anon, authenticated;

grant execute on function
  public.transition_product_release_lifecycle_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, uuid
  )
to service_role;

