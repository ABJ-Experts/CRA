begin;
create extension if not exists pgtap;
select plan(29);

select has_table('public','supplier_evidence_reminder_deliveries','M9-04 uses a dedicated durable reminder ledger');
select has_column('public','organization_settings','supplier_evidence_reminder_offsets_hours','organization settings retain reminder cadence');
select has_column('public','organization_settings','supplier_evidence_reminders_version','settings use optimistic concurrency');
select col_is_pk('public','supplier_evidence_reminder_deliveries','id','delivery has an immutable primary key');
select ok(exists(select 1 from pg_constraint where conrelid='public.supplier_evidence_reminder_deliveries'::regclass and pg_get_constraintdef(oid)='UNIQUE (organization_id, revision_id, due_at_snapshot, offset_hours, recipient_kind)'),'logical reminder dedupe includes the immutable due-date snapshot');
select ok((select relrowsecurity from pg_class where oid='public.supplier_evidence_reminder_deliveries'::regclass),'reminder ledger has RLS enabled');
select ok(not has_table_privilege('authenticated','public.supplier_evidence_reminder_deliveries','select'),'authenticated users cannot directly read the ledger');

select ok(public.m9_04_reminder_offsets_valid(array[-168,-24,24]),'default cadence is valid');
select ok(not public.m9_04_reminder_offsets_valid(array[-24,-24,24]),'duplicate cadence offsets are rejected');
select ok(not public.m9_04_reminder_offsets_valid(array[-24]),'a cadence requires an overdue escalation offset');
select ok(not public.m9_04_reminder_offsets_valid(array[0,24]),'zero offset is rejected');

select ok(to_regprocedure('public.get_supplier_evidence_reminder_settings_atomic(uuid,uuid)') is not null,'settings read RPC exists');
select ok(to_regprocedure('public.update_supplier_evidence_reminder_settings_atomic(uuid,uuid,integer,integer[],uuid)') is not null,'settings update RPC exists');
select ok(to_regprocedure('public.reconcile_supplier_evidence_reminders_atomic(uuid,uuid)') is not null,'durable reconciliation RPC exists');
select ok(to_regprocedure('public.list_supplier_evidence_reminder_organization_ids_atomic(uuid,integer)') is not null,'bounded organization traversal RPC exists');
select ok(to_regprocedure('public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)') is not null,'worker claim RPC exists');
select ok(to_regprocedure('public.prepare_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text)') is not null,'prepare RPC accepts only a token hash');
select ok(to_regprocedure('public.complete_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text,text)') is not null,'completion RPC records provider outcome');
select ok(to_regprocedure('public.retry_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,uuid,integer,uuid)') is not null,'manual retry RPC verifies the nested request id and optimistic version');
select ok(to_regprocedure('public.get_supplier_evidence_response_metrics_atomic(uuid,uuid,timestamptz,timestamptz,uuid,uuid)') is not null,'tenant-scoped metrics RPC exists');
select ok(to_regprocedure('public.list_supplier_evidence_overdue_atomic(uuid,uuid,uuid,uuid,integer,uuid)') is not null,'overdue drill-down RPC exists');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)'::regprocedure),'claim RPC has pinned security-definer search path');
select ok(has_function_privilege('service_role','public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)','execute') and not has_function_privilege('authenticated','public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)','execute'),'worker RPC is service-role-only');
select ok(position('q.current_revision_id<>d.revision_id' in pg_get_functiondef('public.reconcile_supplier_evidence_reminders_atomic(uuid,uuid)'::regprocedure))>0,'reconciliation obsoletes prior revisions');
select ok(position('clock_timestamp()>=d.due_at_snapshot' in pg_get_functiondef('public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)'::regprocedure))>0,'catch-up does not flood missed pre-due reminders');
select ok(position('p_token_hash !~ ''^[a-f0-9]{64}$''' in pg_get_functiondef('public.prepare_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text)'::regprocedure))>0,'supplier reminder preparation validates token hashes before persistence');
select ok(position('m9_04_active_owner' in pg_get_functiondef('public.reconcile_supplier_evidence_reminders_atomic(uuid,uuid)'::regprocedure))>0,'overdue escalation uses deterministic active-owner fallback');
select ok(position('sent_at>clock_timestamp()-interval ''24 hours''' in pg_get_functiondef('public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer)'::regprocedure))>0,'claim enforces the delivered supplier reminder frequency bound');
select ok(position('v.finalized_at>=c.delivered_at' in pg_get_functiondef('public.get_supplier_evidence_response_metrics_atomic(uuid,uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure))>0,'turnaround excludes evidence finalized before invitation delivery');

select * from finish();
rollback;
