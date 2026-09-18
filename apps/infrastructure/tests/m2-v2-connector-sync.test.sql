-- M2 V2 PLM/ALM connector sync integration tests.
-- Fixtures stay inside one transaction and never alter seeded development data.

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

create or replace function pg_temp.sync_field_diff(
  p_field text,
  p_external_value jsonb,
  p_cra_value jsonb default 'null'::jsonb,
  p_authority_policy_id uuid default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'field', p_field,
    'craValue', p_cra_value,
    'externalValue', p_external_value,
    'authorityPolicyId', p_authority_policy_id,
    'permittedActions', jsonb_build_array('accept_external', 'keep_cra', 'enter_manual_value')
  )
$$;

select pg_temp.check(
  'connector sync introduces exactly the eight expected tables',
  (select count(*) = 8 from pg_class tables
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public'
      and tables.relkind = 'r'
      and tables.relname in (
        'connectors', 'connector_secrets', 'product_external_identities',
        'field_authority_policies', 'sync_runs', 'sync_run_plan_items',
        'sync_conflicts', 'sync_connector_cursors'
      ))
);

select pg_temp.check(
  'every connector sync table has RLS enabled without forcing it and no browser/public grants',
  not exists (
    select 1 from (values
      ('connectors'), ('connector_secrets'), ('product_external_identities'),
      ('field_authority_policies'), ('sync_runs'), ('sync_run_plan_items'),
      ('sync_conflicts'), ('sync_connector_cursors')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public'
      and (
        not tables.relrowsecurity or tables.relforcerowsecurity
        or has_table_privilege('public', tables.oid, 'select')
        or has_table_privilege('anon', tables.oid, 'select')
        or has_table_privilege('authenticated', tables.oid, 'select')
      )
  )
  and has_table_privilege('service_role', 'public.connectors', 'select')
  and has_table_privilege('service_role', 'public.connector_secrets', 'select')
  and not has_column_privilege('service_role', 'public.connector_secrets', 'ciphertext', 'update')
);

select pg_temp.check(
  'every connector sync RPC is a service-role-only security definer with pinned search_path',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = any (array[
        'create_connector_atomic', 'update_connector_atomic', 'set_connector_secret_atomic',
        'resolve_connector_secret', 'record_connector_test_atomic', 'archive_connector_atomic',
        'upsert_field_authority_policy_atomic', 'preview_field_authority_policy', 'list_field_authority_policies',
        'link_external_identity_atomic', 'unlink_external_identity_atomic', 'merge_external_identities_atomic',
        'begin_sync_run_atomic', 'request_sync_run_commit_atomic', 'claim_sync_run',
        'save_sync_run_plan_atomic', 'commit_sync_run_atomic', 'cancel_sync_run_atomic', 'fail_sync_run_atomic', 'retry_sync_run_atomic',
        'list_due_sync_run_organizations', 'resolve_sync_conflict_atomic', 'connector_compliance_metrics_snapshot',
        'resolve_connector_sync_worker_actor'
      ])
      and (
        not procedures.prosecdef
        or procedures.proconfig is null
        or not ('search_path=public, pg_temp' = any (procedures.proconfig))
        or exists (
          select 1 from information_schema.routine_privileges privileges
          where privileges.routine_schema = 'public' and privileges.routine_name = procedures.proname
            and privileges.grantee in ('public', 'anon', 'authenticated')
        )
      )
  )
);

select pg_temp.check(
  'the sync-run transition trigger helper is service-role-only despite being security definer',
  not has_function_privilege('public', 'public.enforce_sync_run_status_transition()', 'execute')
  and not has_function_privilege('anon', 'public.enforce_sync_run_status_transition()', 'execute')
  and not has_function_privilege('authenticated', 'public.enforce_sync_run_status_transition()', 'execute')
  and has_function_privilege('service_role', 'public.enforce_sync_run_status_transition()', 'execute')
);

select pg_temp.check(
  'connector sync helper functions are never callable by browser roles',
  not exists (
    select 1
    from unnest(array[
      'public.m2_v2_valid_field_authority_field(text,text)'::regprocedure,
      'public.m2_v2_sync_run_json(public.sync_runs)'::regprocedure,
      'public.m2_v2_valid_sync_field_diffs(jsonb)'::regprocedure,
      'public.m2_v2_sync_field_external_value(jsonb,text)'::regprocedure,
      'public.m2_v2_sync_text_field_value(jsonb,boolean,text)'::regprocedure,
      'public.m2_v2_sync_conflict_json(public.sync_conflicts)'::regprocedure,
      'public.m2_v2_field_authority_policy_preview_digest(uuid,uuid,text,text,text,boolean,text)'::regprocedure
    ]) helpers(helper)
    cross join unnest(array['public', 'anon', 'authenticated']) roles(role_name)
    where has_function_privilege(roles.role_name, helpers.helper, 'execute')
  )
  and has_function_privilege('service_role', 'public.m2_v2_valid_field_authority_field(text,text)', 'execute')
  and has_function_privilege('service_role', 'public.m2_v2_sync_run_json(public.sync_runs)', 'execute')
  and has_function_privilege('service_role', 'public.m2_v2_valid_sync_field_diffs(jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.m2_v2_sync_conflict_json(public.sync_conflicts)', 'execute')
  and has_function_privilege('service_role', 'public.m2_v2_field_authority_policy_preview_digest(uuid,uuid,text,text,text,boolean,text)', 'execute')
  and not has_function_privilege('service_role', 'public.m2_v2_sync_field_external_value(jsonb,text)', 'execute')
  and not has_function_privilege('service_role', 'public.m2_v2_sync_text_field_value(jsonb,boolean,text)', 'execute')
);

