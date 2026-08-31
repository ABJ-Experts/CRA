-- CRA-M4-06 focused SQL checks.  Every fixture is rolled back so this test
-- cannot alter a developer mirror or an existing tenant.
\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %', p_label;
  else raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'offline imports and CSAF mirror surfaces are RLS protected and browser-inaccessible',
  exists (select 1 from pg_class tables join pg_namespace schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = 'public' and tables.relname = 'vulnerability_offline_bundle_imports'
      and tables.relrowsecurity and not tables.relforcerowsecurity)
  and not has_table_privilege('public', 'public.vulnerability_offline_bundle_imports', 'select')
  and not has_table_privilege('anon', 'public.vulnerability_offline_bundle_imports', 'select')
  and not has_table_privilege('authenticated', 'public.vulnerability_offline_bundle_imports', 'select')
  and has_table_privilege('service_role', 'public.vulnerability_offline_bundle_imports', 'insert')
  and exists (select 1 from public.vulnerability_feed_configs where feed_key = 'vendor_csaf'
    and not enabled and sync_state = 'disabled' and freshness_state = 'disabled')
);

select pg_temp.check(
  'bundle and CSAF functions are service-role-only security definers with pinned paths',
  not exists (
    select 1 from pg_proc procedures join pg_namespace schemas on schemas.oid = procedures.pronamespace
    where schemas.nspname = 'public' and procedures.proname = any (array[
      'preflight_vulnerability_offline_bundle_import', 'confirm_vulnerability_offline_bundle_import',
      'get_vulnerability_offline_bundle_import', 'vulnerability_offline_bundle_import_json',
      'reconcile_vendor_csaf_source_record', 'list_vulnerability_match_csaf_purl_candidates',
      'list_vulnerability_match_csaf_cpe_candidates'
    ]) and (not procedures.prosecdef or procedures.proconfig is null
      or not ('search_path=public, pg_temp' = any(procedures.proconfig))
      or exists (select 1 from information_schema.routine_privileges privileges
        where privileges.routine_schema = 'public' and privileges.routine_name = procedures.proname
          and privileges.grantee in ('public', 'anon', 'authenticated')))
  ) and has_function_privilege('service_role',
    'public.confirm_vulnerability_offline_bundle_import(uuid,uuid,uuid)', 'execute')
);

begin;
do $$
declare
  v_actor uuid;
  v_preflight record;
  v_replay record;
  v_confirmation record;
  v_payloads jsonb := jsonb_build_array(jsonb_build_object(
    'feedKey', 'nvd', 'sourceSnapshotAt', '2099-01-01T00:00:00Z',
    'payloadSha256', repeat('a', 64), 'schemaVersion', '1.0', 'expectedRecordCount', 0
  ));
begin
  select id into v_actor from public.users order by created_at, id limit 1;
  if v_actor is null then raise exception 'seed user missing'; end if;
  select * into v_preflight from public.preflight_vulnerability_offline_bundle_import(
    repeat('b', 64), '1.0.0', repeat('b', 64), 'fixture-key',
    jsonb_build_object('bundleVersion', '1.0.0'),
    jsonb_build_object('signatureStatus', 'verified', 'trustedKeyId', 'fixture-key'),
    v_actor, '00000000-0000-0000-0000-000000004601'::uuid,
    '00000000-0000-0000-0000-000000004602'::uuid, v_payloads, 'm4-06-sql-stage-worker'
  );
  if v_preflight.outcome <> 'preflight_created'
    or jsonb_array_length(v_preflight.import -> 'runs') <> 1
    or (v_preflight.import -> 'runs' -> 0 ->> 'feedKey') <> 'nvd'
    or v_preflight.import ? 'signedManifest' then
    raise exception 'preflight did not produce a safe staged receipt';
  end if;
  select * into v_replay from public.preflight_vulnerability_offline_bundle_import(
    repeat('b', 64), '1.0.0', repeat('b', 64), 'fixture-key',
    jsonb_build_object('bundleVersion', '1.0.0'),
    jsonb_build_object('signatureStatus', 'verified', 'trustedKeyId', 'fixture-key'),
    v_actor, '00000000-0000-0000-0000-000000004603'::uuid,
    '00000000-0000-0000-0000-000000004604'::uuid, v_payloads, 'm4-06-sql-stage-worker'
  );
  if v_replay.outcome <> 'replayed' or v_replay.import ->> 'id' <> v_preflight.import ->> 'id' then
    raise exception 'identical bundle hash was not idempotent';
  end if;
  select * into v_confirmation from public.confirm_vulnerability_offline_bundle_import(
    (v_preflight.import ->> 'id')::uuid, v_actor,
    '00000000-0000-0000-0000-000000004605'::uuid
  );
  if v_confirmation.outcome <> 'incomplete_staging' then
    raise exception 'confirm must return a safe incomplete-staging result';
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  v_vulnerability_id uuid;
  v_public_record_id uuid;
  v_vendor_record_id uuid;
  v_public_run_id uuid := '00000000-0000-0000-0000-000000004611'::uuid;
  v_vendor_run_id uuid := '00000000-0000-0000-0000-000000004612'::uuid;
  v_public_version_id uuid;
  v_vendor_version_id uuid;
  v_detail jsonb;
