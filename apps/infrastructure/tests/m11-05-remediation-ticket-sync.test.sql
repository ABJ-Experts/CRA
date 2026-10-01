\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL %', p_label;
  end if;
  raise notice 'ok %', p_label;
end;
$$;

select pg_temp.check(
  'M11-05 ticket tables are non-forced RLS and browser-private',
  not exists (
    select 1
    from pg_class c
    where c.oid in (
      'public.vulnerability_remediation_ticket_bindings'::regclass,
      'public.vulnerability_remediation_ticket_status_mappings'::regclass,
      'public.vulnerability_remediation_tickets'::regclass,
      'public.vulnerability_remediation_ticket_operations'::regclass,
      'public.vulnerability_remediation_ticket_events'::regclass
    ) and (not c.relrowsecurity or c.relforcerowsecurity
      or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))
  )
);

select pg_temp.check(
  'M11-05 writes use service-role RPCs, not direct table mutation grants',
  has_table_privilege('service_role', 'public.vulnerability_remediation_tickets', 'select')
  and not has_table_privilege('service_role', 'public.vulnerability_remediation_tickets', 'insert')
  and not has_table_privilege('service_role', 'public.vulnerability_remediation_ticket_events', 'insert')
  and has_function_privilege('service_role',
    'public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)', 'execute')
  and has_function_privilege('service_role',
    'public.mark_vulnerability_remediation_ticket_create_attempt_atomic(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.mark_vulnerability_remediation_ticket_create_attempt_atomic(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.mark_vulnerability_remediation_ticket_create_rejected_atomic(uuid,uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.mark_vulnerability_remediation_ticket_create_rejected_atomic(uuid,uuid,uuid,text)', 'execute')
);

select pg_temp.check(
  'M11-05 RPCs pin search_path and remove unsafe legacy entry points',
  not exists (
    select 1
    from pg_proc
    where proname in (
      'list_finding_remediation_tickets',
      'upsert_vulnerability_remediation_ticket_binding_atomic',
      'reserve_vulnerability_remediation_ticket_atomic',
      'finalize_vulnerability_remediation_ticket_atomic',
      'record_verified_vulnerability_ticket_event_atomic',
      'resolve_vulnerability_remediation_ticket_webhook_binding',
      'resolve_vulnerability_remediation_ticket_webhook_ticket',
      'reserve_vulnerability_remediation_ticket_transition_atomic',
      'mark_vulnerability_remediation_ticket_create_attempt_atomic',
      'mark_vulnerability_remediation_ticket_create_rejected_atomic'
    ) and not ('search_path=public, pg_temp' = any(proconfig))
  )
  and to_regprocedure('public.sync_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid)') is null
  and to_regprocedure('public.ingest_vulnerability_remediation_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone)') is null
);

select pg_temp.check(
  'M11-05 binding requires Jira cloud identity and approved field mapping',
  exists (select 1 from pg_constraint where conrelid = 'public.connectors'::regclass
    and conname = 'connectors_connector_type_check'
    and pg_get_constraintdef(oid) like '%jira%')
  and public.m11_valid_connector_config(
    '00000000-0000-4000-8000-0000000000ca'::uuid,
    '{"providerHost":"api.atlassian.com","cloudId":"11111111-1111-4111-8111-111111111111","siteHost":"cra-test.atlassian.net"}'::jsonb)
  and not public.m11_valid_connector_config(
    '00000000-0000-4000-8000-0000000000ca'::uuid,
    '{"providerHost":"api.atlassian.com","cloudId":"11111111-1111-4111-8111-111111111111","siteId":"site-1"}'::jsonb)
  and public.m11_05_valid_ticket_field_mapping('{"summary":"cra","description":"cra","status":"jira"}'::jsonb)
  and not public.m11_05_valid_ticket_field_mapping('{"summary":"jira","description":"cra","status":"jira"}'::jsonb)
  and public.m11_05_valid_custom_field_mappings('[{"fieldId":"customfield_10010","source":"severity"}]'::jsonb)
  and not public.m11_05_valid_custom_field_mappings('[{"fieldId":"summary","source":"severity"}]'::jsonb)
  and public.m11_05_valid_status_mappings('[{"statusId":"3","workState":"open"}]'::jsonb)
  and not public.m11_05_valid_status_mappings('[{"statusId":"3","workState":"fixed"}]'::jsonb)
);

