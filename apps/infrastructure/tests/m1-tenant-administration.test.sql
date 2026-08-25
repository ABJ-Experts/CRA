-- M1 V1 tenant-administration durable-foundation integration tests.
-- Fixtures live inside transactions and are rolled back unless a test explicitly
-- proves that the non-tenant deletion record survives organization deletion.

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
  'tenant-administration tables exist and use RLS without force',
  (select count(*) = 0
     from (values
       ('tenant_settings_catalog'), ('retention_evidence_classes'),
       ('organization_settings'), ('organization_lifecycles'),
       ('organization_retention_policies'), ('retention_floor_reasons'),
       ('retention_authority_states'), ('retention_authoritative_facts'),
       ('retention_floor_snapshots'), ('evidence_protection_watermarks'),
       ('retention_cleanup_runs'), ('retention_cleanup_items'),
       ('organization_export_sources'), ('organization_export_jobs'),
       ('organization_export_idempotencies'), ('organization_export_snapshots'),
       ('organization_export_parts'), ('organization_session_bindings'),
       ('organization_session_revocations'), ('destructive_reauth_grants'),
       ('organization_purge_jobs'), ('organization_purge_work_items'),
       ('organization_deletion_proofs'), ('organization_deletion_artifact_work'),
       ('organization_export_source_tables'), ('organization_export_snapshot_records'),
       ('organization_export_artifact_snapshots')
     ) expected(table_name)
    left join pg_class c on c.relname = expected.table_name
    left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.oid is null or not c.relrowsecurity or c.relforcerowsecurity)
);

select pg_temp.check(
  'mutation RPCs are service-role-only security definers with pinned search paths',
  (select count(*) = 0
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'initialize_tenant_administration_state',
        'm1_settings_json', 'm1_retention_policy_json',
        'm1_normalize_lifecycle_blockers', 'm1_organization_lifecycle_json',
        'get_organization_settings_catalog', 'get_organization_settings',
        'get_organization_lifecycle',
        'update_organization_settings_atomic',
        'get_organization_retention_policies',
        'update_organization_retention_policy_atomic',
        'reconcile_organization_retention_atomic',
        'claim_retention_cleanup_atomic',
        'complete_retention_cleanup_atomic',
        'fail_retention_cleanup_atomic',
        'request_organization_export_atomic',
        'claim_organization_export_atomic',
        'materialize_organization_export_snapshot_atomic',
        'checkpoint_organization_export_atomic',
        'complete_organization_export_atomic',
        'fail_organization_export_atomic',
        'record_organization_export_artifact_snapshot_atomic',
        'record_organization_export_download_atomic',
        'claim_organization_deletion_artifact_work_atomic',
        'complete_organization_deletion_artifact_work_atomic',
        'fail_organization_deletion_artifact_work_atomic',
        'register_organization_session_atomic',
        'create_destructive_reauth_grant_atomic',
        'consume_destructive_reauth_grant_atomic',
        'deactivate_organization_atomic',
        'schedule_organization_purge_atomic',
        'recover_organization_atomic',
        'claim_organization_purge_atomic',
        'complete_organization_purge_atomic',
        'fail_organization_purge_atomic',
        'accept_invitation_atomic',
        'resend_invitation_atomic',
        'record_organization_onboarding_evidence_atomic',
        'record_invitation_delivery_onboarding_atomic'
      ])
      and (
        not p.prosecdef
        or pg_get_userbyid(p.proowner) <> 'postgres'
        or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public, pg_temp%'
        or has_function_privilege('public', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or (
          p.proname not in (
            'initialize_tenant_administration_state',
            'm1_settings_json', 'm1_retention_policy_json',
            'm1_normalize_lifecycle_blockers', 'm1_organization_lifecycle_json'
          )
          and not has_function_privilege('service_role', p.oid, 'execute')
        )
      ))
);

select pg_temp.check(
  'tenant export storage is private and browser roles cannot mutate objects',
  exists (select 1 from storage.buckets where id = 'tenant-exports' and not public)
  and not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
      and (coalesce(qual, '') like '%tenant-exports%'
        or coalesce(with_check, '') like '%tenant-exports%')
  )
);

select pg_temp.check(
  'export redaction is stable rather than incorrectly immutable',
  (select provolatile = 's'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'm1_export_redact_jsonb'
      and pg_get_function_identity_arguments(p.oid) = 'p_value jsonb')
);

begin;
do $$
declare
  v_owner uuid;
  v_member uuid;
  v_other_owner uuid;
  v_org uuid;
  v_other_org uuid;
  v_session uuid := '21000000-0000-4000-8000-000000000001';
  v_settings record;
  v_stale record;
  v_invalid record;
  v_retention record;
  v_reconcile record;
  v_cleanup record;
  v_fail record;
  v_export record;
  v_replay record;
  v_mismatch record;
  v_claim record;
  v_checkpoint record;
  v_complete record;
  v_download record;
  v_grant record;
  v_deactivate record;
  v_recover record;
  v_schedule record;
  v_lifecycle record;
  v_before_audits integer;
  v_cleanup_run uuid;
  v_cleanup_item uuid;
  v_cleanup_item_two uuid;
  v_kind text;
