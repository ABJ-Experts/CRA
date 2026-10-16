begin;
create extension if not exists pgtap;
select plan(21);

select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='supplier_evidence_request_items' and column_name='sbom_supplier_request_id'), 'M9 checklist item links one M3 request');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='sbom_supplier_invitations' and column_name='m9_invitation_id'), 'M3 grant binds the M9 invitation');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='sbom_supplier_invitations' and column_name='m9_request_item_id'), 'M3 grant binds the M9 item');
select ok(exists(select 1 from pg_constraint where conrelid='public.supplier_evidence_request_items'::regclass and contype='f' and pg_get_constraintdef(oid) like '%sbom_supplier_request_id%'), 'M3 request link has scoped foreign key');
select ok(exists(select 1 from pg_constraint where conrelid='public.sbom_supplier_invitations'::regclass and contype='f' and pg_get_constraintdef(oid) like '%m9_invitation_id%'), 'M3 grant has scoped M9 foreign key');
select ok(exists(select 1 from pg_constraint where conrelid='public.sbom_supplier_invitations'::regclass and contype='f' and pg_get_constraintdef(oid) like '%m9_request_item_id%'), 'M3 grant has scoped M9 item foreign key');
select ok(to_regprocedure('public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text)') is not null, 'narrow linked session activation exists');
select ok(not has_function_privilege('anon','public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text)','execute'), 'anonymous cannot activate linked M3 session');
select ok(not has_function_privilege('authenticated','public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text)','execute'), 'authenticated cannot activate linked M3 session');
select ok(has_function_privilege('service_role','public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text)','execute'), 'service role can activate linked M3 session');
select is((select outcome from public.activate_supplier_evidence_sbom_session_atomic(repeat('0',64),gen_random_uuid(),repeat('1',64))), 'not_found', 'guessed session cannot activate M3');
select ok(position('m9_06_link_active' in pg_get_functiondef('public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text)'::regprocedure))>0, 'M3 reservation rechecks linked M9 session');
select ok(position('m9_06_link_active' in pg_get_functiondef('public.get_supplier_sbom_submission_upload(text,uuid,uuid)'::regprocedure))>0, 'M3 upload inspection rechecks linked M9 session');
select ok(position('m9_06_link_active' in pg_get_functiondef('public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid)'::regprocedure))>0, 'M3 finalization rechecks linked M9 session');
select ok(position('m9_06_validate_link' in pg_get_functiondef('public.m9_02_validate_draft(uuid,uuid,jsonb)'::regprocedure))>0, 'M9 draft validates scoped M3 request');
select ok(exists(select 1 from pg_trigger where tgrelid='public.supplier_evidence_invitations'::regclass and tgname='m9_06_bind_grants_after_issue'), 'M9 issue binds M3 grants atomically');
select ok(position('document_class=''sbom''' in pg_get_functiondef('public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamp with time zone,uuid,text)'::regprocedure))>0, 'legacy evidence upload refuses SBOM items');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='sbom_supplier_submissions' and column_name='validation_message'), 'component mismatch has bounded supplier-safe guidance');
select ok(exists(select 1 from pg_trigger where tgrelid='public.sbom_supplier_submissions'::regclass and tgname='m9_06_sync_completed_alias_after_processing'), 'completed deduplicated source leaves processing');
select ok(position('accepted_submission.status=''accepted''' in replace(pg_get_functiondef('public.validate_sbom_composite_scope(uuid,uuid,uuid,uuid,jsonb)'::regprocedure),' ',''))>0, 'composite scope admits only accepted supplier aliases');
select ok(position('accepted_submission.status=''accepted''' in replace(pg_get_functiondef('public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)'::regprocedure),' ',''))>0, 'composite source persists accepted alias provenance');

select * from finish();
rollback;
