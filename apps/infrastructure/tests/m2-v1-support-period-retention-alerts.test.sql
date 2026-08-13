-- M2 V1 support-period, retention, and alert integration tests. Fixtures are
-- isolated in one transaction and never alter seeded development records.

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
  'support-period decisions are service-role-only and retain active-scope and idempotency indexes',
  (select relrowsecurity from pg_class where oid = 'public.product_support_periods'::regclass)
  and not has_table_privilege('anon', 'public.product_support_periods', 'select')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'product_support_period_active_release_key')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'product_support_period_actor_idempotency_key')
  and not has_function_privilege('authenticated', 'public.create_product_support_period_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.create_product_support_period_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid)', 'execute')
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_product uuid := gen_random_uuid();
  v_release uuid := gen_random_uuid();
  v_initial_key uuid := gen_random_uuid();
  v_supersede_key uuid := gen_random_uuid();
  v_period_id uuid;
  v_start timestamptz := clock_timestamp();
  v_initial_end timestamptz := clock_timestamp() + interval '12 years';
  v_extended_end timestamptz := clock_timestamp() + interval '13 years';
  v_before_recalculated_at timestamptz;
  v_after_recalculated_at timestamptz;
  v_initial record;
  v_replay record;
  v_mismatch record;
  v_preview record;
  v_superseded record;
  v_read record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_entity from public.organization_legal_entities
  where organization_id = v_org and is_default;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_by, updated_by
  ) values (
    v_product, v_org, v_entity, 0, '{}'::jsonb,
    'M2 V1 support period test', 'M2-SUPPORT-' || v_product::text,
    'standalone_software', v_actor, v_actor, v_actor
  );
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values (
    v_release, v_org, v_product, v_entity, 0, '{}'::jsonb,
    'M2 V1 support release', '1.0-' || v_release::text,
    'development', v_actor, v_actor
  );

  select * into v_initial from public.create_product_support_period_atomic(
    v_org, v_product, v_release, v_actor,
    v_start, v_initial_end,
    'Expected product lifetime is twelve years for the registered release.',
    v_initial_key, gen_random_uuid()
  );
  v_period_id := (v_initial.support_period ->> 'id')::uuid;
  perform pg_temp.check('valid support decision persists an immutable first revision with three default schedules',
    v_initial.outcome = 'created'
    and (select count(*) from public.product_support_periods where id = v_period_id) = 1
    and (select count(*) from public.product_regulatory_outbox_events where support_period_id = v_period_id and event_type = 'support_period.alert') = 3
  );

  select * into v_replay from public.create_product_support_period_atomic(
    v_org, v_product, v_release, v_actor,
    v_start, v_initial_end,
    'Expected product lifetime is twelve years for the registered release.',
    v_initial_key, gen_random_uuid()
  );
  perform pg_temp.check('same support command idempotency key replays without another decision',
    v_replay.outcome = 'created'
    and (v_replay.support_period ->> 'id')::uuid = v_period_id
    and (select count(*) from public.product_support_periods where product_id = v_product) = 1
  );

  select * into v_mismatch from public.create_product_support_period_atomic(
    v_org, v_product, v_release, v_actor,
    v_start, v_extended_end,
    'Expected product lifetime is twelve years for the registered release.',
    v_initial_key, gen_random_uuid()
  );
  perform pg_temp.check('reusing an idempotency key with a different legal decision fails closed',
    v_mismatch.outcome = 'idempotency_mismatch'
  );

  select retention_recalculated_at into v_before_recalculated_at
  from public.products where id = v_product;
  select * into v_read from public.get_product_retention_calculation(v_org, v_product, v_actor);
  select retention_recalculated_at into v_after_recalculated_at
  from public.products where id = v_product;
  perform pg_temp.check('retention reads are pure and explicitly report missing placed-on-market input',
    v_read.outcome = 'found'
    and v_read.retention ->> 'status' = 'incomplete'
    and v_read.retention -> 'incompleteReasons' ? 'missing_placed_on_market_at'
    and v_before_recalculated_at is not distinct from v_after_recalculated_at
  );

  select * into v_preview from public.preview_product_support_period_change(
    v_org, v_product, v_release, v_actor, 1,
    v_start, v_extended_end,
    'Expected product lifetime is thirteen years after the reviewed extension.'
  );
  select * into v_superseded from public.supersede_product_support_period_atomic(
    v_org, v_product, v_period_id, v_actor, 1,
    v_start, v_extended_end,
    'Expected product lifetime is thirteen years after the reviewed extension.',
    'Extended support commitment after review.', v_preview.preview ->> 'previewDigest',
    false, v_supersede_key, gen_random_uuid()
  );
  perform pg_temp.check('superseding preserves history, obsoletes old schedules, and creates exactly three new schedules',
    v_superseded.outcome = 'superseded'
    and (select count(*) from public.product_support_periods where product_id = v_product and superseded_at is not null) = 1
    and (select count(*) from public.product_support_periods where product_id = v_product and superseded_at is null) = 1
    and (select count(*) from public.product_regulatory_outbox_events where product_id = v_product and event_type = 'support_period.alert' and delivery_state = 'obsolete') = 3
    and (select count(*) from public.product_regulatory_outbox_events where product_id = v_product and event_type = 'support_period.alert' and delivery_state = 'scheduled') = 3
  );
end;
$$;
rollback;
