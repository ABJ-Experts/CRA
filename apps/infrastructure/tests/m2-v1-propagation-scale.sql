-- Deliberately opt-in local performance verification for M2 V1 propagation.
-- It creates 500 products, 5,000 releases, and 5,000,000 opaque finding
-- sources inside one transaction, inspects index-backed plans, then rolls the
-- complete fixture back. Run only through run-m2-v1-propagation-scale.sh.

\set ON_ERROR_STOP on
\timing on

begin;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_source_product uuid;
  v_source_release uuid;
  v_plan jsonb;
  v_query text;
begin
  select user_row.id into v_actor
    from public.users user_row
   where user_row.email = 'owner@cra.test';
  select entity_row.id into v_entity
    from public.organization_legal_entities entity_row
   where entity_row.organization_id = v_org
     and entity_row.status = 'active'
     and entity_row.completion_status = 'complete'
   order by entity_row.is_default desc, entity_row.created_at asc
   limit 1;
  if v_actor is null or v_entity is null then
    raise exception 'M2 scale suite requires the local seeded owner and legal entity';
  end if;

  create temporary table m2_propagation_scale_products (
    ordinal integer primary key,
    product_id uuid not null
  ) on commit drop;
  create temporary table m2_propagation_scale_releases (
    ordinal integer primary key,
    product_id uuid not null,
    release_id uuid not null
  ) on commit drop;

  insert into m2_propagation_scale_products(ordinal, product_id)
  select series, gen_random_uuid()
    from generate_series(1, 500) series;
  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_by, updated_by
  )
  select fixture.product_id, v_org, v_entity, 0, '{}'::jsonb,
    'M2 propagation scale product ' || fixture.ordinal,
    'M2-PROP-SCALE-' || lpad(fixture.ordinal::text, 4, '0'),
    'standalone_software', v_actor, v_actor, v_actor
  from m2_propagation_scale_products fixture;

  insert into m2_propagation_scale_releases(ordinal, product_id, release_id)
  select (product_fixture.ordinal - 1) * 10 + release_number,
    product_fixture.product_id, gen_random_uuid()
  from m2_propagation_scale_products product_fixture
  cross join generate_series(1, 10) release_number;
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  )
  select fixture.release_id, v_org, fixture.product_id, v_entity, 0, '{}'::jsonb,
    'M2 propagation scale release ' || fixture.ordinal,
    '1.0.' || fixture.ordinal, 'development', v_actor, v_actor
  from m2_propagation_scale_releases fixture;

  -- These sources remain opaque: no SBOM, finding evidence, or assessment is
  -- represented in the fixture. They model the NFR-009 source cardinality.
  insert into public.finding_propagation_sources(
    organization_id, source_system, source_finding_key, source_product_id,
    source_release_id, rule_version, status, source, provenance,
    created_by, updated_by
  )
  select v_org, 'm2_propagation_scale', 'opaque-' || finding_number,
    release_fixture.product_id, release_fixture.release_id, 'scale-v1', 'active',
    'local-scale-suite', 'rollback-only synthetic opaque source', v_actor, v_actor
  from generate_series(1, 5000000) finding_number
  join m2_propagation_scale_releases release_fixture
    on release_fixture.ordinal = ((finding_number - 1) % 5000) + 1;

  insert into public.finding_propagation_jobs(
    organization_id, source_finding_id, trigger_key, graph_version,
    source_release_id, rule_version, as_of, requested_by
  )
  select source_row.organization_id, source_row.id,
    'm2-scale-job:' || source_row.id::text, 0,
    source_row.source_release_id, source_row.rule_version, clock_timestamp(), v_actor
  from public.finding_propagation_sources source_row
  where source_row.organization_id = v_org
    and source_row.source_system = 'm2_propagation_scale'
  order by source_row.id
  limit 100;

  insert into public.product_relationships(
    organization_id, relationship_type, source_product_id, target_product_id,
    quantity, source, provenance, reason, effective_starts_at,
    created_by, updated_by, graph_version
  )
  select v_org, 'embedded', parent_row.product_id, child_row.product_id,
    1, 'local-scale-suite', 'rollback-only chain',
    'Bounded traversal index fixture', transaction_timestamp() - interval '1 second',
    v_actor, v_actor, 0
  from m2_propagation_scale_products parent_row
  join m2_propagation_scale_products child_row
    on child_row.ordinal = parent_row.ordinal + 1;

  select product_id, release_id into v_source_product, v_source_release
    from m2_propagation_scale_releases
   where ordinal = 1;

  -- Require index-backed plans for each operational request shape. UUID values
  -- are local synthetic fixture values and are not written outside this run.
  v_query := format(
    'explain (analyze, buffers, format json) select id from public.finding_propagation_sources where organization_id = %L::uuid and status = ''active'' and source_product_id = %L::uuid and source_release_id = %L::uuid and id > ''00000000-0000-0000-0000-000000000000''::uuid order by id limit 100',
    v_org, v_source_product, v_source_release
  );
  execute v_query into v_plan;
  if v_plan::text not like '%Index%'
     or v_plan::text like '%Seq Scan%' then
    raise exception 'source-page selection must use an indexed tenant-local plan';
  end if;

  v_query := format(
    'explain (analyze, buffers, format json) select id from public.finding_propagation_jobs where organization_id = %L::uuid and status in (''scheduled'', ''retrying'') and due_at <= clock_timestamp() order by due_at, id limit 1 for update skip locked',
    v_org
  );
  execute v_query into v_plan;
  if v_plan::text not like '%Index%'
     or v_plan::text like '%Seq Scan%' then
    raise exception 'job claim must use an indexed tenant-local plan';
  end if;

  v_query := format(
    'explain (analyze, buffers, format json) with source_ids as (select id from public.finding_propagation_sources where organization_id = %L::uuid and status = ''active'' and source_product_id = %L::uuid) select count(distinct job_row.id) from public.finding_propagation_jobs job_row join source_ids on source_ids.id = job_row.source_finding_id where job_row.organization_id = %L::uuid',
    v_org, v_source_product, v_org
  );
  execute v_query into v_plan;
  if v_plan::text not like '%Index%'
     or v_plan::text like '%Seq Scan%' then
    raise exception 'impact-summary source/job lookup must use indexed tenant-local plans';
  end if;

  -- The recursive leg always names both organization and target product. The
  -- target adjacency index is therefore usable at every bounded depth.
  set local enable_seqscan = off;
  v_query := format(
    'explain (analyze, buffers, format json) with recursive walk(product_id, depth) as (select %L::uuid, 0 union all select edge.source_product_id, walk.depth + 1 from walk join public.product_relationships edge on edge.organization_id = %L::uuid and edge.relationship_type = ''embedded'' and edge.ended_at is null and edge.target_product_id = walk.product_id where walk.depth < 64) select count(*) from walk',
    (select product_id from m2_propagation_scale_products where ordinal = 500), v_org
  );
  execute v_query into v_plan;
  if v_plan::text not like '%Index%'
     or v_plan::text like '%Seq Scan%' then
    raise exception 'bounded graph traversal must use indexed target adjacency at every recursive step';
  end if;
  reset enable_seqscan;

  raise notice 'M2 propagation scale fixture passed: 500 products, 5000 releases, 5000000 opaque sources; transaction will roll back';
end;
$$;

rollback;

