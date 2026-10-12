-- Populated parity fixtures for every M14 SBOM/vulnerability source.
-- All records belong to a fresh tenant; global advisory/run fixtures are new.
-- No existing record is updated. Everything rolls back.
begin;
set local statement_timeout='30s';
create function pg_temp.assert_export(p_org uuid, p_actor uuid, p_source text, p_filters jsonb, p_context jsonb,
    p_expected jsonb)
returns void language plpgsql as $$
declare actual jsonb;
  expected jsonb;
  keys jsonb;
  begin
 if coalesce(jsonb_array_length(p_expected), 0)=0 then raise exception 'Empty positive parity fixture: %',
    p_source;
  end if;
 select columns into keys from (select public.m14_03_source_policy(p_source)->'columns' columns)x;
 select jsonb_agg((select jsonb_object_agg(k.value, case when jsonb_typeof(item.value->k.value) in ('object',
    'array') then to_jsonb((item.value->k.value)::text)else coalesce(item.value->k.value, 'null'::jsonb)end) from jsonb_array_elements_text(keys)k(value)) order by item.n) into expected from jsonb_array_elements(p_expected)with ordinality item(value,
    n);
 select jsonb_agg(row_values order by n)into actual from public.m14_03_additional_source_rows(p_org, p_actor,
    p_source, p_filters, p_context)with ordinality x(source_id, source_version, product_id, row_values,
    n);
 if actual is distinct from expected then raise exception 'Source parity failed: % actual=% expected=%',
    p_source, actual, expected;
  end if;
 begin perform * from public.m14_03_additional_source_rows(gen_random_uuid(), p_actor, p_source, p_filters,
    p_context);
  raise exception 'Forged tenant accepted: %', p_source;
  exception when insufficient_privilege then null;
  end;
 raise notice 'Populated native filter/sort/columns + tenant denial: %', p_source;
end $$;
do $$ declare
 o uuid:=gen_random_uuid();
  u uuid;
  l uuid:=gen_random_uuid();
  p uuid:=gen_random_uuid();
  r uuid:=gen_random_uuid();
  s uuid:=gen_random_uuid();
  s2 uuid:=gen_random_uuid();
  raw uuid:=gen_random_uuid();
  raw2 uuid:=gen_random_uuid();
  j uuid:=gen_random_uuid();
  j2 uuid:=gen_random_uuid();
  d uuid:=gen_random_uuid();
  d2 uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid();
  c2 uuid:=gen_random_uuid();
  quality uuid:=gen_random_uuid();
  diff uuid:=gen_random_uuid();
  review uuid:=gen_random_uuid();
  cred uuid:=gen_random_uuid();
  conn uuid:=gen_random_uuid();
  binding uuid:=gen_random_uuid();
  request uuid:=gen_random_uuid();
  finding uuid:=gen_random_uuid();
  vuln uuid;
  feedrun uuid;
  recordid uuid;
  versionid uuid;
  rangeid uuid;
  occ uuid;
  reach uuid:=gen_random_uuid();
  native record;
  items jsonb;
  ctx jsonb;
  filters jsonb;
  health jsonb;
  actual jsonb;
  marker text:='M14-'||gen_random_uuid();
