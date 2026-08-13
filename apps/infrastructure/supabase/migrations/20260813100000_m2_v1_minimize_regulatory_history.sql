-- Consolidate M2 V1 regulatory history into the append-only audit ledger.
-- The delivery outbox remains an independent durable queue.

do $$
declare
  v_table_name text;
  v_table regclass;
  v_row_count bigint;
begin
  foreach v_table_name in array array[
    'product_release_market_availability_history',
    'product_release_lifecycle_transitions',
    'product_release_placed_on_market_corrections'
  ]
  loop
    v_table := to_regclass('public.' || v_table_name);
    if v_table is not null then
      execute format('select count(*) from %s', v_table) into v_row_count;
      if v_row_count <> 0 then
        raise exception using
          errcode = 'P0001',
          message = format(
            'M2 V1 consolidation blocked: public.%s contains %s rows',
            v_table_name,
            v_row_count
          );
      end if;
    end if;
  end loop;
end;
$$;

delete from public.organization_export_source_tables
 where source_id = 'product_registry'
   and table_name in (
     'product_release_market_availability_history',
     'product_release_lifecycle_transitions',
     'product_release_placed_on_market_corrections'
   );

drop table if exists public.product_release_market_availability_history;
drop table if exists public.product_release_lifecycle_transitions;
drop table if exists public.product_release_placed_on_market_corrections;

create index if not exists product_release_regulatory_audit_timeline_idx
  on public.audit_logs
    (organization_id, entity_type, entity_id, created_at desc, id desc)
  where action in (
    'product.release_lifecycle_transitioned',
    'product.release_placed_on_market_date_corrected'
  );

revoke update, delete, truncate on table public.audit_logs from service_role;
grant select, insert on table public.audit_logs to service_role;

create or replace function public.m2_release_timeline_json(
  p_organization_id uuid,
  p_release_id uuid
)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'timeline', coalesce(jsonb_agg(events.payload order by events.occurred_at desc, events.id desc), '[]'::jsonb)
  )
  from (
    select audit.id, audit.created_at as occurred_at, jsonb_build_object(
      'id', audit.id,
      'eventType', case audit.action
        when 'product.release_lifecycle_transitioned' then 'transition'
        else 'placed_on_market_date_corrected'
      end,
      'beforeLifecycle', audit.changes->'before'->>'lifecycle',
      'afterLifecycle', audit.changes->'after'->>'lifecycle',
      'originalPlacedOnMarketAt', audit.changes->'before'->>'placedOnMarketAt',
      'correctedPlacedOnMarketAt', audit.changes->'after'->>'placedOnMarketAt',
      'actorId', audit.user_id,
      'reason', audit.changes->'reason',
      'correlationId', audit.changes->'correlationId',
      'occurredAt', public.m2_utc_z(audit.created_at)
    ) payload
    from public.audit_logs audit
    where audit.organization_id = p_organization_id
      and audit.entity_type = 'product_release'
      and audit.entity_id = p_release_id::text
      and audit.action in (
        'product.release_lifecycle_transitioned',
        'product.release_placed_on_market_date_corrected'
      )
      and audit.changes ?& array['before', 'after', 'reason', 'correlationId']
  ) events