begin
  insert into public.users (email) values ('tenant-owner@integration.test') returning id into v_owner;
  insert into public.users (email) values ('tenant-member@integration.test') returning id into v_member;
  insert into public.users (email) values ('tenant-other-owner@integration.test') returning id into v_other_owner;
  insert into public.organizations (name, slug) values ('Tenant Admin', 'tenant-admin') returning id into v_org;
  insert into public.organizations (name, slug) values ('Other Tenant', 'other-tenant') returning id into v_other_org;
  insert into public.organization_members (organization_id, user_id, role) values
    (v_org, v_owner, 'owner'), (v_org, v_member, 'member'),
    (v_other_org, v_other_owner, 'owner');

  -- Test/local adapters explicitly report available. New organizations default
  -- unavailable so production cleanup and purge fail closed until reconciled.
  foreach v_kind in array array['product','evidence_class','obligation','legal_hold'] loop
    perform public.reconcile_organization_retention_atomic(
      v_org, v_owner, v_kind, true, '[]'::jsonb
    );
  end loop;

  perform pg_temp.check(
    'new organizations start explicitly unconfigured, active, and with a non-empty unique policy set',
    (select not configured and version = 0 from public.organization_settings where organization_id = v_org)
    and (select status = 'active' and version = 0 from public.organization_lifecycles where organization_id = v_org)
    and (select count(*) > 0 and count(*) = count(distinct evidence_class)
           from public.organization_retention_policies where organization_id = v_org)
  );

  select * into v_lifecycle from public.get_organization_lifecycle(gen_random_uuid());
  perform pg_temp.check(
    'lifecycle read returns not_found for an unknown tenant',
    v_lifecycle.outcome = 'not_found' and v_lifecycle.lifecycle is null
  );

  select * into v_lifecycle from public.get_organization_lifecycle(v_org);
  perform pg_temp.check(
    'lifecycle read returns the strict active lifecycle shape',
    v_lifecycle.outcome = 'found'
    and v_lifecycle.lifecycle ?& array['status', 'version', 'changedAt', 'error', 'blockers']
    and v_lifecycle.lifecycle->'error' = 'null'::jsonb
    and v_lifecycle.lifecycle->'blockers' = '[]'::jsonb
  );

  select * into v_settings from public.update_organization_settings_atomic(
    v_org, v_owner, 0, 'Etc/UTC', array['monday','tuesday'], array['2026-12-25']::date[],
    array['email'], null, 480, 'test_ai', 'local', v_session
  );
  perform pg_temp.check(
    'settings update validates the server catalog, versions, audits, and maps safely to the contract',
    v_settings.outcome = 'updated'
    and v_settings.settings->>'status' = 'configured'
    and (v_settings.settings->>'version')::integer = 1
    and (select configured and version = 1 and timezone = 'Etc/UTC'
           from public.organization_settings where organization_id = v_org)
    and (select count(*) = 1 from public.audit_logs
          where organization_id = v_org and action = 'organization.settings_updated')
  );

  select count(*) into v_before_audits from public.audit_logs where organization_id = v_org;
  select * into v_stale from public.update_organization_settings_atomic(
    v_org, v_owner, 0, 'Etc/UTC', array['monday'], array[]::date[], array['email'],
    null, 240, 'test_ai', 'local', v_session
  );
  select * into v_invalid from public.update_organization_settings_atomic(
    v_org, v_owner, 1, 'Browser/Invented', array['monday'], array[]::date[],
    array['email'], null, 240, 'test_ai', 'local', v_session
  );
  perform pg_temp.check(
    'stale or non-catalog settings reject without partial rows or audits',
    v_stale.outcome = 'conflict' and v_invalid.outcome = 'invalid_catalog'
    and (select version = 1 from public.organization_settings where organization_id = v_org)
    and (select count(*) = v_before_audits from public.audit_logs where organization_id = v_org)
  );

  -- Tightening the maximum session age signals tenant-local revocation only.
  perform public.register_organization_session_atomic(v_org, v_owner, v_session, now() - interval '1 hour');
  select * into v_settings from public.update_organization_settings_atomic(
    v_org, v_owner, 1, 'Etc/UTC', array['monday','tuesday'], array['2026-12-25']::date[],
    array['email'], null, 60, 'test_ai', 'local', v_session
  );
  perform pg_temp.check(
    'session-policy tightening creates tenant-local revocations',
    v_settings.session_policy_tightened
    and exists (select 1 from public.organization_session_revocations
      where organization_id = v_org and session_id = v_session
        and reason = 'settings_policy_tightened')
  );

  select * into v_retention from public.update_organization_retention_policy_atomic(
    v_org, v_owner, 'audit_event', 1, 30
  );
  perform pg_temp.check(
    'retention updates are evidence-class scoped, versioned, and audited',
    v_retention.outcome = 'updated'
    and v_retention.policy->>'evidenceClass' = 'audit_event'
    and (v_retention.policy->>'requestedRetentionDays')::integer = 30
    and (select count(*) = 1 from public.audit_logs where organization_id = v_org
          and action = 'organization.retention_policy_updated')
  );

  select * into v_reconcile from public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'product', true,
    jsonb_build_array(
      jsonb_build_object('evidenceClass', 'audit_event',
        'recordId', '22000000-0000-4000-8000-000000000099',
        'requiredRetentionDays', 10),
      jsonb_build_object('evidenceClass', 'unknown_class',
        'recordId', 'not-a-uuid', 'requiredRetentionDays', 10)
    )
  );
  perform pg_temp.check(
    'rejected retention reconcile leaves no partial authoritative facts',
    v_reconcile.outcome = 'invalid_request'
    and not exists (select 1 from public.retention_authoritative_facts
      where organization_id = v_org
        and source_record_id = '22000000-0000-4000-8000-000000000099')
  );

  select * into v_reconcile from public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'legal_hold', true,
    jsonb_build_array(jsonb_build_object(
      'evidenceClass', 'audit_event', 'recordId', '22000000-0000-4000-8000-000000000001',
      'requiredRetentionDays', 365, 'protectThrough', '2028-01-01T00:00:00Z'
    ))
  );
  perform pg_temp.check(
    'retention reconciliation stores deterministic reasons and only raises protection',
    v_reconcile.outcome = 'reconciled'
    and (select effective_floor_days = 365 and effective_retention_days = 365
           from public.organization_retention_policies
          where organization_id = v_org and evidence_class = 'audit_event')
    and (select count(*) = 1 from public.retention_floor_reasons
          where organization_id = v_org and evidence_class = 'audit_event'
            and reason_kind = 'legal_hold' and required_retention_days = 365)
    and (select protected_through >= '2028-01-01T00:00:00Z'
           from public.evidence_protection_watermarks
          where organization_id = v_org and evidence_class = 'audit_event')
  );

  insert into public.retention_cleanup_runs (organization_id, evidence_class, status, requested_by)
  values (v_org, 'audit_event', 'queued', v_owner);
  select * into v_cleanup from public.claim_retention_cleanup_atomic(v_org, gen_random_uuid(), 60);
  perform pg_temp.check(
    'active legal holds block cleanup at final claim recheck',
    v_cleanup.outcome = 'blocked'
    and (select status = 'blocked' from public.retention_cleanup_runs
          where organization_id = v_org and evidence_class = 'audit_event')
  );

  insert into public.retention_cleanup_runs (
    organization_id, evidence_class, status, requested_by,
    lease_owner, lease_expires_at, attempt_count
  ) values (
    v_org, 'security_event', 'running', v_owner,
    gen_random_uuid(), now() - interval '1 second', 1
  ) returning id into v_cleanup_run;
  insert into public.retention_cleanup_items (
    organization_id, cleanup_run_id, evidence_class, source_record_id,
    observed_at, protection_watermark
  ) values (
    v_org, v_cleanup_run, 'security_event', gen_random_uuid(),
    now() - interval '10 days', '-infinity'
  ) returning id into v_cleanup_item;
  select * into v_cleanup from public.claim_retention_cleanup_atomic(v_org, gen_random_uuid(), 60);
  perform pg_temp.check(
    'expired cleanup leases are reclaimable after worker restart',
    v_cleanup.outcome = 'claimed' and v_cleanup.cleanup_run_id = v_cleanup_run
  );
  select * into v_complete from public.complete_retention_cleanup_atomic(
    v_org, v_cleanup_run, v_cleanup.lease_owner, 0,
    jsonb_build_array(jsonb_build_object('itemId', v_cleanup_item, 'status', 'deleted'))
  );
  perform pg_temp.check(
    'cleanup completion validates and persists each authoritative item result',
    v_complete.outcome = 'completed'
    and (select status = 'deleted' from public.retention_cleanup_items where id = v_cleanup_item)
  );

  insert into public.retention_cleanup_runs (organization_id, evidence_class, status, requested_by)
  values (v_org, 'security_event', 'queued', v_owner) returning id into v_cleanup_run;
  insert into public.retention_cleanup_items (
    organization_id, cleanup_run_id, evidence_class, source_record_id,
    observed_at, protection_watermark
  ) values (
    v_org, v_cleanup_run, 'security_event', gen_random_uuid(),
    now() - interval '10 days', '-infinity'
  ) returning id into v_cleanup_item;
  insert into public.retention_cleanup_items (
    organization_id, cleanup_run_id, evidence_class, source_record_id,
    observed_at, protection_watermark
  ) values (
    v_org, v_cleanup_run, 'security_event', gen_random_uuid(),
    now() - interval '10 days', '-infinity'
  ) returning id into v_cleanup_item_two;
  select * into v_cleanup from public.claim_retention_cleanup_atomic(v_org, gen_random_uuid(), 60);
  select * into v_complete from public.complete_retention_cleanup_atomic(
    v_org, v_cleanup_run, v_cleanup.lease_owner, 0, null
  );
  perform pg_temp.check(
    'cleanup completion rejects NULL item results without changing pending items',
    v_complete.outcome = 'invalid_request'
    and (select status = 'running' from public.retention_cleanup_runs where id = v_cleanup_run)
    and (select count(*) = 2 from public.retention_cleanup_items
          where cleanup_run_id = v_cleanup_run and status = 'pending')
  );
  select * into v_complete from public.complete_retention_cleanup_atomic(
    v_org, v_cleanup_run, v_cleanup.lease_owner, 0,
    jsonb_build_array(
      jsonb_build_object('itemId', v_cleanup_item, 'status', 'deleted'),
      jsonb_build_object('itemId', v_cleanup_item, 'status', 'deleted')
    )
  );
  perform pg_temp.check(
    'cleanup completion rejects duplicate item identifiers and requires the exact pending set',
    v_complete.outcome = 'invalid_request'
    and (select count(*) = 2 from public.retention_cleanup_items
          where cleanup_run_id = v_cleanup_run and status = 'pending')
  );
  select * into v_complete from public.complete_retention_cleanup_atomic(
    v_org, v_cleanup_run, v_cleanup.lease_owner, 0,
    jsonb_build_array(
      jsonb_build_object('itemId', v_cleanup_item, 'status', 'deleted'),
      jsonb_build_object('itemId', v_cleanup_item_two, 'status', 'deleted')
    )
  );
  perform pg_temp.check(
    'cleanup completion persists the exact pending set and leaves no pending item',
    v_complete.outcome = 'completed'
    and not exists (select 1 from public.retention_cleanup_items
      where cleanup_run_id = v_cleanup_run and status = 'pending')
  );

  insert into public.retention_cleanup_runs (organization_id, evidence_class, status, requested_by)
  values (v_org, 'export_artifact', 'queued', v_owner) returning id into v_cleanup_run;
  insert into public.retention_cleanup_items (
    organization_id, cleanup_run_id, evidence_class, source_record_id,
    observed_at, protection_watermark
  ) values (
    v_org, v_cleanup_run, 'export_artifact', gen_random_uuid(),
    now() - interval '10 days', '-infinity'
  ) returning id into v_cleanup_item;
  select * into v_cleanup from public.claim_retention_cleanup_atomic(v_org, gen_random_uuid(), 60);
  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'obligation', true,
    jsonb_build_array(jsonb_build_object(
      'evidenceClass', 'export_artifact',
      'recordId', '22000000-0000-4000-8000-000000000002',
      'requiredRetentionDays', 0, 'protectThrough', '2029-01-01T00:00:00Z'
    ))
  );
  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'legal_hold', true,
    jsonb_build_array(jsonb_build_object(
      'evidenceClass', 'export_artifact',
      'recordId', '22000000-0000-4000-8000-000000000003',
      'requiredRetentionDays', 90, 'protectThrough', '2029-01-01T00:00:00Z'
    ))
  );
  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'product', false, '[]'::jsonb
  );
  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'product', false, '[]'::jsonb
  );
  select * into v_complete from public.complete_retention_cleanup_atomic(
    v_org, v_cleanup_run, v_cleanup.lease_owner, 0,
    jsonb_build_array(jsonb_build_object('itemId', v_cleanup_item, 'status', 'deleted'))
  );
  perform pg_temp.check(
    'cleanup final recheck persists all block reasons, audit, and the protected item',
    v_complete.outcome = 'blocked'
    and (select status = 'pending' from public.retention_cleanup_items where id = v_cleanup_item)
    and (select status = 'blocked' and jsonb_array_length(blocked_reasons) = 3
           from public.retention_cleanup_runs where id = v_cleanup_run)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and action = 'organization.retention_cleanup_blocked'
        and entity_id = v_cleanup_run::text
        and changes->>'phase' = 'final_completion_recheck')
  );

  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'product', true, '[]'::jsonb
  );

  insert into public.retention_cleanup_runs (organization_id, evidence_class, status, requested_by)
  values (v_org, 'security_event', 'queued', v_owner) returning id into v_cleanup_run;
  select * into v_cleanup from public.claim_retention_cleanup_atomic(v_org, gen_random_uuid(), 60);
  update public.retention_cleanup_runs set lease_expires_at = now() - interval '1 second'
    where id = v_cleanup_run;
  select * into v_fail from public.fail_retention_cleanup_atomic(
    v_org, v_cleanup_run, v_cleanup.lease_owner, 0,
    'worker_error', true, '{}'::jsonb
  );
  perform pg_temp.check(
    'expired cleanup lease holders cannot fail current work',
    v_fail.outcome = 'conflict'
  );

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000001', repeat('a', 64), 'corr-1'
  );
  select * into v_replay from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000001', repeat('a', 64), 'corr-1'
  );
  select * into v_mismatch from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000001', repeat('b', 64), 'corr-2'
  );
  perform pg_temp.check(
    'export idempotency replays same actor/org/payload and mismatches expose no job id',
    v_export.outcome = 'created' and v_replay.outcome = 'replayed'
    and v_replay.export_job_id = v_export.export_job_id
    and v_mismatch.outcome = 'idempotency_mismatch' and v_mismatch.export_job_id is null
  );

  select * into v_claim from public.claim_organization_export_atomic(v_org, gen_random_uuid(), 60);
  perform pg_temp.check('export jobs claim under a durable lease', v_claim.outcome = 'claimed');
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 1, 1, '[]'::jsonb
  );
  perform pg_temp.check(
    'export checkpoint rejects progress without a persisted part ledger',
    v_checkpoint.outcome = 'invalid_request'
    and (select checkpoint_version = 0 and completed_parts = 0
           from public.organization_export_jobs where id = v_claim.export_job_id)
  );
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 2, 2,
    jsonb_build_array(
      jsonb_build_object('sourceId', 'audit_logs', 'partNumber', 1,
        'objectPath', v_org::text || '/duplicate.ndjson', 'sha256', repeat('c', 64), 'byteSize', 12),
      jsonb_build_object('sourceId', 'audit_logs', 'partNumber', 1,
        'objectPath', v_org::text || '/duplicate.ndjson', 'sha256', repeat('c', 64), 'byteSize', 12)
    )
  );
  perform pg_temp.check(
    'export checkpoint rejects duplicate part identities without partial ledger rows',
    v_checkpoint.outcome = 'invalid_request'
    and not exists (select 1 from public.organization_export_parts
      where export_job_id = v_claim.export_job_id)
  );
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 1, 1,
    jsonb_build_array(jsonb_build_object(
      'sourceId', 'audit_logs', 'partNumber', 1, 'objectPath', v_org::text || '/part-1.ndjson',
      'sha256', repeat('c', 64), 'byteSize', 12
    ))
  );
  perform pg_temp.check(
    'export checkpoint persists resumable parts and increments checkpoint version',
    v_checkpoint.outcome = 'checkpointed' and v_checkpoint.checkpoint_version = 1
  );
  select * into v_complete from public.complete_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 1,
    1, repeat('d', 64), repeat('x', 64)
  );
  perform pg_temp.check(
    'invalid artifact hash fails closed without a downloadable completed export',
    v_complete.outcome = 'verification_failed'
    and (select status = 'failed' and safe_error_code = 'verification_failed'
           from public.organization_export_jobs where id = v_claim.export_job_id)
  );

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000006', repeat('9', 64), 'corr-null-path'
  );
  select * into v_claim from public.claim_organization_export_atomic(v_org, gen_random_uuid(), 60);
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 1, 1,
    jsonb_build_array(jsonb_build_object(
      'sourceId', 'audit_logs', 'partNumber', 1,
      'objectPath', v_org::text || '/part-null-path.ndjson',
      'sha256', repeat('a', 64), 'byteSize', 14
    ))
  );
  select * into v_complete from public.complete_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 1,
    1, repeat('b', 64), repeat('c', 64)
  );
  select * into v_download from public.record_organization_export_download_atomic(
    v_org, v_claim.export_job_id, v_owner
  );
  perform pg_temp.check(
    'null artifact paths fail closed and cannot create verified exports',
    v_complete.outcome = 'verification_failed'
    and v_download.outcome = 'not_found'
    and (select status = 'failed' and artifact_object_path is null and verified_at is null
           from public.organization_export_jobs where id = v_claim.export_job_id)
  );

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000002', repeat('f', 64), 'corr-3'
  );
  select * into v_claim from public.claim_organization_export_atomic(v_org, gen_random_uuid(), 60);
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 1, 1,
    jsonb_build_array(jsonb_build_object(
      'sourceId', 'audit_logs', 'partNumber', 1,
      'objectPath', v_org::text || '/part-valid.ndjson',
      'sha256', repeat('a', 64), 'byteSize', 14
    ))
  );
  select * into v_complete from public.complete_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 1,
    1, repeat('b', 64), repeat('c', 64),
    v_org::text || '/' || v_claim.export_job_id::text || '/alternate.zip'
  );
  select * into v_download from public.record_organization_export_download_atomic(
    v_org, v_claim.export_job_id, v_owner
  );
  perform pg_temp.check(
    'same-tenant export-like artifact paths fail closed and cannot download',
    v_complete.outcome = 'verification_failed'
    and v_download.outcome = 'not_found'
    and (select status = 'failed' and artifact_object_path is null and verified_at is null
           from public.organization_export_jobs where id = v_claim.export_job_id)
  );

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000005', repeat('e', 64), 'corr-3a'
  );
  select * into v_claim from public.claim_organization_export_atomic(v_org, gen_random_uuid(), 60);
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 1, 1,
    jsonb_build_array(jsonb_build_object(
      'sourceId', 'audit_logs', 'partNumber', 1,
      'objectPath', v_org::text || '/part-canonical.ndjson',
      'sha256', repeat('a', 64), 'byteSize', 14
    ))
  );
  select * into v_complete from public.complete_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 1,
    1, repeat('b', 64), repeat('c', 64),
    v_org::text || '/' || v_claim.export_job_id::text || '/organization-export-v1.zip'
  );
  select * into v_download from public.record_organization_export_download_atomic(
    v_org, v_claim.export_job_id, v_owner
  );
  perform pg_temp.check(
    'only the canonical export archive path completes and authorizes download',
    v_complete.outcome = 'completed'
    and v_download.outcome = 'found'
    and (select manifest_sha256 <> artifact_sha256 and verified_at is not null
         and artifact_object_path = v_org::text || '/' || v_claim.export_job_id::text
             || '/organization-export-v1.zip'
           from public.organization_export_jobs where id = v_claim.export_job_id)
  );

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000003', repeat('1', 64), 'corr-4'
  );
  select * into v_claim from public.claim_organization_export_atomic(v_org, gen_random_uuid(), 60);
  update public.organization_export_jobs set lease_expires_at = now() - interval '1 second'
    where id = v_claim.export_job_id;
  select * into v_fail from public.fail_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0,
    'worker_error', true, false, '{}'::jsonb
  );
  perform pg_temp.check(
    'expired export lease holders cannot fail current work',
    v_fail.outcome = 'conflict'
  );

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '23000000-0000-4000-8000-000000000004', repeat('2', 64), 'corr-5'
  );
  select * into v_claim from public.claim_organization_export_atomic(v_org, gen_random_uuid(), 60);
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0, 0, 0, '[]'::jsonb
  );
  perform pg_temp.check(
    'export checkpoint rejects an empty zero-progress ledger',
    v_checkpoint.outcome = 'invalid_request'
  );
  select * into v_complete from public.complete_organization_export_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, 0,
    0, repeat('3', 64), repeat('4', 64), v_org::text || '/empty.zip'
  );
  perform pg_temp.check(
    'export completion can never complete with zero persisted parts',
    v_complete.outcome = 'verification_failed'
    and (select status = 'failed' from public.organization_export_jobs
          where id = v_claim.export_job_id)
  );
  -- Cross-tenant job identifiers are generic misses.
  select * into v_checkpoint from public.checkpoint_organization_export_atomic(
    v_other_org, v_claim.export_job_id, v_claim.lease_owner, 1, 1, 1, '[]'::jsonb
  );
  perform pg_temp.check('export worker operations are tenant isolated', v_checkpoint.outcome = 'not_found');

  perform public.register_organization_session_atomic(v_org, v_member,
    '21000000-0000-4000-8000-000000000002', now());
  select * into v_grant from public.create_destructive_reauth_grant_atomic(
    v_org, v_owner, v_session, 0, now() + interval '5 minutes'
  );
  select * into v_deactivate from public.deactivate_organization_atomic(
    v_org, v_owner, v_session, v_grant.grant_id, 0, 'DEACTIVATE ORGANIZATION'
  );
  perform pg_temp.check(
    'deactivation synchronizes compatibility state, pauses exports, revokes tenant sessions, and audits',
    v_deactivate.outcome = 'deactivated'
    and (select status = 'deactivated' and version = 1 from public.organization_lifecycles where organization_id = v_org)
    and (select not is_active from public.organizations where id = v_org)
    and (select count(*) = 2 from public.organization_session_revocations where organization_id = v_org
          and reason = 'organization_deactivated')
    and exists (select 1 from public.audit_logs where organization_id = v_org
          and action = 'organization.deactivated')
    and v_deactivate.lifecycle ?& array['status', 'version', 'changedAt', 'error', 'blockers']
    and v_deactivate.lifecycle->'error' = 'null'::jsonb
    and v_deactivate.lifecycle->'blockers' = '[]'::jsonb
  );

  -- One-use grant cannot be replayed and stale versions do not mutate state.
  select * into v_stale from public.deactivate_organization_atomic(
    v_org, v_owner, v_session, v_grant.grant_id, 0, 'DEACTIVATE ORGANIZATION'
  );
  perform pg_temp.check('destructive grants are one-use and stale transitions reject', v_stale.outcome = 'invalid_grant');

  select * into v_grant from public.create_destructive_reauth_grant_atomic(
    v_org, v_owner, v_session, 1, now() + interval '5 minutes'
  );
  select * into v_recover from public.recover_organization_atomic(
    v_org, v_owner, v_session, v_grant.grant_id, 1
  );
  perform pg_temp.check(
    'recovery before purging returns the lifecycle to active',
    v_recover.outcome = 'recovered'
    and (select status = 'active' and version = 2 from public.organization_lifecycles where organization_id = v_org)
    and (select is_active from public.organizations where id = v_org)
    and v_recover.lifecycle ?& array['status', 'version', 'changedAt', 'error', 'blockers']
    and v_recover.lifecycle->'error' = 'null'::jsonb
    and v_recover.lifecycle->'blockers' = '[]'::jsonb
  );

  select * into v_grant from public.create_destructive_reauth_grant_atomic(
    v_org, v_owner, v_session, 2, now() + interval '5 minutes'
  );
  select * into v_deactivate from public.deactivate_organization_atomic(
    v_org, v_owner, v_session, v_grant.grant_id, 2, 'DEACTIVATE ORGANIZATION'
  );
  select * into v_grant from public.create_destructive_reauth_grant_atomic(
    v_org, v_owner, v_session, 3, now() + interval '5 minutes'
  );
  select * into v_schedule from public.schedule_organization_purge_atomic(
    v_org, v_owner, v_session, v_grant.grant_id, 3, 'DELETE tenant-admin'
  );
  perform pg_temp.check(
    'purge scheduling compares the exact canonical slug and uses server grace',
    v_schedule.outcome = 'scheduled'
    and (select status = 'purge_scheduled' and purge_after >= now() + interval '29 days'
           from public.organization_lifecycles where organization_id = v_org)
    and v_schedule.lifecycle ?& array['status', 'version', 'changedAt', 'error', 'blockers']
    and v_schedule.lifecycle->'error' = 'null'::jsonb
    and v_schedule.lifecycle->'blockers' = '[]'::jsonb
  );
