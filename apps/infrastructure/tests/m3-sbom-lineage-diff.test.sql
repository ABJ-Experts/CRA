begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

select pg_temp.check(
  'lineage aliases and diff projections are tenant scoped and browser private',
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='sbom_sources' and column_name='deduplicated_from_source_id')
  and (select relrowsecurity from pg_class where oid='public.sbom_diff_reports'::regclass)
  and (select relrowsecurity from pg_class where oid='public.sbom_diff_component_changes'::regclass)
  and not has_table_privilege('authenticated','public.sbom_diff_reports','select')
  and not has_table_privilege('authenticated','public.sbom_diff_component_changes','select')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='sbom_sources_one_chain_successor_idx')
  and exists(
    select 1
    from pg_index
    where indexrelid = 'public.sbom_sources_one_chain_successor_idx'::regclass
      and pg_get_expr(indpred, indrelid) like '%status = ''verified''%'
  )
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='sbom_component_identities_package_lookup_idx')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='sbom_diff_changes_cursor_idx')
);

select pg_temp.check(
  'diff RPCs are service role only and pin their search path',
  has_function_privilege('service_role','public.enqueue_sbom_diff_report_atomic(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.enqueue_sbom_diff_report_atomic(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.claim_sbom_diff_report(uuid,text,integer)','execute')
  and has_function_privilege('service_role','public.list_due_sbom_diff_organizations(integer)','execute')
  and has_function_privilege('service_role','public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text)','execute')
  and has_function_privilege('service_role','public.persist_sbom_diff_batch_atomic(uuid,uuid,text,jsonb,jsonb,boolean)','execute')
  and has_function_privilege('service_role','public.retry_sbom_diff_report_atomic(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.finalize_sbom_source_deduplicated_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.finalize_sbom_source_deduplicated_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.get_sbom_source_diff_report(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.get_sbom_diff_findings(uuid,uuid,uuid,integer,text)','execute')
  and (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid='public.claim_sbom_diff_report(uuid,text,integer)'::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid='public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text)'::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid='public.finalize_sbom_source_deduplicated_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid,uuid)'::regprocedure)
  and position('identities.canonical_value' in pg_get_functiondef('public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text)'::regprocedure)) > 0
  and position('collate "C"' in pg_get_functiondef('public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text)'::regprocedure)) > 0
  and position('sbom_purl_package_identity(components.canonical_purl)' in pg_get_functiondef('public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text)'::regprocedure)) = 0
);

