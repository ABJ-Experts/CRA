-- M2 V1 release market availability and lifecycle integration tests.
-- All fixtures roll back so this suite preserves the shared local database.

\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
  returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'the minimal regulatory model creates four RLS-protected tables only',
  (select count(*) = 0
     from (values
       ('member_state_reference_versions'),
       ('member_state_reference_entries'),
       ('product_release_market_availability'),
       ('product_regulatory_outbox_events')
     ) expected(table_name)
     left join pg_class c on c.relname = expected.table_name
     left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.oid is null
       or not c.relrowsecurity
       or c.relforcerowsecurity
       or has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'))
  and to_regclass('public.product_release_market_availability_history') is null
  and to_regclass('public.product_release_lifecycle_transitions') is null
  and to_regclass('public.product_release_placed_on_market_corrections') is null
);

select pg_temp.check(
  'audit history is append-only at the service-role boundary',
  has_table_privilege('service_role', 'public.audit_logs', 'select')
  and has_table_privilege('service_role', 'public.audit_logs', 'insert')
  and not has_table_privilege('service_role', 'public.audit_logs', 'update')
  and not has_table_privilege('service_role', 'public.audit_logs', 'delete')
  and not has_table_privilege('service_role', 'public.audit_logs', 'truncate')
);

select pg_temp.check(
  'regulatory RPCs are service-role-only security definers with pinned search paths',
  (select count(*) = 0
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'get_m2_member_states',
        'get_product_release_market_availability',
        'add_product_release_market_availability_atomic',
        'remove_product_release_market_availability_atomic',
        'correct_product_release_market_availability_atomic',
        'transition_product_release_lifecycle_atomic',
        'correct_product_release_placed_on_market_at_atomic',
        'get_product_release_lifecycle_timeline'
      ])
      and (
        not p.prosecdef
        or pg_get_userbyid(p.proowner) <> 'postgres'
        or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public, pg_temp%'
        or has_function_privilege('public', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or not has_function_privilege('service_role', p.oid, 'execute')
      ))
);

select pg_temp.check(
  'one active versioned EU-27 reference set contains exactly 27 canonical codes',
  (select count(*) = 1 from public.member_state_reference_versions where active)
  and (select count(*) = 27
         from public.member_state_reference_entries entries
         join public.member_state_reference_versions versions
           on versions.id = entries.reference_version_id
        where versions.active and entries.active)
  and not exists (
    select 1 from public.member_state_reference_entries entries
    join public.member_state_reference_versions versions
      on versions.id = entries.reference_version_id
    where versions.active and entries.active
      and entries.country_code not in (
        'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
        'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
      )
  )
);

select pg_temp.check(
  'dependency facts bind a release to the stated product and organization',
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.product_lifecycle_dependency_facts'::regclass
       and conname = 'product_dependencies_release_product_fkey'
  )
);

select pg_temp.check(
  'regulatory evidence tables are registered in organization exports',
  (select count(*) = 2
     from public.organization_export_source_tables
    where source_id = 'product_registry'
      and table_name in (
        'product_release_market_availability',
        'product_regulatory_outbox_events'
      ))
  and not exists (
    select 1 from public.organization_export_source_tables
     where source_id = 'product_registry'
       and table_name in (
         'product_release_market_availability_history',
         'product_release_lifecycle_transitions',
         'product_release_placed_on_market_corrections'
       )
  )
  and position(
    'product_release_market_availability_history'
    in pg_get_functiondef(
      'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
    )
  ) = 0
  and position(
    'product_release_lifecycle_transitions'
    in pg_get_functiondef(
      'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
    )
  ) = 0
  and position(
    'product_release_placed_on_market_corrections'
    in pg_get_functiondef(
      'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
    )
  ) = 0
);

begin;
create or replace function pg_temp.fail_selected_regulatory_audit()
returns trigger language plpgsql as $$
begin
  if new.changes->>'correlationId' =
     nullif(current_setting('cra.test_audit_failure_correlation', true), '') then
    raise exception 'simulated regulatory audit failure';
  end if;
  return new;