end
$$;
rollback;

-- A hold can arrive after claim. Completion must persist every controlling
-- reason and move the lifecycle/job to purge_blocked instead of merely returning.
begin;
do $$
declare
  v_owner uuid;
  v_org uuid;
  v_session uuid := '24000000-0000-4000-8000-000000000010';
  v_grant record;
  v_job record;
  v_result record;
  v_lifecycle record;
  v_kind text;
begin
  insert into public.users (email) values ('purge-block-owner@integration.test') returning id into v_owner;
  insert into public.organizations (name, slug) values ('Purge Block Tenant', 'purge-block-tenant') returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_owner, 'owner');
  foreach v_kind in array array['product','evidence_class','obligation','legal_hold'] loop
    perform public.reconcile_organization_retention_atomic(v_org, v_owner, v_kind, true, '[]'::jsonb);
  end loop;
  perform public.register_organization_session_atomic(v_org, v_owner, v_session, now());
  select * into v_grant from public.create_destructive_reauth_grant_atomic(v_org, v_owner, v_session, 0, now() + interval '5 minutes');
  perform public.deactivate_organization_atomic(v_org, v_owner, v_session, v_grant.grant_id, 0, 'DEACTIVATE ORGANIZATION');
  select * into v_grant from public.create_destructive_reauth_grant_atomic(v_org, v_owner, v_session, 1, now() + interval '5 minutes');
  perform public.schedule_organization_purge_atomic(v_org, v_owner, v_session, v_grant.grant_id, 1, 'DELETE purge-block-tenant');
  update public.organization_lifecycles set purge_after = now() - interval '1 second' where organization_id = v_org;
  update public.organization_purge_jobs set purge_after = now() - interval '1 second',
    available_at = now() - interval '1 second' where organization_id = v_org;
  select * into v_job from public.claim_organization_purge_atomic(v_org, gen_random_uuid(), 60);
  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'legal_hold', true,
    jsonb_build_array(jsonb_build_object(
      'evidenceClass', 'audit_event',
      'recordId', '24000000-0000-4000-8000-000000000011',
      'requiredRetentionDays', 365, 'protectThrough', '2029-01-01T00:00:00Z'
    ))
  );
  perform public.reconcile_organization_retention_atomic(
    v_org, v_owner, 'product', false, '[]'::jsonb
  );
  select * into v_result from public.complete_organization_purge_atomic(
    v_org, v_job.purge_job_id, v_job.lease_owner, 0
  );
  select * into v_lifecycle from public.get_organization_lifecycle(v_org);
  perform pg_temp.check(
    'final purge recheck persists purge_blocked with every controlling reason and audit',
    v_result.outcome = 'blocked'
    and (select status = 'purge_blocked' and jsonb_array_length(purge_block_reasons) > 0
           from public.organization_lifecycles where organization_id = v_org)
    and (select status = 'blocked' and jsonb_array_length(blocked_reasons) > 0
           from public.organization_purge_jobs where organization_id = v_org)
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and action = 'organization.purge_blocked'
      and changes->>'phase' = 'final_completion_recheck')
    and v_lifecycle.outcome = 'found'
    and v_lifecycle.lifecycle->>'status' = 'purge_blocked'
    and exists (
      select 1 from jsonb_array_elements(v_lifecycle.lifecycle->'blockers') blocker
      where blocker->>'kind' = 'legal_hold'
        and blocker->>'recordId' = '24000000-0000-4000-8000-000000000011'
        and (blocker->>'requiredRetentionDays')::integer = 365
    )
    and exists (
      select 1 from jsonb_array_elements(v_lifecycle.lifecycle->'blockers') blocker
      where blocker = jsonb_build_object('kind', 'unavailable', 'code', 'dependency_unavailable')
    )
  );
