-- A rollback-only supplier fixture. Tokens and session hashes are never read from audit rows.
begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end $$;

create or replace function pg_temp.block_supplier_audit()
returns trigger language plpgsql as $$
begin
  if new.action in ('supplier.evidence_invitation_redeemed',
    'supplier.evidence_submission_failed') then
    raise exception 'simulated audit outage';
  end if;
  return new;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_product uuid := gen_random_uuid();
  v_release uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_m3_request uuid := gen_random_uuid();
  v_direct_request uuid := gen_random_uuid();
  v_direct_invitation uuid := gen_random_uuid();
  v_m9_request uuid;
  v_m9_invitation uuid;
  v_m9_item uuid;
  v_evidence_item uuid;
  v_linked_invitation uuid;
  v_submission uuid;
  v_version uuid;
  v_reserve_key uuid := gen_random_uuid();
  v_finalize_key uuid := gen_random_uuid();
  v_hash text := encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_payload jsonb;
  v_result record;
  v_direct_token text := encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_direct_session text := encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_evidence_token text := encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_evidence_session text := encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_linked_session text := encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_failed boolean := false;
begin
  select id into strict v_actor from public.users where email = 'owner@cra.test';
  select id into strict v_entity from public.organization_legal_entities
    where organization_id = v_org and is_default;

  insert into public.supplier_organizations(id, organization_id, name, created_by, updated_by)
  values(v_supplier, v_org, 'M13 supplier ' || left(v_supplier::text, 8), v_actor, v_actor);
  insert into public.supplier_contacts(id, organization_id, supplier_id, name, email, created_by, updated_by)
  values(v_contact, v_org, v_supplier, 'M13 contact',
    'm13-' || left(v_contact::text, 8) || '@cra.test', v_actor, v_actor);
  insert into public.products(id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type, responsible_owner_id, created_by, updated_by)
  values(v_product, v_org, v_entity, 0, '{}'::jsonb, 'M13 supplier product',
    'M13-' || v_product::text, 'standalone_software', v_actor, v_actor, v_actor);
  insert into public.product_releases(id, organization_id, product_id, legal_entity_id,
    legal_entity_version, legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by)
  values(v_release, v_org, v_product, v_entity, 0, '{}'::jsonb,
    'M13 supplier release', '1.0-' || v_release::text, 'development', v_actor, v_actor);
  insert into public.sbom_supplier_requests(id, organization_id, product_id, release_id,
    supplier_display_name, allowed_component_ref, status, expires_at, idempotency_key,
    request_digest, created_by, supplier_id)
  values
    (v_m3_request, v_org, v_product, v_release, 'M13 linked supplier',
      'pkg:npm/m13-linked@1.0.0', 'open', now() + interval '2 days', gen_random_uuid(),
      repeat('a', 64), v_actor, v_supplier),
    (v_direct_request, v_org, v_product, v_release, 'M13 direct supplier',
      'pkg:npm/m13-direct@1.0.0', 'open', now() + interval '2 days', gen_random_uuid(),
      repeat('b', 64), v_actor, v_supplier);

  select * into v_result from public.create_supplier_sbom_invitation_atomic(
    v_org, v_actor, v_direct_request, v_direct_invitation, v_direct_token,
    now() + interval '1 day', gen_random_uuid(), repeat('c', 64), gen_random_uuid());
  perform pg_temp.check('direct M3 invitation created', v_result.outcome = 'created');
  select * into v_result from public.consume_supplier_sbom_invitation_atomic(
    v_direct_token, v_direct_session, now() + interval '20 minutes');
  perform pg_temp.check('direct M3 invitation consumed', v_result.outcome = 'created');
  select * into v_result from public.consume_supplier_sbom_invitation_atomic(
    v_direct_token, v_direct_session, now() + interval '20 minutes');
  perform pg_temp.check('direct M3 retry accepted', v_result.outcome = 'created');
  perform pg_temp.check('direct M3 consume has one scoped event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_direct_invitation::text
        and action = 'sbom.supplier_invitation_consumed' and schema_version = 2));

  v_payload := jsonb_build_object('supplierId', v_supplier,
    'recipientContactId', v_contact, 'productId', v_product, 'ownerUserId', v_actor,
    'title', 'M13 supplier request', 'instructions', 'Submit the requested SBOM.',
    'dueAt', to_char(clock_timestamp() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items', jsonb_build_array(
      jsonb_build_object('title', 'Component SBOM', 'kind', 'sbom',
        'documentClass', 'sbom', 'supplierSbomRequestId', v_m3_request),
      jsonb_build_object('title', 'Supplier certificate', 'kind', 'evidence',
        'documentClass', 'certificate')));
  select * into v_result from public.create_supplier_evidence_request_atomic(
    v_org, v_actor, v_payload, gen_random_uuid());
  perform pg_temp.check('M9 request created', v_result.outcome = 'created');
  v_m9_request := (v_result.result ->> 'id')::uuid;
  select * into v_result from public.preview_supplier_evidence_request_atomic(v_org, v_actor, v_payload);
  perform pg_temp.check('M9 request previewed', v_result.outcome = 'previewed');
  select * into v_result from public.issue_supplier_evidence_request_atomic(
    v_org, v_actor, v_m9_request, 0, v_result.result ->> 'fingerprint',
    v_evidence_token, clock_timestamp() + interval '1 day', gen_random_uuid());
  perform pg_temp.check('M9 invitation issued', v_result.outcome = 'issued');
  select id into strict v_m9_invitation from public.supplier_evidence_invitations
    where organization_id = v_org and request_id = v_m9_request;
  select id into strict v_m9_item from public.supplier_evidence_request_items
    where organization_id = v_org and sbom_supplier_request_id = v_m3_request;
  select id into strict v_evidence_item from public.supplier_evidence_request_items
    where organization_id = v_org and revision_id = (select current_revision_id
      from public.supplier_evidence_requests where id = v_m9_request)
      and document_class = 'certificate';
  select id into strict v_linked_invitation from public.sbom_supplier_invitations
    where organization_id = v_org and m9_invitation_id = v_m9_invitation
      and m9_request_item_id = v_m9_item;

  execute 'create trigger m13_test_block_audit before insert on public.audit_logs '
    || 'for each row execute function pg_temp.block_supplier_audit()';
  begin
    perform * from public.redeem_supplier_evidence_invitation_atomic(
      v_evidence_token, v_evidence_session, clock_timestamp() + interval '20 minutes');
  exception when others then v_failed := true;
  end;
  execute 'drop trigger m13_test_block_audit on public.audit_logs';
  perform pg_temp.check('audit outage aborts redemption', v_failed);
  perform pg_temp.check('audit outage rolls back session change',
    (select state = 'active' and session_token_hash is null
      from public.supplier_evidence_invitations where id = v_m9_invitation));

  select * into v_result from public.redeem_supplier_evidence_invitation_atomic(
    v_evidence_token, v_evidence_session, clock_timestamp() + interval '20 minutes');
  perform pg_temp.check('M9 invitation redeemed', v_result.outcome = 'created');
  select * into v_result from public.redeem_supplier_evidence_invitation_atomic(
    v_evidence_token, v_evidence_session, clock_timestamp() + interval '20 minutes');
  perform pg_temp.check('M9 redemption retry accepted', v_result.outcome = 'created');
  perform pg_temp.check('M9 redemption has one scoped event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_m9_invitation::text
        and action = 'supplier.evidence_invitation_redeemed' and schema_version = 2));

  select * into v_result from public.activate_supplier_evidence_sbom_session_atomic(
    v_evidence_session, v_m9_item, v_linked_session);
  perform pg_temp.check('linked M3 session activated', v_result.outcome = 'created');
  select * into v_result from public.activate_supplier_evidence_sbom_session_atomic(
    v_evidence_session, v_m9_item, v_linked_session);
  perform pg_temp.check('linked M3 activation replays', v_result.outcome = 'replayed');
  perform pg_temp.check('linked M3 activation has one scoped event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_linked_invitation::text
        and action = 'sbom.supplier_linked_session_activated' and schema_version = 2));
  perform pg_temp.check('cross-item and token substitution cannot create audit',
    (select outcome = 'not_found' from public.activate_supplier_evidence_sbom_session_atomic(
      v_evidence_session, gen_random_uuid(), encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex')))
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_linked_invitation::text
        and action = 'sbom.supplier_linked_session_activated'));

  -- M8 owns successful upload completion and scanner decisions. A failed
  -- integrity finalize has no M8 completion event, so the supplier state
  -- transition must be the authoritative audit source for that branch.
  select * into v_result from public.reserve_supplier_evidence_submission_atomic(
    v_evidence_session, v_evidence_item, 'certificate.pdf', 128,
    'application/pdf', v_hash,
    gen_random_uuid()::text || '/' || gen_random_uuid()::text || '/'
      || gen_random_uuid()::text || '/' || gen_random_uuid()::text,
    clock_timestamp() + interval '10 minutes', v_reserve_key, repeat('f', 64));
  perform pg_temp.check('M9 evidence upload reserved', v_result.outcome = 'reserved');
  v_submission := (v_result.result #>> '{submission,id}')::uuid;
  v_version := (v_result.result ->> 'versionId')::uuid;

  execute 'create trigger m13_test_block_audit before insert on public.audit_logs '
    || 'for each row execute function pg_temp.block_supplier_audit()';
  v_failed := false;
  begin
    perform * from public.finalize_supplier_evidence_submission_atomic(
      v_evidence_session, v_version, 129, 'application/pdf', v_hash,
      v_finalize_key, repeat('e', 64));
  exception when others then v_failed := true;
  end;
  execute 'drop trigger m13_test_block_audit on public.audit_logs';
  perform pg_temp.check('audit outage aborts failed finalize', v_failed);
  perform pg_temp.check('audit outage rolls back evidence and supplier states',
    (select state = 'uploading' from public.supplier_evidence_submissions
      where organization_id = v_org and id = v_submission)
    and (select processing_state = 'uploading'
      from public.evidence_document_versions where organization_id = v_org and id = v_version));

  select * into v_result from public.finalize_supplier_evidence_submission_atomic(
    v_evidence_session, v_version, 129, 'application/pdf', v_hash,
    v_finalize_key, repeat('e', 64));
  perform pg_temp.check('integrity failure is reported', v_result.outcome = 'rejected');
  select * into v_result from public.finalize_supplier_evidence_submission_atomic(
    v_evidence_session, v_version, 129, 'application/pdf', v_hash,
    v_finalize_key, repeat('e', 64));
  perform pg_temp.check('failed finalize retry replays', v_result.outcome = 'replayed');
  perform pg_temp.check('failed finalize has one supplier event and no M8 completion event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_submission::text
        and action = 'supplier.evidence_submission_failed' and schema_version = 2)
    and not exists(select 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_version::text
        and action = 'evidence.upload_completed'));
  perform pg_temp.check('session hashes and portal instructions never enter audit',
    not exists(select 1 from public.audit_logs a
      where a.organization_id = v_org
        and a.entity_id in (v_direct_invitation::text, v_m9_invitation::text,
          v_linked_invitation::text)
        and (position(v_direct_token in row_to_json(a)::text) > 0
          or position(v_direct_session in row_to_json(a)::text) > 0
          or position(v_evidence_token in row_to_json(a)::text) > 0
          or position(v_evidence_session in row_to_json(a)::text) > 0
          or position(v_linked_session in row_to_json(a)::text) > 0
          or position('Submit the requested SBOM.' in row_to_json(a)::text) > 0)));
end $$;

select pg_temp.check('supplier session audit trigger functions are protected',
  not has_function_privilege('anon', 'public.m13_01_audit_supplier_evidence_invitation()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_supplier_evidence_invitation()', 'execute')
  and not has_function_privilege('anon', 'public.m13_01_audit_supplier_sbom_invitation()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_supplier_sbom_invitation()', 'execute')
  and not has_function_privilege('anon', 'public.m13_01_audit_supplier_evidence_failure()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_supplier_evidence_failure()', 'execute'));

rollback;
