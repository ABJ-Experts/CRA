-- Populated native parity for imports, suppliers, tasks and risk lists.
-- Fresh tenant/source graph; all changes roll back.
\set ON_ERROR_STOP on
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
 select jsonb_agg(row_values order by n)into actual from public.m14_03_source_rows(p_org, p_actor,
    p_source, p_filters, p_context)with ordinality x(source_id, source_version, product_id, row_values,
    n);
 if actual is distinct from expected then raise exception 'Source parity failed: % actual=% expected=%',
    p_source, actual, expected;
  end if;
 begin perform * from public.m14_03_source_rows(gen_random_uuid(), p_actor, p_source, p_filters,
    p_context);
  if p_source not in ('products.registry','products.releases') then raise exception 'Forged tenant accepted: %', p_source; end if;
  if exists(select 1 from public.m14_03_source_rows(gen_random_uuid(),p_actor,p_source,p_filters,p_context)) then raise exception 'Forged tenant leaked products';end if;
  exception when insufficient_privilege then null;
  end;
 raise notice 'Populated native filter/sort/columns + tenant denial: %', p_source;
end $$;
do $$ declare
 o uuid:=gen_random_uuid();u uuid;member_id uuid;l uuid:=gen_random_uuid();p uuid:=gen_random_uuid();r uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();raw uuid:=gen_random_uuid();raw2 uuid:=gen_random_uuid();j uuid:=gen_random_uuid();j2 uuid:=gen_random_uuid();d uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();c uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();
 vuln uuid;feedrun uuid;recordid uuid;versionid uuid;rangeid uuid;occ uuid;finding uuid:=gen_random_uuid();marker text:='M14-list-'||gen_random_uuid();supplier uuid;import_id uuid:=gen_random_uuid();queued_id uuid:=gen_random_uuid();native record;items jsonb;payload jsonb;
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

 -- Native product filters exclude a separate product; matched products use native descending order.
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by,created_at,updated_at)
 values(gen_random_uuid(),o,l,0,'{}','Excluded device','OTHER','hardware_with_software',u,u,u,now(),now()),(gen_random_uuid(),o,l,0,'{}','M14 second parity','M14-SECOND','standalone_software',u,u,u,now()-interval '1 day',now()-interval '1 day');
 select * into native from public.list_products(o,u,'M14',false,'standalone_software',u,1,100);
 select jsonb_agg(x||jsonb_build_object('legalEntity.id',x#>'{legalEntity,id}') order by n)into items from jsonb_array_elements(native.products->'rows')with ordinality z(x,n);
 perform pg_temp.assert_export(o,u,'products.registry',jsonb_build_object('q','M14','archived',false,'productType','standalone_software','responsibleOwnerId',u),'{}',items);
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,created_by,updated_by,created_at)
 values(gen_random_uuid(),o,p,l,0,'{}','Earlier development','0.9.0','development',u,u,now()-interval '1 day'),(gen_random_uuid(),o,p,l,0,'{}','Excluded withdrawn','0.8.0','withdrawn',u,u,now());
 select * into native from public.list_product_releases(o,p,u,false,'development',1,100);
 perform pg_temp.assert_export(o,u,'products.releases','{"archived":false,"lifecycle":"development"}',jsonb_build_object('productId',p),native.releases->'rows');
 select id into strict member_id from public.users where email='member@cra.test';
 insert into public.organization_members(organization_id,user_id,role)values(o,member_id,'member');
 select * into native from public.create_supplier_organization_atomic(o,u,'Parity supplier','Parity legal',null,'high',array[]::uuid[],gen_random_uuid());
 if native.outcome<>'created' then raise exception 'supplier setup %',native.outcome;end if;
 supplier:=(native.result->>'id')::uuid;
 select * into native from public.create_supplier_contact_atomic(o,u,supplier,'Zulu contact','zulu@fixture.invalid','Security',null,gen_random_uuid());
 if native.outcome<>'created' then raise exception 'contact setup %',native.outcome;end if;
 perform * from public.create_supplier_contact_atomic(o,u,supplier,'Alpha contact','alpha@fixture.invalid','Engineering',null,gen_random_uuid());
 select * into native from public.create_supplier_component_responsibility_atomic(o,u,supplier,p,r,occ,'manual',null,gen_random_uuid());
 if native.outcome<>'created' then raise exception 'responsibility setup %',native.outcome;end if;
 perform * from public.create_supplier_organization_atomic(o,u,'Excluded vendor','Other legal',null,'low',array[]::uuid[],gen_random_uuid());
 select * into native from public.list_supplier_organizations_atomic(o,u,'Parity',false,100,null);
 perform pg_temp.assert_export(o,u,'suppliers.registry','{"search":"Parity","includeArchived":false}','{}',native.result->'items');
 select * into native from public.get_supplier_organization_atomic(o,u,supplier);
 perform pg_temp.assert_export(o,u,'suppliers.contacts','{}',jsonb_build_object('supplierId',supplier),native.result->'contacts');
 perform pg_temp.assert_export(o,u,'suppliers.responsibilities','{}',jsonb_build_object('supplierId',supplier),native.result->'responsibilities');
 select * into native from public.get_finding_responsible_suppliers_atomic(o,u,finding);
 select jsonb_agg(x->'supplier' order by n)into items from jsonb_array_elements(native.result->'suppliers')with ordinality t(x,n);
 perform pg_temp.assert_export(o,u,'findings.responsible_suppliers','{}',jsonb_build_object('findingId',finding),items);
 perform * from public.create_product_import_job(o,u,import_id,gen_random_uuid(),repeat('4',64),'parity.csv',100,o||'/'||import_id||'/source.csv',gen_random_uuid());
 perform * from public.claim_product_import_job_by_id(o,import_id,'m14-parity',60);
 perform * from public.save_product_import_rows_page(o,import_id,'m14-parity',repeat('4',64),jsonb_build_array(
 jsonb_build_object('id',gen_random_uuid(),'sourceRowNumber',3,'rowHash',repeat('5',64),'rowType','product','proposedAction','create','result','planned','productInternalCode','BETA','productInternalCodeNormalized','beta','proposed',jsonb_build_object('name','=SECRET PRIVATE CELL'),'issues','[]'::jsonb),
 jsonb_build_object('id',gen_random_uuid(),'sourceRowNumber',2,'rowHash',repeat('6',64),'rowType','product','proposedAction','create','result','planned','productInternalCode','ALPHA','productInternalCodeNormalized','alpha','proposed','{}'::jsonb,'issues','[]'::jsonb),
 jsonb_build_object('id',gen_random_uuid(),'sourceRowNumber',4,'rowHash',repeat('7',64),'rowType','product','proposedAction','skipped','result','skipped','productInternalCode','EXCLUDED','productInternalCodeNormalized','excluded','proposed','{}'::jsonb,'issues','[]'::jsonb)));
 perform * from public.create_product_import_job(o,u,queued_id,gen_random_uuid(),repeat('8',64),'queued.csv',100,o||'/'||queued_id||'/source.csv',gen_random_uuid());
 select * into native from public.list_product_import_jobs(o,u,'validating',1,100);
 perform pg_temp.assert_export(o,u,'products.imports','{"status":"validating"}','{}',native.imports->'rows');
 select * into native from public.list_product_import_rows(o,u,import_id,'planned',1,100);
 perform pg_temp.assert_export(o,u,'products.import_rows','{"result":"planned"}',jsonb_build_object('importId',import_id),native.rows->'rows');
 perform * from public.m1201_manage_group(o,u,'create',null,'Zulu reviewers',null,null,gen_random_uuid());
 perform * from public.m1201_manage_group(o,u,'create',null,'Alpha reviewers',null,null,gen_random_uuid());
 select * into native from public.m1201_list_groups(o,u);
 perform pg_temp.assert_export(o,u,'tasks.routing_groups','{}','{}',native.groups);
 select * into native from public.m1201_manage_absence(o,u,'create',null,now()+interval '1 day',now()+interval '2 days',member_id,null,gen_random_uuid());
 if native.outcome<>'updated' then raise exception 'absence setup %',native.outcome;end if;
 select * into native from public.m1201_list_absences(o,u);
 perform pg_temp.assert_export(o,u,'tasks.absences','{}','{}',native.absences);
 select * into native from public.m1201_list_tasks(o,u,'all','finding_triage',null,null,null,null,null,100);
 perform pg_temp.assert_export(o,u,'tasks.inbox','{"scope":"all","type":"finding_triage"}','{}',native.tasks);
 perform * from public.create_technical_file_atomic(o,u,p,gen_random_uuid());
 payload:=jsonb_build_object('threat','Untrusted update','mitigations','Verify signed update','revisionRationale','Parity fixture','ownerId',u,
 'inherentAssessment',jsonb_build_object('likelihood',4,'impact',4,'likelihoodRationale','Exposure','impactRationale','Sensitive data'),
 'residualAssessment',jsonb_build_object('likelihood',2,'impact',2,'likelihoodRationale','Verified signatures','impactRationale','Isolation'),
 'affectedAssets','[]'::jsonb,'requirements','[]'::jsonb,'evidenceReferences','[]'::jsonb);
 select * into native from public.create_technical_file_risk_atomic(o,u,p,payload,gen_random_uuid());
 if native.outcome<>'created' then raise exception 'risk setup %',native.outcome;end if;
 select * into native from public.get_technical_file_risk_register(o,u,p);
 perform pg_temp.assert_export(o,u,'risk_register.risks','{}',jsonb_build_object('productId',p),native.result->'riskRegister'->'risks');
end $$;
rollback;