end
$$;
rollback;

-- Deletion-proof survival needs an organization that is actually deleted. The
-- whole block is still rolled back after proving the proof/work rows outlive it.
begin;
do $$
declare
  v_owner uuid;
  v_org uuid;
  v_session uuid := '24000000-0000-4000-8000-000000000001';
  v_grant record;
  v_result record;
  v_job record;
  v_fail record;
  v_artifact_work record;
  v_artifact_failure record;
  v_first_artifact_completion record;
  v_second_artifact_work record;
  v_artifact_lease_one uuid := '24000000-0000-4000-8000-000000000020';
  v_artifact_lease_two uuid := '24000000-0000-4000-8000-000000000021';
  v_artifact_lease_three uuid := '24000000-0000-4000-8000-000000000022';
  v_proof uuid;
  v_kind text;
begin
  insert into public.users (email) values ('purge-owner@integration.test') returning id into v_owner;
  insert into public.organizations (name, slug) values ('Purge Tenant', 'purge-tenant') returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_owner, 'owner');
  foreach v_kind in array array['product','evidence_class','obligation','legal_hold'] loop
    perform public.reconcile_organization_retention_atomic(v_org, v_owner, v_kind, true, '[]'::jsonb);
  end loop;
  perform public.register_organization_session_atomic(v_org, v_owner, v_session, now());
  select * into v_grant from public.create_destructive_reauth_grant_atomic(v_org, v_owner, v_session, 0, now() + interval '5 minutes');
  perform public.deactivate_organization_atomic(v_org, v_owner, v_session, v_grant.grant_id, 0, 'DEACTIVATE ORGANIZATION');
  select * into v_grant from public.create_destructive_reauth_grant_atomic(v_org, v_owner, v_session, 1, now() + interval '5 minutes');
  perform public.schedule_organization_purge_atomic(v_org, v_owner, v_session, v_grant.grant_id, 1, 'DELETE purge-tenant');
  update public.organization_lifecycles set purge_after = now() - interval '1 second' where organization_id = v_org;
  update public.organization_purge_jobs set purge_after = now() - interval '1 second',
    available_at = now() - interval '1 second' where organization_id = v_org;
  select * into v_job from public.claim_organization_purge_atomic(v_org, gen_random_uuid(), 60);
  perform pg_temp.check('purge claim rechecks authoritative retention and leases eligible work', v_job.outcome = 'claimed');
  update public.organization_purge_jobs set lease_expires_at = now() - interval '1 second'
    where id = v_job.purge_job_id;
  select * into v_fail from public.fail_organization_purge_atomic(
    v_org, v_job.purge_job_id, v_job.lease_owner, 0,
    'worker_error', true, '{}'::jsonb
  );
  perform pg_temp.check(
    'expired purge lease holders cannot fail current work',
    v_fail.outcome = 'conflict'
  );
  update public.organization_purge_jobs set lease_expires_at = now() + interval '1 minute'
    where id = v_job.purge_job_id;
  select * into v_result from public.complete_organization_purge_atomic(v_org, v_job.purge_job_id, v_job.lease_owner, 0);
  v_proof := v_result.deletion_proof_id;
  perform pg_temp.check(
    'purge writes minimal proof and artifact work before deleting tenant rows',
    v_result.outcome = 'purged'
    and not exists (select 1 from public.organizations where id = v_org)
    and exists (select 1 from public.organization_deletion_proofs where id = v_proof and deleted_organization_id = v_org)
    and exists (select 1 from public.organization_deletion_artifact_work where deletion_proof_id = v_proof)
  );
  select * into v_artifact_work from public.claim_organization_deletion_artifact_work_atomic(
    v_artifact_lease_one, 60
  );
  select * into v_artifact_failure from public.fail_organization_deletion_artifact_work_atomic(
    v_artifact_work.work_id, v_artifact_lease_one, 'provider_unavailable', true
  );
  update public.organization_deletion_artifact_work
     set available_at = now() - interval '1 second'
   where id = v_artifact_work.work_id;
  select * into v_artifact_work from public.claim_organization_deletion_artifact_work_atomic(
    v_artifact_lease_two, 60
  );
  select * into v_first_artifact_completion from public.complete_organization_deletion_artifact_work_atomic(
    v_artifact_work.work_id, v_artifact_lease_two
  );
  perform pg_temp.check(
    'deletion proof waits for every private artifact prefix before completing',
    v_first_artifact_completion.outcome = 'completed'
    and (select artifact_deletion_completed_at is null
           from public.organization_deletion_proofs where id = v_proof)
    and (select count(*) = 1
           from public.organization_deletion_artifact_work
          where deletion_proof_id = v_proof and status <> 'completed')
  );
  select * into v_second_artifact_work from public.claim_organization_deletion_artifact_work_atomic(
    v_artifact_lease_three, 60
  );
  select * into v_result from public.complete_organization_deletion_artifact_work_atomic(
    v_second_artifact_work.work_id, v_artifact_lease_three
  );
  perform pg_temp.check(
    'post-database artifact work retries durably and completes every private prefix without restoring access',
    v_artifact_failure.outcome = 'recorded'
    and v_artifact_failure.status = 'retry'
    and v_result.outcome = 'completed'
    and (select artifact_deletion_completed_at is not null
           from public.organization_deletion_proofs where id = v_proof)
    and (select count(*) = 2
           from public.organization_deletion_artifact_work
          where deletion_proof_id = v_proof)
    and not exists (
      select 1
        from public.organization_deletion_artifact_work
       where deletion_proof_id = v_proof and status <> 'completed'
    )
    and (select array_agg(bucket_id order by bucket_id)
           from public.organization_deletion_artifact_work
          where deletion_proof_id = v_proof)
        = array['organization-branding', 'tenant-exports']::text[]
    and not exists (select 1 from public.organizations where id = v_org)
  );
