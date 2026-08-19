-- M2 V2 substantial-modification and security-update-artifact integration tests.
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

select pg_temp.check(
  'M2 V2 introduces exactly the three retained product evidence tables',
  (select count(*) = 3 from pg_class tables
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public'
      and tables.relkind = 'r'
      and tables.relname in (
        'product_substantial_modification_assessments',
        'product_substantial_modification_releases',
        'product_security_update_artifacts'
      ))
  and to_regclass('public.product_security_update_artifact_history') is null
  and to_regclass('public.product_security_update_artifact_uploads') is null
  and to_regclass('public.product_security_update_artifact_jobs') is null
);

select pg_temp.check(
  'M2 V2 tables use RLS without forcing it and have no browser or public grants',
  not exists (
    select 1 from (values
      ('product_substantial_modification_assessments'),
      ('product_substantial_modification_releases'),
      ('product_security_update_artifacts')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public'
      and (
        not tables.relrowsecurity or tables.relforcerowsecurity
        or has_table_privilege('public', tables.oid, 'select')
        or has_table_privilege('anon', tables.oid, 'select')
        or has_table_privilege('authenticated', tables.oid, 'select')
        or has_table_privilege('service_role', tables.oid, 'delete')
      )
  )
  and has_table_privilege('service_role', 'public.product_substantial_modification_assessments', 'select')
  and has_table_privilege('service_role', 'public.product_substantial_modification_assessments', 'insert')
  and has_table_privilege('service_role', 'public.product_substantial_modification_releases', 'select')
  and has_table_privilege('service_role', 'public.product_substantial_modification_releases', 'insert')
  and has_table_privilege('service_role', 'public.product_security_update_artifacts', 'select')
  and has_table_privilege('service_role', 'public.product_security_update_artifacts', 'insert')
  and not has_column_privilege('service_role', 'public.product_security_update_artifacts', 'object_key', 'update')
  and not has_column_privilege('service_role', 'public.product_security_update_artifacts', 'sha256', 'update')
  and not has_column_privilege('service_role', 'public.product_security_update_artifacts', 'byte_size', 'update')
  and not has_column_privilege('service_role', 'public.product_security_update_artifacts', 'content_type', 'update')
);

select pg_temp.check(
  'M2 V2 tenant FKs bind assessment joins and artifacts to the declared product release',
  (select count(*) >= 1 from pg_constraint
    where conrelid = 'public.product_substantial_modification_assessments'::regclass
      and contype = 'f' and confrelid = 'public.products'::regclass)
  and (select count(*) >= 2 from pg_constraint
    where conrelid = 'public.product_substantial_modification_releases'::regclass
      and contype = 'f'
      and confrelid in (
        'public.product_substantial_modification_assessments'::regclass,
        'public.product_releases'::regclass
      ))
  and (select count(*) >= 1 from pg_constraint
    where conrelid = 'public.product_security_update_artifacts'::regclass
      and contype = 'f' and confrelid = 'public.product_releases'::regclass)
  and (select count(*) >= 1 from pg_constraint
    where conrelid = 'public.product_security_update_artifacts'::regclass
      and contype = 'f'
      and confrelid = 'public.product_security_update_artifacts'::regclass)
);

select pg_temp.check(
  'tenant deletion defers M2 and upstream product legal-entity dependency checks without cascading direct deletes',
  not exists (
    select 1 from pg_constraint
    where conname = any (array[
      'products_organization_id_legal_entity_id_fkey',
      'product_releases_organization_id_product_id_fkey',
      'product_releases_organization_id_legal_entity_id_fkey',
      'product_support_periods_organization_id_product_id_release_fkey',
      'product_support_periods_organization_id_superseded_by_id_fkey',
      'product_regulatory_outbox_support_period_fk',
      'product_substantial_modification_assessment_product_fkey',
      'product_substantial_modification_assessment_supersedes_fkey',
      'product_substantial_modification_assessment_superseded_by_fkey',
      'product_substantial_modification_release_assessment_product_fke',
      'product_substantial_modification_release_product_release_fkey',
      'product_security_update_artifact_product_release_fkey',
      'product_security_update_artifact_support_period_fkey',
      'product_security_update_artifact_replacement_release_fkey'
    ]) and (confdeltype <> 'a' or not condeferrable or not condeferred)
  )
  and exists (
    select 1 from pg_constraint
    where conname = 'product_releases_organization_id_fkey'
      and confdeltype = 'c'
  )
);

select pg_temp.check(
  'assessment drafts retain the locked narrative columns and JSON builders keep nullable keys',
  (select count(*) = 10
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_substantial_modification_assessments'
      and column_name in (
        'modification_identifier', 'title', 'description', 'technical_scope',
        'introduced_at', 'detected_or_assessed_at', 'previous_state', 'resulting_state',
        'required_follow_up_actions', 'completeness_state'
      ))
  and position(
    'jsonb_strip_nulls'
    in pg_get_functiondef(
      'public.m2_v2_security_update_artifact_json(public.product_security_update_artifacts,boolean)'::regprocedure
    )
  ) = 0
);

select pg_temp.check(
  'M2 V2 commands are service-role-only security definers with pinned search paths',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = any (array[
        'list_product_substantial_modification_assessments',
        'get_product_substantial_modification_assessment',
        'create_product_substantial_modification_assessment_draft_atomic',
        'create_product_substantial_modification_assessment_atomic',
        'reassess_product_substantial_modification_atomic',
        'review_product_substantial_modification_assessment_atomic',
        'list_product_security_update_artifacts',
        'get_product_security_update_artifact',
        'reserve_product_security_update_artifact_atomic',
        'finalize_product_security_update_artifact_atomic',
        'review_product_security_update_artifact_atomic',
        'publish_product_security_update_artifact_atomic',
        'replace_product_security_update_artifact_atomic',
        'withdraw_product_security_update_artifact_atomic',
        'download_product_security_update_artifact_atomic',
        'schedule_product_security_update_artifact_cleanup_atomic',
        'recalc_product_security_update_artifact_availability_atomic',
        'monitor_product_security_update_external_reference_atomic',
        'finalize_product_security_update_artifact_worker_atomic',
        'recalc_security_update_artifact_availability_worker_atomic',
        'schedule_security_update_artifact_cleanup_worker_atomic',
        'monitor_security_update_external_reference_worker_atomic',
        'claim_product_security_update_artifact_work_atomic',
        'complete_product_security_update_artifact_work_atomic',
        'fail_product_security_update_artifact_work_atomic',
        'list_due_product_security_update_artifact_organizations'
      ])
      and (
        not procedures.prosecdef
        or pg_get_userbyid(procedures.proowner) <> 'postgres'
        or not ('search_path=public, pg_temp' = any(procedures.proconfig))
        or has_function_privilege('public', procedures.oid, 'execute')
        or has_function_privilege('anon', procedures.oid, 'execute')
        or has_function_privilege('authenticated', procedures.oid, 'execute')
        or not has_function_privilege('service_role', procedures.oid, 'execute')
      )
  )
  and not has_function_privilege(
    'public', 'public.m2_reconcile_product_entity(uuid,uuid,uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.m2_reconcile_product_entity(uuid,uuid,uuid)', 'execute'
  )
  and has_function_privilege(
    'service_role', 'public.m2_reconcile_product_entity(uuid,uuid,uuid)', 'execute'
  )
);

