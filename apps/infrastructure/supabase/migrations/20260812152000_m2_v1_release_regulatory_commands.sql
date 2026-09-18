-- M2 V1 organization-first optimistic commands. Projection/audit/outbox
-- writes share one transaction because each RPC is one database statement.

create or replace function public.m2_emit_product_regulatory_event(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_release_version integer,
  p_event_type text,
  p_payload jsonb,
  p_correlation_id uuid
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.product_regulatory_outbox_events (
    organization_id, product_id, release_id, event_type, event_key,
    payload, correlation_id
  ) values (
    p_organization_id, p_product_id, p_release_id, p_event_type,
    p_release_id::text || ':' || p_release_version::text || ':' || p_event_type,
    p_payload, p_correlation_id
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.m2_audit_release_command_rejection(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_release_id uuid,
  p_action text,
  p_error_code text,
  p_correlation_id uuid,
  p_before jsonb,
  p_attempt jsonb
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id, p_action, 'product_release',
    p_release_id::text,
    jsonb_build_object(
      'before', p_before,
      'attempt', coalesce(p_attempt, '{}'::jsonb),
      'errorCode', p_error_code,
      'correlationId', p_correlation_id
    )
  )
$$;

create or replace function public.add_product_release_market_availability_atomic(
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
  select versions.id, versions.version
    into v_reference_version_id, v_reference_version
    from public.member_state_reference_versions versions
    join public.member_state_reference_entries entries
      on entries.reference_version_id = versions.id
   where versions.reference_set_id = 'eu_member_states'
     and versions.active and entries.active
     and entries.country_code = p_country_code;
  if v_reference_version_id is null then
    return query select 'member_state_unavailable'::text,
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
     and availability.country_code = p_country_code for update;
  if found and v_projection.unavailable_at is null then
    return query select 'conflict'::text,
      public.m2_release_json(p_organization_id, p_release_id); return;
  end if;
  if found then v_before := public.m2_market_availability_item_json(v_projection); end if;
  v_before_release := public.m2_release_json(p_organization_id, p_release_id);

  insert into public.product_release_market_availability (
    organization_id, product_id, release_id, reference_version_id,
    country_code, available_at, available_by
  ) values (
    p_organization_id, p_product_id, p_release_id, v_reference_version_id,
    p_country_code, clock_timestamp(), p_actor_user_id
  )
  on conflict (organization_id, release_id, country_code) do update set
    product_id = excluded.product_id,
    reference_version_id = excluded.reference_version_id,
    available_at = excluded.available_at,
    available_by = excluded.available_by,
    unavailable_at = null,
    unavailable_by = null
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
    'product.release_market_availability_added', 'product_release',
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
      'releaseVersion', v_release.version, 'operation', 'added',
      'before', v_before, 'after', v_after
    ), p_correlation_id
  );
  return query select 'updated'::text,
    public.m2_release_json(p_organization_id, p_release_id);
end;
$$;

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

create or replace function public.correct_product_release_placed_on_market_at_atomic(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_corrected_placed_on_market_at text,
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
  v_corrected_at timestamptz;
  v_product_created_at timestamptz;
  v_error text;
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
    v_error := 'invalid_request';
  elsif v_release.version <> p_expected_version then
    v_error := 'conflict';
  end if;
  if v_error is null and v_release.archived_at is not null then v_error := 'invalid_state'; end if;
  if v_error is null and v_release.placed_on_market_at is null then
    v_error := 'placed_on_market_date_not_set';
  end if;
  if v_error is null and nullif(btrim(p_reason), '') is null then
    v_error := 'invalid_request';
  end if;
  if v_error is null then
    v_corrected_at := public.m2_parse_utc_z(p_corrected_placed_on_market_at);
    select created_at into v_product_created_at from public.products
     where organization_id = p_organization_id and id = p_product_id;
    if v_corrected_at is null or v_corrected_at > clock_timestamp()
       or v_corrected_at < v_product_created_at
       or v_corrected_at = v_release.placed_on_market_at then
      v_error := 'invalid_request';
    end if;
  end if;
  if v_error is not null then
    perform public.m2_audit_release_command_rejection(
      p_organization_id, p_actor_user_id, p_release_id,
      'product.release_placed_on_market_date_correction_rejected', v_error,
      p_correlation_id, v_before,
      jsonb_build_object('expectedVersion', p_expected_version,
        'correctedPlacedOnMarketAtPresent', p_corrected_placed_on_market_at is not null,
        'reasonPresent', nullif(btrim(p_reason), '') is not null)
    );
    return query select v_error, v_before; return;
  end if;

  perform set_config('cra.allow_placed_date_correction', 'on', true);
  update public.product_releases set
    placed_on_market_at = v_corrected_at,
    version = version + 1,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_release_id
  returning * into v_release;
  perform set_config('cra.allow_placed_date_correction', 'off', true);
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, p_actor_user_id,
    'product.release_placed_on_market_date_corrected', 'product_release',
    p_release_id::text, jsonb_build_object(
      'before', v_before,
      'after', public.m2_release_json(p_organization_id, p_release_id),
      'reason', btrim(p_reason), 'correlationId', p_correlation_id
    )
  );
  perform public.m2_emit_product_regulatory_event(
    p_organization_id, p_product_id, p_release_id, v_release.version,
    'release.placed_on_market_changed', jsonb_build_object(
      'productId', p_product_id, 'releaseId', p_release_id,
      'releaseVersion', v_release.version,
      'originalPlacedOnMarketAt', v_before->>'placedOnMarketAt',
      'correctedPlacedOnMarketAt', public.m2_utc_z(v_corrected_at)
    ), p_correlation_id
  );
  return query select 'corrected'::text,
    public.m2_release_json(p_organization_id, p_release_id);
end;
$$;

alter function public.m2_emit_product_regulatory_event(uuid, uuid, uuid, integer, text, jsonb, uuid) owner to postgres;
alter function public.m2_audit_release_command_rejection(uuid, uuid, uuid, text, text, uuid, jsonb, jsonb) owner to postgres;
alter function public.add_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;
alter function public.remove_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;
alter function public.correct_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid) owner to postgres;
alter function public.transition_product_release_lifecycle_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid) owner to postgres;
alter function public.correct_product_release_placed_on_market_at_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;

revoke all on function
  public.m2_emit_product_regulatory_event(uuid, uuid, uuid, integer, text, jsonb, uuid),
  public.m2_audit_release_command_rejection(uuid, uuid, uuid, text, text, uuid, jsonb, jsonb),
  public.add_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.remove_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.correct_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid),
  public.transition_product_release_lifecycle_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid),
  public.correct_product_release_placed_on_market_at_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.add_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.remove_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.correct_product_release_market_availability_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid),
  public.transition_product_release_lifecycle_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid),
  public.correct_product_release_placed_on_market_at_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid)
to service_role;