end
$$;
rollback;

-- Export records are materialized in one lease-checked database statement.
-- Later writes must never affect unprocessed/retried NDJSON source parts.
begin;
do $$
declare
  v_owner uuid;
  v_org uuid;
  v_invitation uuid;
  v_export record;
  v_claim record;
  v_materialized record;
  v_replayed record;
  v_conflict record;
  v_artifact record;
  v_unmapped_export record;
  v_unmapped_claim record;
  v_unmapped_materialized record;
begin
  insert into public.users (email) values ('snapshot-owner@integration.test')
    returning id into v_owner;
  insert into public.organizations (name, slug)
    values ('Snapshot Tenant', 'snapshot-tenant') returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role)
    values (v_org, v_owner, 'owner');
  insert into public.invitations (
    organization_id, invited_by, email, role, token_hash, expires_at
  ) values (
    v_org, v_owner, 'before-snapshot@integration.test', 'member',
    repeat('f', 64), now() + interval '1 day'
  ) returning id into v_invitation;

  select * into v_export from public.request_organization_export_atomic(
    v_org, v_owner, '26000000-0000-4000-8000-000000000001',
    repeat('a', 64), 'snapshot-correlation'
  );
  select * into v_claim from public.claim_organization_export_atomic(
    v_org, '26000000-0000-4000-8000-000000000002', 60
  );
  select * into v_materialized from public.materialize_organization_export_snapshot_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, v_claim.checkpoint_version
  );
  update public.invitations set email = 'after-snapshot@integration.test'
    where id = v_invitation;
  select * into v_replayed from public.materialize_organization_export_snapshot_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, v_claim.checkpoint_version
  );
  select * into v_conflict from public.materialize_organization_export_snapshot_atomic(
    v_org, v_claim.export_job_id, gen_random_uuid(), v_claim.checkpoint_version
  );
  select * into v_artifact from public.record_organization_export_artifact_snapshot_atomic(
    v_org, v_claim.export_job_id, v_claim.lease_owner, v_claim.checkpoint_version,
    'reports/initial.pdf', v_org::text || '/' || v_claim.export_job_id::text || '/artifacts/reports/initial.pdf',
    repeat('b', 64), 42, 'application/pdf',
    jsonb_build_object('provider_key', 'never-export', 'label', 'initial')
  );
  perform pg_temp.check(
    'export materialization freezes redacted records, is replay-safe, and binds immutable artifact metadata',
    v_materialized.outcome = 'materialized'
    and v_replayed.outcome = 'replayed'
    and v_conflict.outcome = 'conflict'
    and v_artifact.outcome = 'recorded'
    and (select materialized_at is not null and materialized_checkpoint_version = v_claim.checkpoint_version
           from public.organization_export_snapshots
          where organization_id = v_org and export_job_id = v_claim.export_job_id)
    and exists (
      select 1 from public.organization_export_snapshot_records records
       where records.organization_id = v_org and records.export_job_id = v_claim.export_job_id
         and records.source_id = 'invitations'
         and records.record_payload->>'email' = 'before-snapshot@integration.test'
         and not (records.record_payload ? 'token_hash')
    )
    and (select metadata = jsonb_build_object('label', 'initial')
           from public.organization_export_artifact_snapshots
          where organization_id = v_org and export_job_id = v_claim.export_job_id
            and artifact_key = 'reports/initial.pdf')
  );

  insert into public.organization_export_sources (source_id, enabled, sort_order)
    values ('unmapped_snapshot_test', true, 99);
  select * into v_unmapped_export from public.request_organization_export_atomic(
    v_org, v_owner, '26000000-0000-4000-8000-000000000003',
    repeat('c', 64), 'unmapped-snapshot-correlation'
  );
  select * into v_unmapped_claim from public.claim_organization_export_atomic(
    v_org, '26000000-0000-4000-8000-000000000004', 60
  );
  select * into v_unmapped_materialized from public.materialize_organization_export_snapshot_atomic(
    v_org, v_unmapped_claim.export_job_id, v_unmapped_claim.lease_owner,
    v_unmapped_claim.checkpoint_version
  );
  perform pg_temp.check(
    'export materialization rejects a snapshot source without a physical mapping',
    v_unmapped_materialized.outcome = 'invalid_request'
    and not exists (select 1 from public.organization_export_snapshot_records
      where export_job_id = v_unmapped_claim.export_job_id)
  );