select pg_temp.check(
  'new M2 V2 security-definer helpers and guards are never executable by browser roles',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = any (array[
        'm2_v2_valid_assessment_answers',
        'm2_v2_availability_candidate',
        'm2_v2_valid_published_external_references',
        'm2_v2_assessment_json',
        'm2_v2_security_update_artifact_json',
        'm2_v2_guard_assessment_update',
        'm2_v2_guard_security_update_artifact_update',
        'm2_v2_set_lifecycle_dependency_fact',
        'm2_v2_set_artifact_retention_fact',
        'm2_v2_enqueue_security_update_artifact_recalculations',
        'm2_v2_command_digest',
        'm2_v2_assessment_payload_complete',
        'm2_v2_resolve_security_update_artifact_worker_actor',
        'm2_v2_record_security_update_artifact_worker_effect'
      ])
      and procedures.prosecdef
      and (
        has_function_privilege('public', procedures.oid, 'execute')
        or has_function_privilege('anon', procedures.oid, 'execute')
        or has_function_privilege('authenticated', procedures.oid, 'execute')
      )
  )
);

select pg_temp.check(
  'artifact bucket is private and lifecycle/export/retention links are registered',
  exists (
    select 1 from storage.buckets
    where id = 'security-update-artifacts' and public = false
  )
  and exists (
    select 1 from public.retention_evidence_classes
    where identifier = 'security_update_artifact' and enabled
  )
  and (select count(*) = 3 from public.organization_export_source_tables
    where source_id = 'product_registry' and table_name in (
      'product_substantial_modification_assessments',
      'product_substantial_modification_releases',
      'product_security_update_artifacts'
    ))
  and position(
    'product_security_update_artifacts'
    in pg_get_functiondef(
      'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
    )
  ) > 0
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_lifecycle_dependency_facts'::regclass
      and conname = 'product_lifecycle_dependency_facts_authority_kind_check'
      and pg_get_constraintdef(oid) like '%substantial_modification%'
      and pg_get_constraintdef(oid) like '%security_update_artifact%'
  )
);