begin
 select id into strict u from public.users where email='owner@cra.test';
 insert into public.organizations(id, name, slug)values(o, 'M14 parity tenant', 'm14-parity-'||o);
 insert into public.organization_members(organization_id, user_id, role)values(o, u, 'owner');
 insert into public.organization_legal_entities(id, organization_id, identifier, display_name, completion_status,
    status, created_by, updated_by)values(l, o, 'test', 'M14 entity', 'needs_completion', 'inactive',
    u, u);
 insert into public.products(id, organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by)values(p, o, l, 0,
    '{}', 'M14 parity', 'M14', 'standalone_software', u, u, u);
 insert into public.product_releases(id, organization_id, product_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, label, release_version, created_by, updated_by)values(r, o, p, l, 0, '{}',
    'Parity', '1.0.0', u, u);
 insert into public.sbom_sources(id, organization_id, product_id, release_id, actor_user_id, source_kind,
    idempotency_key, request_digest, original_filename, declared_media_type, declared_byte_size, declared_sha256,
    staging_storage_key, status, upload_expires_at, correlation_id)
 select id, o, p, r, u, 'manual_upload', gen_random_uuid(), hash, name, 'application/json', 20, hash,
    o||'/'||id||'/'||hash, 'upload_pending', clock_timestamp()+interval '1 hour', gen_random_uuid()from(values(s,
    repeat('a', 64), 'first.json'), (s2, repeat('b', 64), 'second.json'))x(id, hash, name);
 insert into public.sbom_raw_objects(id, organization_id, sha256, byte_size, media_type, storage_key) select id,
    o, hash, 20, 'application/json', o||'/'||id||'/'||hash from(values(raw, repeat('a', 64)), (raw2, repeat('b',
    64)))x(id, hash);
 update public.sbom_sources set status='verified', verified_at=now(), raw_object_id=case id when s then raw else raw2 end where organization_id=o;
 insert into public.sbom_ingest_jobs(id, organization_id, source_id, release_id, actor_user_id, correlation_id,
    idempotency_key, input_sha256, status, progress_stage, progress_percent, validation_status, detected_format,
    detected_serialization, detected_spec_version, validator_name, validator_version, validator_schema_asset_sha256,
    validation_report, validation_completed_at, completed_at)
 select id, o, source, r, u, gen_random_uuid(), gen_random_uuid(), hash, 'completed', 'completed', 100,
    'valid_with_warnings', 'cyclonedx', 'json', '1.6', 'test', '1.0.0', hash, '{"status":"valid_with_warnings","completedAt":"2026-10-09T00:00:00Z","detected":null,"validator":{"name":"test","version":"1.0.0","schemaAssetSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"errorCount":0,"warningCount":1,"omittedDiagnosticCount":0,"diagnostics":[{"severity":"warning","code":"test_diagnostic","location":"components[0]","message":"Unicode café Ω","remediation":"Review"}]}',
    now(), now()from(values(j, s, repeat('a', 64)), (j2, s2, repeat('b', 64)))x(id, source, hash);
 insert into public.sbom_documents(id, organization_id, source_id, raw_object_id, ingest_job_id, document_sha256,
    format, serialization, specification_version, parser_name, parser_version, normalizer_name, normalizer_version,
    validation_status, state, progress_stage, completed_at, component_count)
 select id, o, source, rawobj, job, hash, 'cyclonedx', 'json', '1.6', 'test', '1.0.0', 'test', '1.0.0',
    'valid_with_warnings', 'processing', 'parsing', null, 2 from(values(d, s, raw, j, repeat('a', 64)),
    (d2, s2, raw2, j2, repeat('b', 64)))x(id, source, rawobj, job, hash);
 insert into public.sbom_document_sources(organization_id, document_id, source_id, raw_object_id, release_id)values(o,
    d, s, raw, r), (o, d2, s2, raw2, r);
 insert into public.sbom_components(id, organization_id, document_id, document_local_ref, source_offset,
    source_path, source_byte_end, original_name, normalized_name, original_version, normalized_version,
    canonical_purl, ecosystem, depth, canonical_parent_component_id)
 values(c, o, d, 'parent', 0, 'components[0]', 10, 'Package Alpha', 'package-alpha', '1.0', '1.0', 'pkg:npm/package-alpha@1.0',
    'npm', 0, null), (c2, o, d, 'child', 10, 'components[1]', 20, 'Package Beta', 'package-beta', '2.0',
    '2.0', 'pkg:npm/package-beta@2.0', 'npm', 1, c);
 update public.sbom_documents set state='completed', progress_stage='completed', completed_at=now() where organization_id=o;
 ctx:=jsonb_build_object('productId', p, 'releaseId', r);
 select * into native from public.list_sbom_documents_for_release(o, u, p, r, 100, null);
  perform pg_temp.assert_export(o, u, 'sboms.documents_for_release', '{}', ctx, native.result->'documents');
 select * into native from public.list_sbom_sources_for_release(o, u, p, r, 100, null);
  select jsonb_agg(value->'source')into items from jsonb_array_elements(native.sources);
  perform pg_temp.assert_export(o, u, 'sboms.source_history', '{}', ctx, items);
 ctx:=jsonb_build_object('documentId', d);
  filters:='{"q":"beta"}';
  select * into native from public.search_sbom_components(o, u, d, 'beta', 100, null);
  perform pg_temp.assert_export(o, u, 'sboms.components', filters, ctx, native.result->'components');
 filters:=jsonb_build_object('parentComponentId', c);
  select * into native from public.list_sbom_dependency_tree(o, u, d, c, null, 100, null);
  select jsonb_agg(value->'component')into items from jsonb_array_elements(native.result->'items');
  perform pg_temp.assert_export(o, u, 'sboms.dependency_tree', filters, ctx, items);
 select id into strict quality from public.sbom_quality_reports where organization_id=o and source_id=s;
 insert into public.sbom_quality_findings(organization_id, report_id, document_id, component_id, finding_key,
    category, code, severity, remediation)values(o, quality, d, c, 'first', 'coverage', 'missing_license',
    'warning', 'Provide licence'), (o, quality, d, c2, 'second', 'coverage', 'missing_supplier', 'error',
    'Provide supplier');
 ctx:=jsonb_build_object('sourceId', s);
  filters:='{"severity":"warning"}';
  select * into native from public.list_sbom_quality_findings(o, u, s, 100, null, 'warning', null);
  perform pg_temp.assert_export(o, u, 'sboms.quality_findings', filters, ctx, native.result->'findings');
 select * into native from public.get_sbom_validation_report(o, u, s);
  select jsonb_agg(value||jsonb_build_object('path', value->'location'))into items from jsonb_array_elements(native.report->'diagnostics');
  perform pg_temp.assert_export(o, u, 'sboms.validation_diagnostics', '{}', ctx, items);
 insert into public.sbom_diff_reports(id, organization_id, source_id, baseline_source_id, release_id,
    document_id, baseline_document_id, state, progress_stage, progress_percent, completed_at)values(diff,
    o, s, s2, r, d, d2, 'completed', 'completed', 100, now());
 insert into public.sbom_diff_component_changes(organization_id, report_id, change_key, change_type, canonical_package_identity,
    ecosystem, current_component_id, current_version, baseline_version, explanation)values(o, diff, 'first',
    'added', 'pkg:npm/package-alpha', 'npm', c, '1.0', null, 'Added alpha'), (o, diff, 'second', 'upgraded',
    'pkg:npm/package-beta', 'npm', c2, '2.0', '1.0', 'Changed beta');
 ctx:=jsonb_build_object('diffId', diff);
  filters:='{"change":"added","q":"alpha"}';
  select * into native from public.list_sbom_diff_component_changes(o, u, diff, 100, null, 'added', null,
    'alpha');
  perform pg_temp.assert_export(o, u, 'sboms.diff_components', filters, ctx, native.result->'changes');
 insert into public.sbom_composite_reviews(id, organization_id, product_id, release_id, merge_rules_version,
    input_set_digest, status, created_by)values(review, o, p, r, 'm14-parity', repeat('a', 64), 'awaiting_review',
    u);
 insert into public.sbom_composite_conflicts(organization_id, review_id, identity_key, conflict_type,
    field_name, candidates)values(o, review, 'pkg:npm/package-alpha', 'unresolved_identity', null, '[{"value":"alpha"}]');
 insert into public.sbom_composite_unresolved_relationships(organization_id, review_id, relationship_key,
    detail)values(o, review, 'alpha-beta', '{"from":"alpha","to":"beta"}');
 ctx:=jsonb_build_object('reviewId', review);
  select * into native from public.get_sbom_composite_review(o, u, review);
  perform pg_temp.assert_export(o, u, 'sboms.composite_conflicts', '{}', ctx, native.review->'conflicts');
  perform pg_temp.assert_export(o, u, 'sboms.composite_relationships', '{}', ctx, native.review->'relationships');
 insert into public.sbom_supplier_requests(id, organization_id, product_id, release_id, supplier_display_name,
    allowed_component_ref, expires_at, idempotency_key, request_digest, created_by)values(request, o,
    p, r, 'Supplier', 'parent', now()+interval '1 day', gen_random_uuid(), repeat('a', 64), u);
 ctx:=jsonb_build_object('productId', p, 'releaseId', r);
  filters:='{"state":"open"}';
  select * into native from public.list_supplier_sbom_requests(o, u, p, r, 'open', 100, null);
  select jsonb_agg(value->'request')into items from jsonb_array_elements(native.requests);
  perform pg_temp.assert_export(o, u, 'sboms.supplier_requests', filters, ctx, items);
 insert into public.sbom_ci_credentials(id, organization_id, label, token_prefix, token_salt, token_hash,
    created_by)values(cred, o, 'Parity credential', 'cra_sbom_12345678', repeat('s', 32), repeat('h',
    64), u);
 perform pg_temp.assert_export(o, u, 'sboms.ci_credentials', '{}', '{}', jsonb_build_array(jsonb_build_object('id',
    cred, 'label', 'Parity credential', 'createdAt', (select created_at from public.sbom_ci_credentials where id=cred),
    'revokedAt', null, 'lastUsedAt', null)));
 insert into public.connectors(id, organization_id, connector_type, display_name, adapter_version, mapping_version,
    created_by, updated_by)values(conn, o, 'github_actions', 'Parity connector', '1.0.0', 'ci-v1', u,
    u);
 insert into public.ci_provider_release_bindings(id, organization_id, connector_id, product_id, release_id,
    credential_id, provider, provider_host, repository_owner, repository_name, repository_id, provider_installation_id,
    allowed_ref, connection_revision, credential_revision, created_by)values(binding, o, conn, p, r, cred,
    'github_actions', 'github.com', 'fixture', 'repo', '1', '1', 'refs/heads/main', 1, 1, u);
 select jsonb_build_array(jsonb_build_object('id', id, 'connectorId', connector_id, 'productId', product_id,
    'releaseId', release_id, 'provider', provider, 'repositoryOwner', repository_owner, 'repositoryName',
    repository_name, 'status', status, 'version', version, 'createdAt', created_at, 'updatedAt', updated_at))into items from public.ci_provider_release_bindings where id=binding;
  perform pg_temp.assert_export(o, u, 'sboms.ci_bindings', '{}', '{}', items);
 insert into public.ci_build_runs(organization_id, binding_id, credential_id, source_id, ingest_job_id,
    provider, provider_host, repository_owner, repository_name, repository_id, provider_installation_id,
    run_id, run_attempt, ref, commit_sha, event_name, idempotency_key, request_digest)values(o, binding,
    cred, s, j, 'github_actions', 'github.com', 'fixture', 'repo', '1', '1', 'run-1', '1', 'refs/heads/main',
    repeat('a', 40), 'push', gen_random_uuid(), repeat('a', 64));
 -- Before match completion the canonical build state is pending.
 select jsonb_build_array(jsonb_build_object('id', id, 'bindingId', binding_id, 'runId', run_id, 'runAttempt',
    run_attempt, 'commitSha', commit_sha, 'ref', ref, 'sourceId', source_id, 'jobId', ingest_job_id, 'state',
    'pending', 'createdAt', created_at))into items from public.ci_build_runs where organization_id=o;
  perform pg_temp.assert_export(o, u, 'sboms.ci_binding_runs', '{}', jsonb_build_object('bindingId', binding),
    items);
 insert into public.vulnerabilities(canonical_id, title, summary)values(marker, 'Parity vulnerability',
    'Synthetic')returning id into vuln;
 insert into public.vulnerability_feed_sync_runs(feed_key, run_kind, status, correlation_id, staging_complete,
    expected_record_count, records_received, records_promoted, started_at, completed_at)values('osv',
    'manual', 'completed', gen_random_uuid(), true, 1, 1, 1, now(), now())returning id into feedrun;
 insert into public.vulnerability_source_records(feed_key, source_record_key, vulnerability_id)values('osv',
    marker, vuln)returning id into recordid;
 insert into public.vulnerability_source_record_versions(source_record_id, run_id, record_sha256, record_state,
    raw_payload, normalized_payload)values(recordid, feedrun, repeat('f', 64), 'active', '{}', '{}')returning id into versionid;
 update public.vulnerability_source_records set current_version_id=versionid where id=recordid;
 insert into public.vulnerability_affected_ranges(vulnerability_id, source_record_version_id, ecosystem,
    package_name, range_type, range_value)values(vuln, versionid, 'npm', 'package-alpha', 'semver', '{"versions":["1.0"]}')returning id into rangeid;
 insert into public.vulnerability_component_occurrences(organization_id, document_id, release_id, component_id,
    canonical_purl, component_identity, component_version)values(o, d, r, c, 'pkg:npm/package-alpha@1.0',
    'pkg:npm/package-alpha@1.0', '1.0')returning id into occ;
 insert into public.vulnerability_findings(id, organization_id, release_id, component_identity, canonical_advisory_id,
    vulnerability_id, source_feed_key, source_record_id, source_record_version_id, affected_range_id,
    match_method, comparator_name, comparator_version, evaluated_component_value, affected_range, event_sequence,
    confidence, confidence_table_version, confidence_explanation)values(finding, o, r, 'pkg:npm/package-alpha@1.0',
    marker, vuln, 'osv', recordid, versionid, rangeid, 'purl_osv', 'semver', 'm4-02.1', '1.0', '{"versions":["1.0"]}',
    '[]', 0.91, 'm14-test', 'Parity');
 insert into public.vulnerability_finding_component_occurrences(finding_id, occurrence_id, organization_id)values(finding,
    occ, o);
 insert into public.vulnerability_match_jobs(organization_id, document_id, release_id, osv_promotion_sequence,
    status, correlation_id, trigger_key, completed_at)values(o, d, r, 0, 'completed', gen_random_uuid(),
    marker||'-current', now()), (o, d2, r, 0, 'completed', gen_random_uuid(), marker||'-baseline', now());
 update public.vulnerability_match_jobs set status='completed', completed_at=now() where organization_id=o;
 ctx:=jsonb_build_object('diffId', diff);
  select * into native from public.get_sbom_diff_findings(o, u, diff, 100, null);
  perform pg_temp.assert_export(o, u, 'sboms.diff_findings', '{}', ctx, native.result->'items');
 ctx:=jsonb_build_object('documentId', d);
  filters:=jsonb_build_object('q', marker, 'includeLowConfidence', true, 'includeReviewable', true);
  select * into native from public.list_vulnerability_match_results_for_document_page(o, u, d, true, true,
    1, 100, marker);
  select jsonb_agg(value||jsonb_build_object('canonicalPurl', value->'componentPurl', 'evaluatedVersion',
    value->'componentVersion'))into items from jsonb_array_elements(native.result->'results');
  perform pg_temp.assert_export(o, u, 'vulnerabilities.document_findings', filters, ctx, items);
 select * into native from public.list_vulnerability_enriched_findings_for_document_page(o, u, d, true,
    1, 100, marker);
 select jsonb_agg((value->'finding')||jsonb_build_object('cvssBaseScore', value#>'{intelligence,cvss,preferred,baseScore}',
    'epss', value#>'{intelligence,epss,value}', 'kevStatus', value#>'{intelligence,kev,status}', 'priority',
    jsonb_build_object('kind', 'm14_priority_inputs_v1', 'inputs', jsonb_build_object('cvssBaseScore',
    null, 'epss', null, 'kevStatus', 'not_listed', 'confidenceScore', value#>'{finding,confidence,score}',
    'humanVerdict', null))::text))into items from jsonb_array_elements(native.result->'rows');
  perform pg_temp.assert_export(o, u, 'vulnerabilities.enriched_findings', filters, ctx, items);
 insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)values(o,
    u, 'vulnerability.finding_reevaluated', 'vulnerability_finding', finding::text, jsonb_build_object('transitionReason',
    'source_changed', 'sourceRecordId', recordid, 'sourceRecordVersionId', versionid, 'after', jsonb_build_object('reevaluationState',
    'unchanged')));
 ctx:=jsonb_build_object('documentId', d, 'findingId', finding);
  select * into native from public.list_vulnerability_finding_reevaluation_history(o, u, d, finding, 1,
    100);
  perform pg_temp.assert_export(o, u, 'vulnerabilities.reevaluation_history', '{}', ctx, native.result->'rows');
 insert into public.vulnerability_reachability_results(id, organization_id, finding_id, occurrence_id,
    source_record_version_id, analyzer_id, analyzer_version, ecosystem, build_format, component_identity,
    verdict, input_artifacts, input_fingerprint, executed_at, evidence_path, confidence_score, confidence_level,
    confidence_explanation, idempotency_key, material_fingerprint)values(reach, o, finding, occ, versionid,
    'test', '1.0', 'npm', 'package-lock', 'pkg:npm/package-alpha@1.0', 'unknown', '[]', repeat('a', 64),
    now(), '[]', 0.5, 'medium', 'Synthetic', gen_random_uuid(), repeat('b', 64));
 select * into native from public.get_vulnerability_finding_reachability_evidence(o, u, d, finding, false);
  perform pg_temp.assert_export(o, u, 'vulnerabilities.reachability_evidence', '{}', ctx, jsonb_build_array(native.result->'reachability'));
 select jsonb_agg(jsonb_build_object('id', id, 'feedKey', feed_key, 'status', status, 'attempt', attempt_count,
    'recordsFetched', records_received, 'recordsPromoted', records_promoted, 'failureCode', failure_code,
    'startedAt', started_at, 'completedAt', coalesce(completed_at, dead_lettered_at)))into items from public.list_vulnerability_feed_sync_runs('osv',
    100, 0);
  perform pg_temp.assert_export(o, u, 'vulnerabilities.sync_runs', '{"feedKey":"osv"}', '{}', items);
 -- Feed health freezes native inputs under each approved selected field. The
 -- TypeScript source-owned policy tests independently verify final mapping.
 health:=public.vulnerability_feed_health_json('osv');
 select jsonb_agg((row_values->>'status')::jsonb->'value')into actual from public.m14_03_additional_source_rows(o,
    u, 'vulnerabilities.feed_health', '{"feedKey":"osv"}', '{}');
  if actual is distinct from health then raise exception 'Feed health capture differs from native source';
  end if;
 begin perform * from public.m14_03_additional_source_rows(gen_random_uuid(), u, 'vulnerabilities.feed_health',
    '{}', '{}');
  raise exception 'Forged health tenant accepted';
  exception when insufficient_privilege then null;
  end;
 raise notice 'Populated health source + forged tenant denial';
end $$;
rollback;