select pg_temp.check(
  'M11-05 ticket identity is pending until verified provider finalize',
  exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'vulnerability_remediation_tickets' and column_name = 'correlation_id')
  and exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'vulnerability_remediation_tickets' and column_name = 'external_issue_id' and is_nullable = 'YES')
  and position('gen_random_uuid()::text' in pg_get_functiondef(
    'public.reserve_vulnerability_remediation_ticket_atomic(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure)) = 0
  and position('record_finding_remediation_anchor_atomic' in pg_get_functiondef(
    'public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid)'::regprocedure)) = 0
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_other_org uuid := gen_random_uuid();
  v_owner uuid;
  v_product uuid;
  v_release uuid;
  v_epoch bigint;
  v_connector uuid;
  v_secret uuid := gen_random_uuid();
  v_binding uuid;
  v_finding uuid := gen_random_uuid();
  v_moved_finding uuid := gen_random_uuid();
  v_equal_finding uuid := gen_random_uuid();
  v_failure_finding uuid := gen_random_uuid();
  v_missing_finding uuid := gen_random_uuid();
  v_legacy_finding uuid := gen_random_uuid();
  v_operation uuid;
  v_context_operation uuid;
  v_ticket uuid;
  v_moved_ticket uuid;
  v_equal_ticket uuid;
  v_failure_ticket uuid;
  v_missing_ticket uuid;
  v_legacy_ticket uuid;
  v_ticket_version integer;
  v_pending_ticket uuid;
  v_pending_operation uuid;
  v_pending_retry_operation uuid;
  v_pending_reserved_ticket uuid;
  v_sync_revision integer;
  v_correlation uuid;
  v_worker uuid := gen_random_uuid();
  v_anchors_before integer;
  v_anchors_after integer;
  v_provider_echo_at timestamptz := now() - interval '30 minutes';
  v_open_event_at timestamptz;
  v_current_ticket jsonb;
  v record;
  v_replay record;
  v_transition jsonb := '[{"fromStatusId":"3","toStatusId":"10001","transitionId":"31"}]'::jsonb;
  v_status_mapping jsonb := '[{"statusId":"3","workState":"open"},{"statusId":"10001","workState":"closed"}]'::jsonb;
  v_custom_mapping jsonb := '[{"fieldId":"customfield_10010","source":"severity"}]'::jsonb;
  v_mapping jsonb := '{"summary":"cra","description":"cra","status":"jira"}'::jsonb;
  v_hash text := repeat('a', 64);
  v_equal_event_at timestamptz;
  v_failure_operation uuid;
  v_retry_after_at timestamptz;
  v_failure_worker uuid := gen_random_uuid();
  v_retry_worker uuid := gen_random_uuid();
  v_missing_correlation uuid;
  v_legacy_operation uuid;
begin
  select id into v_owner from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release
  from public.products p
  join public.product_releases r on r.organization_id = p.organization_id and r.product_id = p.id
  where p.organization_id = v_org
  order by r.created_at
  limit 1;
  select version into v_epoch from public.organization_permissions_version where organization_id = v_org;
  perform pg_temp.check('Seeded owner and product release are available',
    v_owner is not null and v_product is not null and v_release is not null and v_epoch is not null);

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', v_finding,
      'organization_id', v_org,
      'release_id', v_release,
      'component_identity', 'm11-05-' || v_finding::text,
      'status', 'active',
      'superseded_at', null
    ))).*
  from public.vulnerability_findings template
  where template.organization_id = v_org
  limit 1;
  perform pg_temp.check('Finding fixture was cloned without cross-tenant data',
    exists (select 1 from public.vulnerability_findings where organization_id = v_org and id = v_finding));

  select count(*) into v_anchors_before
  from public.vulnerability_finding_remediation_anchors
  where organization_id = v_org and finding_id = v_finding;

  select * into v from public.m11_create_connector_atomic(
    v_org, v_owner, v_epoch, gen_random_uuid(), 'jira', 'M11-05 Jira fixture', '1.0.0', 'tickets-v1',
    '{"providerHost":"api.atlassian.com","cloudId":"11111111-1111-4111-8111-111111111111","siteHost":"cra-test.atlassian.net"}'::jsonb, 'manual');
  v_connector := (v.connector ->> 'id')::uuid;
  perform pg_temp.check('Jira connector is created through existing connector hub',
    v.outcome = 'created' and v_connector is not null);

  insert into public.connector_secrets(id, organization_id, connector_id, ciphertext, encryption_scheme,
    key_id, nonce, auth_tag, credential_revision, rotated_by)
  values (v_secret, v_org, v_connector, decode('abcd','hex'), 'aes_256_gcm_v1', 'test-key',
    decode(repeat('11', 12), 'hex'), decode(repeat('22', 16), 'hex'), 1, v_owner);
  update public.connectors set secret_ref = v_secret where organization_id = v_org and id = v_connector;

  select * into v from public.upsert_vulnerability_remediation_ticket_binding_atomic(
    v_org, v_owner, v_connector, v_product, '11111111-1111-4111-8111-111111111111', '10000', 'CRA', '10001',
    '{"summary":"jira","description":"cra","status":"jira"}'::jsonb, v_custom_mapping, v_transition, v_status_mapping,
    null, null, gen_random_uuid(), v_hash);
  perform pg_temp.check('Unsafe custom field authority is rejected', v.outcome = 'invalid_request');

  select * into v from public.upsert_vulnerability_remediation_ticket_binding_atomic(
    v_org, v_owner, v_connector, v_product, '22222222-2222-4222-8222-222222222222', '10000', 'CRA', '10001',
    v_mapping, v_custom_mapping, v_transition, v_status_mapping, null, null, gen_random_uuid(), v_hash);
  perform pg_temp.check('Binding cannot override the connector cloud identity', v.outcome = 'not_found');

  select * into v from public.upsert_vulnerability_remediation_ticket_binding_atomic(
    v_org, v_owner, v_connector, v_product, '11111111-1111-4111-8111-111111111111', '10000', 'CRA', '10001',
    v_mapping, v_custom_mapping, v_transition, v_status_mapping, null, null, gen_random_uuid(), v_hash);
  v_binding := (v.result -> 'binding' ->> 'id')::uuid;
  perform pg_temp.check('Owner binding is product-scoped and returns stable provider identity',
    v.outcome = 'upserted'
    and (v.result -> 'binding' ->> 'productId')::uuid = v_product
    and v.result -> 'binding' ->> 'providerCloudId' = '11111111-1111-4111-8111-111111111111'
    and v.result -> 'binding' ->> 'providerHost' = 'api.atlassian.com'
    and v.result -> 'binding' ->> 'siteHost' = 'cra-test.atlassian.net'
    and v.result -> 'binding' -> 'fieldMapping' = v_mapping
    and v.result -> 'binding' -> 'customFieldMappings' = v_custom_mapping
    and v.result -> 'binding' -> 'statusMappings' = v_status_mapping);

  select * into v from public.reserve_vulnerability_remediation_ticket_atomic(
    v_other_org, v_owner, v_finding, v_binding, 0, gen_random_uuid(), repeat('b', 64));
  perform pg_temp.check('Tenant substitution cannot reserve a ticket', v.outcome in ('forbidden', 'not_found'));

  select * into v from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_finding, v_binding, 0, gen_random_uuid(), repeat('c', 64));
  v_ticket := v.ticket_id;
  v_operation := v.operation_id;
  v_correlation := v.correlation_id;
  perform pg_temp.check('Reserve creates one pending ticket without external Jira identity',
    v.outcome = 'reserved'
    and v.ticket_id is not null
    and v.operation_id is not null
    and v.correlation_id is not null
    and (v.ticket ->> 'status') = 'sync_pending'
    and (v.ticket ->> 'externalIssueId') is null
    and (v.ticket ->> 'correlationId')::uuid = v.correlation_id);
  perform pg_temp.check('Fresh inline create is not claimable by worker before handoff',
    (select next_attempt_at > clock_timestamp() + interval '4 minutes'
      and (result ->> 'createProtocolVersion')::integer = 1
      from public.vulnerability_remediation_ticket_operations
      where organization_id = v_org and id = v_operation));
  perform pg_temp.check('Reservation carries the exact durable operation timestamp',
    v.ticket ->> 'operationCreatedAt' =
      (select public.m2_utc_z(created_at) from public.vulnerability_remediation_ticket_operations
        where organization_id = v_org and id = v_operation));

  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_finding, v_binding, 0, (select idempotency_key from public.vulnerability_remediation_ticket_operations where id = v_operation), repeat('c', 64));
  perform pg_temp.check('Duplicate reserve replays the same ticket and operation',
    v_replay.outcome = 'replayed' and v_replay.ticket_id = v_ticket and v_replay.operation_id = v_operation
    and v_replay.ticket ->> 'operationCreatedAt' =
      (select public.m2_utc_z(created_at) from public.vulnerability_remediation_ticket_operations
        where organization_id = v_org and id = v_operation));

  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_finding, v_binding, 0, (select idempotency_key from public.vulnerability_remediation_ticket_operations where id = v_operation), repeat('d', 64));
  perform pg_temp.check('Changed reserve digest is rejected', v_replay.outcome = 'idempotency_mismatch');

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', gen_random_uuid(),
      'organization_id', v_org,
      'release_id', v_release,
      'component_identity', 'm11-05-pending-' || gen_random_uuid()::text,
      'status', 'active',
      'superseded_at', null
    ))).* from public.vulnerability_findings template where template.organization_id = v_org limit 1
  returning id into v_pending_ticket;
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_pending_ticket, v_binding, 0, gen_random_uuid(), repeat('1', 64));
  v_pending_operation := v_replay.operation_id;
  v_pending_reserved_ticket := v_replay.ticket_id;
  perform pg_temp.check('Pending create reservation is created once',
    v_replay.outcome = 'reserved'
    and (select operation = 'reserve_outbound' from public.vulnerability_remediation_ticket_operations where id = v_pending_operation));
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_pending_ticket, v_binding, 1, gen_random_uuid(), repeat('2', 64));
  perform pg_temp.check('Pending create cannot reserve a second create before reconciliation',
    v_replay.outcome = 'conflict'
    and (select count(*) = 1 from public.vulnerability_remediation_ticket_operations where ticket_id = (select ticket_id from public.vulnerability_remediation_ticket_operations where id = v_pending_operation) and operation = 'reserve_outbound'));
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_rejected_atomic(
    v_org, v_pending_operation, v_owner, 'http_400');
  perform pg_temp.check('No-create rejection requires a prior durable attempt marker',
    v_replay.outcome = 'conflict'
    and not coalesce((v_replay.operation -> 'result' ->> 'safeNoCreate')::boolean, false));
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
    v_other_org, v_pending_operation, v_owner);
  perform pg_temp.check('Tenant substitution cannot mark provider create attempt', v_replay.outcome = 'not_found');
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
    v_org, v_pending_operation, gen_random_uuid());
  perform pg_temp.check('Actor substitution cannot mark provider create attempt', v_replay.outcome = 'forbidden');
  update public.connectors set credential_revision = credential_revision + 1
  where organization_id = v_org and id = v_connector;
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
    v_org, v_pending_operation, v_owner);
  perform pg_temp.check('Changed credential revision blocks create before POST', v_replay.outcome = 'forbidden');
  update public.connectors set credential_revision = credential_revision - 1
  where organization_id = v_org and id = v_connector;
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
    v_org, v_pending_operation, v_owner);
  perform pg_temp.check('Provider create marker commits before POST with audit',
    v_replay.outcome = 'marked'
    and (v_replay.operation -> 'result' ->> 'providerCreateAttemptedAt') is not null
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and action = 'vulnerability.remediation_ticket_create_attempted'
      and entity_id = v_pending_reserved_ticket::text));
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
    v_org, v_pending_operation, v_owner);
  perform pg_temp.check('Duplicate marker cannot authorize a second POST', v_replay.outcome = 'replayed');
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_rejected_atomic(
    v_org, v_pending_operation, v_owner, 'http_429');
  perform pg_temp.check('Rate limit cannot be called a definitive no-create rejection', v_replay.outcome = 'invalid_request');
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_rejected_atomic(
    v_org, v_pending_operation, v_owner, 'http_400');
  perform pg_temp.check('Definitive HTTP rejection marks no-create and ticket error atomically',
    v_replay.outcome = 'rejected'
    and (v_replay.operation -> 'result' ->> 'safeNoCreate')::boolean
    and (select status = 'sync_error' and conflict_reason = 'sync_failed'
      from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_pending_reserved_ticket)
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and action = 'vulnerability.remediation_ticket_create_rejected'
      and entity_id = v_pending_reserved_ticket::text));
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_rejected_atomic(
    v_org, v_pending_operation, v_owner, 'http_400');
  perform pg_temp.check('Definitive rejection replay is stable', v_replay.outcome = 'replayed');
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_pending_ticket, v_binding,
    (select version from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_pending_reserved_ticket),
    gen_random_uuid(), repeat('3', 64));
  v_pending_retry_operation := v_replay.operation_id;
  perform pg_temp.check('Only proven no-create history allows owner-authorized unlinked retry',
    v_replay.outcome = 'safe_retry_reserved'
    and v_replay.ticket_id = v_pending_reserved_ticket
    and v_replay.operation_id <> v_pending_operation
    and (select count(*) = 2 from public.vulnerability_remediation_ticket_operations where ticket_id = v_pending_reserved_ticket and operation = 'reserve_outbound')
    and (select status = 'sync_pending' and conflict_reason is null from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_pending_reserved_ticket)
    and v_replay.ticket ->> 'operationCreatedAt' =
      (select public.m2_utc_z(created_at) from public.vulnerability_remediation_ticket_operations
        where organization_id = v_org and id = v_replay.operation_id));
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_pending_ticket, v_binding,
    (select version from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_pending_reserved_ticket),
    gen_random_uuid(), repeat('7', 64));
  perform pg_temp.check('Active retry create reservation still blocks blind duplicate create',
    v_replay.outcome = 'conflict'
    and v_replay.ticket_id = v_pending_reserved_ticket
    and (select count(*) = 2 from public.vulnerability_remediation_ticket_operations where ticket_id = v_pending_reserved_ticket and operation = 'reserve_outbound'));
  select * into v_replay from public.mark_vulnerability_remediation_ticket_create_attempt_atomic(
    v_org, v_pending_retry_operation, v_owner);
  perform pg_temp.check('Safe retry still requires a durable marker before its next POST',
    v_replay.outcome = 'marked');
  update public.vulnerability_remediation_ticket_operations
  set next_attempt_at = case when id = v_pending_retry_operation
    then clock_timestamp() - interval '1 second' else clock_timestamp() + interval '1 hour' end
  where organization_id = v_org and state = 'reserved';
  select * into v_replay from public.claim_vulnerability_remediation_ticket_operation_atomic(v_org, v_retry_worker, 120);
  perform pg_temp.check('Worker claims only the timed-out marked retry',
    v_replay.outcome = 'claimed' and (v_replay.operation ->> 'operationId')::uuid = v_pending_retry_operation);
  select * into v_replay from public.fail_vulnerability_remediation_ticket_operation_atomic(
    v_org, v_pending_retry_operation, v_retry_worker, false, 'correlation unresolved');
  perform pg_temp.check('Uncertain provider create failure cannot be declared safe',
    v_replay.outcome = 'failed'
    and not coalesce((v_replay.operation -> 'result' ->> 'safeNoCreate')::boolean, false));
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_pending_ticket, v_binding,
    (select version from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_pending_reserved_ticket),
    gen_random_uuid(), repeat('9', 64));
  perform pg_temp.check('Uncertain create history blocks even after prior safe rejection',
    v_replay.outcome = 'conflict'
    and (select count(*) = 2 from public.vulnerability_remediation_ticket_operations
      where organization_id = v_org and ticket_id = v_pending_reserved_ticket and operation = 'reserve_outbound'));

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', v_legacy_finding, 'organization_id', v_org, 'release_id', v_release,
      'component_identity', 'm11-05-legacy-' || v_legacy_finding::text,
      'status', 'active', 'superseded_at', null
    ))).* from public.vulnerability_findings template where template.organization_id = v_org limit 1;
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_legacy_finding, v_binding, 0, gen_random_uuid(), repeat('a', 64));
  v_legacy_ticket := v_replay.ticket_id;
  v_legacy_operation := v_replay.operation_id;
  update public.vulnerability_remediation_ticket_operations
  set state = 'failed', completed_at = clock_timestamp(),
    result = result - 'createProtocolVersion'
  where organization_id = v_org and id = v_legacy_operation;
  update public.vulnerability_remediation_tickets
  set status = 'sync_error', conflict_reason = 'sync_failed',
    version = version + 1, sync_revision = sync_revision + 1
  where organization_id = v_org and id = v_legacy_ticket;
  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_legacy_finding, v_binding,
    (select version from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_legacy_ticket),
    gen_random_uuid(), repeat('b', 64));
  perform pg_temp.check('Legacy terminal create without no-create proof remains fenced',
    v_replay.outcome = 'conflict'
    and (select count(*) = 1 from public.vulnerability_remediation_ticket_operations
      where organization_id = v_org and ticket_id = v_legacy_ticket and operation = 'reserve_outbound'));

  select * into v_replay from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_ticket, 'delivery-forged', 'evil-1', 'EVIL-1', '10001', 'Done', '10000', now(), v_correlation);
  perform pg_temp.check('Forged or unbound provider issue is recorded but cannot create a ticket',
    v_replay.outcome = 'not_found'
    and v_replay.ticket is null
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and binding_id = v_binding and delivery_id = 'delivery-forged' and outcome = 'unbound')
    and (select count(*) = 1 from public.vulnerability_remediation_tickets where organization_id = v_org and binding_id = v_binding and finding_id = v_finding));

  select * into v from public.finalize_vulnerability_remediation_ticket_atomic(
    v_org, v_ticket, v_operation, '10001', 'CRA-42', '3', 'Open', '10000', now() - interval '1 hour');
  v_ticket_version := (v.ticket ->> 'version')::integer;
  v_open_event_at := (v.ticket ->> 'lastProviderEventAt')::timestamptz;
  perform pg_temp.check('Finalize attaches only verified Jira issue identity',
    v.outcome = 'finalized'
    and (v.ticket ->> 'externalIssueId') = '10001'
    and (v.ticket ->> 'externalIssueKey') = 'CRA-42'
    and (v.ticket ->> 'status') = 'linked'
    and (v.ticket ->> 'externalUrl') = 'https://cra-test.atlassian.net/browse/CRA-42');

  select * into v_replay from public.finalize_vulnerability_remediation_ticket_atomic(
    v_org, v_ticket, v_operation, '10001', 'CRA-42', '3', 'Open', '10000', now() - interval '1 hour');
  perform pg_temp.check('Finalize replay is stable', v_replay.outcome = 'replayed'
    and (v_replay.ticket ->> 'externalIssueId') = '10001');

  select * into v_replay from public.resolve_vulnerability_remediation_ticket_webhook_binding(v_binding);
  perform pg_temp.check('Webhook binding resolver exposes only stable scope identifiers',
    v_replay.outcome = 'found'
    and (v_replay.result ->> 'organizationId')::uuid = v_org
    and (v_replay.result ->> 'bindingId')::uuid = v_binding
    and (v_replay.result ->> 'connectorId')::uuid = v_connector
    and v_replay.result ? 'cloudId'
    and not (v_replay.result ? 'secretRef'));
  select * into v_replay from public.resolve_vulnerability_remediation_ticket_webhook_binding(gen_random_uuid());
  perform pg_temp.check('Unknown webhook binding is not found', v_replay.outcome = 'not_found' and v_replay.result is null);
  select * into v_replay from public.resolve_vulnerability_remediation_ticket_webhook_ticket(v_org, v_binding, '10001');
  perform pg_temp.check('Webhook ticket resolver returns ticket correlation after provider refetch',
    v_replay.outcome = 'found'
    and (v_replay.result ->> 'ticketId')::uuid = v_ticket
    and (v_replay.result ->> 'correlationId')::uuid = v_correlation);
  select * into v_replay from public.resolve_vulnerability_remediation_ticket_webhook_ticket(gen_random_uuid(), v_binding, '10001');
  perform pg_temp.check('Webhook ticket resolver rejects tenant substitution', v_replay.outcome = 'not_found' and v_replay.result is null);

  select * into v_replay from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_finding, v_binding, v_ticket_version, gen_random_uuid(), repeat('e', 64));
  v_operation := v_replay.operation_id;
  v_context_operation := v_replay.operation_id;
  perform pg_temp.check('Existing linked ticket reserve queues context sync instead of duplicate create',
    v_replay.outcome = 'sync_reserved'
    and v_replay.ticket_id = v_ticket
    and (select operation = 'sync_context' from public.vulnerability_remediation_ticket_operations where id = v_replay.operation_id)
    and (select count(*) = 1 from public.vulnerability_remediation_tickets where organization_id = v_org and binding_id = v_binding and finding_id = v_finding)
    and (select count(*) = 1 from public.vulnerability_remediation_ticket_operations where ticket_id = v_ticket and operation = 'reserve_outbound'));
  perform pg_temp.check('Linked context sync remains immediately due for worker',
    (select next_attempt_at <= clock_timestamp()
      from public.vulnerability_remediation_ticket_operations
      where organization_id = v_org and id = v_context_operation));

  perform pg_temp.check('Existing linked ticket sync operation remains durable for worker claim',
    exists (select 1 from public.vulnerability_remediation_ticket_operations
      where organization_id = v_org and id = v_context_operation
        and operation = 'sync_context' and state = 'reserved'));
  select public.m11_05_ticket_json(v_org, v_ticket) into v_current_ticket;

  v_sync_revision := (v_current_ticket ->> 'syncRevision')::integer;
  select last_provider_event_at into v_provider_echo_at
  from public.vulnerability_remediation_tickets
  where organization_id = v_org and id = v_ticket;
  select * into v_replay from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_ticket, 'delivery-echo', '10001', 'CRA-42', '3', 'Open', '10000', v_provider_echo_at, v_correlation);
  perform pg_temp.check('Echoed provider notification is durable but does not bump revision',
    v_replay.outcome = 'recorded'
    and (v_replay.ticket ->> 'status') = 'linked'
    and (v_replay.ticket ->> 'syncRevision')::integer = v_sync_revision
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and binding_id = v_binding and delivery_id = 'delivery-echo'));

  select * into v_replay from public.reserve_vulnerability_remediation_ticket_transition_atomic(
    v_org, v_owner, v_finding, v_ticket, (v_current_ticket ->> 'version')::integer, '10001', gen_random_uuid());
  v_operation := v_replay.operation_id;
  perform pg_temp.check('Configured transition reservation returns durable operation and transition id',
    v_replay.outcome = 'reserved'
    and v_replay.ticket_id = v_ticket
    and v_replay.operation_id is not null
    and v_replay.correlation_id = v_correlation
    and v_replay.transition_id = '31');
  select * into v from public.reserve_vulnerability_remediation_ticket_transition_atomic(
    v_org, v_owner, v_finding, v_ticket, (v_current_ticket ->> 'version')::integer, '10001',
    (select idempotency_key from public.vulnerability_remediation_ticket_operations where id = v_operation));
  perform pg_temp.check('Transition reservation replay returns same operation and target',
    v.outcome = 'replayed' and v.operation_id = v_operation and v.transition_id = '31');
  select * into v from public.reserve_vulnerability_remediation_ticket_transition_atomic(
    v_org, v_owner, v_finding, v_ticket, (v_current_ticket ->> 'version')::integer, '999',
    (select idempotency_key from public.vulnerability_remediation_ticket_operations where id = v_operation));
  perform pg_temp.check('Changed transition idempotency payload conflicts', v.outcome = 'idempotency_mismatch');

  perform pg_temp.check('Tenant fair operation listing includes due organization',
    exists (select 1 from public.list_due_vulnerability_remediation_ticket_operation_orgs(10) due
      where due.organization_id = v_org and due.due_count >= 1));
  select * into v from public.claim_vulnerability_remediation_ticket_operation_atomic(v_org, v_worker, 120);
  perform pg_temp.check('Worker claim carries actor and scoped revalidation context without secrets',
    v.outcome = 'claimed'
    and (v.operation ->> 'operationId')::uuid = v_context_operation
    and (v.operation ->> 'actorUserId')::uuid = v_owner
    and (v.operation -> 'context' ->> 'connectorId')::uuid = v_connector
    and (v.operation -> 'context' ->> 'bindingId')::uuid = v_binding
    and (v.operation -> 'context' ->> 'ticketId')::uuid = v_ticket
    and (v.operation -> 'context' ->> 'ticketCorrelationId')::uuid = v_correlation
    and (v.operation -> 'context' ->> 'productId')::uuid = v_product
    and v.operation -> 'context' ->> 'cloudId' = '11111111-1111-4111-8111-111111111111'
    and not (v.operation::text ~* '(secret|ciphertext|auth_tag|nonce)'));
  select * into v from public.resolve_vulnerability_remediation_ticket_worker_context(v_org, v_context_operation);
  perform pg_temp.check('Worker context resolver revalidates scoped operation context',
    v.outcome = 'found'
    and (v.result ->> 'actorId')::uuid = v_owner
    and v.result ->> 'operationCreatedAt' =
      (select public.m2_utc_z(created_at) from public.vulnerability_remediation_ticket_operations
        where organization_id = v_org and id = v_context_operation)
    and (v.result -> 'ticket' ->> 'id')::uuid = v_ticket
    and (v.result -> 'binding' ->> 'id')::uuid = v_binding
    and (v.result ->> 'connectorConnectionRevision')::integer =
      (select connector_connection_revision from public.vulnerability_remediation_ticket_operations
        where organization_id = v_org and id = v_context_operation)
    and not (v.result::text ~* '(secret|ciphertext|auth_tag|nonce)'));
  select * into v from public.resolve_vulnerability_remediation_ticket_worker_context(gen_random_uuid(), v_context_operation);
  perform pg_temp.check('Worker context resolver rejects tenant substitution', v.outcome = 'not_found');
  select * into v from public.complete_vulnerability_remediation_ticket_operation_atomic(
    v_org, v_context_operation, v_worker, '{"providerAction":"context_synced"}'::jsonb);
  perform pg_temp.check('Completed context sync updates ticket sync metadata and audits atomically',
    v.outcome = 'completed'
    and (v.operation ->> 'state') = 'completed'
    and exists (select 1 from public.vulnerability_remediation_tickets
      where organization_id = v_org and id = v_ticket
        and status = 'linked' and last_sync_direction = 'outbound' and conflict_reason is null)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org
        and action = 'vulnerability.remediation_ticket_operation_completed'
        and entity_id = v_ticket::text
        and changes ->> 'operationId' = v_context_operation::text));

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', v_failure_finding,
      'organization_id', v_org,
      'release_id', v_release,
      'component_identity', 'm11-05-failure-' || v_failure_finding::text,
      'status', 'active',
      'superseded_at', null
    ))).* from public.vulnerability_findings template where template.organization_id = v_org limit 1;
  select * into v from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_failure_finding, v_binding, 0, gen_random_uuid(), repeat('6', 64));
  v_failure_ticket := v.ticket_id;
  v_failure_operation := v.operation_id;
  update public.vulnerability_remediation_ticket_operations
  set next_attempt_at = case when id = v_failure_operation
    then clock_timestamp() - interval '1 second' else clock_timestamp() + interval '1 hour' end
  where organization_id = v_org and state = 'reserved';
  select * into v from public.claim_vulnerability_remediation_ticket_operation_atomic(v_org, v_failure_worker, 120);
  perform pg_temp.check('Failure fixture reserves and claims outbound operation',
    v.outcome = 'claimed' and (v.operation ->> 'operationId')::uuid = v_failure_operation);
  select * into v from public.fail_vulnerability_remediation_ticket_operation_atomic(
    v_org, v_failure_operation, v_failure_worker, true, 'provider timeout with no secrets', 120);
  select next_attempt_at into v_retry_after_at
  from public.vulnerability_remediation_ticket_operations
  where organization_id = v_org and id = v_failure_operation;
  perform pg_temp.check('Retryable worker failure honors bounded Retry-After and leaves safe pending ticket',
    v.outcome = 'retry_scheduled'
    and (v.operation -> 'result' ->> 'retryAfterSeconds')::integer = 120
    and v_retry_after_at >= clock_timestamp() + interval '100 seconds'
    and v_retry_after_at <= clock_timestamp() + interval '130 seconds'
    and (select status = 'sync_pending' and conflict_reason is null
      from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_failure_ticket)
    and not exists (select 1 from public.vulnerability_remediation_tickets
      where organization_id = v_org and id = v_failure_ticket and coalesce(conflict_reason,'') like '%provider timeout%'));
  update public.vulnerability_remediation_ticket_operations
  set lease_owner = v_failure_worker, lease_expires_at = clock_timestamp() + interval '2 minutes'
  where organization_id = v_org and id = v_failure_operation;
  select * into v from public.fail_vulnerability_remediation_ticket_operation_atomic(
    v_org, v_failure_operation, v_failure_worker, true, 'provider timeout with no secrets', 3601);
  perform pg_temp.check('Out of bounds Retry-After is rejected without changing operation', v.outcome = 'invalid_request');
  update public.vulnerability_remediation_ticket_operations
  set lease_owner = v_failure_worker, lease_expires_at = clock_timestamp() + interval '2 minutes', attempt_count = 5
  where organization_id = v_org and id = v_failure_operation;
  select * into v from public.fail_vulnerability_remediation_ticket_operation_atomic(
    v_org, v_failure_operation, v_failure_worker, true, 'provider timeout with no secrets');
  perform pg_temp.check('Permanent worker failure marks ticket sync error with safe reason and audit',
    v.outcome = 'failed'
    and (v.operation -> 'result' ->> 'safeNoCreate')::boolean
    and (select status = 'sync_error' and conflict_reason = 'sync_failed'
      from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_failure_ticket)
    and exists (select 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_failure_ticket::text
        and action = 'vulnerability.remediation_ticket_sync_failed'));

  select * into v from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_ticket, 'delivery-close', '10001', 'CRA-42', '10001', 'Done', '10000', now(), v_correlation);
  v_sync_revision := (v.ticket ->> 'syncRevision')::integer;
  perform pg_temp.check('External closure is a pending review signal, not remediation proof',
    v.outcome = 'recorded'
    and (v.ticket ->> 'status') = 'external_closed_pending_review');

  select * into v_replay from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_ticket, 'delivery-close', '10001', 'CRA-42', '10001', 'Done', '10000', now(), v_correlation);
  perform pg_temp.check('Duplicate provider notification does not oscillate state',
    v_replay.outcome = 'duplicate'
    and (v_replay.ticket ->> 'syncRevision')::integer = v_sync_revision);

  select * into v_replay from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_ticket, 'delivery-stale', '10001', 'CRA-42', '3', 'Open', '10000', now() - interval '2 days', v_correlation);
  perform pg_temp.check('Out-of-order older provider event is ignored as stale',
    v_replay.outcome = 'stale'
    and (v_replay.ticket ->> 'status') = 'external_closed_pending_review');

  select * into v from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_ticket, 'delivery-unknown', '10001', 'CRA-42', '999', 'Mystery', '10000', now() + interval '1 minute', v_correlation);
  perform pg_temp.check('Unknown external status is surfaced as conflict',
    v.outcome = 'unknown_status'
    and (v.ticket ->> 'status') = 'conflict'
    and (v.ticket ->> 'conflictReason') = 'unknown_external_status');

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', v_missing_finding,
      'organization_id', v_org,
      'release_id', v_release,
      'component_identity', 'm11-05-missing-' || v_missing_finding::text,
      'status', 'active',
      'superseded_at', null
    ))).* from public.vulnerability_findings template where template.organization_id = v_org limit 1;
  select * into v from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_missing_finding, v_binding, 0, gen_random_uuid(), repeat('8', 64));
  v_missing_ticket := v.ticket_id;
  select * into v from public.finalize_vulnerability_remediation_ticket_atomic(
    v_org, v_missing_ticket, v.operation_id, '40001', 'CRA-45', '3', 'Open', '10000', now() - interval '15 minutes');
  v_missing_correlation := (v.ticket ->> 'correlationId')::uuid;
  select * into v_replay from public.record_missing_vulnerability_ticket_event_atomic(
    gen_random_uuid(), v_binding, v_missing_ticket, v_missing_correlation, 'delivery-missing-tenant', '40001');
  perform pg_temp.check('Missing issue RPC rejects tenant substitution',
    v_replay.outcome = 'not_found' and v_replay.result is null);
  select * into v_replay from public.record_missing_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_missing_ticket, gen_random_uuid(), 'delivery-missing-bad-correlation', '40001');
  perform pg_temp.check('Missing issue RPC rejects correlation mismatch without changing ticket',
    v_replay.outcome = 'conflict'
    and v_replay.result ->> 'reason' = 'identity_mismatch'
    and (select status = 'linked' from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_missing_ticket)
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and delivery_id = 'delivery-missing-bad-correlation' and outcome = 'unbound'));
  select * into v_replay from public.record_missing_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_missing_ticket, v_missing_correlation, 'delivery-missing-wrong-issue', 'OTHER-40001');
  perform pg_temp.check('Missing issue RPC rejects stable issue mismatch',
    v_replay.outcome = 'conflict'
    and v_replay.result ->> 'reason' = 'identity_mismatch'
    and (select status = 'linked' from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_missing_ticket)
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and delivery_id = 'delivery-missing-wrong-issue' and outcome = 'unbound'));
  select * into v_replay from public.record_missing_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_missing_ticket, v_missing_correlation, 'delivery-missing-ok', '40001');
  perform pg_temp.check('Authoritative missing provider issue marks ticket deleted or moved with audit',
    v_replay.outcome = 'moved'
    and (v_replay.result ->> 'status') = 'deleted_or_moved'
    and (v_replay.result ->> 'conflictReason') = 'provider_issue_missing'
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and binding_id = v_binding and ticket_id = v_missing_ticket
        and delivery_id = 'delivery-missing-ok' and outcome = 'moved')
    and exists (select 1 from public.audit_logs
      where organization_id = v_org and action = 'vulnerability.remediation_ticket_issue_missing'
        and entity_id = v_missing_ticket::text));
  select * into v_replay from public.record_missing_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_missing_ticket, v_missing_correlation, 'delivery-missing-ok', '40001');
  perform pg_temp.check('Duplicate missing issue delivery is idempotent',
    v_replay.outcome = 'duplicate'
    and (v_replay.result ->> 'status') = 'deleted_or_moved');

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', v_moved_finding,
      'organization_id', v_org,
      'release_id', v_release,
      'component_identity', 'm11-05-moved-' || v_moved_finding::text,
      'status', 'active',
      'superseded_at', null
    ))).* from public.vulnerability_findings template where template.organization_id = v_org limit 1;
  select * into v from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_moved_finding, v_binding, 0, gen_random_uuid(), repeat('4', 64));
  v_moved_ticket := v.ticket_id;
  select * into v from public.finalize_vulnerability_remediation_ticket_atomic(
    v_org, v_moved_ticket, v.operation_id, '20001', 'CRA-43', '3', 'Open', '10000', now() - interval '20 minutes');
  select * into v_replay from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_moved_ticket, 'delivery-moved-project', '20001', 'OTHER-43', '3', 'Open', '20000', now() - interval '19 minutes',
    (v.ticket ->> 'correlationId')::uuid);
  perform pg_temp.check('Verified same issue in a different Jira project is marked deleted or moved',
    v_replay.outcome = 'moved'
    and (v_replay.ticket ->> 'status') = 'deleted_or_moved'
    and (v_replay.ticket ->> 'conflictReason') = 'provider_project_changed'
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and binding_id = v_binding and delivery_id = 'delivery-moved-project' and outcome = 'moved')
    and exists (select 1 from public.audit_logs
      where organization_id = v_org and action = 'vulnerability.remediation_ticket_deleted_or_moved'
        and entity_id = v_moved_ticket::text));

  insert into public.vulnerability_findings
  select (jsonb_populate_record(null::public.vulnerability_findings,
    to_jsonb(template) || jsonb_build_object(
      'id', v_equal_finding,
      'organization_id', v_org,
      'release_id', v_release,
      'component_identity', 'm11-05-equal-' || v_equal_finding::text,
      'status', 'active',
      'superseded_at', null
    ))).* from public.vulnerability_findings template where template.organization_id = v_org limit 1;
  select * into v from public.reserve_vulnerability_remediation_ticket_atomic(
    v_org, v_owner, v_equal_finding, v_binding, 0, gen_random_uuid(), repeat('5', 64));
  v_equal_ticket := v.ticket_id;
  v_equal_event_at := now() - interval '10 minutes';
  select * into v from public.finalize_vulnerability_remediation_ticket_atomic(
    v_org, v_equal_ticket, v.operation_id, '30001', 'CRA-44', '3', 'Open', '10000', v_equal_event_at);
  v_sync_revision := (v.ticket ->> 'syncRevision')::integer;
  select * into v_replay from public.record_verified_vulnerability_ticket_event_atomic(
    v_org, v_binding, v_equal_ticket, 'delivery-equal-conflict', '30001', 'CRA-44', '10001', 'Done', '10000', v_equal_event_at,
    (v.ticket ->> 'correlationId')::uuid);
  perform pg_temp.check('Equal provider timestamp with changed state is a conflict and cannot oscillate',
    v_replay.outcome = 'conflict'
    and (v_replay.ticket ->> 'status') = 'conflict'
    and (v_replay.ticket ->> 'conflictReason') = 'provider_equal_timestamp_conflict'
    and (v_replay.ticket ->> 'syncRevision')::integer = v_sync_revision + 1
    and exists (select 1 from public.vulnerability_remediation_ticket_events
      where organization_id = v_org and binding_id = v_binding and delivery_id = 'delivery-equal-conflict' and outcome = 'conflict'));

  select count(*) into v_anchors_after
  from public.vulnerability_finding_remediation_anchors
  where organization_id = v_org and finding_id = v_finding;
  perform pg_temp.check('Jira closure did not create or approve remediation anchors',
    v_anchors_after = v_anchors_before);

  perform pg_temp.check('Ticket correlation remains stable through sync lifecycle',
    (select correlation_id = v_correlation from public.vulnerability_remediation_tickets where organization_id = v_org and id = v_ticket));
end $$;
rollback;