$$;
create or replace function public.get_product_release_lifecycle_timeline(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid
)
returns table (outcome text, timeline jsonb)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists (
       select 1 from public.product_releases releases
        where releases.organization_id = p_organization_id
          and releases.product_id = p_product_id
          and releases.id = p_release_id
     ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text,
    public.m2_release_timeline_json(p_organization_id, p_release_id);
end;
$$;
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
         where availability.organization_id = p_organization_id
           and availability.release_id = p_release_id
           and availability.unavailable_at is null
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
-- Export the tenant-owned regulatory evidence and lock it into the same atomic
-- snapshot as the existing product registry records.

insert into public.organization_export_source_tables (
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('product_registry', 'product_release_market_availability', 'organization_id', 'id', 5),
  ('product_registry', 'product_regulatory_outbox_events', 'organization_id', 'id', 6)
on conflict (source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

create or replace function public.materialize_organization_export_snapshot_atomic(
  p_organization_id uuid,
  p_export_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
)
  returns table (outcome text, checkpoint_version integer)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_snapshot public.organization_export_snapshots%rowtype;
  v_mapping public.organization_export_source_tables%rowtype;
  v_source_id text;
  v_source_count integer := 0;
begin
  lock table
    public.organizations,
    public.organization_legal_profiles,
    public.organization_members,
    public.audit_logs,
    public.invitations,
    public.custom_roles,
    public.base_role_permission_overrides,
    public.menu_permissions,
    public.user_role_assignments,
    public.user_table_preferences,
    public.organization_onboarding,
    public.organization_onboarding_stages,
    public.organization_onboarding_evidence,
    public.organization_settings,
    public.organization_lifecycles,
    public.organization_retention_policies,
    public.retention_authority_states,
    public.retention_authoritative_facts,
    public.retention_floor_snapshots,
    public.retention_floor_reasons,
    public.evidence_protection_watermarks,
    public.retention_cleanup_runs,
    public.retention_cleanup_items,
    public.organization_export_jobs,
    public.organization_export_parts,
    public.organization_export_snapshots,
    public.organization_purge_jobs,
    public.organization_purge_work_items,
    public.organization_permissions_version,
    public.organization_legal_entities,
    public.organization_legal_entity_dependency_authorities,
    public.organization_legal_entity_dependency_facts,
    public.organization_branding_drafts,
    public.organization_branding_assets,
    public.organization_branding_versions,
    public.products,
    public.product_releases,
    public.product_legal_entity_assignments,
    public.product_lifecycle_dependency_facts,
    public.product_release_market_availability,
    public.product_regulatory_outbox_events
  in share mode;

  select * into v_job
    from public.organization_export_jobs
   where id = p_export_job_id and organization_id = p_organization_id
   for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;

  select * into v_snapshot
    from public.organization_export_snapshots
   where organization_id = p_organization_id and export_job_id = p_export_job_id
   order by snapshot_version desc limit 1 for update;
  if not found or cardinality(v_snapshot.source_ids) = 0 then return query select 'invalid_request'::text, v_job.checkpoint_version; return; end if;
  if v_snapshot.materialized_at is not null then return query select 'replayed'::text, v_job.checkpoint_version; return; end if;
  if exists (select 1 from public.organization_export_snapshot_records records where records.organization_id = p_organization_id and records.export_job_id = p_export_job_id) then return query select 'invalid_request'::text, v_job.checkpoint_version; return; end if;
  if exists (select 1 from unnest(v_snapshot.source_ids) as requested(source_id) where not exists (select 1 from public.organization_export_source_tables mappings where mappings.source_id = requested.source_id)) then return query select 'invalid_request'::text, v_job.checkpoint_version; return; end if;

  foreach v_source_id in array v_snapshot.source_ids loop
    for v_mapping in select * from public.organization_export_source_tables mappings where mappings.source_id = v_source_id order by mappings.table_sort
    loop
      execute format(
        'insert into public.organization_export_snapshot_records
          (organization_id, export_job_id, source_id, table_name, table_sort, record_index, record_payload)
         select $1, $2, $3, $4, $5,
                row_number() over (order by source.%I),
                public.m1_export_redact_jsonb(to_jsonb(source))
           from public.%I source
          where source.%I = $1
          order by source.%I',
        v_mapping.record_order_column, v_mapping.table_name,
        v_mapping.tenant_key_column, v_mapping.record_order_column
      ) using p_organization_id, p_export_job_id, v_source_id,
        v_mapping.table_name, v_mapping.table_sort;
      v_source_count := v_source_count + 1;
    end loop;
  end loop;
  if v_source_count <> (select count(*) from public.organization_export_source_tables mappings where mappings.source_id = any(v_snapshot.source_ids)) then return query select 'invalid_request'::text, v_job.checkpoint_version; return; end if;

  update public.organization_export_snapshots snapshots
     set materialized_at = now(), materialized_by = v_job.actor_user_id,
         materialized_checkpoint_version = v_job.checkpoint_version
   where snapshots.id = v_snapshot.id;
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'organization.export_snapshot_materialized',
    'organization_export_job', p_export_job_id::text,
    jsonb_build_object('sourceCount', v_source_count, 'checkpointVersion', v_job.checkpoint_version));
  return query select 'materialized'::text, v_job.checkpoint_version;
end;
$$;

alter function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(uuid, uuid, uuid, integer) to service_role;

alter function public.m2_release_timeline_json(uuid, uuid) owner to postgres;
alter function public.get_product_release_lifecycle_timeline(uuid, uuid, uuid, uuid) owner to postgres;
revoke all on function
  public.m2_release_timeline_json(uuid, uuid),
  public.get_product_release_lifecycle_timeline(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.get_product_release_lifecycle_timeline(uuid, uuid, uuid, uuid)
to service_role;