select pg_temp.check(
  'M2 V2 final RPC surface drops wrapper-era base functions and scopes the metrics snapshot',
  (
    select count(*) = 0
    from pg_proc functions
    join pg_namespace namespaces on namespaces.oid = functions.pronamespace
    where namespaces.nspname = 'public'
      and functions.proname like '%_atomic_base'
  )
  and has_function_privilege(
    'service_role', 'public.product_compliance_metrics_snapshot(uuid)', 'execute')
  and not has_function_privilege(
    'public', 'public.product_compliance_metrics_snapshot(uuid)', 'execute')
  and not has_function_privilege(
    'anon', 'public.product_compliance_metrics_snapshot(uuid)', 'execute')
  and (
    select proconfig = array['search_path=public, pg_temp']
    from pg_proc functions
    join pg_namespace namespaces on namespaces.oid = functions.pronamespace
    where namespaces.nspname = 'public'
      and functions.proname = 'product_compliance_metrics_snapshot'
  )
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_admin uuid;
  v_other_actor uuid;
  v_other_org uuid;
  v_entity uuid;
  v_product uuid := gen_random_uuid();
  v_release uuid := gen_random_uuid();
  v_assessment_id uuid;
  v_draft_assessment_id uuid;
  v_reassessment_id uuid;
  v_artifact_id uuid;
  v_external_artifact_id uuid;
  v_replacement_id uuid;
  v_support_start timestamptz := clock_timestamp() - interval '1 day';
  v_support_end timestamptz := clock_timestamp() + interval '12 years';
  v_answers jsonb := jsonb_build_object(
    'changesIntendedPurpose', 'no',
    'changesSecurityArchitectureOrTrustBoundary', 'yes',
    'changesNetworkInterfaceOrPrivilegedRemoteControl', 'unknown',
    'changesCryptographyOrIdentityAccessControl', 'yes',
    'changesSafetyOrSecurityRelevantComponent', 'no'
  );
  v_result record;
  v_other_result record;
  v_reservation record;
  v_shared_content_reservation record;
  v_finalized record;
  v_reviewed record;
  v_published record;
  v_replacement record;
  v_withdrawn record;
  v_recalculated record;
  v_external_finalized record;
  v_external_reviewed record;
  v_external_published record;
  v_external_monitored record;
  v_worker_effect record;
  v_worker_unavailable record;
  v_external_version integer;
  v_metrics_pending_id uuid;
  v_metrics_flagged_id uuid;
  v_snapshot record;
  v_direct_legal_entity_delete_blocked boolean := false;
  v_direct_product_delete_blocked boolean := false;
  v_validated_external_references jsonb := jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'title', 'Validated manufacturer release notice',
    'uri', 'https://updates.example.test/m2-v2/security-update',
    'validationState', 'validated_by_server',
    'validatedAt', public.m2_utc_z(clock_timestamp())
  ));
  v_failed boolean;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  insert into public.users(email) values ('m2-v2-worker-admin@integration.test')
    returning id into v_admin;
  insert into public.organization_members(organization_id, user_id, role)
  values (v_org, v_admin, 'admin');
  select id into v_entity from public.organization_legal_entities
   where organization_id = v_org and is_default;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by
  ) values (
    v_product, v_org, v_entity, 0, '{}'::jsonb,
    'M2 V2 evidence test', 'M2-V2-' || v_product::text,
    'standalone_software', v_actor, v_actor, v_actor
  );
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, placed_on_market_at,
    created_by, updated_by
  ) values (
    v_release, v_org, v_product, v_entity, 0, '{}'::jsonb,
    'M2 V2 release', '1.0-' || v_release::text, 'placed_on_market',
    clock_timestamp(), v_actor, v_actor
  );
  perform * from public.create_product_support_period_atomic(
    v_org, v_product, v_release, v_actor, v_support_start, v_support_end,
    'The release remains supported for this integration fixture.',
    gen_random_uuid(), gen_random_uuid()
  );

  select * into v_result
  from public.create_product_substantial_modification_assessment_draft_atomic(
    v_org, v_product, v_actor, gen_random_uuid(),
    null, null, null, null, null, null, null, null, null,
    null, null, null, null, 'draft', gen_random_uuid(), gen_random_uuid()
  );
  v_draft_assessment_id := (v_result.assessment ->> 'id')::uuid;
  select * into v_other_result
  from public.review_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_draft_assessment_id, v_actor, 1,
    'undetermined', 'A draft cannot be reviewed until it is complete.',
    'Draft review prohibition.', gen_random_uuid()
  );
  perform pg_temp.check(
    'draft assessments retain nullable partial fields and cannot be reviewed before completion',
    v_result.outcome = 'created'
    and v_result.assessment ->> 'completenessState' = 'draft'
    and v_result.assessment ->> 'modificationIdentifier' is null
    and v_result.assessment -> 'answers' ->> 'changesIntendedPurpose' is null
    and v_other_result.outcome = 'invalid_state'
  );

  select * into v_result
  from public.create_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_actor, gen_random_uuid(), 'M2-V2-CHANGE-001',
    'M2 V2 security architecture change',
    'The product changes its privileged security architecture.',
    'Remote trust-boundary and identity components are affected.',
    clock_timestamp() - interval '1 hour', clock_timestamp(),
    'The prior release used the existing authentication boundary.',
    'The revised release uses an updated authentication boundary.',
    jsonb_build_array('Record the reviewed determination in the technical file.'),
    v_answers, 'Initial M2 V2 assessment rationale.',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'title', 'Technical file reference', 'sha256', repeat('d', 64))),
    'potentially_substantial', array[v_release], gen_random_uuid(), gen_random_uuid()
  );
  v_assessment_id := (v_result.assessment ->> 'id')::uuid;
  perform pg_temp.check(
    'assessment creation uses a release join without recording narrative in audit facts',
    v_result.outcome = 'created'
    and (select count(*) from public.product_substantial_modification_releases
      where organization_id = v_org and assessment_id = v_assessment_id and release_id = v_release) = 1
    and not exists (
      select 1 from public.audit_logs
       where organization_id = v_org and entity_id = v_assessment_id::text
         and changes::text like '%Initial M2 V2 assessment rationale%'
    )
  );

  select * into v_result
  from public.review_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_assessment_id, v_actor, 1,
    'potentially_substantial', 'Human reviewer recorded the authority decision.', null, gen_random_uuid()
  );
  perform pg_temp.check(
    'reviewed potentially substantial assessment projects an active lifecycle dependency fact',
    v_result.outcome = 'reviewed'
    and exists (
      select 1 from public.product_lifecycle_dependency_facts
       where organization_id = v_org and product_id = v_product and release_id = v_release
         and authority_kind = 'substantial_modification' and record_id = v_assessment_id and active
    )
  );

  select * into v_result
  from public.reassess_product_substantial_modification_atomic(
    v_org, v_product, v_assessment_id, v_actor, 2,
    'M2-V2-CHANGE-001', 'M2 V2 reassessment',
    'The product retains a complete reassessment record.',
    'The affected security architecture and release scope were re-evaluated.',
    clock_timestamp() - interval '1 hour', clock_timestamp(),
    'The prior reviewed record required reassessment.',
    'The new record documents the resulting state.',
    jsonb_build_array('Track follow-up completion.'),
    v_answers, 'Reassessment preserves the previous reviewed row.',
    '[]'::jsonb,
    'not_substantial', array[v_release], gen_random_uuid(), gen_random_uuid()
  );
  v_reassessment_id := (v_result.assessment ->> 'id')::uuid;
  perform pg_temp.check(
    'reassessment supersedes instead of overwriting and deactivates the prior fact',
    v_result.outcome = 'reassessed'
    and v_reassessment_id is not null and v_reassessment_id <> v_assessment_id
    and exists (
      select 1 from public.product_substantial_modification_assessments
       where organization_id = v_org and id = v_assessment_id
         and superseded_at is not null and superseded_by_id = v_reassessment_id
    )
    and not exists (
      select 1 from public.product_lifecycle_dependency_facts
       where organization_id = v_org and authority_kind = 'substantial_modification'
         and record_id = v_assessment_id and active
    )
  );

  insert into public.users(email) values ('m2-v2-other-owner@integration.test')
    returning id into v_other_actor;
  insert into public.organizations(name, slug)
  values ('M2 V2 other', 'm2-v2-other-' || replace(v_other_actor::text, '-', ''))
  returning id into v_other_org;
  insert into public.organization_members(organization_id, user_id, role)
  values (v_other_org, v_other_actor, 'owner');
  select * into v_other_result from public.get_product_substantial_modification_assessment(
    v_other_org, v_product, v_assessment_id, v_other_actor
  );
  perform pg_temp.check(
    'foreign tenant assessment probes collapse to stable not found',
    v_other_result.outcome = 'not_found' and v_other_result.assessment is null
  );

  select * into v_reservation from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.1', 'Security update',
    'software_update', 'all', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb,
    'security-update.bin', 'application/octet-stream', 32, repeat('a', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  v_artifact_id := (v_reservation.artifact ->> 'id')::uuid;
  select * into v_shared_content_reservation from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.1-repackaged', 'Security update mirror record',
    'software_update', 'all', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb,
    'security-update-mirror.bin', 'application/octet-stream', 32, repeat('a', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'same verified content can back multiple immutable release artifact records',
    v_shared_content_reservation.outcome = 'reserved'
    and v_shared_content_reservation.artifact ->> 'id' <> v_reservation.artifact ->> 'id'
    and v_shared_content_reservation.artifact ->> 'objectKey' = v_reservation.artifact ->> 'objectKey'
    and v_reservation.artifact ->> 'objectKey' = concat(v_org::text, '/', repeat('a', 64))
  );
  insert into storage.objects(bucket_id, name)
  values ('security-update-artifacts', v_reservation.artifact ->> 'objectKey');
  select * into v_finalized from public.finalize_product_security_update_artifact_atomic(
    v_org, v_product, v_artifact_id, v_actor, 1, repeat('a', 64),
    32, 'application/octet-stream', 'verified', gen_random_uuid()
  );
  select * into v_reviewed from public.review_product_security_update_artifact_atomic(
    v_org, v_product, v_artifact_id, v_actor, 2, 'cleared',
    'Human clearance after verified integrity.', gen_random_uuid()
  );
  select * into v_published from public.publish_product_security_update_artifact_atomic(
    v_org, v_product, v_artifact_id, v_actor, 3, '[]'::jsonb, gen_random_uuid()
  );
  perform pg_temp.check(
    'finalized approved artifact publishes with an active availability dependency fact',
    v_finalized.outcome = 'finalized'
    and v_reviewed.outcome = 'reviewed'
    and v_published.outcome = 'published'
    and exists (
      select 1 from public.product_lifecycle_dependency_facts
       where organization_id = v_org and product_id = v_product and release_id = v_release
         and authority_kind = 'security_update_artifact' and record_id = v_artifact_id and active
    )
  );

  begin
    update public.product_security_update_artifacts
       set sha256 = repeat('b', 64)
     where organization_id = v_org and id = v_artifact_id;
  exception when others then
    v_failed := true;
  end;
  perform pg_temp.check(
    'artifact content identity remains immutable after reservation and finalization',
    v_failed
    and (select sha256 = repeat('a', 64) from public.product_security_update_artifacts
      where organization_id = v_org and id = v_artifact_id)
  );

  update public.product_security_update_artifacts
     set availability_until = clock_timestamp() + interval '15 years', version = version + 1
   where organization_id = v_org and id = v_artifact_id;
  select * into v_recalculated from public.recalc_product_security_update_artifact_availability_atomic(
    v_org, v_product, v_artifact_id, v_actor, gen_random_uuid()
  );
  perform pg_temp.check(
    'support-period recalculation cannot lower an established availability window',
    v_recalculated.outcome = 'recalculated'
    and (v_recalculated.artifact ->> 'availabilityUntil')::timestamptz
      >= clock_timestamp() + interval '14 years 364 days'
  );

  select * into v_reservation from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.1-external', 'Manufacturer hosted update',
    'security_advisory', 'all', '{}'::jsonb, 'external_reference',
    v_validated_external_references,
    'security-update-advisory.txt', 'text/plain', 48, repeat('e', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  v_external_artifact_id := (v_reservation.artifact ->> 'id')::uuid;
  v_external_version := (v_reservation.artifact ->> 'version')::integer;
  select * into v_result from public.review_product_security_update_artifact_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version, 'cleared',
    'External source must first be safely inspected.', gen_random_uuid()
  );
  select * into v_external_finalized from public.finalize_product_security_update_artifact_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version, repeat('e', 64),
    48, 'text/plain', 'verified', gen_random_uuid()
  );
  v_external_version := (v_external_finalized.artifact ->> 'version')::integer;
  select * into v_external_reviewed from public.review_product_security_update_artifact_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version, 'cleared',
    'External reference integrity has been verified.', gen_random_uuid()
  );
  v_external_version := (v_external_reviewed.artifact ->> 'version')::integer;
  select * into v_other_result from public.publish_product_security_update_artifact_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version,
    jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'title', 'Different validated release notice',
      'uri', 'https://updates.example.test/m2-v2/different',
      'validationState', 'validated_by_server',
      'validatedAt', public.m2_utc_z(clock_timestamp())
    )), gen_random_uuid()
  );
  select * into v_external_published from public.publish_product_security_update_artifact_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version,
    v_validated_external_references, gen_random_uuid()
  );
  v_external_version := (v_external_published.artifact ->> 'version')::integer;
  perform pg_temp.check(
    'external references persist only validated inspection sources, require verification, and cannot swap at publication',
    v_reservation.outcome = 'reserved'
    and v_reservation.artifact ->> 'objectKey' is null
    and v_reservation.artifact ->> 'distributionKind' = 'external_reference'
    and v_reservation.artifact -> 'distributionReference' ->> 'validationState' = 'validated_by_server'
    and v_result.outcome = 'invalid_state'
    and v_external_finalized.outcome = 'finalized'
    and v_external_reviewed.outcome = 'reviewed'
    and v_other_result.outcome = 'invalid_request'
    and v_external_published.outcome = 'published'
    and exists (
      select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and event_type = 'security_update_artifact.inspect'
        and payload ->> 'artifactId' = v_external_artifact_id::text
    )
    and exists (
      select 1 from public.product_regulatory_outbox_events
      where organization_id = v_org and event_type = 'security_update_artifact.external_reference_monitor'
        and payload ->> 'artifactId' = v_external_artifact_id::text
    )
    and not exists (
      select 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_external_artifact_id::text
        and changes::text like '%https://updates.example.test/%'
    )
  );
  select * into v_external_monitored from public.monitor_product_security_update_external_reference_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version,
    'external_content_changed', gen_random_uuid()
  );
  update public.product_security_update_artifacts set
    availability_status = 'expired', version = version + 1
  where organization_id = v_org and id = v_external_artifact_id;
  select version into v_external_version
    from public.product_security_update_artifacts
   where organization_id = v_org and id = v_external_artifact_id;
  select * into v_result from public.monitor_product_security_update_external_reference_atomic(
    v_org, v_product, v_external_artifact_id, v_actor, v_external_version,
    'verified', gen_random_uuid()
  );
  perform pg_temp.check(
    'external monitor blocks changed content and never reactivates an expired artifact',
    v_external_monitored.outcome = 'monitored'
    and v_external_monitored.artifact ->> 'integrityStatus' = 'corrupt'
    and v_external_monitored.artifact ->> 'availabilityStatus' = 'blocked'
    and v_result.outcome = 'monitored'
    and v_result.artifact ->> 'availabilityStatus' = 'expired'
  );

  select * into v_reservation from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.2', 'Replacement security update',
    'software_update', 'all', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb,
    'security-update-replacement.bin', 'application/octet-stream', 33, repeat('c', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  v_replacement_id := (v_reservation.artifact ->> 'id')::uuid;
  insert into storage.objects(bucket_id, name)
  values ('security-update-artifacts', v_reservation.artifact ->> 'objectKey');
  perform * from public.finalize_product_security_update_artifact_atomic(
    v_org, v_product, v_replacement_id, v_actor, 1, repeat('c', 64),
    33, 'application/octet-stream', 'verified', gen_random_uuid()
  );
  perform * from public.review_product_security_update_artifact_atomic(
    v_org, v_product, v_replacement_id, v_actor, 2, 'cleared',
    'Replacement clearance.', gen_random_uuid()
  );
  select * into v_replacement from public.publish_product_security_update_artifact_atomic(
    v_org, v_product, v_replacement_id, v_actor, 3, '[]'::jsonb, gen_random_uuid()
  );
  update public.product_security_update_artifacts
     set availability_until = clock_timestamp() + interval '15 years', version = version + 1
   where organization_id = v_org and id = v_replacement_id;
  select * into v_result from public.replace_product_security_update_artifact_atomic(
    v_org, v_product, v_artifact_id, v_replacement_id, v_actor, 6,
    'Equivalent approved release artifact replaces the prior object.', gen_random_uuid()
  );
  select * into v_withdrawn from public.withdraw_product_security_update_artifact_atomic(
    v_org, v_product, v_artifact_id, v_actor, 7,
    'Early withdrawal follows an approved equivalent replacement.', gen_random_uuid()
  );
  perform pg_temp.check(
    'early withdrawal requires and records an approved published replacement with equal availability',
    v_replacement.outcome = 'published'
    and v_result.outcome = 'replaced'
    and v_withdrawn.outcome = 'withdrawn'
    and (select replacement_artifact_id = v_replacement_id
      from public.product_security_update_artifacts
      where organization_id = v_org and id = v_artifact_id)
  );

  select * into v_result from public.schedule_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, v_artifact_id, v_actor, gen_random_uuid()
  );
  perform pg_temp.check(
    'cleanup is recorded through the reused idempotent regulatory outbox',
    v_result.outcome in ('scheduled', 'blocked')
    and exists (
      select 1 from public.product_regulatory_outbox_events
       where organization_id = v_org and product_id = v_product and release_id = v_release
         and event_type = 'security_update_artifact.cleanup'
    )
  );

  -- Edge case: reserving an artifact whose issue date falls outside the
  -- active support period is blocked before any storage work happens.
  select * into v_result
  from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.9.0-outside-window',
    'Outside support window update', 'software_update', 'all', '{}'::jsonb,
    'authenticated_download', '[]'::jsonb,
    'outside-window.bin', 'application/octet-stream', 64, repeat('0', 64),
    clock_timestamp() + interval '13 years', gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'an issue date outside the support period reserves as availability-blocked',
    v_result.outcome = 'reserved'
    and v_result.artifact ->> 'availabilityStatus' = 'blocked'
    and v_result.artifact ->> 'supportPeriodId' is null
  );
  insert into storage.objects(bucket_id, name)
  values ('security-update-artifacts', v_result.artifact ->> 'objectKey');
  perform * from public.finalize_product_security_update_artifact_atomic(
    v_org, v_product, (v_result.artifact ->> 'id')::uuid, v_actor, 1,
    repeat('0', 64), 64, 'application/octet-stream', 'verified', gen_random_uuid()
  );
  perform * from public.review_product_security_update_artifact_atomic(
    v_org, v_product, (v_result.artifact ->> 'id')::uuid, v_actor, 2, 'cleared',
    'Cleared before probing the support window gate.', gen_random_uuid()
  );
  select * into v_result
  from public.publish_product_security_update_artifact_atomic(
    v_org, v_product, (v_result.artifact ->> 'id')::uuid, v_actor, 3,
    '[]'::jsonb, gen_random_uuid()
  );
  perform pg_temp.check(
    'publishing an artifact issued outside the support period is blocked',
    v_result.outcome = 'blocked'
  );

  -- Edge case: finalizing an authenticated download with no stored object
  -- degrades integrity to unavailable instead of claiming verification.
  select * into v_reservation
  from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.4-missing-object',
    'Missing object update', 'software_update', 'all', '{}'::jsonb,
    'authenticated_download', '[]'::jsonb,
    'missing-object.bin', 'application/octet-stream', 64, repeat('1', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  select * into v_finalized
  from public.finalize_product_security_update_artifact_atomic(
    v_org, v_product, (v_reservation.artifact ->> 'id')::uuid, v_actor, 1,
    repeat('1', 64), 64, 'application/octet-stream', 'verified', gen_random_uuid()
  );
  perform pg_temp.check(
    'finalizing a missing storage object records unavailable integrity',
    v_finalized.outcome = 'finalized'
    and v_finalized.artifact ->> 'integrityStatus' = 'unavailable'
    and v_finalized.artifact ->> 'uploadStatus' = 'failed'
  );

  -- Edge case: the same update version with different content is a distinct
  -- immutable record; version strings are not uniqueness keys.
  select * into v_result
  from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.1',
    'Same version republish', 'software_update', 'all', '{}'::jsonb,
    'authenticated_download', '[]'::jsonb,
    'same-version-rebuild.bin', 'application/octet-stream', 36, repeat('2', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'a same-version artifact with different content reserves as its own record',
    v_result.outcome = 'reserved'
    and v_result.artifact ->> 'id' <> v_artifact_id::text
    and v_result.artifact ->> 'sha256' = repeat('2', 64)
  );

  -- Edge case: two assessments claiming the same active modification
  -- converge through the unique active-modification index, not duplicates.
  select * into v_result
  from public.create_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_actor, v_reassessment_id, 'M2-V2-CHANGE-DUPLICATE',
    'Duplicate modification claim', 'A second analyst assesses the same change.',
    'The scope matches an already active modification.',
    clock_timestamp() - interval '10 minutes', clock_timestamp(),
    'The prior state stands.', 'The claimed state stands.',
    jsonb_build_array('Resolve the duplicate claim.'),
    v_answers, 'Duplicate claim rationale.',
    '[]'::jsonb,
    'not_substantial', array[v_release], gen_random_uuid(), gen_random_uuid()
  );
  select * into v_result
  from public.create_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_actor, v_reassessment_id, 'M2-V2-CHANGE-DUPLICATE',
    'Duplicate modification claim', 'A second analyst assesses the same change.',
    'The scope matches an already active modification.',
    clock_timestamp() - interval '10 minutes', clock_timestamp(),
    'The prior state stands.', 'The claimed state stands.',
    jsonb_build_array('Resolve the duplicate claim.'),
    v_answers, 'Duplicate claim rationale.',
    '[]'::jsonb,
    'not_substantial', array[v_release], gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'a concurrent duplicate active modification collapses to a conflict outcome',
    v_result.outcome = 'conflict'
    and (
      select count(*) = 1
      from public.product_substantial_modification_assessments
      where organization_id = v_org
        and modification_identifier = 'M2-V2-CHANGE-DUPLICATE'
        and superseded_at is null
    )
  );

  -- Metrics coverage: one assessment left awaiting review, one reviewed
  -- substantial determination with a mandatory override, and one corrupt
  -- inspection make every gauge family observable.
  select * into v_reservation
  from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release, v_actor, '1.0.3-quarantined', 'Quarantined update',
    'software_update', 'all', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb,
    'security-update-quarantined.bin', 'application/octet-stream', 40, repeat('f', 64),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  insert into storage.objects(bucket_id, name)
  values ('security-update-artifacts', v_reservation.artifact ->> 'objectKey');
  perform * from public.finalize_product_security_update_artifact_atomic(
    v_org, v_product, (v_reservation.artifact ->> 'id')::uuid, v_actor, 1,
    null, null, null, 'corrupt', gen_random_uuid()
  );

  select * into v_result
  from public.create_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_actor, gen_random_uuid(), 'M2-V2-CHANGE-002',
    'M2 V2 assessment awaiting review',
    'A modification awaiting conformity review for gauge coverage.',
    'The scope affects the update distribution path.',
    clock_timestamp() - interval '30 minutes', clock_timestamp(),
    'The prior release shipped the existing distribution path.',
    'The revised release adjusts the distribution path.',
    jsonb_build_array('Complete the conformity review.'),
    v_answers, 'Pending review rationale recorded for metrics coverage.',
    '[]'::jsonb,
    'potentially_substantial', array[v_release], gen_random_uuid(), gen_random_uuid()
  );
  v_metrics_pending_id := (v_result.assessment ->> 'id')::uuid;

  select * into v_result
  from public.create_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_actor, gen_random_uuid(), 'M2-V2-CHANGE-003',
    'M2 V2 reviewed substantial modification',
    'A reviewed substantial modification for gauge coverage.',
    'The privileged remote control surface changed materially.',
    clock_timestamp() - interval '45 minutes', clock_timestamp(),
    'The prior release exposed the existing control surface.',
    'The revised release reworks the control surface.',
    jsonb_build_array('Trigger conformity reassessment.'),
    v_answers, 'Reviewed substantial rationale recorded for metrics coverage.',
    '[]'::jsonb,
    'potentially_substantial', array[v_release], gen_random_uuid(), gen_random_uuid()
  );
  v_metrics_flagged_id := (v_result.assessment ->> 'id')::uuid;
  perform * from public.review_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_metrics_flagged_id, v_actor, 1,
    'substantial', 'Human reviewer escalated beyond the policy suggestion.',
    'Escalation follows a recorded engineering decision.', gen_random_uuid()
  );

  select * into v_snapshot
  from public.product_compliance_metrics_snapshot(v_org);
  perform pg_temp.check(
    'metrics snapshot counts backlog, flagged determinations, and quarantine without false positives',
    -- Three rows await review: the pending CHANGE-002 assessment, the
    -- reassessment itself (inserted as submitted_for_review even though it
    -- carries a requested determination), and the surviving duplicate claim.
    -- The missing-object finalize contributes provider-unavailable and the
    -- outside-support-window artifact is the blocked availability gauge.
    -- The external artifact is expired rather than blocked because its final
    -- verified monitor run restored integrity while preserving the expiry,
    -- and a published artifact can never expire inside 30 days of a fresh
    -- fixture because of its ten calendar year floor.
    v_snapshot.assessment_backlog = 3
    and v_snapshot.flagged_assessments = 1
    and v_snapshot.artifact_quarantine = 1
    and v_snapshot.artifact_hash_mismatch = 0
    and v_snapshot.artifact_provider_unavailable = 1
    and v_snapshot.artifact_upload_missing = 0
    and v_snapshot.artifact_expiring_availability = 0
    and v_snapshot.artifact_availability_blocked = 1
    and exists (
      select 1 from public.product_substantial_modification_assessments
       where organization_id = v_org and id = v_metrics_pending_id
         and status = 'submitted_for_review' and superseded_at is null
    )
    and exists (
      select 1 from public.product_substantial_modification_assessments
       where organization_id = v_org and id = v_metrics_flagged_id
         and status = 'reviewed' and determination = 'substantial'
    )
  );

  update public.users set is_active = false
  where id in (
    select member.user_id from public.organization_members member
    where member.organization_id = v_org and member.role in ('owner', 'admin')
      and member.user_id <> v_admin
  );
  select * into v_worker_effect
  from public.schedule_security_update_artifact_cleanup_worker_atomic(
    v_org, v_product, v_artifact_id, gen_random_uuid()
  );
  perform pg_temp.check(
    'worker effects resolve a current active org authority and retain source provenance',
    v_worker_effect.outcome = 'scheduled'
    and exists (
      select 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_artifact_id::text
        and action = 'product.security_update_artifact_worker_effect_authorized'
        and changes ->> 'workerActorId' = v_admin::text
        and changes ->> 'sourceUpdatedBy' = v_actor::text
    )
  );
  update public.users set is_active = false
  where id in (
    select member.user_id from public.organization_members member
    where member.organization_id = v_org and member.role in ('owner', 'admin')
  );
  select * into v_worker_unavailable
  from public.recalc_security_update_artifact_availability_worker_atomic(
    v_org, v_product, v_artifact_id, gen_random_uuid()
  );
  perform pg_temp.check(
    'worker effects remain retryable when no active owner or admin can authorize them',
    v_worker_unavailable.outcome = 'retryable_unavailable'
    and v_worker_unavailable.artifact is null
  );

  begin
    delete from public.organization_legal_entities
    where organization_id = v_org and id = v_entity;
    set constraints all immediate;
  exception when foreign_key_violation then
    v_direct_legal_entity_delete_blocked := true;
  end;
  perform pg_temp.check(
    'direct legal entity deletion remains blocked by deferred product and release references at commit',
    v_direct_legal_entity_delete_blocked
    and exists (
      select 1 from public.organization_legal_entities
      where organization_id = v_org and id = v_entity
    )
  );

  begin
    delete from public.products
    where organization_id = v_org and id = v_product;
    set constraints all immediate;
  exception when foreign_key_violation then
    v_direct_product_delete_blocked := true;
  end;
  perform pg_temp.check(
    'direct product deletion remains blocked by deferred M2 evidence references at commit',
    v_direct_product_delete_blocked
    and exists (
      select 1 from public.products
      where organization_id = v_org and id = v_product
    )
  );

  perform pg_temp.check(
    'tenant cascade test has no active legal-hold authority',
    not exists (
      select 1 from public.retention_authoritative_facts
      where organization_id = v_org and reason_kind = 'legal_hold' and active
    )
  );
  -- This is an existing M1 restrictive relationship, not M2 evidence. The
  -- run-scoped cleanup removes this exact mutable assignment before the
  -- organization cascade, while M2's append-only rows remain untouched.
  delete from public.product_legal_entity_assignments
  where organization_id = v_org;
  -- Product-import staging remains mutable service-role state. Its restrictive
  -- product/release references must be removed before the exact tenant cascade.
  delete from public.product_import_rows where organization_id = v_org;
  delete from public.product_import_jobs where organization_id = v_org;
  delete from public.organizations where id = v_org;
  set constraints all immediate;
  perform pg_temp.check(
    'exact organization deletion atomically cascades M2 evidence after hold clearance',
    not exists (select 1 from public.organizations where id = v_org)
    and not exists (
      select 1 from public.product_substantial_modification_assessments
      where organization_id = v_org
    )
    and not exists (
      select 1 from public.product_substantial_modification_releases
      where organization_id = v_org
    )
    and not exists (
      select 1 from public.product_security_update_artifacts
      where organization_id = v_org
    )
  );
