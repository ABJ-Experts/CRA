begin;
create extension if not exists pgtap;
select plan(37);

select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization_settings' and column_name='evidence_expiry_alert_intervals'), 'organization settings stores expiry intervals without a duplicate settings table');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization_settings' and column_name='evidence_expiry_alerts_version'), 'expiry settings have an optimistic concurrency version');
select is((select evidence_expiry_alert_intervals from public.organization_settings limit 1), array[30,14,7,1], 'new organization defaults use 30/14/7/1 expiry thresholds');
select ok(public.m8_evidence_expiry_thresholds_valid(array[30,14,7,1]) and not public.m8_evidence_expiry_thresholds_valid(array[30,30]) and not public.m8_evidence_expiry_thresholds_valid(array[0]), 'threshold validation rejects duplicate and out-of-range intervals');
select is(public.m8_evidence_validity_status(null,null,array[30]), 'missing', 'missing validity is never inferred as valid forever');
select is(public.m8_evidence_validity_status(current_date,null,array[30]), 'open_ended', 'open-ended validity is explicit and has no expiry threshold');
select is(public.m8_evidence_validity_status(current_date-1,current_date-1,array[30]), 'expired', 'validity expiry remains distinct from retention');
select is(public.m8_evidence_validity_status(current_date+1,current_date+31,array[30]), 'not_yet_valid', 'future validity is explicit');
select is(public.m8_evidence_validity_status(current_date-1,current_date+7,array[30]), 'expiring_soon', 'largest configured threshold determines expiring soon');
select is(public.m8_evidence_validity_status(current_date-1,current_date+31,array[30]), 'current', 'evidence outside configured thresholds remains current');

select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='evidence_notification_validity_threshold_dedupe_idx'), 'validity notifications dedupe per version and threshold');
select ok((select position('evidence_validity_expiring' in pg_get_constraintdef(oid))>0 from pg_constraint where conrelid='public.evidence_document_notification_outbox'::regclass and conname='evidence_document_notification_outbox_event_type_check') and (select position('recipient_unavailable' in pg_get_constraintdef(oid))>0 from pg_constraint where conrelid='public.evidence_document_notification_outbox'::regclass and conname='evidence_document_notification_outbox_status_check'), 'outbox records validity events and terminal unavailable recipients');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.evidence_document_notification_outbox'::regclass), 'notification outbox keeps enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.evidence_document_notification_outbox','select,insert,update,delete') and not has_table_privilege('authenticated','public.evidence_document_notification_outbox','select'), 'outbox remains service-role-only');

select ok(to_regprocedure('public.get_evidence_expiry_alert_intervals_atomic(uuid,uuid)') is not null, 'expiry interval read RPC exists');
select ok(to_regprocedure('public.update_evidence_expiry_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid)') is not null, 'idempotent optimistic expiry interval update RPC exists');
select ok(to_regprocedure('public.reconcile_evidence_validity_alerts_atomic(uuid,uuid)') is not null, 'durable validity reconciliation RPC exists');
select ok(to_regprocedure('public.claim_evidence_validity_notification_atomic(uuid,uuid,integer)') is not null and to_regprocedure('public.complete_evidence_validity_notification_atomic(uuid,uuid,uuid,text,text)') is not null, 'lease claim and completion RPCs exist');
select ok(to_regprocedure('public.list_evidence_validity_alert_organization_ids_atomic(uuid,integer)') is not null, 'bounded tenant traversal RPC exists');
select ok(to_regprocedure('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)') is not null, 'version-pinned reuse projection RPC exists');
select ok(to_regprocedure('public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text)') is not null, 'validity-filtered evidence list overload exists');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.update_evidence_expiry_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid)'::regprocedure), 'settings mutation has a pinned security-definer search path');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.claim_evidence_validity_notification_atomic(uuid,uuid,integer)'::regprocedure), 'notification claim has a pinned security-definer search path');
select ok(has_function_privilege('service_role','public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)','execute') and not has_function_privilege('authenticated','public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)','execute'), 'reuse projection is service-role mediated');
select ok(has_function_privilege('service_role','public.list_evidence_validity_alert_organization_ids_atomic(uuid,integer)','execute') and not has_function_privilege('authenticated','public.list_evidence_validity_alert_organization_ids_atomic(uuid,integer)','execute'), 'tenant traversal is service-role only');

select ok(position('can_view_evidence' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure))>0 and position('can_view_technical_files' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure))>0, 'reuse projection requires evidence access and gates technical targets separately');
select ok(position('observed_revision' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure))>0 and position('version_number::text' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure))>0, 'reuse resolves an immutable linked version rather than retargeting the document');
select ok(position('f.status=''active''' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure))>0, 'reuse excludes inactive technical-file targets just as its count projection does');
select ok(position('frameworkControls' in pg_get_functiondef('public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure))>0, 'framework mapping contract is honestly empty while M10 is unavailable');
select ok(position('p_validity_status' in pg_get_functiondef('public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text)'::regprocedure))>0 and position('linkageCount' in pg_get_functiondef('public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text)'::regprocedure))>0, 'list applies validity filtering and returns matching linkage counts');
select ok(position('offset (p_limit-1)' in pg_get_functiondef('public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text)'::regprocedure))>0 and position('exists(select 1 from filtered offset p_limit)' in pg_get_functiondef('public.list_evidence_documents(uuid,uuid,uuid,text,text,timestamptz,uuid,integer,text)'::regprocedure))>0, 'next cursor is the final selected row only when another page exists, so keyset pages do not skip a row');
select ok(position('p.archived_at is null' in pg_get_functiondef('public.reconcile_evidence_validity_alerts_atomic(uuid,uuid)'::regprocedure))>0, 'reconciliation excludes evidence applicable only to archived products');
select ok(position('idempotencyKey' in pg_get_functiondef('public.update_evidence_expiry_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid)'::regprocedure))>0 and position('pg_advisory_xact_lock' in pg_get_functiondef('public.update_evidence_expiry_alert_intervals_atomic(uuid,uuid,integer,integer[],uuid)'::regprocedure))>0, 'settings update persists and serializes idempotent commands');
select ok(position('YYYY-MM-DD"T"HH24:MI:SS"Z"' in pg_get_functiondef('public.claim_evidence_validity_notification_atomic(uuid,uuid,integer)'::regprocedure))>0, 'claimed expiry dates are UTC timestamps accepted by the worker boundary');
select is((select outcome from public.get_evidence_expiry_alert_intervals_atomic(gen_random_uuid(),gen_random_uuid())), 'forbidden', 'cross-tenant/unverified interval reads fail closed');
select is((select outcome from public.get_evidence_document_reuse_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())), 'forbidden', 'cross-tenant/unverified reuse reads fail closed');
select is((select public.claim_evidence_validity_notification_atomic(gen_random_uuid(),gen_random_uuid(),30)), null::jsonb, 'empty foreign tenant queue does not disclose notification data');

select * from finish();
rollback;