begin
  insert into public.vulnerability_feed_sync_runs(
    id, feed_key, run_kind, status, correlation_id, completed_at
  ) values
    (v_public_run_id, 'nvd', 'scheduled', 'completed', '00000000-0000-0000-0000-000000004613'::uuid, clock_timestamp()),
    (v_vendor_run_id, 'vendor_csaf', 'scheduled', 'completed', '00000000-0000-0000-0000-000000004614'::uuid, clock_timestamp());
  insert into public.vulnerabilities(canonical_id) values ('CVE-2099-4606') returning id into v_vulnerability_id;
  insert into public.vulnerability_source_records(feed_key, source_record_key, vulnerability_id)
  values ('nvd', 'CVE-2099-4606', v_vulnerability_id)
  returning id into v_public_record_id;
  insert into public.vulnerability_source_records(feed_key, source_record_key, vulnerability_id)
  values ('vendor_csaf', 'vendor.example:ADV-4606:CVE-2099-4606', v_vulnerability_id)
  returning id into v_vendor_record_id;
  insert into public.vulnerability_source_record_versions(
    source_record_id, run_id, record_sha256, record_state, raw_payload, normalized_payload
  ) values (
    v_public_record_id, v_public_run_id, repeat('c', 64), 'active', '{}'::jsonb, '{}'::jsonb
  ) returning id into v_public_version_id;
  insert into public.vulnerability_source_record_versions(
    source_record_id, run_id, record_sha256, record_state, raw_payload, normalized_payload
  ) values (
    v_vendor_record_id, v_vendor_run_id, repeat('d', 64), 'active', '{}'::jsonb,
    jsonb_build_object(
      'csafProvenance', jsonb_build_object('publisherName', 'Vendor', 'trackingId', 'ADV-4606'),
      'enrichments', jsonb_build_array(jsonb_build_object('type', 'csaf', 'value', jsonb_build_object('status', 'fixed')))
    )
  ) returning id into v_vendor_version_id;
  update public.vulnerability_source_records set current_version_id = v_public_version_id where id = v_public_record_id;
  update public.vulnerability_source_records set current_version_id = v_vendor_version_id where id = v_vendor_record_id;
  select public.get_vulnerability_csaf_reconciliation_detail('CVE-2099-4606') into v_detail;
  if v_detail #>> '{sourceAssertions,1,status}' <> 'fixed'
    or not (v_detail -> 'conflicts' ? 'vendor_fixed_public_affected') then
    raise exception 'CSAF fixed assertion did not remain visible beside the active public assertion';
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  v_health jsonb;
begin
  if public.set_vulnerability_feed_configuration('vendor_csaf', true) <> 'enabled' then
    raise exception 'vendor CSAF must be configurable through the mirror RPC';
  end if;

  update public.vulnerability_feed_configs
  set last_success_at = clock_timestamp(),
      last_source_snapshot_at = clock_timestamp() - interval '2 days',
      stale_threshold_seconds = 60
  where feed_key = 'vendor_csaf';

  select public.vulnerability_feed_health_json('vendor_csaf') -> 0 into v_health;
  if v_health ->> 'freshnessState' <> 'stale'
    or coalesce((v_health ->> 'mirrorAgeSeconds')::integer, 0) < 86400 then
    raise exception 'feed health must derive freshness and mirror age from source snapshot time';
  end if;
end;
$$;
rollback;