end;
$$;
rollback;

-- ===========================================================================
-- Gap-closing coverage: assessment retention-authority wiring, real cleanup
-- completion, metrics extensions, and artifact metadata edit.
-- ===========================================================================

select pg_temp.check(
  'new cleanup and metadata-edit RPCs are service-role only with pinned search_path',
  (select count(*) = 7 from pg_proc functions
    join pg_namespace namespaces on namespaces.oid = functions.pronamespace
    where namespaces.nspname = 'public'
      and functions.proname in (
        'm2_v2_set_assessment_retention_fact',
        'begin_product_security_update_artifact_cleanup_atomic',
        'complete_product_security_update_artifact_cleanup_atomic',
        'begin_security_update_artifact_cleanup_worker_atomic',
        'complete_security_update_artifact_cleanup_worker_atomic',
        'reverify_product_security_update_artifact_atomic',
        'update_product_security_update_artifact_metadata_atomic'
      )
      and functions.prosecdef
      and functions.proconfig = array['search_path=public, pg_temp'])
  and not exists (
    select 1 from information_schema.routine_privileges privileges
    where privileges.routine_schema = 'public'
      and privileges.routine_name in (
        'm2_v2_set_assessment_retention_fact',
        'begin_product_security_update_artifact_cleanup_atomic',
        'complete_product_security_update_artifact_cleanup_atomic',
        'begin_security_update_artifact_cleanup_worker_atomic',
        'complete_security_update_artifact_cleanup_worker_atomic',
        'reverify_product_security_update_artifact_atomic',
        'update_product_security_update_artifact_metadata_atomic'
      )
      and privileges.grantee in ('public', 'anon', 'authenticated')
  )
);