end
$$;
rollback;

select pg_temp.check(
  'the durable export catalogue includes every registered database source',
  (select array_agg(source_id order by sort_order, source_id)
     from public.organization_export_sources
    where enabled) = array[
      'organization_profile', 'memberships', 'audit_logs', 'invitations',
      'organization_settings', 'organization_lifecycles',
      'organization_retention_policies', 'retention_authority_states',
      'retention_authoritative_facts', 'retention_floor_snapshots',
      'retention_floor_reasons', 'evidence_protection_watermarks',
      'retention_cleanup_runs', 'retention_cleanup_items', 'custom_roles',
      'base_role_permission_overrides', 'menu_permissions',
      'user_role_assignments', 'user_table_preferences',
      'organization_onboarding', 'organization_onboarding_stages',
      'organization_onboarding_evidence', 'organization_export_jobs',
      'organization_export_parts', 'organization_export_snapshots',
      'organization_purge_jobs', 'organization_purge_work_items',
      'organization_permissions_version', 'legal_entities',
      'organization_branding', 'product_registry', 'finding_propagation',
      'connector_sync', 'sbom_normalized_graph',
      'sbom_composite_supplier_provenance'
    ]::text[]
);

select pg_temp.check(
  'every enabled export source has a physical source mapping',
  not exists (
    select 1 from public.organization_export_sources sources
     where sources.enabled
       and not exists (
         select 1 from public.organization_export_source_tables mappings
          where mappings.source_id = sources.source_id
       )
  )
);

