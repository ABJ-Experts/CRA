-- M2 V1 variants, hierarchy, and propagation integration tests.
-- Every fixture lives in a transaction and is rolled back, preserving local data.

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
  'relationship records are service-role-only and retain active adjacency indexes',
  (select relrowsecurity from pg_class where oid = 'public.software_baselines'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.software_baseline_release_memberships'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.product_relationships'::regclass)
  and not has_table_privilege('anon', 'public.product_relationships', 'select')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'product_relationships_embedded_source_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'product_relationships_embedded_target_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'product_relationships_source_release_fkey_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'product_relationships_target_release_fkey_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'software_baseline_memberships_release_fkey_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'software_baseline_membership_active_release_key')
  and not has_function_privilege('authenticated', 'public.create_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.create_product_component_link_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid,uuid)', 'execute')
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_parent_product uuid := gen_random_uuid();
  v_child_product uuid := gen_random_uuid();
  v_parent_release uuid := gen_random_uuid();
  v_child_release uuid := gen_random_uuid();
  v_baseline_id uuid;
  v_revision_one_id uuid;
  v_graph integer;
  v_baseline record;
  v_revision record;
  v_membership record;
  v_variant record;
  v_component record;
  v_cycle record;
  v_candidates record;
  v_event record;
  v_replay record;
  v_archive record;
  v_reevaluation_key uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_entity from public.organization_legal_entities
    where organization_id = v_org and is_default;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by
  ) values
    (v_parent_product, v_org, v_entity, 0, '{}'::jsonb,
      'M2 relationship parent test', 'M2-REL-P-' || v_parent_product::text,
      'standalone_software', v_actor, v_actor, v_actor),
    (v_child_product, v_org, v_entity, 0, '{}'::jsonb,
      'M2 relationship child test', 'M2-REL-C-' || v_child_product::text,
      'standalone_software', v_actor, v_actor, v_actor);
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values
    (v_parent_release, v_org, v_parent_product, v_entity, 0, '{}'::jsonb,
      'Parent relationship release', '1.0.0-' || v_parent_release::text,
      'development', v_actor, v_actor),
    (v_child_release, v_org, v_child_product, v_entity, 0, '{}'::jsonb,
      'Child relationship release', '1.0.0-' || v_child_release::text,
      'development', v_actor, v_actor);

  select * into v_baseline from public.create_software_baseline_atomic(
    v_org, v_actor, 'baseline-' || v_parent_product::text,
    'Shared tested baseline', '', 'Initial immutable baseline revision',
    'manual', 'SQL integration fixture', v_now, null, gen_random_uuid(), gen_random_uuid()
  );
  v_baseline_id := (v_baseline.baseline ->> 'baselineId')::uuid;
  v_revision_one_id := (v_baseline.baseline ->> 'id')::uuid;
  perform pg_temp.check('baseline creation writes the first immutable revision',
    v_baseline.outcome = 'created' and (v_baseline.baseline ->> 'revisionNumber')::integer = 1
  );

  select * into v_membership from public.assign_software_baseline_membership_atomic(
    v_org, v_parent_product, v_baseline_id, v_revision_one_id, v_parent_release,
    v_actor, 0, 'manual', 'SQL integration fixture', v_now, null,
    gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('release-aware baseline membership is recorded',
    v_membership.outcome = 'created'
    and (v_membership.membership ->> 'baselineRevisionId')::uuid = v_revision_one_id
  );

  select * into v_revision from public.append_software_baseline_revision_atomic(
    v_org, v_baseline_id, v_actor, 0, 'Shared tested baseline revision two', '',
    'A later revision retains the original membership history', 'manual',
    'SQL integration fixture', v_now + interval '1 minute', null,
    gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('baseline revision does not rewrite prior release applicability',
    v_revision.outcome = 'updated'
    and (select baseline_revision_id from public.software_baseline_release_memberships
      where id = (v_membership.membership ->> 'id')::uuid) = v_revision_one_id
    and (select count(*) from public.software_baselines where baseline_id = v_baseline_id) = 2
  );

  select product_relationship_graph_version into v_graph
    from public.organization_settings where organization_id = v_org;
  select * into v_variant from public.create_product_variant_relationship_atomic(
    v_org, null, v_revision_one_id, v_child_product, v_child_release, v_actor,
    v_graph, 'manual', 'SQL integration fixture',
    'The child release shares the proven baseline', v_now, null,
    gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('baseline-source variant is release aware and advances graph version',
    v_variant.outcome = 'created'
    and (v_variant.relationship ->> 'baselineRevisionId')::uuid = v_revision_one_id
    and (v_variant.relationship ->> 'targetReleaseId')::uuid = v_child_release
  );

  select product_relationship_graph_version into v_graph
    from public.organization_settings where organization_id = v_org;
  select * into v_component from public.create_product_component_link_atomic(
    v_org, v_parent_product, v_child_product, v_actor, v_graph,
    v_parent_release, v_child_release, 2, 'manual', 'SQL integration fixture',
    'The parent embeds the child release', v_now, null, gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('embedded component link is durable and graph-versioned',
    v_component.outcome = 'created'
    and (v_component.relationship ->> 'relationshipType') = 'embedded'
    and (v_component.relationship ->> 'quantity')::integer = 2
  );

  select product_relationship_graph_version into v_graph
    from public.organization_settings where organization_id = v_org;
  select * into v_cycle from public.preview_product_component_link(
    v_org, v_child_product, v_parent_product, v_actor, v_graph,
    v_child_release, v_parent_release, 1, 'manual', 'SQL integration fixture',
    'Attempted reverse edge must be blocked', v_now, null
  );
  perform pg_temp.check('component preview rejects a direct graph cycle before persistence',
    v_cycle.outcome = 'cycle_detected'
    and (v_cycle.preview ->> 'outcome') = 'cycle_detected'
    and (select count(*) from public.product_relationships
      where organization_id = v_org and source_product_id = v_child_product and target_product_id = v_parent_product) = 0
  );

  select * into v_candidates from public.get_product_relationship_propagation_candidates(
    v_org, null, v_revision_one_id, v_actor, v_graph, v_now, 25, null
  );
  perform pg_temp.check('resolver returns candidate variants without claiming finding applicability',
    v_candidates.outcome = 'found'
    and v_candidates.candidates -> 'candidates' @> jsonb_build_array(jsonb_build_object('productId', v_child_product, 'releaseId', v_child_release))
    and v_candidates.candidates ->> 'graphVersion' = v_graph::text
  );

  select * into v_event from public.request_product_relationship_reevaluation_atomic(
    v_org, v_parent_product, v_actor, v_graph,
    'Verify durable downstream re-evaluation', 'manual', 'SQL integration fixture',
    v_reevaluation_key, gen_random_uuid()
  );
  select * into v_replay from public.request_product_relationship_reevaluation_atomic(
    v_org, v_parent_product, v_actor, v_graph,
    'Verify durable downstream re-evaluation', 'manual', 'SQL integration fixture',
    v_reevaluation_key, gen_random_uuid()
  );
  perform pg_temp.check('relationship mutation enqueues one auditable graph-change event under replay',
    v_event.outcome = 'created'
    and v_replay.outcome = 'created'
    and (v_replay.event ->> 'id') = (v_event.event ->> 'id')
    and (v_event.event ->> 'eventType') = 'product_relationship.graph_changed'
    and (select count(*) from public.product_regulatory_outbox_events
      where id = (v_event.event ->> 'id')::uuid and delivery_state = 'scheduled') = 1
  );

  select * into v_archive from public.archive_software_baseline_atomic(
    v_org, v_baseline_id, v_actor, 0,
    'Active release membership must block archival', gen_random_uuid()
  );
  perform pg_temp.check('baseline archival is blocked while active membership or variant remains',
    v_archive.outcome = 'blocked'
  );
end;
$$;
rollback;