select pg_temp.check(
  'cleanup completion columns exist and are service-role updatable only',
  (select count(*) = 2 from information_schema.columns columns
    where columns.table_schema = 'public'
      and columns.table_name = 'product_security_update_artifacts'
      and columns.column_name in ('cleanup_completed_at', 'cleanup_completed_by'))
  and not exists (
    select 1 from information_schema.column_privileges privileges
    where privileges.table_schema = 'public'
      and privileges.table_name = 'product_security_update_artifacts'
      and privileges.column_name in ('cleanup_completed_at', 'cleanup_completed_by')
      and privileges.privilege_type = 'UPDATE'
      and privileges.grantee in ('public', 'anon', 'authenticated')
  )
);

select pg_temp.check(
  'product_compliance_metrics_snapshot reports an upload-failure gauge',
  exists (
    select 1 from pg_proc functions
    where functions.proname = 'product_compliance_metrics_snapshot'
      and 'artifact_upload_failed' = any(functions.proargnames)
  )
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_product uuid := gen_random_uuid();
  v_release_a uuid := gen_random_uuid();
  v_release_b uuid := gen_random_uuid();
  v_release_c uuid := gen_random_uuid();
  v_answers jsonb := jsonb_build_object(
    'changesIntendedPurpose', 'no',
    'changesSecurityArchitectureOrTrustBoundary', 'yes',
    'changesNetworkInterfaceOrPrivilegedRemoteControl', 'unknown',
    'changesCryptographyOrIdentityAccessControl', 'yes',
    'changesSafetyOrSecurityRelevantComponent', 'no'
  );
  v_result record;
  v_reviewed record;
  v_reassessed record;
  v_artifact_a record;
  v_artifact_b record;
  v_artifact_c record;
  v_begin record;
  v_complete record;
  v_metadata record;
  v_conflict record;
  v_sha256 text := encode(sha256('m2-v2-gap-closing-fixture-bytes'), 'hex');
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_entity from public.organization_legal_entities
   where organization_id = v_org and is_default;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by
  ) values (
    v_product, v_org, v_entity, 0, '{}'::jsonb,
    'M2 V2 gap-closing test', 'M2-V2-GAP-' || v_product::text,
    'standalone_software', v_actor, v_actor, v_actor
  );
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, placed_on_market_at,
    created_by, updated_by
  ) values
    (v_release_a, v_org, v_product, v_entity, 0, '{}'::jsonb,
      'Release A', '1.0-' || v_release_a::text, 'placed_on_market', clock_timestamp(), v_actor, v_actor),
    (v_release_b, v_org, v_product, v_entity, 0, '{}'::jsonb,
      'Release B', '1.0-' || v_release_b::text, 'placed_on_market', clock_timestamp(), v_actor, v_actor),
    (v_release_c, v_org, v_product, v_entity, 0, '{}'::jsonb,
      'Release C', '1.0-' || v_release_c::text, 'placed_on_market', clock_timestamp(), v_actor, v_actor);

  -- Assessment retention-authority wiring: a substantial determination
  -- activates a retention_authoritative_facts row; reassessing (superseding)
  -- it deactivates the superseded row's fact.
  select * into v_result
  from public.create_product_substantial_modification_assessment_atomic(
    v_org, v_product, v_actor, gen_random_uuid(), 'GAP-MOD-1', 'Gap-closing modification',
    'Description of the modification.', 'Technical scope of the modification.',
    clock_timestamp() - interval '1 day', clock_timestamp(),
    'Previous product state.', 'Resulting product state.',
    '[]'::jsonb, v_answers, 'Rationale for the modification.', '[]'::jsonb,
    'potentially_substantial', array[v_release_a], gen_random_uuid(), gen_random_uuid()
  );
  select * into v_reviewed
  from public.review_product_substantial_modification_assessment_atomic(
    v_org, v_product, (v_result.assessment ->> 'id')::uuid, v_actor,
    (v_result.assessment ->> 'version')::integer, 'substantial',
    'Confirmed substantial on review.',
    'Escalated above the policy suggestion after manual review of the trust boundary impact.',
    gen_random_uuid()
  );
  perform pg_temp.check(
    'reviewing above the policy suggestion succeeds once a mandatory override reason is given',
    v_reviewed.outcome = 'reviewed'
  );
  perform pg_temp.check(
    'a substantial determination activates an assessment retention-authority fact',
    exists (
      select 1 from public.retention_authoritative_facts facts
      where facts.organization_id = v_org
        and facts.evidence_class = 'substantial_modification'
        and facts.reason_kind = 'obligation'
        and facts.source_record_id = (v_result.assessment ->> 'id')::uuid
        and facts.active
        and facts.protect_through = 'infinity'::timestamptz
    )
  );

  select * into v_reassessed
  from public.reassess_product_substantial_modification_atomic(
    v_org, v_product, (v_result.assessment ->> 'id')::uuid, v_actor,
    (v_reviewed.assessment ->> 'version')::integer, 'GAP-MOD-1', 'Gap-closing modification',
    'Updated description.', 'Technical scope of the modification.',
    clock_timestamp() - interval '1 day', clock_timestamp(),
    'Previous product state.', 'Resulting product state.',
    '[]'::jsonb, v_answers, 'Updated rationale.', '[]'::jsonb,
    'potentially_substantial', array[v_release_a], gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'reassessing a substantial assessment deactivates the superseded fact',
    v_reassessed.outcome = 'reassessed'
    and not exists (
      select 1 from public.retention_authoritative_facts facts
      where facts.organization_id = v_org
        and facts.evidence_class = 'substantial_modification'
        and facts.reason_kind = 'obligation'
        and facts.source_record_id = (v_result.assessment ->> 'id')::uuid
        and facts.active
    )
  );

  -- Real cleanup completion: not-due, shared-object-key, clear, complete,
  -- already-completed, and legal-hold blocking.
  select * into v_artifact_a from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release_a, v_actor, '1.0.0', 'Gap-closing artifact A',
    'software_update', 'linux-x86_64', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb, 'update-a.bin', 'application/octet-stream', 2048, v_sha256,
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  select * into v_artifact_b from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release_b, v_actor, '1.0.0', 'Gap-closing artifact B',
    'software_update', 'linux-x86_64', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb, 'update-b.bin', 'application/octet-stream', 2048, v_sha256,
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  select * into v_artifact_c from public.reserve_product_security_update_artifact_atomic(
    v_org, v_product, v_release_c, v_actor, '1.0.0', 'Gap-closing artifact C',
    'software_update', 'linux-x86_64', '{}'::jsonb, 'authenticated_download',
    '[]'::jsonb, 'update-c.bin', 'application/octet-stream', 2048,
    encode(sha256('m2-v2-gap-closing-fixture-bytes-c'), 'hex'),
    clock_timestamp(), gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'artifacts sharing byte-identical content share the same content-addressed object key',
    (v_artifact_a.artifact ->> 'id') is not null
    and (select object_key from public.product_security_update_artifacts
          where organization_id = v_org and id = (v_artifact_a.artifact ->> 'id')::uuid)
      = (select object_key from public.product_security_update_artifacts
          where organization_id = v_org and id = (v_artifact_b.artifact ->> 'id')::uuid)
  );

  select * into v_begin from public.begin_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, (v_artifact_a.artifact ->> 'id')::uuid
  );
  perform pg_temp.check(
    'cleanup is not due before the artifact is expired or withdrawn',
    v_begin.outcome = 'not_due'
  );

  update public.product_security_update_artifacts set
    availability_status = 'expired', cleanup_scheduled_at = now(), cleanup_scheduled_by = v_actor,
    version = version + 1, updated_by = v_actor
  where organization_id = v_org and id = (v_artifact_a.artifact ->> 'id')::uuid;

  select * into v_begin from public.begin_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, (v_artifact_a.artifact ->> 'id')::uuid
  );
  perform pg_temp.check(
    'cleanup defers deleting bytes while a live sibling still references the shared object key',
    v_begin.outcome = 'shared_object'
  );

  update public.product_security_update_artifacts set
    availability_status = 'expired', cleanup_scheduled_at = now(), cleanup_scheduled_by = v_actor,
    version = version + 1, updated_by = v_actor
  where organization_id = v_org and id = (v_artifact_b.artifact ->> 'id')::uuid;

  select * into v_begin from public.begin_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, (v_artifact_a.artifact ->> 'id')::uuid
  );
  perform pg_temp.check(
    'cleanup clears once no live sibling references the shared object key',
    v_begin.outcome = 'clear'
    and v_begin.object_key is not null
  );

  select * into v_complete from public.complete_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, (v_artifact_a.artifact ->> 'id')::uuid, v_actor, true, gen_random_uuid()
  );
  perform pg_temp.check(
    'cleanup completion is durably recorded with an audit fact',
    v_complete.outcome = 'completed'
    and (v_complete.artifact ->> 'id') is not null
    and exists (
      select 1 from public.audit_logs
      where organization_id = v_org and entity_id = (v_artifact_a.artifact ->> 'id')
        and action = 'product.security_update_artifact_cleanup_completed'
        and changes ->> 'objectRemoved' = 'true'
    )
    and (select cleanup_completed_at is not null and cleanup_completed_by = v_actor
      from public.product_security_update_artifacts
      where organization_id = v_org and id = (v_artifact_a.artifact ->> 'id')::uuid)
  );

  select * into v_begin from public.begin_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, (v_artifact_a.artifact ->> 'id')::uuid
  );
  perform pg_temp.check(
    'cleanup is idempotent once already completed',
    v_begin.outcome = 'already_completed'
  );

  update public.product_security_update_artifacts set
    availability_status = 'expired', cleanup_scheduled_at = now(), cleanup_scheduled_by = v_actor,
    version = version + 1, updated_by = v_actor
  where organization_id = v_org and id = (v_artifact_c.artifact ->> 'id')::uuid;
  insert into public.retention_authoritative_facts(
    organization_id, evidence_class, reason_kind, source_record_id,
    required_retention_days, protect_through, active, last_observed_at
  ) values (
    v_org, 'security_update_artifact', 'legal_hold', (v_artifact_c.artifact ->> 'id')::uuid,
    0, null, true, now()
  );
  select * into v_begin from public.begin_product_security_update_artifact_cleanup_atomic(
    v_org, v_product, (v_artifact_c.artifact ->> 'id')::uuid
  );
  perform pg_temp.check(
    'cleanup is blocked while the organization has an active legal hold',
    v_begin.outcome = 'legal_hold'
  );
  delete from public.retention_authoritative_facts
  where organization_id = v_org and reason_kind = 'legal_hold'
    and source_record_id = (v_artifact_c.artifact ->> 'id')::uuid;

  -- Metadata edit: mutable fields update with an audit trail and optimistic
  -- locking, content-identity columns never change.
  select * into v_metadata
  from public.update_product_security_update_artifact_metadata_atomic(
    v_org, v_product, (v_artifact_c.artifact ->> 'id')::uuid, v_actor,
    (select version from public.product_security_update_artifacts
      where organization_id = v_org and id = (v_artifact_c.artifact ->> 'id')::uuid),
    'Renamed gap-closing artifact C',
    'linux-arm64', jsonb_build_object('algorithm', 'ed25519'), gen_random_uuid()
  );
  perform pg_temp.check(
    'metadata edit updates mutable fields, bumps version, and writes an audit fact',
    v_metadata.outcome = 'updated'
    and (v_metadata.artifact ->> 'title') = 'Renamed gap-closing artifact C'
    and (v_metadata.artifact ->> 'supportedPlatform') = 'linux-arm64'
    and (v_metadata.artifact ->> 'sha256')
      = (select sha256 from public.product_security_update_artifacts
          where organization_id = v_org and id = (v_artifact_c.artifact ->> 'id')::uuid)
    and exists (
      select 1 from public.audit_logs
      where organization_id = v_org and entity_id = (v_artifact_c.artifact ->> 'id')
        and action = 'product.security_update_artifact_metadata_updated'
        and changes -> 'before' ->> 'title' = 'Gap-closing artifact C'
        and changes -> 'after' ->> 'title' = 'Renamed gap-closing artifact C'
    )
  );

  select * into v_conflict
  from public.update_product_security_update_artifact_metadata_atomic(
    v_org, v_product, (v_artifact_c.artifact ->> 'id')::uuid, v_actor,
    (v_artifact_c.artifact ->> 'version')::integer, 'Stale write', 'linux-arm64',
    '{}'::jsonb, gen_random_uuid()
  );
  perform pg_temp.check(
    'metadata edit rejects a stale expected version as a conflict, not a silent overwrite',
    v_conflict.outcome = 'conflict'
    and (v_conflict.artifact ->> 'title') = 'Renamed gap-closing artifact C'
  );

  select * into v_conflict from public.product_compliance_metrics_snapshot(v_org);
  perform pg_temp.check(
    'metrics snapshot exposes the upload-failure gauge alongside the existing gauges',
    v_conflict is not null
  );
end;
$$;
rollback;
