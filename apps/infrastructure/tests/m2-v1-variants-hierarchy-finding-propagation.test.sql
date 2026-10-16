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
  and not has_function_privilege('authenticated', 'public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text)', 'execute')
  and has_function_privilege('service_role', 'public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text)', 'execute')
  and (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz)'::regprocedure)
  and (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text)'::regprocedure)
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
  v_child_release_b2 uuid := gen_random_uuid();
  v_mixed_product_ids uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid()
  ];
  v_mixed_release_ids uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid()
  ];
  v_baseline_id uuid;
  v_revision_one_id uuid;
  v_graph integer;
  v_baseline record;
  v_revision record;
  v_membership record;
  v_variant record;
  v_component record;
  v_preview record;
  v_unprivileged_preview record;
  v_cycle record;
  v_candidates record;
  v_b1_candidates record;
  v_b2_candidates record;
  v_invalid_cursor record;
  v_mixed_candidates record;
  v_page_one record;
  v_page_two record;
  v_event record;
  v_replay record;
  v_obsolete_history record;
  v_archive record;
  v_stale_event_id uuid := gen_random_uuid();
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
      'development', v_actor, v_actor),
    (v_child_release_b2, v_org, v_child_product, v_entity, 0, '{}'::jsonb,
      'Child relationship release B2', '2.0.0-' || v_child_release_b2::text,
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
  select * into v_unprivileged_preview from public.preview_product_component_link(
    v_org, v_parent_product, v_child_product, gen_random_uuid(), v_graph,
    v_parent_release, v_child_release, 2, 'manual', 'SQL integration fixture',
    'Non-member preview must not reveal relationship feasibility', v_now, null
  );
  perform pg_temp.check('a non-member cannot read an allowed component preview',
    v_unprivileged_preview.outcome = 'not_found'
    and v_unprivileged_preview.preview is null
  );

  select * into v_preview from public.preview_product_component_link(
    v_org, v_parent_product, v_child_product, v_actor, v_graph,
    v_parent_release, v_child_release, 2, 'manual', 'SQL integration fixture',
    'Preview before create', v_now, null
  );
  perform pg_temp.check('allowed preview is an API-success outcome',
    v_preview.outcome = 'found' and v_preview.preview ->> 'outcome' = 'allowed');

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

  select * into v_b2_candidates from public.get_product_relationship_propagation_candidates(
    v_org, v_child_release_b2, null, v_actor, v_graph, v_now, 25, null
  );
  perform pg_temp.check('a release-scoped component link excludes other child releases',
    not (v_b2_candidates.candidates -> 'candidates' @>
      jsonb_build_array(jsonb_build_object('productId', v_parent_product)))
  );

  select * into v_b1_candidates from public.get_product_relationship_propagation_candidates(
    v_org, v_child_release, null, v_actor, v_graph, v_now, 25, null
  );
  perform pg_temp.check('the matching child release reaches its parent',
    v_b1_candidates.outcome = 'found'
    and v_b1_candidates.candidates -> 'candidates' @>
      jsonb_build_array(jsonb_build_object('productId', v_parent_product, 'releaseId', v_parent_release))
  );

  select * into v_page_one from public.get_product_relationship_propagation_candidates(
    v_org, v_child_release, null, v_actor, v_graph, v_now, 1, null
  );
  select * into v_page_two from public.get_product_relationship_propagation_candidates(
    v_org, v_child_release, null, v_actor, v_graph, v_now, 1,
    v_page_one.candidates ->> 'nextCursor'
  );
  perform pg_temp.check('one-item propagation pages return every candidate exactly once',
    v_page_one.outcome = 'found'
    and v_page_two.outcome = 'found'
    and jsonb_array_length(v_page_one.candidates -> 'candidates') = 1
    and jsonb_array_length(v_page_two.candidates -> 'candidates') = 1
    and v_page_one.candidates ->> 'nextCursor' =
      (v_page_one.candidates -> 'candidates' -> 0 ->> 'productId') || ':' ||
      coalesce(v_page_one.candidates -> 'candidates' -> 0 ->> 'releaseId', '')
    and v_page_two.candidates ->> 'nextCursor' is null
    and (select count(*) = 2
      and count(distinct (candidate ->> 'productId', candidate ->> 'releaseId')) = 2
      from (
        select candidate from jsonb_array_elements(v_page_one.candidates -> 'candidates') candidate
        union all
        select candidate from jsonb_array_elements(v_page_two.candidates -> 'candidates') candidate
      ) pages)
  );

  -- Work from product five to product one. The chain alternates release-scoped
  -- and product-wide links, so the null scope on product four must allow the
  -- walk to cross the release-scoped product-three link without revisiting a
  -- product or leaking outside this organization.
  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by
  )
  select product_id, v_org, v_entity, 0, '{}'::jsonb,
    'M2 mixed-scope product ' || ordinal,
    'M2-MIXED-' || product_id::text,
    'standalone_software', v_actor, v_actor, v_actor
  from unnest(v_mixed_product_ids) with ordinality as scope(product_id, ordinal);
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  )
  select release_id, v_org, v_mixed_product_ids[ordinal], v_entity, 0, '{}'::jsonb,
    'M2 mixed-scope release ' || ordinal,
    ordinal::text || '.0.0-' || release_id::text,
    'development', v_actor, v_actor
  from unnest(v_mixed_release_ids) with ordinality as scope(release_id, ordinal);
  insert into public.product_relationships(
    organization_id, relationship_type, source_product_id, target_product_id,
    source_release_id, target_release_id, quantity, source, provenance, reason,
    effective_starts_at, created_by, updated_by, graph_version
  ) values
    (v_org, 'embedded', v_mixed_product_ids[1], v_mixed_product_ids[2],
      v_mixed_release_ids[1], v_mixed_release_ids[2], 1, 'manual',
      'SQL integration fixture', 'Release-scoped mixed traversal edge', v_now,
      v_actor, v_actor, v_graph),
    (v_org, 'embedded', v_mixed_product_ids[2], v_mixed_product_ids[3],
      null, null, 1, 'manual', 'SQL integration fixture',
      'Product-wide mixed traversal edge', v_now, v_actor, v_actor, v_graph),
    (v_org, 'embedded', v_mixed_product_ids[3], v_mixed_product_ids[4],
      v_mixed_release_ids[3], v_mixed_release_ids[4], 1, 'manual',
      'SQL integration fixture', 'Release-scoped mixed traversal edge', v_now,
      v_actor, v_actor, v_graph),
    (v_org, 'embedded', v_mixed_product_ids[4], v_mixed_product_ids[5],
      null, null, 1, 'manual', 'SQL integration fixture',
      'Product-wide mixed traversal edge', v_now, v_actor, v_actor, v_graph);
  select * into v_mixed_candidates from public.get_product_relationship_propagation_candidates(
    v_org, v_mixed_release_ids[5], null, v_actor, v_graph, v_now, 25, null
  );
  perform pg_temp.check('product-wide scope crosses a downstream release-specific edge',
    v_mixed_candidates.outcome = 'found'
    and v_mixed_candidates.candidates -> 'candidates' @>
      jsonb_build_array(jsonb_build_object('productId', v_mixed_product_ids[1], 'releaseId', v_mixed_release_ids[1]))
  );
  perform pg_temp.check('mixed-scope candidate paths stay tenant-scoped, acyclic, and bounded',
    (select coalesce(bool_and(r.organization_id = v_org), true)
      from jsonb_array_elements(v_mixed_candidates.candidates -> 'candidates') candidate
      cross join lateral jsonb_array_elements_text(candidate -> 'relationshipPathIds') path(id_text)
      join public.product_relationships r on r.id = path.id_text::uuid
      where candidate ->> 'productId' = v_mixed_product_ids[1]::text)
    and (select coalesce(bool_and(path.product_count = jsonb_array_length(candidate -> 'relationshipPathIds') + 1), true)
      from jsonb_array_elements(v_mixed_candidates.candidates -> 'candidates') candidate
      cross join lateral (
        select count(*) as product_count
        from (
          select r.source_product_id as product_id
          from jsonb_array_elements_text(candidate -> 'relationshipPathIds') path(id_text)
          join public.product_relationships r on r.id = path.id_text::uuid
          union
          select r.target_product_id
          from jsonb_array_elements_text(candidate -> 'relationshipPathIds') path(id_text)
          join public.product_relationships r on r.id = path.id_text::uuid
        ) path_products
      ) path
      where candidate ->> 'productId' = v_mixed_product_ids[1]::text)
    and (select coalesce(bool_and(jsonb_array_length(candidate -> 'relationshipPathIds') <= 64), true)
      from jsonb_array_elements(v_mixed_candidates.candidates -> 'candidates') candidate
      where candidate ->> 'productId' = v_mixed_product_ids[1]::text)
  );

  select * into v_invalid_cursor from public.get_product_relationship_propagation_candidates(
    v_org, v_child_release, null, v_actor, v_graph, v_now, 25, 'invalid'
  );
  perform pg_temp.check('candidate cursor must be canonical',
    v_invalid_cursor.outcome = 'invalid_request'
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

  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state, graph_version, obsolete_at,
    last_error_code
  ) values (
    v_stale_event_id, v_org, v_parent_product, null,
    'product_relationship.graph_changed',
    'relationship:history:obsolete:' || v_stale_event_id::text,
    jsonb_build_object('private', 'never returned from relationship history'),
    gen_random_uuid(), v_now, 'obsolete', v_graph, clock_timestamp(), 'stale_graph'
  );
  select * into v_obsolete_history
    from public.get_product_relationship_propagation_events(
      v_org, v_actor, v_parent_product, null, 25, 'obsolete'
    );
  perform pg_temp.check(
    'relationship history filters and represents obsolete graph events without private payloads',
    v_obsolete_history.outcome = 'found'
      and v_obsolete_history.events -> 'events' @> jsonb_build_array(
        jsonb_build_object(
          'id', v_stale_event_id,
          'deliveryState', 'obsolete',
          'lastErrorCode', 'stale_graph'
        )
      )
      and (v_obsolete_history.events -> 'events' -> 0 ? 'obsoleteAt')
      and not (v_obsolete_history.events -> 'events' -> 0 ? 'payload')
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

select pg_temp.check(
  'relationship graph event leasing functions are security-definer, pinned, and service-role-only',
  (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.claim_product_relationship_graph_event_atomic(uuid,uuid,integer)'::regprocedure)
  and (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.complete_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer)'::regprocedure)
  and (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.fail_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer,text,boolean)'::regprocedure)
  and (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.checkpoint_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer,text,boolean)'::regprocedure)
  and not has_function_privilege('public', 'public.claim_product_relationship_graph_event_atomic(uuid,uuid,integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_product_relationship_graph_event_atomic(uuid,uuid,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_product_relationship_graph_event_atomic(uuid,uuid,integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_product_relationship_graph_event_atomic(uuid,uuid,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer)', 'execute')
  and has_function_privilege('service_role', 'public.complete_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.fail_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.fail_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.checkpoint_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.checkpoint_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer,text,boolean)', 'execute')
);

begin;
do $$
declare
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_scheduled_event uuid := gen_random_uuid();
  v_expired_event uuid := gen_random_uuid();
  v_retry_event uuid := gen_random_uuid();
  v_dead_letter_event uuid := gen_random_uuid();
  v_exhausted_event uuid := gen_random_uuid();
  v_checkpoint_event uuid := gen_random_uuid();
  v_first_owner uuid := gen_random_uuid();
  v_second_owner uuid := gen_random_uuid();
  v_expired_owner uuid := gen_random_uuid();
  v_retry_owner uuid := gen_random_uuid();
  v_dead_letter_owner uuid := gen_random_uuid();
  v_exhausted_owner uuid := gen_random_uuid();
  v_cross_tenant_claim record;
  v_first_claim record;
  v_second_claim record;
  v_expired_completion record;
  v_expired_failure record;
  v_reclaimed_claim record;
  v_conflicting_completion record;
  v_wrong_owner_completion record;
  v_completed record;
  v_replayed_completion_count integer;
  v_replayed_completion_outcome text;
  v_cross_tenant_completion record;
  v_retry_claim record;
  v_retry_failure record;
  v_dead_letter_claim record;
  v_dead_letter_failure record;
  v_exhausted_claim record;
  v_exhausted_failure record;
  v_invalid_claim record;
  v_checkpoint_claim record;
  v_checkpoint_complete record;
  v_checkpoint_replay record;
begin
  insert into public.organizations(id, name, slug, size)
  values (
    v_org, 'M2 relationship lease tenant',
    'm2-lease-' || substr(v_org::text, 1, 8), '1-10'
  );
  insert into public.organizations(id, name, slug, size)
  values (
    v_other_org, 'M2 relationship lease isolation tenant',
    'm2-lease-other-' || substr(v_other_org::text, 1, 8), '1-10'
  );
  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state, graph_version
  ) values (
    v_scheduled_event, v_org, v_product, null,
      'product_relationship.graph_changed', 'relationship:lease:scheduled:' || v_scheduled_event::text,
      jsonb_build_object('private', 'never returned or audited'), gen_random_uuid(),
      clock_timestamp(), null, 'scheduled', 7
  );

  select * into v_cross_tenant_claim
    from public.claim_product_relationship_graph_event_atomic(v_other_org, gen_random_uuid(), 60);
  select * into v_first_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_first_owner, 60);
  select * into v_second_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_second_owner, 60);
  perform pg_temp.check('a scheduled relationship graph event with no due time claims exclusively and stays tenant-scoped',
    v_cross_tenant_claim.outcome = 'none_available'
    and v_first_claim.outcome = 'claimed'
    and v_first_claim.event_id = v_scheduled_event
    and v_first_claim.organization_id = v_org
    and v_first_claim.product_id = v_product
    and v_first_claim.graph_version = 7
    and v_first_claim.event_key = 'relationship:lease:scheduled:' || v_scheduled_event::text
    and v_first_claim.lease_owner = v_first_owner
    and v_first_claim.retry_count = 1
    and v_second_claim.outcome = 'none_available'
    and (select delivery_state = 'leased' and lease_owner = v_first_owner
      from public.product_regulatory_outbox_events
      where organization_id = v_org and id = v_scheduled_event)
    and not (to_jsonb(v_first_claim) ? 'payload')
  );

  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state, graph_version,
    lease_owner, lease_expires_at, checkpoint_version, delivery_attempts
  ) values (
    v_expired_event, v_org, v_product, null,
    'product_relationship.graph_changed', 'relationship:lease:expired:' || v_expired_event::text,
    jsonb_build_object('private', 'never returned or audited'), gen_random_uuid(),
    clock_timestamp(), clock_timestamp() - interval '1 second', 'leased', 8,
    v_expired_owner, clock_timestamp() - interval '1 second', 4, 2
  );
  select * into v_expired_completion
    from public.complete_product_relationship_graph_event_atomic(
      v_org, v_expired_event, v_expired_owner, 4
    );
  select * into v_expired_failure
    from public.fail_product_relationship_graph_event_atomic(
      v_org, v_expired_event, v_expired_owner, 4, 'upstream_timeout', true
    );
  select * into v_reclaimed_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_second_owner, 60);
  perform pg_temp.check('an expired relationship graph lease is reclaimed with a new owner and checkpoint',
    v_expired_completion.outcome = 'conflict'
    and v_expired_failure.outcome = 'conflict'
    and v_reclaimed_claim.outcome = 'claimed'
    and v_reclaimed_claim.event_id = v_expired_event
    and v_reclaimed_claim.lease_owner = v_second_owner
    and v_reclaimed_claim.checkpoint_version = 5
    and v_reclaimed_claim.retry_count = 3
  );

  select * into v_conflicting_completion
    from public.complete_product_relationship_graph_event_atomic(
      v_org, v_expired_event, v_second_owner, v_reclaimed_claim.checkpoint_version - 1
    );
  select * into v_wrong_owner_completion
    from public.complete_product_relationship_graph_event_atomic(
      v_org, v_expired_event, v_expired_owner, v_reclaimed_claim.checkpoint_version
    );
  select * into v_completed
    from public.complete_product_relationship_graph_event_atomic(
      v_org, v_expired_event, v_second_owner, v_reclaimed_claim.checkpoint_version
    );
  select count(*), min(replay.outcome)
    into v_replayed_completion_count, v_replayed_completion_outcome
    from public.complete_product_relationship_graph_event_atomic(
      v_org, v_expired_event, v_second_owner, v_reclaimed_claim.checkpoint_version
    ) replay;
  select * into v_cross_tenant_completion
    from public.complete_product_relationship_graph_event_atomic(
      v_other_org, v_expired_event, v_second_owner, v_reclaimed_claim.checkpoint_version
    );
  perform pg_temp.check('completion requires the matching organization, owner, and checkpoint, then is idempotent for replay',
    v_conflicting_completion.outcome = 'conflict'
    and v_wrong_owner_completion.outcome = 'conflict'
    and v_completed.outcome = 'completed'
    and v_replayed_completion_count = 1
    and v_replayed_completion_outcome = 'delivered'
    and v_cross_tenant_completion.outcome = 'not_found'
    and (select delivery_state = 'delivered' and lease_owner is null and lease_expires_at is null
      from public.product_regulatory_outbox_events
      where organization_id = v_org and id = v_expired_event)
  );

  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state, graph_version
  ) values (
    v_retry_event, v_org, v_product, null,
    'product_relationship.graph_changed', 'relationship:lease:retry:' || v_retry_event::text,
    jsonb_build_object('private', 'never returned or audited'), gen_random_uuid(),
    clock_timestamp(), clock_timestamp() - interval '1 second', 'scheduled', 9
  );
  select * into v_retry_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_retry_owner, 60);
  select * into v_retry_failure
    from public.fail_product_relationship_graph_event_atomic(
      v_org, v_retry_event, v_retry_owner, v_retry_claim.checkpoint_version,
      'upstream_timeout', true
    );
  perform pg_temp.check('a retryable relationship graph event clears its lease and receives bounded backoff',
    v_retry_claim.outcome = 'claimed'
    and v_retry_claim.event_id = v_retry_event
    and v_retry_failure.outcome = 'retry_scheduled'
    and v_retry_failure.error_code = 'upstream_timeout'
    and (select delivery_state = 'retrying'
      and lease_owner is null
      and lease_expires_at is null
      and due_at > clock_timestamp()
      and last_error_code = 'upstream_timeout'
      from public.product_regulatory_outbox_events
      where organization_id = v_org and id = v_retry_event)
  );

  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state, graph_version
  ) values (
    v_dead_letter_event, v_org, v_product, null,
    'product_relationship.graph_changed', 'relationship:lease:dead-letter:' || v_dead_letter_event::text,
    jsonb_build_object('private', 'never returned or audited'), gen_random_uuid(),
    clock_timestamp(), clock_timestamp() - interval '1 second', 'scheduled', 10
  );
  select * into v_dead_letter_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_dead_letter_owner, 60);
  select * into v_dead_letter_failure
    from public.fail_product_relationship_graph_event_atomic(
      v_org, v_dead_letter_event, v_dead_letter_owner, v_dead_letter_claim.checkpoint_version,
      'invalid_source_data', false
    );
  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state, graph_version, delivery_attempts
  ) values (
    v_exhausted_event, v_org, v_product, null,
    'product_relationship.graph_changed', 'relationship:lease:exhausted:' || v_exhausted_event::text,
    jsonb_build_object('private', 'never returned or audited'), gen_random_uuid(),
    clock_timestamp(), clock_timestamp() - interval '1 second', 'scheduled', 11, 11
  );
  select * into v_exhausted_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_exhausted_owner, 60);
  select * into v_exhausted_failure
    from public.fail_product_relationship_graph_event_atomic(
      v_org, v_exhausted_event, v_exhausted_owner, v_exhausted_claim.checkpoint_version,
      'upstream_timeout', true
    );
  perform pg_temp.check('nonretryable and exhausted relationship graph events become dead letters without source payload logs',
    v_dead_letter_claim.outcome = 'claimed'
    and v_dead_letter_failure.outcome = 'dead_letter'
    and v_exhausted_claim.outcome = 'claimed'
    and v_exhausted_failure.outcome = 'dead_letter'
    and (select delivery_state = 'dead_letter' and lease_owner is null and lease_expires_at is null
      and last_error_code = 'invalid_source_data'
      from public.product_regulatory_outbox_events
      where organization_id = v_org and id = v_dead_letter_event)
    and (select delivery_state = 'dead_letter' and last_error_code = 'upstream_timeout'
      from public.product_regulatory_outbox_events
      where organization_id = v_org and id = v_exhausted_event)
    and not exists (
      select 1 from public.audit_logs audit
      where audit.organization_id = v_org
        and audit.entity_type = 'product_relationship_graph_event'
        and audit.entity_id in (
          v_scheduled_event::text, v_expired_event::text, v_retry_event::text,
          v_dead_letter_event::text, v_exhausted_event::text
        )
        and audit.changes ? 'payload'
    )
  );

  insert into public.product_regulatory_outbox_events(
    id, organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state, graph_version
  ) values (
    v_checkpoint_event, v_org, v_product, null,
    'product_relationship.graph_changed',
    'relationship:lease:checkpoint:' || v_checkpoint_event::text,
    jsonb_build_object('private', 'never returned or audited'), gen_random_uuid(),
    clock_timestamp(), clock_timestamp() - interval '1 second', 'scheduled', 0
  );
  select * into v_checkpoint_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_first_owner, 60);
  select * into v_checkpoint_complete
    from public.checkpoint_product_relationship_graph_event_atomic(
      v_org, v_checkpoint_event, v_first_owner,
      v_checkpoint_claim.checkpoint_version, null, true
    );
  select * into v_checkpoint_replay
    from public.checkpoint_product_relationship_graph_event_atomic(
      v_org, v_checkpoint_event, v_first_owner,
      v_checkpoint_claim.checkpoint_version, null, true
    );
  perform pg_temp.check('a final graph-event checkpoint is idempotent after the worker loses its first response',
    v_checkpoint_claim.outcome = 'claimed'
      and v_checkpoint_claim.event_id = v_checkpoint_event
      and v_checkpoint_complete.outcome = 'completed'
      and v_checkpoint_replay.outcome = 'delivered'
      and (select delivery_state = 'delivered'
        and checkpoint_version = v_checkpoint_complete.checkpoint_version
        from public.product_regulatory_outbox_events
       where organization_id = v_org and id = v_checkpoint_event)
  );

  select * into v_invalid_claim
    from public.claim_product_relationship_graph_event_atomic(v_org, v_first_owner, 0);
  perform pg_temp.check('relationship graph lease commands reject invalid lease arguments',
    v_invalid_claim.outcome = 'invalid_request'
  );
end;
$$;
rollback;