select pg_temp.check(
  'versionless package identities retain qualifiers and subpaths',
  public.sbom_purl_package_identity('pkg:npm/%40scope/name@1.2.3?repository_url=x#src')
    = 'pkg:npm/%40scope/name?repository_url=x#src'
  and public.sbom_purl_package_identity('pkg:maven/group/name@1.0') = 'pkg:maven/group/name'
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_canonical_source uuid := gen_random_uuid();
  v_alias_source uuid := gen_random_uuid();
  v_alias_pending_source uuid := gen_random_uuid();
  v_next_source uuid := gen_random_uuid();
  v_canonical_key uuid := gen_random_uuid();
  v_alias_key uuid := gen_random_uuid();
  v_alias_pending_key uuid := gen_random_uuid();
  v_next_key uuid := gen_random_uuid();
  v_canonical_hash text := repeat('e', 64);
  v_next_hash text := repeat('f', 64);
  v_canonical_completion record;
  v_alias_completion record;
  v_next_completion record;
  v_claim record;
  v_begin record;
  v_next_claim record;
  v_next_begin record;
  v_canonical_finalization record;
  v_source_diff record;
  v_changes record;
  v_findings record;
  v_baseline_component_id uuid;
  v_current_component_id uuid;
  v_diff_id uuid := gen_random_uuid();
  v_facts record;
  v_report jsonb := jsonb_build_object(
    'status', 'valid',
    'detected', jsonb_build_object(
      'format', 'cyclonedx',
      'serialization', 'json',
      'specificationVersion', '1.6'
    ),
    'validator', jsonb_build_object(
      'name', 'CRA streaming SBOM normalizer',
      'version', 'm3-lineage-test',
      'schemaAssetSha256', repeat('a', 64)
    ),
    'diagnostics', '[]'::jsonb,
    'errorCount', 0,
    'warningCount', 0,
    'omittedDiagnosticCount', 0,
    'completedAt', '2026-08-25T00:00:00.000Z'
  );
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select products.id, releases.id into v_product, v_release
  from public.products products
  join public.product_releases releases
    on releases.organization_id = products.organization_id
   and releases.product_id = products.id
  where products.organization_id = v_org
  order by releases.created_at, releases.id
  limit 1;
  if v_actor is null or v_release is null then
    raise exception 'seeded owner and release are required for lineage dedup tests';
  end if;

  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_canonical_source,
    'manual_upload', v_canonical_key,
    encode(extensions.digest('m3-lineage-canonical', 'sha256'), 'hex'),
    'canonical.json', 'application/json', 64, v_canonical_hash,
    v_org::text || '/' || v_canonical_source::text || '/' || v_canonical_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'cyclonedx', '1.6', null
  );
  select * into v_canonical_completion
  from public.finalize_sbom_source_deduplicated_atomic(
    v_org, v_canonical_source, v_actor, null, v_canonical_hash, 64,
    'application/json', v_canonical_key, gen_random_uuid()
  );
  if v_canonical_completion.outcome <> 'queued' then
    raise exception 'canonical upload was not queued: %', v_canonical_completion.outcome;
  end if;

  -- Keep this rollback-scoped fixture deterministic when a local browser E2E
  -- run has left an unrelated durable job in the shared seeded organization.
  update public.sbom_ingest_jobs
     set next_attempt_at = now() + interval '1 day'
   where organization_id = v_org
     and source_id <> v_canonical_source
     and status in ('queued', 'failed');

  -- The user-declared predecessor remains immutable even when the bytes are
  -- an alias.  The alias must reuse the queued canonical job, not enqueue one.
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_alias_source,
    'manual_upload', v_alias_key,
    encode(extensions.digest('m3-lineage-alias', 'sha256'), 'hex'),
    'same-bytes.json', 'application/json', 64, v_canonical_hash,
    v_org::text || '/' || v_alias_source::text || '/' || v_canonical_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'cyclonedx', '1.6', v_canonical_source
  );
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_alias_pending_source,
    'manual_upload', v_alias_pending_key,
    encode(extensions.digest('m3-lineage-alias-pending', 'sha256'), 'hex'),
    'same-bytes-second-event.json', 'application/json', 64, v_canonical_hash,
    v_org::text || '/' || v_alias_pending_source::text || '/' || v_canonical_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'cyclonedx', '1.6', v_canonical_source
  );
  select * into v_alias_completion
  from public.finalize_sbom_source_deduplicated_atomic(
    v_org, v_alias_source, v_actor, null, v_canonical_hash, 64,
    'application/json', v_alias_key, gen_random_uuid()
  );
  if v_alias_completion.outcome <> 'deduplicated'
    or (v_alias_completion.job ->> 'id') <> (v_canonical_completion.job ->> 'id')
    or not exists (
      select 1 from public.sbom_sources aliases
      where aliases.organization_id = v_org
        and aliases.id = v_alias_source
        and aliases.supersedes_source_id = v_canonical_source
        and aliases.deduplicated_from_source_id = v_canonical_source
    )
    or (select count(*) from public.sbom_ingest_jobs jobs
        where jobs.organization_id = v_org and jobs.input_sha256 = v_canonical_hash) <> 1
    or exists (select 1 from public.sbom_document_sources mappings
        where mappings.organization_id = v_org and mappings.source_id = v_alias_source)
    or not exists (select 1 from public.audit_logs logs
        where logs.organization_id = v_org and logs.action = 'sbom.source_deduplicated'
          and logs.entity_id = v_alias_source::text) then
    raise exception 'queued byte-identical finalization did not retain one canonical job and alias audit';
  end if;

  select * into v_claim
  from public.claim_sbom_ingest_job(v_org, 'm3-lineage-canonical-worker', 60);
  if v_claim.outcome <> 'claimed'
    or (v_claim.work ->> 'sourceId')::uuid <> v_canonical_source then
    raise exception 'canonical job was not claimable after alias finalization';
  end if;
  select * into v_begin
  from public.begin_sbom_document_normalization_atomic(
    v_org, (v_canonical_completion.job ->> 'id')::uuid,
    'm3-lineage-canonical-worker',
    'CRA streaming SBOM parser', 'm3-lineage-test',
    'CRA SBOM normalizer', 'm3-03.1',
    'cyclonedx', 'json', '1.6', v_report
  );
  if v_begin.outcome <> 'created'
    or (select count(*) from public.sbom_document_sources mappings
        where mappings.organization_id = v_org
          and mappings.document_id = (v_begin.document ->> 'id')::uuid) <> 2 then
    raise exception 'queued alias was not attached when the canonical graph began';
  end if;

  insert into public.sbom_components(
    organization_id, document_id, document_local_ref, source_offset,
    source_byte_end, source_path, source_line, original_name, normalized_name,
    original_version, normalized_version, original_purl, canonical_purl,
    cpe, ecosystem, scope, supplier, license_expression, hashes
  ) values
    (v_org, (v_begin.document ->> 'id')::uuid, 'no-purl', 90, 100,
      '$.components[0]', 1, 'No PURL', 'no purl', '1.0.0', '1.0.0', null,
      null, null, null, null, null, null, '[]'::jsonb),
    (v_org, (v_begin.document ->> 'id')::uuid, 'with-purl', 1, 80,
      '$.components[1]', 2, 'With PURL', 'with purl', '1.0.0', '1.0.0',
      'pkg:npm/with-purl@1.0.0', 'pkg:npm/with-purl@1.0.0', null, 'npm',
      null, null, null, '[]'::jsonb);
  select * into v_canonical_finalization
  from public.finalize_sbom_document_normalization_atomic(
    v_org, (v_canonical_completion.job ->> 'id')::uuid,
    'm3-lineage-canonical-worker', (v_begin.document ->> 'id')::uuid
  );
  if v_canonical_finalization.outcome <> 'completed' then
    raise exception 'canonical graph did not complete: %', v_canonical_finalization.outcome;
  end if;

  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_next_source,
    'manual_upload', v_next_key,
    encode(extensions.digest('m3-lineage-next', 'sha256'), 'hex'),
    'next.json', 'application/json', 64, v_next_hash,
    v_org::text || '/' || v_next_source::text || '/' || v_next_hash,
    now() + interval '10 minutes', gen_random_uuid(), 'cyclonedx', '1.6', v_canonical_source
  );
  select * into v_next_completion
  from public.finalize_sbom_source_deduplicated_atomic(
    v_org, v_next_source, v_actor, null, v_next_hash, 64,
    'application/json', v_next_key, gen_random_uuid()
  );
  update public.sbom_ingest_jobs
     set next_attempt_at = now() + interval '1 day'
   where organization_id = v_org
     and source_id <> v_next_source
     and status in ('queued', 'failed');
  select * into v_next_claim
  from public.claim_sbom_ingest_job(v_org, 'm3-lineage-next-worker', 60);
  select * into v_next_begin
  from public.begin_sbom_document_normalization_atomic(
    v_org, (v_next_completion.job ->> 'id')::uuid,
    'm3-lineage-next-worker',
    'CRA streaming SBOM parser', 'm3-lineage-test',
    'CRA SBOM normalizer', 'm3-03.1',
    'cyclonedx', 'json', '1.6', v_report
  );
  if v_next_completion.outcome <> 'queued'
    or v_next_claim.outcome <> 'claimed'
    or v_next_begin.outcome <> 'created' then
    raise exception 'second graph fixture was not created: completion %, claim %, begin %',
      v_next_completion.outcome, v_next_claim.outcome, v_next_begin.outcome;
  end if;

  select * into v_source_diff
  from public.get_sbom_source_diff_report(
    v_org, v_actor, v_next_source, null
  );
  if v_source_diff.outcome <> 'not_started'
    or (v_source_diff.result ->> 'baselineSourceId')::uuid <> v_canonical_source then
    raise exception 'source diff lookup did not retain the release-local predecessor';
  end if;
  select * into v_source_diff
  from public.get_sbom_source_diff_report(
    v_org, v_actor, v_alias_source, null
  );
  if v_source_diff.outcome <> 'not_found' then
    raise exception 'deduplicated alias appeared as a comparable lineage node';
  end if;

  insert into public.sbom_components(
    organization_id, document_id, document_local_ref, source_offset,
    source_byte_end, source_path, source_line, original_name, normalized_name,
    original_version, normalized_version, original_purl, canonical_purl,
    cpe, ecosystem, scope, supplier, license_expression, hashes
  ) values (
    v_org, (v_next_begin.document ->> 'id')::uuid, 'next-purl', 3, 50,
    '$.components[0]', 1, 'Next PURL', 'next purl', '2.0.0', '2.0.0',
    'pkg:npm/next-purl@2.0.0', 'pkg:npm/next-purl@2.0.0', null, 'npm',
    null, null, null, '[]'::jsonb
  ) returning id into v_current_component_id;
  select id into v_baseline_component_id
  from public.sbom_components
  where organization_id = v_org and document_id = (v_begin.document ->> 'id')::uuid
    and document_local_ref = 'with-purl';

  insert into public.sbom_diff_reports(
    id, organization_id, source_id, baseline_source_id, release_id,
    document_id, baseline_document_id, state, progress_stage, progress_percent,
    lease_owner, lease_expires_at
  ) values (
    v_diff_id, v_org, v_next_source, v_canonical_source, v_release,
    (v_next_begin.document ->> 'id')::uuid, (v_begin.document ->> 'id')::uuid,
    'processing', 'projecting_identities', 10,
    'm3-lineage-diff-worker', now() + interval '60 seconds'
  );
  insert into public.sbom_diff_component_changes(
    organization_id, report_id, change_key, change_type,
    canonical_package_identity, ecosystem, current_component_id,
    baseline_component_id, current_version, baseline_version, explanation
  ) values (
    v_org, v_diff_id, 'unresolved:fixture', 'unresolved',
    'pkg:npm/next-purl', 'npm', v_current_component_id,
    v_baseline_component_id, '2.0.0', '1.0.0',
    'The M4 comparator is not installed.'
  );
  select * into v_facts
  from public.list_sbom_diff_component_facts(
    v_org, v_diff_id, 'm3-lineage-diff-worker', 'baseline', 10, null
  );
  if v_facts.outcome <> 'found'
    or jsonb_array_length(v_facts.result -> 'items') <> 2
    or (v_facts.result -> 'items' -> 0 -> 'packageIdentity') <> 'null'::jsonb
    or (v_facts.result -> 'items' -> 0 -> 'canonicalPurl') <> 'null'::jsonb then
    raise exception 'missing-PURL facts were not retained before canonical identities';
  end if;
  if (v_facts.result -> 'items' -> 1 ->> 'packageIdentity') <> 'pkg:npm/with-purl' then
    raise exception 'PURL diff facts did not read the persisted package identity';
  end if;
  select * into v_source_diff
  from public.get_sbom_source_diff_report(
    v_org, v_actor, v_next_source, null
  );
  if v_source_diff.outcome <> 'found'
    or (v_source_diff.result -> 'report' ->> 'comparisonStatus') <> 'ready' then
    raise exception 'source diff lookup did not return the persisted report';
  end if;
  select * into v_changes
  from public.list_sbom_diff_component_changes(
    v_org, v_actor, v_diff_id, 10, null, null, null, null
  );
  if v_changes.outcome <> 'found'
    or (v_changes.result -> 'changes' -> 0 ->> 'diffId')::uuid <> v_diff_id
    or (v_changes.result -> 'changes' -> 0 ->> 'currentPurl') <> 'pkg:npm/next-purl@2.0.0'
    or (v_changes.result -> 'changes' -> 0 ->> 'baselinePurl') <> 'pkg:npm/with-purl@1.0.0'
    or (v_changes.result -> 'changes' -> 0 ->> 'currentSourceOffset')::bigint <> 3
    or (v_changes.result -> 'changes' -> 0 ->> 'baselineSourceOffset')::bigint <> 1 then
    raise exception 'component change response did not include traceable component facts';
  end if;
  select * into v_findings
  from public.get_sbom_diff_findings(v_org, v_actor, v_diff_id, 10, null);
  if v_findings.outcome <> 'found'
    or (v_findings.result ->> 'state') <> 'ready'
    or v_findings.result -> 'items' <> '[]'::jsonb
    or v_findings.result -> 'nextCursor' <> 'null'::jsonb then
    raise exception 'finding delta did not preserve the ready cursor boundary';
  end if;
  update public.sbom_diff_reports
  set state = 'completed', progress_stage = 'completed', progress_percent = 100,
      lease_owner = null, lease_expires_at = null, completed_at = now()
  where organization_id = v_org and id = v_diff_id;
  if (public.sbom_diff_report_json(v_org, v_diff_id) ->> 'comparisonStatus')
      <> 'partial_integration_unavailable' then
    raise exception 'unresolved version transitions must retain comparator-unavailable status';
  end if;
  update public.sbom_diff_component_changes
  set change_type = 'added'
  where organization_id = v_org and report_id = v_diff_id;
  if (public.sbom_diff_report_json(v_org, v_diff_id) ->> 'comparisonStatus') <> 'ready' then
    raise exception 'pure exact additions must remain a ready component diff';
  end if;
  delete from public.sbom_diff_component_changes
  where organization_id = v_org and report_id = v_diff_id;
  if (public.sbom_diff_report_json(v_org, v_diff_id) ->> 'comparisonStatus') <> 'identical' then
    raise exception 'an all-unchanged comparison must report identical';
  end if;
end;
$$;

rollback;