-- These atomic paths can be called by a background delivery/evidence owner or
-- public invitation acceptance without the authenticated HTTP tenant guard.
-- Every non-active lifecycle must therefore be an indistinguishable miss and
-- must not write memberships, evidence, deliveries, or a rotated token.
begin;
do $$
declare
  v_owner uuid;
  v_invitee uuid;
  v_org uuid;
  v_invitation uuid;
  v_status text;
  v_accept record;
  v_resend record;
  v_evidence record;
  v_delivery record;
  v_original_hash text := repeat('a', 64);
begin
  insert into public.users (email) values ('inactive-path-owner@integration.test')
    returning id into v_owner;
  insert into public.users (email) values ('inactive-path-invitee@integration.test')
    returning id into v_invitee;
  insert into public.organizations (name, slug)
    values ('Inactive Path Tenant', 'inactive-path-tenant')
    returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role)
    values (v_org, v_owner, 'owner');
  insert into public.invitations (
    organization_id, invited_by, email, role, token_hash, expires_at
  ) values (
    v_org, v_owner, 'inactive-path-invitee@integration.test', 'member',
    v_original_hash, now() + interval '1 day'
  ) returning id into v_invitation;

  foreach v_status in array array['deactivated', 'purge_scheduled', 'purge_blocked'] loop
    update public.organization_lifecycles
       set status = v_status,
           purge_after = case when v_status = 'purge_scheduled' then now() + interval '1 day' else null end
     where organization_id = v_org;

    select * into v_accept from public.accept_invitation_atomic(
      v_original_hash, v_invitee, 'inactive-path-invitee@integration.test'
    );
    select * into v_resend from public.resend_invitation_atomic(
      v_org, v_invitation, v_owner, 'inactive-path-owner@integration.test',
      repeat('b', 64), now() + interval '2 days'
    );
    select * into v_evidence from public.record_organization_onboarding_evidence_atomic(
      v_org, 'first_product', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_owner, true
    );
    select * into v_delivery from public.record_invitation_delivery_onboarding_atomic(
      v_org, v_invitation, v_owner
    );
    perform pg_temp.check(
      'inactive lifecycle ' || v_status || ' rejects invitation and onboarding atomic paths generically',
      v_accept.outcome = 'not_found'
      and v_accept.invitation_id is null
      and v_accept.organization_id is null
      and v_resend.outcome = 'not_found'
      and v_resend.invitation_id is null
      and v_evidence.outcome = 'not_found'
      and v_delivery.outcome = 'not_found'
      and not exists (
        select 1 from public.organization_members
         where organization_id = v_org and user_id = v_invitee
      )
      and (select token_hash = v_original_hash and delivery_confirmed_at is null
             from public.invitations where id = v_invitation)
      and not exists (
        select 1 from public.organization_onboarding_evidence
         where organization_id = v_org and resource_id = v_invitation
      )
    );
  end loop;
end
$$;
rollback;

select 'M1 tenant-administration integration: ALL CHECKS PASSED' as result;