end;
$$;
create trigger fail_selected_regulatory_audit
before insert on public.audit_logs
for each row execute function pg_temp.fail_selected_regulatory_audit();

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_other_actor uuid;
  v_other_org uuid;
  v_product uuid := gen_random_uuid();
  v_other_product uuid := gen_random_uuid();
  v_release uuid := gen_random_uuid();
  v_other_release uuid := gen_random_uuid();
  v_retired_only_release uuid := gen_random_uuid();
  v_correlation uuid;
  v_result record;
  v_available jsonb;
  v_placed_at text := to_char(clock_timestamp() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  -- Earlier correction intentionally exercises the retention-shortening case;
  -- the database preserves it and emits deterministic recalculation evidence.
  v_corrected_at text := to_char(clock_timestamp() - interval '90 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_failed boolean;
  v_country_code text;
  v_expected_version integer;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_entity from public.organization_legal_entities
   where organization_id = v_org and is_default;

  insert into public.products (
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_at, created_by, updated_by
  ) values (
    v_product, v_org, v_entity, 0,
    jsonb_build_object('identifier', 'm2-v1', 'legalName', 'M2 V1 Test',
      'mainEstablishmentCountry', 'IE'),
    'M2 V1 Product', 'M2-V1-' || v_product::text,
    'standalone_software', v_actor, clock_timestamp() - interval '2 days',
    v_actor, v_actor
  );
  insert into public.product_releases (
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_at,
    created_by, updated_by
  ) values (
    v_release, v_org, v_product, v_entity, 0,
    jsonb_build_object('identifier', 'm2-v1', 'legalName', 'M2 V1 Test',
      'mainEstablishmentCountry', 'IE'),
    'M2 V1 Release', '1.0-' || v_release::text, 'development',
    clock_timestamp() - interval '1 day', v_actor, v_actor
  );

  perform pg_temp.check(
    'release JSON uses the V1 lifecycle contract and warns when availability is empty',
    public.m2_release_json(v_org, v_release) @> jsonb_build_object(
      'lifecycle', 'development', 'placedOnMarketAt', null,
      'marketAvailabilityWarning', 'no_active_member_state_availability',
      'versionNumber', 0
    )
  );

  select * into v_result from public.get_m2_member_states(v_org, v_actor);
  perform pg_temp.check(
    'member-state RPC returns the exact versioned response envelope',
    v_result.outcome = 'found'
    and jsonb_typeof(v_result.member_states->'memberStates') = 'array'
    and jsonb_array_length(v_result.member_states->'memberStates') = 27
    and (v_result.member_states->'memberStates'->0) ?&
      array['countryCode','name','version','active']
  );

  select * into v_result from public.get_product_release_market_availability(
    v_org, v_product, v_release, v_actor
  );
  perform pg_temp.check(
    'new release has an empty market-availability response envelope',
    v_result.outcome = 'found'
    and v_result.market_availability = '{"marketAvailability":[]}'::jsonb
  );

  v_correlation := gen_random_uuid();
  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 0, 'placed_on_market',
    v_placed_at, null, v_correlation
  );
  perform pg_temp.check(
    'placement without availability is rejected, audited, and leaves no outbox event',
    v_result.outcome = 'placement_requires_active_market_availability'
    and (select version = 0 and lifecycle = 'development'
           from public.product_releases where id = v_release)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and action = 'product.release_lifecycle_transition_rejected'
        and changes->>'correlationId' = v_correlation::text
        and changes->>'errorCode' = 'placement_requires_active_market_availability')
    and not exists (select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and release_id = v_release)
  );

  v_correlation := gen_random_uuid();
  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, 0, 'DE', null, v_correlation
  );
  perform pg_temp.check(
    'development availability add writes projection/audit/outbox atomically',
    v_result.outcome = 'updated'
    and v_result.release @> '{"lifecycle":"development","versionNumber":1,"marketAvailabilityWarning":null}'::jsonb
    and exists (select 1 from public.product_release_market_availability
      where organization_id = v_org and release_id = v_release
        and country_code = 'DE' and unavailable_at is null)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org and action = 'product.release_market_availability_added'
        and changes ?& array['before','after','reason','correlationId']
        and changes->'before' = 'null'::jsonb
        and changes->'after'->>'countryCode' = 'DE'
        and (changes->'after'->>'referenceVersion')::integer = 1
        and changes->>'correlationId' = v_correlation::text)
    and exists (select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and release_id = v_release
        and event_type = 'release.market_availability_changed'
        and event_key = v_release::text || ':1:release.market_availability_changed')
  );

  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, 1, 'GB', null, gen_random_uuid()
  );
  perform pg_temp.check(
    'unsupported Member States fail closed without an aggregate write',
    v_result.outcome = 'member_state_unavailable'
    and (select version = 1 from public.product_releases where id = v_release)
  );

  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, null, 'FR', null, gen_random_uuid()
  );
  perform pg_temp.check(
    'null aggregate versions fail closed instead of bypassing optimistic locking',
    v_result.outcome = 'invalid_request'
    and (select version = 1 from public.product_releases where id = v_release)
  );

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 1, 'placed_on_market',
    to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+05:30',
    null, gen_random_uuid()
  );
  perform pg_temp.check(
    'database transition boundary rejects non-UTC-Z timestamp text',
    v_result.outcome = 'invalid_request'
    and (select version = 1 from public.product_releases where id = v_release)
  );

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 1, 'placed_on_market',
    to_char(clock_timestamp() + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    null, gen_random_uuid()
  );
  perform pg_temp.check('future placement timestamps fail closed',
    v_result.outcome = 'invalid_request'
    and (select version = 1 from public.product_releases where id = v_release));

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 1, 'placed_on_market',
    to_char(clock_timestamp() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    null, gen_random_uuid()
  );
  perform pg_temp.check('placement cannot predate product creation',
    v_result.outcome = 'invalid_request'
    and (select version = 1 from public.product_releases where id = v_release));

  v_correlation := gen_random_uuid();
  perform set_config('cra.test_audit_failure_correlation', v_correlation::text, true);
  v_failed := false;
  begin
    perform * from public.transition_product_release_lifecycle_atomic(
      v_org, v_product, v_release, v_actor, 1, 'placed_on_market',
      v_placed_at, null, v_correlation
    );
  exception when raise_exception then
    v_failed := true;
  end;
  perform set_config('cra.test_audit_failure_correlation', '', true);
  perform pg_temp.check(
    'audit persistence failure rolls back release and outbox together',
    v_failed
    and (select version = 1 and lifecycle = 'development'
           from public.product_releases where id = v_release)
    and not exists (select 1 from public.audit_logs
      where changes->>'correlationId' = v_correlation::text)
    and not exists (select 1 from public.product_regulatory_outbox_events
      where release_id = v_release and event_key like '%:2:%')
  );

  v_correlation := gen_random_uuid();
  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 1, 'placed_on_market',
    v_placed_at, null, v_correlation
  );
  perform pg_temp.check(
    'placement succeeds with active availability and emits audit-backed timeline/retention evidence',
    v_result.outcome = 'transitioned'
    and v_result.release @> '{"lifecycle":"placed_on_market","versionNumber":2}'::jsonb
    and v_result.release->>'placedOnMarketAt' = v_placed_at
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release' and entity_id = v_release::text
        and action = 'product.release_lifecycle_transitioned'
        and changes ?& array['before','after','reason','correlationId']
        and changes->'before'->>'lifecycle' = 'development'
        and changes->'after'->>'lifecycle' = 'placed_on_market'
        and changes->>'correlationId' = v_correlation::text)
    and exists (select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and release_id = v_release
        and event_type = 'release.placed_on_market_changed'
        and event_key = v_release::text || ':2:release.placed_on_market_changed')
  );

  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, 2, 'FR', null, gen_random_uuid()
  );
  perform pg_temp.check(
    'availability changes after placement require a meaningful reason',
    v_result.outcome = 'invalid_request'
    and (select version = 2 from public.product_releases where id = v_release)
  );

  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, 2, 'FR', 'Added after launch', gen_random_uuid()
  );
  perform pg_temp.check('reasoned post-market add succeeds',
    v_result.outcome = 'updated' and v_result.release->>'versionNumber' = '3');

  v_correlation := gen_random_uuid();
  select * into v_result from public.correct_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, 3, 'FR', 'IT',
    'Registry correction', v_correlation
  );
  perform pg_temp.check(
    'market correction records distinct before/after audit snapshots',
    v_result.outcome = 'updated'
    and v_result.release->>'versionNumber' = '4'
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release' and entity_id = v_release::text
        and action = 'product.release_market_availability_corrected'
        and changes ?& array['before','after','reason','correlationId']
        and changes->'before'->>'countryCode' = 'FR'
        and changes->'after'->>'countryCode' = 'IT'
        and changes->>'reason' = 'Registry correction'
        and changes->>'correlationId' = v_correlation::text)
  );

  select * into v_result from public.remove_product_release_market_availability_atomic(
    v_org, v_product, v_release, v_actor, 4, 'DE',
    'No longer supplied', gen_random_uuid()
  );
  select market_availability into v_available from public.get_product_release_market_availability(
    v_org, v_product, v_release, v_actor
  );
  perform pg_temp.check(
    'market removal closes the projection and current reads exclude the removed state',
    v_result.outcome = 'updated'
    and v_result.release->>'versionNumber' = '5'
    and jsonb_array_length(v_available->'marketAvailability') = 1
    and v_available->'marketAvailability'->0->>'countryCode' = 'IT'
    and exists (select 1 from public.product_release_market_availability
      where organization_id = v_org and release_id = v_release
        and country_code = 'DE' and unavailable_at is not null)
  );

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 5, 'in_support', null, null, gen_random_uuid()
  );
  perform pg_temp.check('placed release advances to in-support',
    v_result.outcome = 'transitioned' and v_result.release->>'versionNumber' = '6');

  v_correlation := gen_random_uuid();
  select * into v_result from public.correct_product_release_placed_on_market_at_atomic(
    v_org, v_product, v_release, v_actor, 6, v_corrected_at,
    'Corrected source record', v_correlation
  );
  perform pg_temp.check(
    'placed-date correction preserves before/after audit values and emits recalculation evidence',
    v_result.outcome = 'corrected'
    and v_result.release->>'versionNumber' = '7'
    and v_result.release->>'placedOnMarketAt' = v_corrected_at
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release' and entity_id = v_release::text
        and action = 'product.release_placed_on_market_date_corrected'
        and changes ?& array['before','after','reason','correlationId']
        and changes->'before'->>'placedOnMarketAt' = v_placed_at
        and changes->'after'->>'placedOnMarketAt' = v_corrected_at
        and changes->>'reason' = 'Corrected source record'
        and changes->>'correlationId' = v_correlation::text)
    and exists (select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and release_id = v_release
        and event_key = v_release::text || ':7:release.placed_on_market_changed')
  );

  v_correlation := gen_random_uuid();
  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 6, 'end_of_support', null, null,
    v_correlation
  );
  perform pg_temp.check(
    'stale transition is rejected and audited without changing lifecycle',
    v_result.outcome = 'conflict'
    and (select version = 7 and lifecycle = 'in_support'
           from public.product_releases where id = v_release)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and action = 'product.release_lifecycle_transition_rejected'
        and changes->>'correlationId' = v_correlation::text
        and changes->>'errorCode' = 'conflict')
  );

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 7, 'end_of_support', null, null,
    gen_random_uuid()
  );
  perform pg_temp.check('support can end only through the forward edge',
    v_result.outcome = 'transitioned' and v_result.release->>'versionNumber' = '8');

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 8, 'withdrawn', null, null,
    gen_random_uuid()
  );
  perform pg_temp.check('withdrawal requires a reason at the database boundary',
    v_result.outcome = 'invalid_request');

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 8, 'withdrawn', null,
    'Withdrawn by product owner', gen_random_uuid()
  );
  perform pg_temp.check(
    'reasoned withdrawal succeeds without erasing regulatory history',
    v_result.outcome = 'transitioned' and v_result.release->>'versionNumber' = '9'
    and (select count(*) = 4 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release' and entity_id = v_release::text
        and action = 'product.release_lifecycle_transitioned')
    and (select count(*) > 0 from public.product_regulatory_outbox_events
      where release_id = v_release)
  );

  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_product, v_release, v_actor, 9, 'in_support', null, null,
    gen_random_uuid()
  );
  perform pg_temp.check('withdrawn is terminal',
    v_result.outcome = 'invalid_transition'
    and v_result.release->>'versionNumber' = '9');

  select * into v_result from public.get_product_release_lifecycle_timeline(
    v_org, v_product, v_release, v_actor
  );
  perform pg_temp.check(
    'lifecycle timeline is rebuilt from immutable audit actions in a strict response envelope',
    v_result.outcome = 'found'
    and jsonb_array_length(v_result.timeline->'timeline') = 5
    and (v_result.timeline->'timeline'->0) ?& array[
      'id','eventType','beforeLifecycle','afterLifecycle',
      'originalPlacedOnMarketAt','correctedPlacedOnMarketAt','actorId',
      'reason','correlationId','occurredAt'
    ]
    and not exists (
      select 1
        from jsonb_array_elements(v_result.timeline->'timeline') event
       where not exists (
         select 1 from public.audit_logs audit
          where audit.id = (event->>'id')::uuid
            and audit.organization_id = v_org
            and audit.entity_id = v_release::text
            and audit.action in (
              'product.release_lifecycle_transitioned',
              'product.release_placed_on_market_date_corrected'
            )
       )
    )
  );

  select * into v_result from public.archive_product_release_atomic(
    v_org, v_product, v_release, v_actor, 9, 'Archived after withdrawal'
  );
  perform pg_temp.check('release archival requires withdrawn state',
    v_result.outcome = 'archived' and v_result.release->>'versionNumber' = '10');

  insert into public.products (
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_at, created_by, updated_by
  ) values (
    v_other_product, v_org, v_entity, 0, '{}'::jsonb,
    'Other M2 Product', 'M2-OTHER-' || v_other_product::text,
    'component', v_actor, clock_timestamp() - interval '2 days', v_actor, v_actor
  );
  insert into public.product_releases (
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values (
    v_other_release, v_org, v_other_product, v_entity, 0, '{}'::jsonb,
    'Other release', '2.0-' || v_other_release::text, 'development', v_actor, v_actor
  );

  update public.member_state_reference_entries set active = false
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'SE';
  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_other_product, v_other_release, v_actor, 0, 'SE', null,
    gen_random_uuid()
  );
  perform pg_temp.check(
    'a retired country entry is rejected even when its canonical code is known',
    v_result.outcome = 'member_state_unavailable'
    and (select version = 0 from public.product_releases where id = v_other_release)
  );
  update public.member_state_reference_entries set active = true
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'SE';

  insert into public.product_releases (
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values (
    v_retired_only_release, v_org, v_other_product, v_entity, 0, '{}'::jsonb,
    'Retired availability only', 'retired-only-' || v_retired_only_release::text,
    'development', v_actor, v_actor
  );
  select * into v_result from public.add_product_release_market_availability_atomic(
    v_org, v_other_product, v_retired_only_release, v_actor, 0, 'SE', null,
    gen_random_uuid()
  );
  if v_result.outcome <> 'updated' then
    raise exception 'failed to create retired-only availability fixture: %', v_result.outcome;
  end if;
  update public.member_state_reference_entries set active = false
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'SE';
  v_correlation := gen_random_uuid();
  select * into v_result from public.transition_product_release_lifecycle_atomic(
    v_org, v_other_product, v_retired_only_release, v_actor, 1,
    'placed_on_market', v_placed_at, null, v_correlation
  );
  perform pg_temp.check(
    'a retired-only availability projection cannot satisfy placement',
    v_result.outcome = 'placement_requires_active_market_availability'
    and (select version = 1 and lifecycle = 'development'
           from public.product_releases where id = v_retired_only_release)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release'
        and entity_id = v_retired_only_release::text
        and action = 'product.release_lifecycle_transition_rejected'
        and changes->>'errorCode' = 'placement_requires_active_market_availability'
        and changes->>'correlationId' = v_correlation::text)
    and not exists (select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and release_id = v_retired_only_release
        and event_key like '%:2:%')
  );
  v_failed := false;
  begin
    update public.product_releases set
      lifecycle = 'placed_on_market',
      placed_on_market_at = v_placed_at::timestamptz,
      version = version + 1,
      updated_by = v_actor
    where organization_id = v_org and id = v_retired_only_release;
  exception when raise_exception then
    v_failed := true;
  end;
  perform pg_temp.check(
    'the release invariant trigger also rejects retired-only placement',
    v_failed
    and (select version = 1 and lifecycle = 'development'
           from public.product_releases where id = v_retired_only_release)
  );
  update public.member_state_reference_entries set active = true
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'SE';

  v_expected_version := 0;
  for v_country_code in
    select country_code from public.member_state_reference_entries
     where reference_version_id = '27000000-0000-4000-8000-000000000001'
       and active order by country_code
  loop
    select * into v_result from public.add_product_release_market_availability_atomic(
      v_org, v_other_product, v_other_release, v_actor, v_expected_version,
      v_country_code, null, gen_random_uuid()
    );
    if v_result.outcome <> 'updated' then
      raise exception 'failed to add supported country %: %', v_country_code, v_result.outcome;
    end if;
    v_expected_version := v_expected_version + 1;
  end loop;
  perform pg_temp.check(
    'one release can record every supported Member State through optimistic commands',
    v_expected_version = 27
    and (select version = 27 from public.product_releases where id = v_other_release)
    and (select count(*) = 27 from public.product_release_market_availability
      where release_id = v_other_release and unavailable_at is null)
    and (select count(*) = 27 from public.audit_logs
      where entity_type = 'product_release' and entity_id = v_other_release::text
        and action = 'product.release_market_availability_added')
  );

  update public.member_state_reference_entries set active = false
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'SE';
  v_correlation := gen_random_uuid();
  select * into v_result from public.remove_product_release_market_availability_atomic(
    v_org, v_other_product, v_other_release, v_actor, 27, 'SE', null,
    v_correlation
  );
  perform pg_temp.check(
    'a retired reference entry does not block removal of its active projection',
    v_result.outcome = 'updated'
    and v_result.release->>'versionNumber' = '28'
    and exists (select 1 from public.product_release_market_availability
      where organization_id = v_org and release_id = v_other_release
        and country_code = 'SE' and unavailable_at is not null)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release' and entity_id = v_other_release::text
        and action = 'product.release_market_availability_removed'
        and changes->'before'->>'countryCode' = 'SE'
        and changes->>'correlationId' = v_correlation::text)
  );
  update public.member_state_reference_entries set active = true
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'SE';

  update public.member_state_reference_entries set active = false
   where reference_version_id = '27000000-0000-4000-8000-000000000001'
     and country_code = 'AT';
  v_correlation := gen_random_uuid();
  select * into v_result from public.correct_product_release_market_availability_atomic(
    v_org, v_other_product, v_other_release, v_actor, 28, 'AT', 'SE', null,
    v_correlation
  );
  perform pg_temp.check(
    'a retired from-entry can be corrected to an active reference entry',
    v_result.outcome = 'updated'
    and v_result.release->>'versionNumber' = '29'
    and exists (select 1 from public.product_release_market_availability
      where organization_id = v_org and release_id = v_other_release
        and country_code = 'AT' and unavailable_at is not null)
    and exists (select 1 from public.product_release_market_availability
      where organization_id = v_org and release_id = v_other_release
        and country_code = 'SE' and unavailable_at is null)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and entity_type = 'product_release' and entity_id = v_other_release::text
        and action = 'product.release_market_availability_corrected'
        and changes->'before'->>'countryCode' = 'AT'
        and changes->'after'->>'countryCode' = 'SE'
        and changes->>'correlationId' = v_correlation::text)
  );

  v_failed := false;
  begin
    insert into public.product_lifecycle_dependency_facts (
      organization_id, product_id, release_id, authority_kind, record_id,
      reconciled_by
    ) values (v_org, v_product, v_other_release, 'retention', gen_random_uuid(), v_actor);
  exception when foreign_key_violation then
    v_failed := true;
  end;
  perform pg_temp.check(
    'composite dependency foreign key rejects a release belonging to another product',
    v_failed
  );

  v_failed := false;
  begin
    -- Flush the deferred tenant-delete FK events queued by earlier fixture
    -- inserts; ALTER TABLE cannot run while trigger events are pending.
    set constraints all immediate;
    alter table public.product_releases drop constraint product_releases_lifecycle_check;
    update public.product_releases set lifecycle = 'released' where id = v_other_release;
    perform public.m2_assert_no_legacy_release_lifecycle();
  exception when raise_exception then
    v_failed := true;
  end;
  perform pg_temp.check(
    'legacy preflight aborts on released or retired rows before lifecycle alteration',
    v_failed
  );

  insert into public.users (email) values ('m2-v1-other-owner@integration.test')
    returning id into v_other_actor;
  insert into public.organizations (name, slug)
  values ('M2 V1 Other', 'm2-v1-other-' || replace(v_other_actor::text, '-', ''))
    returning id into v_other_org;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_other_org, v_other_actor, 'owner');
  select * into v_result from public.get_product_release_market_availability(
    v_other_org, v_product, v_release, v_other_actor
  );
  perform pg_temp.check(
    'cross-tenant product and release identifiers return generic not-found',
    v_result.outcome = 'not_found' and v_result.market_availability is null
  );
  select * into v_result from public.remove_product_release_market_availability_atomic(
    v_other_org, v_other_product, v_other_release, v_other_actor, 29, 'SE', null,
    gen_random_uuid()
  );
  perform pg_temp.check(
    'retired-reference removal remains tenant isolated',
    v_result.outcome = 'not_found'
    and (select version = 29 from public.product_releases where id = v_other_release)
  );
  select * into v_result from public.correct_product_release_market_availability_atomic(
    v_other_org, v_other_product, v_other_release, v_other_actor, 29, 'SE', 'DE',
    null, gen_random_uuid()
  );
  perform pg_temp.check(
    'retired-reference correction remains tenant isolated',
    v_result.outcome = 'not_found'
    and (select version = 29 from public.product_releases where id = v_other_release)
  );
end;
$$;
rollback;
