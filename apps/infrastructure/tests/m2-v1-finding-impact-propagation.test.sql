-- M2 V1 finding impact propagation integration tests.
-- This stays separate from the product graph suite because finding impacts own
-- their high-volume lifecycle and must not become product-registry state.

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
  'finding propagation owns exactly the durable source, impact, override, and job records',
  to_regclass('public.finding_propagation_sources') is not null
  and to_regclass('public.finding_impact_associations') is not null
  and to_regclass('public.finding_product_impact_overrides') is not null
  and to_regclass('public.finding_propagation_jobs') is not null
  and not has_table_privilege('authenticated', 'public.finding_impact_associations', 'select')
  and has_table_privilege('service_role', 'public.finding_impact_associations', 'select')
  and not has_function_privilege(
    'authenticated',
    'public.claim_finding_propagation_job_atomic(uuid,uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_finding_propagation_job_atomic(uuid,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.describe_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.get_product_relationship_propagation_candidates_system(uuid,uuid,uuid,integer,timestamptz,integer,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.end_finding_product_impact_override_atomic(uuid,uuid,uuid,integer,text,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.end_finding_product_impact_override_atomic(uuid,uuid,uuid,integer,text,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.update_finding_propagation_source_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,integer,uuid,uuid)',
    'execute'
  )
  and to_regclass('public.software_baseline_lifecycle_dependency_facts') is null
  and has_function_privilege(
    'service_role',
    'public.enqueue_finding_propagation_source_page_atomic(uuid,text,integer,text,uuid,uuid,uuid,timestamptz,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.enqueue_finding_propagation_source_page_atomic(uuid,text,integer,text,uuid,uuid,uuid,timestamptz,uuid,integer)',
    'execute'
  )
  and (select prosecdef and 'search_path=public, pg_temp' = any(proconfig)
    from pg_proc where oid = 'public.persist_finding_propagation_page_atomic(uuid,uuid,uuid,integer,jsonb,text,boolean)'::regprocedure)
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_other_org uuid := gen_random_uuid();
  v_actor uuid;
  v_entity uuid;
  v_product_id uuid := gen_random_uuid();
  v_release_id uuid := gen_random_uuid();
  v_source_id uuid;
  v_baseline_source_id uuid;
  v_baseline_id uuid;
  v_baseline_revision_id uuid;
  v_baseline_member_product_id uuid := gen_random_uuid();
  v_baseline_member_release_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_override_id uuid;
  v_worker_id uuid := gen_random_uuid();
  v_event_key text := 'event:' || gen_random_uuid()::text;
  v_graph_version integer;
  v_register record;
  v_enqueue_first record;
  v_enqueue_replay record;
  v_claim record;
  v_persist record;
  v_override record;
  v_end record;
  v_end_replay record;
  v_end_stale record;
  v_update record;
  v_update_replay record;
  v_cross_tenant record;
  v_obsolete record;
  v_baseline record;
  v_baseline_source record;
  v_baseline_source_archived record;
  v_baseline_archive record;
  v_baseline_membership record;
  v_baseline_membership_ended record;
  v_baseline_membership_event record;
  v_baseline_page record;
  v_now timestamptz := clock_timestamp();
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select id into v_entity from public.organization_legal_entities
   where organization_id = v_org and is_default;
  if v_actor is null or v_entity is null then
    raise exception 'M2 fixture requires the seeded owner and legal entity';
  end if;

  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_by, updated_by
  ) values (
    v_product_id, v_org, v_entity, 0, '{}'::jsonb,
    'Finding propagation integration product',
    'M2-FIND-' || v_product_id::text,
    'standalone_software', v_actor, v_actor, v_actor
  );
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values (
    v_release_id, v_org, v_product_id, v_entity, 0, '{}'::jsonb,
    'Finding propagation release', '1.0.0-' || v_release_id::text,
    'development', v_actor, v_actor
  );

  select * into v_register from public.register_finding_propagation_source_atomic(
    v_org, v_actor, 'integration', 'finding-' || v_product_id::text,
    v_product_id, v_release_id, null, 'v1', 'integration-test',
    'SQL propagation fixture', gen_random_uuid(), gen_random_uuid()
  );
  v_source_id := (v_register.source ->> 'id')::uuid;
  v_job_id := v_register.job_id;
  perform pg_temp.check(
    'registering an opaque source creates one tenant-scoped durable job',
    v_register.outcome = 'created'
      and v_source_id is not null
      and v_job_id is not null
      and (select count(*) from public.finding_propagation_jobs
        where organization_id = v_org and source_finding_id = v_source_id) = 1
  );

  select product_relationship_graph_version into v_graph_version
    from public.organization_settings where organization_id = v_org;
  select * into v_enqueue_first from public.enqueue_finding_propagation_source_page_atomic(
    v_org, v_event_key, v_graph_version, 'release',
    v_product_id, v_release_id, null, v_now, null, 100
  );
  select * into v_enqueue_replay from public.enqueue_finding_propagation_source_page_atomic(
    v_org, v_event_key, v_graph_version, 'release',
    v_product_id, v_release_id, null, v_now, null, 100
  );
  perform pg_temp.check(
    'release-scoped source pages are bounded and replay without duplicate jobs',
    v_enqueue_first.outcome = 'enqueued_page'
      and v_enqueue_first.source_count = 1
      and v_enqueue_first.next_cursor is null
      and v_enqueue_replay.outcome = 'enqueued_page'
      and v_enqueue_replay.source_count = 1
      and (select count(*) from public.finding_propagation_jobs
        where organization_id = v_org
          and trigger_key = v_event_key || ':' || v_source_id::text) = 1
  );

  -- Claim the registration job, then persist a product-wide relationship
  -- candidate. This is the exact durable page boundary the worker uses.
  select * into v_claim from public.claim_finding_propagation_job_atomic(
    v_org, v_worker_id, 60
  );
  perform pg_temp.check('a due job is exclusively leased with a checkpoint',
    v_claim.outcome = 'claimed' and v_claim.checkpoint_version > 0
  );
  select * into v_persist from public.persist_finding_propagation_page_atomic(
    v_org, v_claim.job_id, v_worker_id, v_claim.checkpoint_version,
    jsonb_build_array(jsonb_build_object(
      'productId', v_product_id,
      'releaseId', v_release_id,
      'relationshipPathIds', '[]'::jsonb,
      'graphVersion', v_claim.graph_version,
      'evaluatedAt', public.m2_utc_z(v_now)
    )),
    null,
    true
  );
  perform pg_temp.check(
    'one persisted page produces one source-to-product association without analyst cloning',
    v_persist.outcome = 'completed'
      and v_persist.processed_count = 1
      and (select count(*) from public.finding_impact_associations
        where organization_id = v_org and source_finding_id = v_source_id) = 1
      and exists (
        select 1 from public.product_lifecycle_dependency_facts f
         where f.organization_id = v_org
           and f.authority_kind = 'finding'
           and f.active
      )
  );

  select * into v_override from public.create_finding_product_impact_override_atomic(
    v_org, v_source_id, v_product_id, v_release_id, v_actor,
    'not_applicable', 'Variant hardware excludes this condition',
    'integration-test', 'SQL propagation fixture', v_now, null,
    gen_random_uuid(), gen_random_uuid()
  );
  v_override_id := (v_override.override ->> 'id')::uuid;
  perform pg_temp.check(
    'a product-specific exception is a separate audited override rather than a copied assessment',
    v_override.outcome = 'created' and v_override_id is not null
  );
  select * into v_end from public.end_finding_product_impact_override_atomic(
    v_org, v_override_id, v_actor, 0, 'Configuration changed',
    '00000000-0000-4000-8000-00000000f101',
    '00000000-0000-4000-8000-00000000f102'
  );
  select * into v_end_replay from public.end_finding_product_impact_override_atomic(
    v_org, v_override_id, v_actor, 0, 'Configuration changed',
    '00000000-0000-4000-8000-00000000f101',
    '00000000-0000-4000-8000-00000000f103'
  );
  select * into v_end_stale from public.end_finding_product_impact_override_atomic(
    v_org, v_override_id, v_actor, 0, 'Different retry',
    gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'ending an override is versioned, idempotent, and never silently replaces the reason',
    v_end.outcome = 'ended'
      and (v_end.override ->> 'endedAt') is not null
      and v_end_replay.outcome = 'replayed'
      and v_end_stale.outcome = 'conflict'
  );

  select * into v_update from public.update_finding_propagation_source_atomic(
    v_org, v_source_id, v_actor, v_product_id, v_release_id, null,
    'v2', 'resolved', 'The source finding was resolved',
    'integration-test', 'SQL propagation fixture', 0,
    '00000000-0000-4000-8000-00000000f201',
    '00000000-0000-4000-8000-00000000f202'
  );
  select * into v_update_replay from public.update_finding_propagation_source_atomic(
    v_org, v_source_id, v_actor, v_product_id, v_release_id, null,
    'v2', 'resolved', 'The source finding was resolved',
    'integration-test', 'SQL propagation fixture', 0,
    '00000000-0000-4000-8000-00000000f201',
    '00000000-0000-4000-8000-00000000f203'
  );
  perform pg_temp.check(
    'resolving a source closes active impacts and records an idempotent terminal job',
    v_update.outcome = 'updated'
      and v_update.job_id is not null
      and v_update_replay.outcome = 'replayed'
      and (select status from public.finding_impact_associations
        where organization_id = v_org and source_finding_id = v_source_id) = 'closed'
      and (select status from public.finding_propagation_jobs
        where organization_id = v_org and id = v_update.job_id) = 'completed'
      and not exists (
        select 1 from public.product_lifecycle_dependency_facts f
         where f.organization_id = v_org
           and f.authority_kind = 'finding'
           and f.record_id in (
             select id from public.finding_impact_associations
              where organization_id = v_org and source_finding_id = v_source_id
           )
           and f.active
      )
  );

  insert into public.organizations(id, name, slug, size)
  values (v_other_org, 'Finding propagation rival', 'finding-rival-' || left(v_other_org::text, 8), 'small');
  select * into v_cross_tenant from public.update_finding_propagation_source_atomic(
    v_other_org, v_source_id, v_actor, v_product_id, v_release_id, null,
    'v2', 'active', 'Cross tenant probe', 'integration-test',
    'SQL propagation fixture', 1, gen_random_uuid(), gen_random_uuid()
  );
  perform pg_temp.check(
    'cross-tenant update collapses an intermediate foreign source to not found',
    v_cross_tenant.outcome = 'not_found'
  );

  -- An active update gets a normal graph job. Obsoleting a stale lease is a
  -- terminal state, not a retry that eventually dead-letters old graph work.
  select * into v_update from public.update_finding_propagation_source_atomic(
    v_org, v_source_id, v_actor, v_product_id, v_release_id, null,
    'v3', 'active', 'The finding was reopened', 'integration-test',
    'SQL propagation fixture', 1, gen_random_uuid(), gen_random_uuid()
  );
  select * into v_claim from public.claim_finding_propagation_job_atomic(
    v_org, v_worker_id, 60
  );
  select * into v_obsolete from public.obsolete_finding_propagation_job_atomic(
    v_org, v_claim.job_id, v_worker_id, v_claim.checkpoint_version, 'stale_graph'
  );
  perform pg_temp.check(
    'stale graph work is terminally obsoleted instead of retried or dead-lettered',
    v_update.outcome = 'updated'
      and v_claim.outcome = 'claimed'
      and v_obsolete.outcome = 'obsolete'
      and (select status from public.finding_propagation_jobs where id = v_claim.job_id) = 'obsolete'
  );

  select * into v_baseline from public.create_software_baseline_atomic(
    v_org, v_actor, 'finding-baseline-' || v_product_id::text,
    'Finding lifecycle baseline', null, 'Baseline source fixture',
    'integration-test', 'SQL propagation fixture', v_now, null,
    gen_random_uuid(), gen_random_uuid()
  );
  v_baseline_id := (v_baseline.baseline ->> 'baselineId')::uuid;
  v_baseline_revision_id := (v_baseline.baseline ->> 'id')::uuid;
  select * into v_baseline_source from public.register_finding_propagation_source_atomic(
    v_org, v_actor, 'integration', 'baseline-finding-' || v_product_id::text,
    v_product_id, null, v_baseline_revision_id, 'v1', 'integration-test',
    'SQL propagation fixture', gen_random_uuid(), gen_random_uuid()
  );
  v_baseline_source_id := (v_baseline_source.source ->> 'id')::uuid;
  select * into v_baseline_archive from public.archive_software_baseline_atomic(
    v_org, v_baseline_id, v_actor, 0, 'Archive probe', gen_random_uuid()
  );
  perform pg_temp.check(
    'an active baseline-scoped finding blocks baseline archive through its published lifecycle fact',
    v_baseline_source.outcome = 'created'
      and v_baseline_archive.outcome = 'blocked'
      and exists (
        select 1 from public.product_lifecycle_dependency_facts f
         where f.organization_id = v_org
           and f.subject_kind = 'baseline'
           and f.record_id = v_baseline_source_id
           and f.active
      )
  );
  insert into public.products(
    id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type,
    responsible_owner_id, created_by, updated_by
  ) values (
    v_baseline_member_product_id, v_org, v_entity, 0, '{}'::jsonb,
    'Baseline membership fan-out product',
    'M2-FIND-MEMBER-' || v_baseline_member_product_id::text,
    'standalone_software', v_actor, v_actor, v_actor
  );
  insert into public.product_releases(
    id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by
  ) values (
    v_baseline_member_release_id, v_org, v_baseline_member_product_id,
    v_entity, 0, '{}'::jsonb, 'Baseline membership fan-out release',
    '1.0.0-' || v_baseline_member_release_id::text,
    'development', v_actor, v_actor
  );
  select * into v_baseline_membership
    from public.assign_software_baseline_membership_atomic(
      v_org, v_baseline_member_product_id, v_baseline_id,
      v_baseline_revision_id, v_baseline_member_release_id, v_actor, 0,
      'integration-test', 'SQL propagation fixture', transaction_timestamp() - interval '1 second', null,
      gen_random_uuid(), gen_random_uuid()
    );
  select event_key, graph_version into v_baseline_membership_event
    from public.product_regulatory_outbox_events
   where organization_id = v_org
     and product_id = v_baseline_member_product_id
     and event_type = 'product_relationship.graph_changed'
     and payload ->> 'subjectKind' = 'baseline_membership'
   order by occurred_at desc, id desc
   limit 1;
  select * into v_baseline_page
    from public.enqueue_finding_propagation_source_page_atomic(
      v_org, v_baseline_membership_event.event_key,
      v_baseline_membership_event.graph_version, 'baseline',
      v_baseline_member_product_id, null, v_baseline_revision_id,
      v_now, null, 100
    );
  perform pg_temp.check(
    'a baseline membership event on product B fans out active baseline sources detected on product A',
    v_baseline_membership.outcome = 'created'
      and v_baseline_membership_event.event_key is not null
      and v_baseline_page.outcome = 'enqueued_page'
      and v_baseline_page.source_count = 1
      and exists (
        select 1 from public.finding_propagation_jobs j
         where j.organization_id = v_org
           and j.source_finding_id = v_baseline_source_id
           and j.trigger_key = v_baseline_membership_event.event_key || ':' || v_baseline_source_id::text
      )
  );
  select * into v_baseline_membership_ended
    from public.end_software_baseline_membership_atomic(
      v_org, v_baseline_member_product_id,
      (v_baseline_membership.membership ->> 'id')::uuid, v_actor, 0,
      'Scale-safe baseline fan-out fixture completed', v_now + interval '1 second',
      gen_random_uuid()
    );
  perform pg_temp.check(
    'the fan-out fixture ends only its own release-aware membership before archival checks',
    v_baseline_membership_ended.outcome = 'ended'
  );
  select * into v_baseline_source_archived from public.update_finding_propagation_source_atomic(
    v_org, v_baseline_source_id, v_actor, v_product_id, null,
    v_baseline_revision_id, 'v1', 'archived', 'Historical source retained',
    'integration-test', 'SQL propagation fixture', 0,
    gen_random_uuid(), gen_random_uuid()
  );
  select * into v_baseline_archive from public.archive_software_baseline_atomic(
    v_org, v_baseline_id, v_actor, 0, 'Archive after source preservation', gen_random_uuid()
  );
  perform pg_temp.check(
    'archived finding history remains retained while its inactive dependency fact permits controlled baseline archive',
    v_baseline_source_archived.outcome = 'updated'
      and v_baseline_archive.outcome = 'archived'
      and not exists (
        select 1 from public.product_lifecycle_dependency_facts f
         where f.organization_id = v_org
           and f.subject_kind = 'baseline'
           and f.record_id = v_baseline_source_id
           and f.active
      )
  );
end;
$$;
rollback;
