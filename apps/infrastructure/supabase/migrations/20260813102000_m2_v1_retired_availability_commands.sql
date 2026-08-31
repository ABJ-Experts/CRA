-- Allow historically valid availability projections to be removed or
-- corrected after their source reference entry is retired. New/add and
-- correction destination entries must still belong to the active EU set.

create or replace function public.remove_product_release_market_availability_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_country_code text,
  p_reason text,
  p_correlation_id uuid
)
returns table (outcome text, release jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_release public.product_releases%rowtype;
  v_projection public.product_release_market_availability%rowtype;
  v_reference_version integer;
  v_before_release jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_release from public.product_releases
   where organization_id = p_organization_id and product_id = p_product_id
     and id = p_release_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.archived_at is not null then
    return query select 'invalid_state'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.placed_on_market_at is not null
     and nullif(btrim(p_reason), '') is null then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;

  select * into v_projection
    from public.product_release_market_availability availability
   where availability.organization_id = p_organization_id
     and availability.release_id = p_release_id
     and availability.country_code = p_country_code
     and availability.unavailable_at is null for update;
  if not found then
    return query select 'market_availability_not_found'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  select versions.version into v_reference_version
    from public.member_state_reference_versions versions
   where versions.id = v_projection.reference_version_id;
  v_before := public.m2_market_availability_item_json(v_projection);
  v_before_release := public.m2_release_json(p_organization_id, p_release_id);
  update public.product_release_market_availability set
    unavailable_at = clock_timestamp(), unavailable_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_projection.id
  returning * into v_projection;
  v_after := public.m2_market_availability_item_json(v_projection);
  update public.product_releases set
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_release_id
  returning * into v_release;
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id,
    'product.release_market_availability_removed', 'product_release',
    p_release_id::text, jsonb_build_object(
      'before', v_before, 'after', v_after,
      'releaseBefore', v_before_release,
      'releaseAfter', public.m2_release_json(p_organization_id, p_release_id),
      'referenceSetVersion', v_reference_version,
      'reason', nullif(btrim(p_reason), ''),
      'correlationId', p_correlation_id
    )
  );
  perform public.m2_emit_product_regulatory_event(
    p_organization_id, p_product_id, p_release_id, v_release.version,
    'release.market_availability_changed',
    jsonb_build_object(
      'productId', p_product_id, 'releaseId', p_release_id,
      'releaseVersion', v_release.version, 'operation', 'removed',
      'before', v_before, 'after', v_after
    ), p_correlation_id
  );
  return query select 'updated'::text,
    public.m2_release_json(p_organization_id, p_release_id);
end;
$$;
create or replace function public.correct_product_release_market_availability_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_from_country_code text,
  p_to_country_code text,
  p_reason text,
  p_correlation_id uuid
)
returns table (outcome text, release jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_release public.product_releases%rowtype;
  v_from public.product_release_market_availability%rowtype;
  v_to public.product_release_market_availability%rowtype;
  v_reference_version_id uuid;
  v_reference_version integer;
  v_before_release jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_release from public.product_releases
   where organization_id = p_organization_id and product_id = p_product_id
     and id = p_release_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.version <> p_expected_version then
    return query select 'conflict'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.archived_at is not null then
    return query select 'invalid_state'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if p_from_country_code = p_to_country_code then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  select versions.id, versions.version
    into v_reference_version_id, v_reference_version
    from public.member_state_reference_versions versions
    join public.member_state_reference_entries entries
      on entries.reference_version_id = versions.id
   where versions.reference_set_id = 'eu_member_states'
     and versions.active and entries.active
     and entries.country_code = p_to_country_code;
  if v_reference_version_id is null then
    return query select 'member_state_unavailable'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if v_release.placed_on_market_at is not null
     and nullif(btrim(p_reason), '') is null then
    return query select 'invalid_request'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;

  select * into v_from from public.product_release_market_availability availability
   where availability.organization_id = p_organization_id
     and availability.release_id = p_release_id
     and availability.country_code = p_from_country_code
     and availability.unavailable_at is null for update;
  if not found then
    return query select 'market_availability_not_found'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  select * into v_to from public.product_release_market_availability availability
   where availability.organization_id = p_organization_id
     and availability.release_id = p_release_id
     and availability.country_code = p_to_country_code for update;
  if found and v_to.unavailable_at is null then
    return query select 'conflict'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  v_before := public.m2_market_availability_item_json(v_from);
  v_before_release := public.m2_release_json(p_organization_id, p_release_id);
  update public.product_release_market_availability set
    unavailable_at = clock_timestamp(), unavailable_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_from.id;
  insert into public.product_release_market_availability (
    organization_id, product_id, release_id, reference_version_id,
    country_code, available_at, available_by
  ) values (
    p_organization_id, p_product_id, p_release_id, v_reference_version_id,
    p_to_country_code, clock_timestamp(), p_actor_user_id
  )
  on conflict (organization_id, release_id, country_code) do update set
    product_id = excluded.product_id,
    reference_version_id = excluded.reference_version_id,
    available_at = excluded.available_at,
    available_by = excluded.available_by,
    unavailable_at = null,
    unavailable_by = null
  returning * into v_to;
  v_after := public.m2_market_availability_item_json(v_to);
  update public.product_releases set
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_release_id
  returning * into v_release;
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id,
    'product.release_market_availability_corrected', 'product_release',
    p_release_id::text, jsonb_build_object(
      'before', v_before, 'after', v_after,
      'releaseBefore', v_before_release,
      'releaseAfter', public.m2_release_json(p_organization_id, p_release_id),
      'referenceSetVersion', v_reference_version,
      'reason', nullif(btrim(p_reason), ''),
      'correlationId', p_correlation_id
    )
  );
  perform public.m2_emit_product_regulatory_event(
    p_organization_id, p_product_id, p_release_id, v_release.version,
    'release.market_availability_changed',
    jsonb_build_object(
      'productId', p_product_id, 'releaseId', p_release_id,
      'releaseVersion', v_release.version, 'operation', 'corrected',
      'before', v_before, 'after', v_after
    ), p_correlation_id
  );
  return query select 'updated'::text,
    public.m2_release_json(p_organization_id, p_release_id);
end;
$$;

alter function public.remove_product_release_market_availability_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, uuid
) owner to postgres;
alter function public.correct_product_release_market_availability_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) owner to postgres;

revoke all on function
  public.remove_product_release_market_availability_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, uuid
  ),
  public.correct_product_release_market_availability_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, uuid
  )
from public, anon, authenticated;

grant execute on function
  public.remove_product_release_market_availability_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, uuid
  ),
  public.correct_product_release_market_availability_atomic(
    uuid, uuid, uuid, uuid, integer, text, text, text, uuid
  )
to service_role;