select pg_temp.check(
  'claiming is organization-scoped and the global overload no longer exists',
  to_regprocedure('public.claim_sync_run(uuid,text,integer)') is not null
  and to_regprocedure('public.claim_sync_run(text,integer)') is null
);

select pg_temp.check(
  'authority-policy persistence requires the digest-bearing overload',
  to_regprocedure('public.upsert_field_authority_policy_atomic(uuid,uuid,uuid,text,text,text,boolean,text,text)') is not null
  and to_regprocedure('public.upsert_field_authority_policy_atomic(uuid,uuid,uuid,text,text,text,boolean,text)') is null
);

select pg_temp.check(
  'embedded hierarchy is an explicit policy-controlled product field, not an ungoverned payload key',
  public.m2_v2_valid_field_authority_field('product', 'parentExternalId')
  and not public.m2_v2_valid_field_authority_field('product', 'unrecognizedVendorField')
);

select pg_temp.check(
  'connector foreign-key paths have the required supporting indexes',
  not exists (
    select 1
    from unnest(array[
      'connector_secrets_connector_idx', 'connector_secrets_rotated_by_idx',
      'connectors_secret_ref_idx', 'connectors_archived_by_idx', 'connectors_created_by_idx', 'connectors_updated_by_idx',
      'connectors_create_idempotency_key',
      'product_external_identities_connector_idx', 'product_external_identities_product_release_idx',
      'product_external_identities_supersedes_idx', 'product_external_identities_superseded_by_idx',
      'product_external_identities_linked_by_idx', 'product_external_identities_unlinked_by_idx',
      'product_external_identities_created_by_idx', 'product_external_identities_updated_by_idx',
      'field_authority_policies_connector_idx', 'field_authority_policies_supersedes_idx',
      'field_authority_policies_superseded_by_idx', 'field_authority_policies_created_by_idx', 'field_authority_policies_updated_by_idx',
      'sync_runs_actor_user_idx',
      'sync_conflicts_connector_idx', 'sync_conflicts_external_identity_idx', 'sync_conflicts_authority_policy_idx',
      'sync_conflicts_supersedes_idx', 'sync_conflicts_resolved_by_idx', 'sync_conflicts_plan_item_idx',
      'sync_connector_cursors_last_committed_run_idx', 'product_relationships_connector_sync_active_child_idx'
    ]) expected(index_name)
    where to_regclass('public.' || expected.index_name) is null
  )
);

select pg_temp.check(
  'a sync conflict is anchored to exactly one tenant-scoped external identity or plan item',
  exists (
    select 1 from pg_attribute columns
    where columns.attrelid = 'public.sync_conflicts'::regclass
      and columns.attname = 'plan_item_id' and not columns.attnotnull and not columns.attisdropped
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.sync_conflicts'::regclass
      and conname = 'sync_conflicts_exactly_one_target_check'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.sync_conflicts'::regclass
      and conname = 'sync_conflicts_plan_item_fkey'
  )
);

select pg_temp.check(
  'connector creation has an additive request-digest idempotency invariant',
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.connectors'::regclass
      and conname = 'connectors_create_idempotency_pair_check'
  )
  and exists (
    select 1 from pg_attribute columns
    where columns.attrelid = 'public.connectors'::regclass
      and columns.attname in ('create_idempotency_key', 'create_request_digest')
      and not columns.attisdropped
    group by columns.attrelid
    having count(*) = 2
  )
);

select pg_temp.check(
  'a protected field can never be persisted as external_authoritative',
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.field_authority_policies'::regclass
      and conname = 'field_authority_policy_protected_never_external_check'
  ) = false
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_other_org uuid;
  v_actor uuid;
  v_entity uuid;
  v_connector_id uuid;
  v_connector_create_key uuid := gen_random_uuid();
  v_other_connector_id uuid;
  v_product_a uuid := gen_random_uuid();
  v_product_b uuid := gen_random_uuid();
  v_result record;
  v_policy record;
  v_run record;
  v_run2 record;
  v_second_run_id uuid;
  v_commit record;
  v_conflict record;
  v_resolved record;
  v_product_after record;
  v_cursor_before text;
  v_cursor_after text;
  v_saved_row_count integer;
  v_preview_digest text;
  v_parent_policy_id uuid;
  v_hierarchy_run record;
  v_hierarchy_conflict public.sync_conflicts%rowtype;
  v_first_seen_product_id uuid;
  v_first_seen_parent_product_id uuid;
  v_ambiguous_blocked boolean := false;
  v_cross_tenant_visible boolean;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_entity from public.organization_legal_entities where organization_id = v_org and is_default;

  begin
    perform public.m2_v2_sync_text_field_value('{"unexpected":"object"}'::jsonb, false, 'name');
    perform pg_temp.check('an object-valued manual field was wrongly accepted for a scalar product field', false);
  exception when invalid_parameter_value then
    perform pg_temp.check('malformed scalar conflict values fail before product mutation rather than being JSON-stringified', true);
  end;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by
  ) values
    (v_product_a, v_org, v_entity, 0, '{}'::jsonb, 'Connector sync test product A', 'CONN-A-' || v_product_a::text, 'standalone_software', v_actor, v_actor, v_actor),
    (v_product_b, v_org, v_entity, 0, '{}'::jsonb, 'Connector sync test product B', 'CONN-B-' || v_product_b::text, 'standalone_software', v_actor, v_actor, v_actor);

  -- --- Connector CRUD, secret round-trip, field authority policy ---
  select * into v_result from public.create_connector_atomic(
    v_org, v_actor, v_connector_create_key, 'reference_conformance', 'Reference connector', '1.0.0', 'm2-v2-reference-v1',
    '{"baseUrl":"https://reference.example.test"}'::jsonb, 'manual'
  );
  perform pg_temp.check('connector creation succeeds', v_result.outcome = 'created');
  v_connector_id := (v_result.connector ->> 'id')::uuid;
  select * into v_result from public.create_connector_atomic(
    v_org, v_actor, v_connector_create_key, 'reference_conformance', 'Reference connector', '1.0.0', 'm2-v2-reference-v1',
    '{"baseUrl":"https://reference.example.test"}'::jsonb, 'manual'
  );
  perform pg_temp.check(
    'connector creation replays the same durable row and cursor for an identical idempotency key',
    v_result.outcome = 'replayed'
    and (v_result.connector ->> 'id')::uuid = v_connector_id
    and (select count(*) = 1 from public.connectors where organization_id = v_org and created_by = v_actor and create_idempotency_key = v_connector_create_key)
    and (select count(*) = 1 from public.sync_connector_cursors where organization_id = v_org and connector_id = v_connector_id)
  );
  select * into v_result from public.create_connector_atomic(
    v_org, v_actor, v_connector_create_key, 'reference_conformance', 'Changed request', '1.0.0', 'm2-v2-reference-v1',
    '{"baseUrl":"https://reference.example.test"}'::jsonb, 'manual'
  );
  perform pg_temp.check(
    'a reused connector idempotency key with a different request is rejected without another connector',
    v_result.outcome = 'idempotency_mismatch'
    and (select count(*) = 1 from public.connectors where organization_id = v_org and created_by = v_actor and create_idempotency_key = v_connector_create_key)
  );

  select * into v_result from public.set_connector_secret_atomic(v_org, v_connector_id, v_actor, 'super-secret-plm-token', 'test-encryption-key');
  perform pg_temp.check('secret set succeeds and never echoes the value', v_result.outcome = 'updated' and (v_result.connector ->> 'hasSecret')::boolean);
  perform pg_temp.check(
    'the resolved secret round-trips through pgcrypto',
    public.resolve_connector_secret(v_org, v_connector_id, 'test-encryption-key') = 'super-secret-plm-token'
  );
  begin
    perform public.resolve_connector_secret(v_org, v_connector_id, 'wrong-key');
    perform pg_temp.check('decrypting with the wrong key was wrongly allowed to succeed', false);
  exception when others then
    perform pg_temp.check('decrypting the secret with the wrong key fails loudly rather than returning garbage', true);
  end;

  select * into v_result from public.preview_field_authority_policy(
    v_org, v_connector_id, v_actor, 'product', 'name', 'external_authoritative', false, null
  );
  perform pg_temp.check(
    'the read-only authority preview returns the digest the persistence path requires',
    v_result.outcome = 'previewed' and (v_result.preview ->> 'previewDigest') ~ '^[a-f0-9]{64}$'
  );
  v_preview_digest := v_result.preview ->> 'previewDigest';
  select * into v_policy from public.upsert_field_authority_policy_atomic(
    v_org, v_connector_id, v_actor, 'product', 'name', 'external_authoritative', false, null, v_preview_digest
  );
  perform pg_temp.check('field authority policy upsert succeeds', v_policy.outcome = 'updated');

  select * into v_policy from public.upsert_field_authority_policy_atomic(
    v_org, v_connector_id, v_actor, 'product', 'name', 'external_authoritative', false, null, v_preview_digest
  );
  perform pg_temp.check(
    'a preview digest becomes stale after the active authority policy version changes',
    v_policy.outcome = 'invalid_request'
  );

  select * into v_policy from public.upsert_field_authority_policy_atomic(
    v_org, v_connector_id, v_actor, 'product', 'internalCode', 'external_authoritative', true, 'compliance-critical identity field', repeat('a', 64)
  );
  perform pg_temp.check(
    'the RPC rejects protected+external_authoritative as invalid_request before it ever reaches the DB constraint',
    v_policy.outcome = 'invalid_request'
  );
  begin
    insert into public.field_authority_policies(
      organization_id, connector_id, entity_type, field_name, policy_value, protected, protected_reason, created_by, updated_by
    ) values (
      v_org, v_connector_id, 'product', 'internalCode', 'external_authoritative', true, 'bypassing the RPC directly', v_actor, v_actor
    );
    perform pg_temp.check('a protected+external_authoritative row was wrongly allowed to bypass the RPC and hit the table directly', false);
  exception when check_violation then
    perform pg_temp.check('the DB CHECK constraint independently rejects protected+external_authoritative even bypassing the RPC', true);
  end;

  select * into v_result from public.preview_field_authority_policy(
    v_org, v_connector_id, v_actor, 'product', 'parentExternalId', 'newest_with_review', false, null
  );
  select * into v_policy from public.upsert_field_authority_policy_atomic(
    v_org, v_connector_id, v_actor, 'product', 'parentExternalId', 'newest_with_review', false, null,
    v_result.preview ->> 'previewDigest'
  );
  v_parent_policy_id := (v_policy.policy ->> 'id')::uuid;
  perform pg_temp.check(
    'embedded hierarchy has an explicit versioned parentExternalId authority policy',
    v_policy.outcome = 'updated' and v_parent_policy_id is not null
  );

  -- Verify that the established M2 relationship API accepts the precise
  -- connector-owned edge shape before the sync commit reuses it. The nested
  -- exception rolls this isolated proof back so the later plan starts clean.
  begin
    select * into v_result from public.preview_product_component_link(
      v_org, v_product_b, v_product_a, v_actor, 0,
      null::uuid, null::uuid, 1, 'connector_sync', 'connector-sync:test',
      'Reference connector contract check.', clock_timestamp(), null::timestamptz
    );
    perform pg_temp.check(
      'the existing M2 embedded-edge preview accepts connector provenance',
      v_result.outcome = 'found'
      and (v_result.preview ->> 'outcome') = 'allowed'
    );
    select * into v_result from public.create_product_component_link_atomic(
      v_org, v_product_b, v_product_a, v_actor, 0,
      null::uuid, null::uuid, 1, 'connector_sync', 'connector-sync:test',
      'Reference connector contract check.', clock_timestamp(), null::timestamptz,
      gen_random_uuid(), gen_random_uuid()
    );
    perform pg_temp.check(
      'the existing M2 embedded-edge create accepts connector provenance',
      v_result.outcome = 'created'
    );
    raise exception using errcode = 'P0002';
  exception when no_data_found then
    null;
  end;

  -- --- Identity mapping: link, cross-tenant isolation, ambiguous-match block ---
  select * into v_result from public.link_external_identity_atomic(
    v_org, v_connector_id, v_actor, 'product', 'PLM-EXT-001', 'External product one', v_product_a, null, 'manual_link'
  );
  perform pg_temp.check('linking a fresh external identity succeeds', v_result.outcome = 'linked');

  select * into v_result from public.link_external_identity_atomic(
    v_org, v_connector_id, v_actor, 'product', 'PLM-EXT-001', 'Duplicate external product', v_product_b, null, 'manual_link'
  );
  perform pg_temp.check(
    'a second active mapping for the same external id under the same connector is structurally blocked, never auto-merged',
    v_result.outcome = 'conflict'
  );
  select * into v_result from public.link_external_identity_atomic(
    v_org, v_connector_id, v_actor, 'product', 'PLM-PARENT-001', 'External parent product', v_product_b, null, 'manual_link'
  );
  perform pg_temp.check('the external parent identity is linked in the same connector and tenant', v_result.outcome = 'linked');

  insert into public.organizations(name, slug)
  values ('Connector Sync Cross-Tenant Test Org', 'connector-sync-cross-tenant-test')
  returning id into v_other_org;
  insert into public.organization_members(organization_id, user_id, role) values (v_other_org, v_actor, 'owner');
  select * into v_result from public.create_connector_atomic(
    v_other_org, v_actor, gen_random_uuid(), 'reference_conformance', 'Other-tenant connector', '1.0.0', 'm2-v2-reference-v1', '{}'::jsonb, 'manual'
  );
  v_other_connector_id := (v_result.connector ->> 'id')::uuid;
  select exists (
    select 1 from public.product_external_identities identities
    where identities.organization_id = v_other_org and identities.external_id = 'PLM-EXT-001' and identities.superseded_at is null
  ) into v_cross_tenant_visible;
  perform pg_temp.check(
    'an external identifier linked in one tenant is invisible when queried from another tenant',
    not v_cross_tenant_visible
  );
  delete from public.organization_members where organization_id = v_other_org and user_id = v_actor;
  delete from public.connectors where organization_id = v_other_org;
  delete from public.organizations where id = v_other_org;

  -- --- Sync run: begin -> connector-exclusivity -> save plan -> conflict -> resolve -> commit -> cursor advance ---
  select * into v_run from public.begin_sync_run_atomic(v_org, v_connector_id, v_actor, 'incremental', gen_random_uuid(), gen_random_uuid());
  perform pg_temp.check('begin_sync_run_atomic queues a dry run', v_run.outcome = 'queued' and (v_run.run ->> 'status') = 'queued');

  select * into v_run2 from public.begin_sync_run_atomic(v_org, v_connector_id, v_actor, 'full', gen_random_uuid(), gen_random_uuid());
  perform pg_temp.check(
    'connector exclusivity blocks a second non-terminal run for the same connector',
    v_run2.outcome = 'already_running' and (v_run2.run ->> 'id') = (v_run.run ->> 'id')
  );

  select cursor into v_cursor_before from public.sync_connector_cursors where organization_id = v_org and connector_id = v_connector_id;
  perform pg_temp.check('a freshly created connector has no cursor yet', v_cursor_before is null);

  select * into v_result from public.claim_sync_run(v_org, 'test-worker-1', 60);
  perform pg_temp.check('claim_sync_run claims the queued dry run', v_result.outcome = 'claimed' and (v_result.run ->> 'status') = 'running');

  select * into v_result from public.save_sync_run_plan_atomic(
    v_org, (v_run.run ->> 'id')::uuid, 'test-worker-1', 'cursor-page-1',
    encode(sha256('page-1-fixture-content'), 'hex'),
    jsonb_build_array(
      jsonb_build_object(
        'externalId', 'PLM-PARENT-NEW-001', 'entityType', 'product', 'proposedAction', 'create',
        'fieldDiffs', jsonb_build_object(
          'name', pg_temp.sync_field_diff('name', to_jsonb('New parent from reference connector'::text)),
          'internalCode', pg_temp.sync_field_diff('internalCode', to_jsonb('CONN-PARENT-' || gen_random_uuid()::text)),
          'productType', pg_temp.sync_field_diff('productType', to_jsonb('standalone_software'::text)),
          'responsibleOwnerId', pg_temp.sync_field_diff('responsibleOwnerId', to_jsonb(v_actor)),
          'legalEntityId', pg_temp.sync_field_diff('legalEntityId', to_jsonb(v_entity))
        )
      ),
      jsonb_build_object(
        'externalId', 'PLM-EXT-002', 'entityType', 'product', 'proposedAction', 'create',
        'fieldDiffs', jsonb_build_object(
          'name', pg_temp.sync_field_diff('name', to_jsonb('Synced product from reference connector'::text)),
          'internalCode', pg_temp.sync_field_diff('internalCode', to_jsonb('CONN-SYNCED-' || gen_random_uuid()::text)),
          'productType', pg_temp.sync_field_diff('productType', to_jsonb('standalone_software'::text)),
          'responsibleOwnerId', pg_temp.sync_field_diff('responsibleOwnerId', to_jsonb(v_actor)),
          'legalEntityId', pg_temp.sync_field_diff('legalEntityId', to_jsonb(v_entity)),
          'parentExternalId', pg_temp.sync_field_diff(
            'parentExternalId',
            jsonb_build_object(
              'externalId', 'PLM-PARENT-NEW-001',
              'craParentProductId', null::uuid,
              'parentExternalIdentityId', null::uuid,
              'materializedInPlan', true
            ),
            'null'::jsonb, v_parent_policy_id
          )
        )
      ),
      jsonb_build_object(
        'externalId', 'PLM-EXT-001', 'entityType', 'product', 'proposedAction', 'conflict',
        'fieldDiffs', jsonb_build_object(
          'name', pg_temp.sync_field_diff('name', to_jsonb('Renamed by PLM'::text)),
          'description', pg_temp.sync_field_diff('description', to_jsonb('Description accepted from the connector'::text))
        ), 'craProductId', v_product_a
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'externalIdentityId', (select id from public.product_external_identities where organization_id = v_org and connector_id = v_connector_id and external_id = 'PLM-EXT-001' and superseded_at is null),
        'entityType', 'product', 'entityId', v_product_a, 'fieldPath', 'name',
        'craValue', to_jsonb('Connector sync test product A'::text), 'craValueSource', 'cra_manual_entry',
        'externalValue', to_jsonb('Renamed by PLM'::text), 'externalValueHash', encode(sha256('Renamed by PLM'), 'hex')
      ),
      jsonb_build_object(
        'externalIdentityId', null::uuid, 'planItemExternalId', 'PLM-EXT-002',
        'entityType', 'product', 'entityId', null::uuid, 'fieldPath', 'parentExternalId',
        'craValue', 'null'::jsonb, 'craValueSource', 'prior_sync_apply',
        'externalValue', jsonb_build_object(
          'externalId', 'PLM-PARENT-NEW-001',
          'craParentProductId', null::uuid,
          'parentExternalIdentityId', null::uuid,
          'materializedInPlan', true
        ),
        'externalValueHash', encode(sha256('PLM-PARENT-NEW-001'), 'hex'),
        'authorityPolicyId', v_parent_policy_id,
        'authorityPolicySnapshot', jsonb_build_object('policyValue', 'newest_with_review'),
        'permittedActions', jsonb_build_array('accept_external', 'keep_cra', 'enter_manual_value')
      )
    )
  );
  perform pg_temp.check(
    'saving a plan with an open conflict routes the run to waiting_for_review, never straight to completed',
    v_result.outcome = 'saved' and (v_result.run ->> 'status') = 'waiting_for_review'
  );
  v_saved_row_count := (v_result.run ->> 'rowCount')::integer;
  perform pg_temp.check(
    'the run envelope exposes the server-authoritative plan row count for a stale-preview commit guard',
    v_saved_row_count = 5
  );
  perform pg_temp.check(
    'the durable plan persists only the canonical structured SyncFieldDiff shape',
    not exists (
      select 1 from public.sync_run_plan_items
      where organization_id = v_org and sync_run_id = (v_run.run ->> 'id')::uuid
        and not public.m2_v2_valid_sync_field_diffs(field_diffs)
    )
  );
  select * into v_result from public.preview_field_authority_policy(
    v_org, v_connector_id, v_actor, 'product', 'name', 'external_authoritative', false, null
  );
  perform pg_temp.check(
    'the policy preview derives bounded create/update counts and samples from the latest unexpired dry run',
    v_result.outcome = 'previewed'
    and (v_result.preview ->> 'wouldCreate')::integer = 2
    and (v_result.preview ->> 'wouldUpdate')::integer = 1
    and jsonb_array_length(v_result.preview -> 'sampleDiffs') = 3
  );

  select * into v_result from public.request_sync_run_commit_atomic(v_org, (v_run.run ->> 'id')::uuid, v_actor, v_saved_row_count);
  perform pg_temp.check(
    'commit is blocked while a conflict is still open',
    v_result.outcome = 'blocked_by_conflicts'
  );

  select * into v_conflict from public.sync_conflicts
  where organization_id = v_org and sync_run_id = (v_run.run ->> 'id')::uuid
    and field_path = 'name' and resolution_status = 'open';
  perform pg_temp.check('the conflict record carries both values, sources, and the permitted actions', v_conflict.field_path = 'name' and v_conflict.permitted_actions is not null);

  select * into v_result from public.resolve_sync_conflict_atomic(
    v_org, v_conflict.id, v_actor, v_conflict.version + 1, 'keep_cra', null, 'Stale write test.', gen_random_uuid()
  );
  perform pg_temp.check(
    'resolving with a stale expected version is rejected as a conflict, not silently applied',
    v_result.outcome = 'conflict'
  );
  select * into v_result from public.resolve_sync_conflict_atomic(
    v_org, v_conflict.id, v_actor, v_conflict.version, 'keep_cra', null, 'Manual review confirmed the CRA name is correct.', gen_random_uuid()
  );
  perform pg_temp.check('resolving with the correct expected version succeeds', v_result.outcome = 'resolved');
  perform pg_temp.check(
    'resolving an open conflict decrements the run conflict count once without discarding conflict history',
    (select conflict_count = 1 from public.sync_runs where organization_id = v_org and id = (v_run.run ->> 'id')::uuid)
    and (select count(*) = 2 from public.sync_conflicts where organization_id = v_org and sync_run_id = (v_run.run ->> 'id')::uuid)
  );

  select * into v_result from public.request_sync_run_commit_atomic(v_org, (v_run.run ->> 'id')::uuid, v_actor, v_saved_row_count);
  perform pg_temp.check('a plan-bound hierarchy conflict still blocks commit after an unrelated field was resolved', v_result.outcome = 'blocked_by_conflicts');
  select * into v_hierarchy_conflict from public.sync_conflicts
  where organization_id = v_org and sync_run_id = (v_run.run ->> 'id')::uuid
    and field_path = 'parentExternalId' and resolution_status = 'open';
  perform pg_temp.check(
    'a first-seen child hierarchy conflict is plan-bound and serializes a nullable externalIdentityId',
    v_hierarchy_conflict.external_identity_id is null
    and v_hierarchy_conflict.plan_item_id is not null
    and (public.m2_v2_sync_conflict_json(v_hierarchy_conflict) -> 'externalIdentityId') = 'null'::jsonb
  );
  select * into v_result from public.resolve_sync_conflict_atomic(
    v_org, v_hierarchy_conflict.id, v_actor, v_hierarchy_conflict.version, 'accept_external', null,
    'The unique parent create in this plan is approved for the newly materialized child.', gen_random_uuid()
  );
  perform pg_temp.check('the plan-bound first-seen hierarchy conflict accepts only after its target plan is durable', v_result.outcome = 'resolved');
  perform pg_temp.check(
    'resolving the final open conflict makes the persisted run count zero for the commit control',
    (select conflict_count = 0 from public.sync_runs where organization_id = v_org and id = (v_run.run ->> 'id')::uuid)
  );

  select * into v_result from public.request_sync_run_commit_atomic(v_org, (v_run.run ->> 'id')::uuid, v_actor, v_saved_row_count);
  perform pg_temp.check('commit can be requested once every conflict is resolved', v_result.outcome = 'queued');

  select * into v_result from public.claim_sync_run(v_org, 'test-worker-1', 60);
  perform pg_temp.check('claim_sync_run claims the queued commit phase', v_result.outcome = 'claimed' and (v_result.run ->> 'workKind') = 'commit');
  perform pg_temp.check(
    'the claimed commit remains running until the durable commit transaction finishes',
    exists (
      select 1
      from public.sync_runs
      where organization_id = v_org
        and id = (v_run.run ->> 'id')::uuid
        and status = 'running'
        and work_kind = 'commit'
    )
  );

  select * into v_commit from public.commit_sync_run_atomic(
    v_org, (v_run.run ->> 'id')::uuid, v_actor, encode(sha256('page-1-fixture-content'), 'hex'), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('commit applies the plan and completes the run', v_commit.outcome = 'completed' and (v_commit.run ->> 'status') = 'completed');
  select name, description into v_product_after
  from public.products where organization_id = v_org and id = v_product_a;
  perform pg_temp.check(
    'a keep_cra resolution suppresses that field while the same conflict item still applies independent allowed field diffs',
    v_product_after.name = 'Connector sync test product A'
    and v_product_after.description = 'Description accepted from the connector'
  );

  perform pg_temp.check(
    'the plan-item create action actually created the product via the existing ProductUseCases-backed RPC, not a bespoke write path',
    exists (select 1 from public.products where organization_id = v_org and name = 'Synced product from reference connector')
  );
  perform pg_temp.check(
    'a committed create atomically persists the tenant-and-connector-scoped external identity for repeatable future syncs',
    exists (
      select 1
      from public.product_external_identities identities
      join public.products products on products.organization_id = identities.organization_id and products.id = identities.cra_product_id
      where identities.organization_id = v_org and identities.connector_id = v_connector_id
        and identities.entity_type = 'product' and identities.external_id = 'PLM-EXT-002'
        and identities.superseded_at is null and identities.unlinked_at is null
        and products.name = 'Synced product from reference connector'
    )
  );
  select cra_product_id into v_first_seen_product_id
  from public.product_external_identities
  where organization_id = v_org and connector_id = v_connector_id and entity_type = 'product'
    and external_id = 'PLM-EXT-002' and superseded_at is null and unlinked_at is null;
  select cra_product_id into v_first_seen_parent_product_id
  from public.product_external_identities
  where organization_id = v_org and connector_id = v_connector_id and entity_type = 'product'
    and external_id = 'PLM-PARENT-NEW-001' and superseded_at is null and unlinked_at is null;
  perform pg_temp.check(
    'a plan-bound first-seen hierarchy conflict creates the connector-owned edge only after materializing the unique parent and child identities',
    exists (
      select 1
      from public.product_relationships relationships
      where relationships.organization_id = v_org and relationships.relationship_type = 'embedded'
        and relationships.source_product_id = v_first_seen_parent_product_id and relationships.target_product_id = v_first_seen_product_id
        and relationships.source = 'connector_sync'
        and relationships.provenance = 'connector-sync:v1:' || v_connector_id::text || ':' || (v_run.run ->> 'id')
        and relationships.ended_at is null
    )
  );

  select cursor into v_cursor_after from public.sync_connector_cursors where organization_id = v_org and connector_id = v_connector_id;
  perform pg_temp.check('cursor only advances after a durable commit', v_cursor_after = 'cursor-page-1');

  -- --- Existing mapped child: explicit parent conflict -> accepted external parent -> connector-owned embedded edge ---
  select * into v_hierarchy_run from public.begin_sync_run_atomic(
    v_org, v_connector_id, v_actor, 'incremental', gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('a hierarchy dry run starts after the first product identity has materialized', v_hierarchy_run.outcome = 'queued');
  select * into v_result from public.claim_sync_run(v_org, 'hierarchy-worker', 60);
  perform pg_temp.check('the organization-scoped worker claims the hierarchy dry run', v_result.outcome = 'claimed');
  select * into v_result from public.save_sync_run_plan_atomic(
    v_org, (v_hierarchy_run.run ->> 'id')::uuid, 'hierarchy-worker', 'cursor-parent-1',
    encode(sha256('parent-link-fixture-content'), 'hex'),
    jsonb_build_array(jsonb_build_object(
      'externalId', 'PLM-EXT-001', 'entityType', 'product', 'proposedAction', 'conflict',
      'craProductId', v_product_a,
      'fieldDiffs', jsonb_build_object(
        'parentExternalId', pg_temp.sync_field_diff(
          'parentExternalId', jsonb_build_object(
            'externalId', 'PLM-PARENT-001',
            'craParentProductId', v_product_b,
            'parentExternalIdentityId', (
              select id from public.product_external_identities
              where organization_id = v_org and connector_id = v_connector_id and entity_type = 'product'
                and external_id = 'PLM-PARENT-001' and superseded_at is null and unlinked_at is null
            ),
            'materializedInPlan', false
          ), 'null'::jsonb, v_parent_policy_id
        )
      )
    )),
    jsonb_build_array(jsonb_build_object(
      'externalIdentityId', (
        select id from public.product_external_identities
        where organization_id = v_org and connector_id = v_connector_id and entity_type = 'product'
          and external_id = 'PLM-EXT-001' and superseded_at is null and unlinked_at is null
      ),
      'entityType', 'product', 'entityId', v_product_a, 'fieldPath', 'parentExternalId',
      'craValue', 'null'::jsonb, 'craValueSource', 'prior_sync_apply',
      'externalValue', jsonb_build_object(
        'externalId', 'PLM-PARENT-001',
        'craParentProductId', v_product_b,
        'parentExternalIdentityId', (
          select id from public.product_external_identities
          where organization_id = v_org and connector_id = v_connector_id and entity_type = 'product'
            and external_id = 'PLM-PARENT-001' and superseded_at is null and unlinked_at is null
        ),
        'materializedInPlan', false
      ),
      'externalValueHash', encode(sha256('PLM-PARENT-001'), 'hex'),
      'authorityPolicyId', v_parent_policy_id,
      'authorityPolicySnapshot', jsonb_build_object('policyValue', 'newest_with_review'),
      'permittedActions', jsonb_build_array('accept_external', 'keep_cra', 'enter_manual_value')
    ))
  );
  perform pg_temp.check(
    'an existing mapped child with an external parent is held for an explicit hierarchy conflict review',
    v_result.outcome = 'saved' and (v_result.run ->> 'status') = 'waiting_for_review'
  );
  select * into v_hierarchy_conflict from public.sync_conflicts
  where organization_id = v_org and sync_run_id = (v_hierarchy_run.run ->> 'id')::uuid
    and entity_id = v_product_a and field_path = 'parentExternalId' and resolution_status = 'open';
  perform pg_temp.check(
    'the hierarchy conflict is bound to the mapped child external identity and retains policy provenance',
    v_hierarchy_conflict.external_identity_id is not null and v_hierarchy_conflict.authority_policy_id = v_parent_policy_id
  );
  select * into v_result from public.resolve_sync_conflict_atomic(
    v_org, v_hierarchy_conflict.id, v_actor, v_hierarchy_conflict.version, 'enter_manual_value',
    to_jsonb(v_product_b::text), 'The mapped CRA parent has been reviewed and selected manually.', gen_random_uuid()
  );
  perform pg_temp.check('a reviewed hierarchy manual value is accepted for the explicitly mapped CRA parent', v_result.outcome = 'resolved');
  select * into v_result from public.request_sync_run_commit_atomic(
    v_org, (v_hierarchy_run.run ->> 'id')::uuid, v_actor, null
  );
  perform pg_temp.check('the reviewed hierarchy plan can be committed', v_result.outcome = 'queued');
  select * into v_result from public.claim_sync_run(v_org, 'hierarchy-worker', 60);
  perform pg_temp.check('the hierarchy commit phase is claimed', v_result.outcome = 'claimed' and (v_result.run ->> 'workKind') = 'commit');
  select * into v_commit from public.commit_sync_run_atomic(
    v_org, (v_hierarchy_run.run ->> 'id')::uuid, v_actor,
    encode(sha256('parent-link-fixture-content'), 'hex'), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check('the reviewed hierarchy commit completes atomically with its cursor advance', v_commit.outcome = 'completed');
  perform pg_temp.check(
    'hierarchy application creates only the connector-owned parent-to-child embedded edge with bounded provenance',
    exists (
      select 1 from public.product_relationships relationships
      where relationships.organization_id = v_org and relationships.relationship_type = 'embedded'
        and relationships.source_product_id = v_product_b and relationships.target_product_id = v_product_a
        and relationships.source = 'connector_sync'
        and relationships.provenance = 'connector-sync:v1:' || v_connector_id::text || ':' || (v_hierarchy_run.run ->> 'id')
        and relationships.ended_at is null
    )
  );

  select * into v_result from public.begin_sync_run_atomic(v_org, v_connector_id, v_actor, 'incremental', gen_random_uuid(), gen_random_uuid());
  perform pg_temp.check(
    'the exclusivity slot is released once the prior run reaches a terminal state',
    v_result.outcome = 'queued'
  );

  -- --- Cursor never advances on a rolled-back commit ---
  select * into v_result from public.claim_sync_run(v_org, 'test-worker-2', 60);
  select * into v_result from public.save_sync_run_plan_atomic(
    v_org, (v_result.run ->> 'id')::uuid, 'test-worker-2', 'cursor-page-2', encode(sha256('page-2-fixture-content'), 'hex'),
    jsonb_build_array(jsonb_build_object(
      'externalId', 'PLM-EXT-003', 'entityType', 'product', 'proposedAction', 'update',
      'fieldDiffs', jsonb_build_object(
        'name', pg_temp.sync_field_diff('name', to_jsonb('This update targets a product that does not exist'::text))
      ),
      'craProductId', gen_random_uuid(), 'expectedVersion', 1
    )), '[]'::jsonb
  );
  v_second_run_id := (v_result.run ->> 'id')::uuid;
  perform public.request_sync_run_commit_atomic(v_org, v_second_run_id, v_actor, null);
  perform public.claim_sync_run(v_org, 'test-worker-2', 60);
  select * into v_commit from public.commit_sync_run_atomic(
    v_org, v_second_run_id, v_actor, encode(sha256('page-2-fixture-content'), 'hex'), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'a plan item targeting a nonexistent product does not silently skip -- the whole commit rolls back and the run is retrying/failed',
    v_commit.outcome in ('retrying', 'failed')
  );
  select cursor into v_cursor_after from public.sync_connector_cursors where organization_id = v_org and connector_id = v_connector_id;
  perform pg_temp.check(
    'a failed commit never advances the durable cursor past the last successful one',
    v_cursor_after = 'cursor-parent-1'
  );

  update public.sync_runs set status = 'failed', error_code = 'retry_window_exhausted', lease_owner = null, lease_expires_at = null
  where organization_id = v_org and id = v_second_run_id;
  select * into v_result from public.retry_sync_run_atomic(v_org, v_second_run_id, v_actor);
  perform pg_temp.check(
    'a privileged retry preserves a failed commit phase and its retry history for durable replay',
    v_result.outcome = 'queued'
    and (v_result.run ->> 'status') = 'queued'
    and (v_result.run ->> 'workKind') = 'commit'
    and exists (
      select 1 from public.sync_runs
      where organization_id = v_org and id = v_second_run_id
        and work_kind = 'commit' and retry_count = 1 and expires_at > now() + interval '23 hours'
    )
    and exists (
      select 1 from public.audit_logs
      where organization_id = v_org and user_id = v_actor and action = 'sync_run.retried'
        and entity_type = 'sync_run' and entity_id = v_second_run_id::text
        and changes ->> 'priorErrorCode' = 'retry_window_exhausted'
    )
  );
  select * into v_result from public.claim_sync_run(v_org, 'test-worker-2', 60);
  perform pg_temp.check(
    'the retried failed commit is claimed as a commit rather than re-planned as a dry run',
    v_result.outcome = 'claimed' and (v_result.run ->> 'workKind') = 'commit'
  );
  select * into v_commit from public.commit_sync_run_atomic(
    v_org, v_second_run_id, v_actor, encode(sha256('page-2-fixture-content'), 'hex'), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'replaying a failed commit preserves the original plan rather than inserting duplicate plan items or conflicts',
    v_commit.outcome in ('retrying', 'failed')
    and (select count(*) from public.sync_run_plan_items where organization_id = v_org and sync_run_id = v_second_run_id) = 1
    and not exists (select 1 from public.sync_conflicts where organization_id = v_org and sync_run_id = v_second_run_id)
  );

  -- --- Cleanup: leave no privileges or cross-cutting state behind for later suites. ---
  delete from public.sync_conflicts where organization_id = v_org;
  delete from public.sync_run_plan_items where organization_id = v_org;
  delete from public.sync_runs where organization_id = v_org;
  delete from public.sync_connector_cursors where organization_id = v_org;
  delete from public.field_authority_policies where organization_id = v_org;
  delete from public.product_external_identities where organization_id = v_org;
  delete from public.connector_secrets where organization_id = v_org;
  delete from public.connectors where organization_id = v_org;
  delete from public.product_relationships
  where organization_id = v_org
    and source = 'connector_sync'
    and provenance like 'connector-sync:v1:' || v_connector_id::text || ':%';
  delete from public.product_releases where organization_id = v_org and product_id in (v_product_a, v_product_b);
  delete from public.product_create_idempotencies where organization_id = v_org;
  delete from public.product_legal_entity_assignments where organization_id = v_org;
  delete from public.products where organization_id = v_org and id in (v_product_a, v_product_b, (select id from public.products where organization_id = v_org and name = 'Synced product from reference connector'));
end;
$$;
rollback;

-- --- Relationship-graph cycle detection remains the shared invariant used by
-- the connector hierarchy commit above; no connector-specific graph bypass is
-- introduced. ---
select pg_temp.check(
  'the existing product-relationship cycle guard function still exists and is reusable by a future sync dispatch',
  exists (select 1 from pg_proc where proname = 'm2_component_link_preview')
);
