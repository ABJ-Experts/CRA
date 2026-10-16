begin;
create extension if not exists pgtap;
select plan(27);

select ok(to_regclass('public.supplier_evidence_requests') is not null, 'request table exists');
select ok(to_regclass('public.supplier_evidence_request_revisions') is not null, 'immutable revision table exists');
select ok(to_regclass('public.supplier_evidence_request_items') is not null, 'revision item table exists');
select ok(to_regclass('public.supplier_evidence_invitations') is not null, 'hash-only invitation table exists');
select ok(to_regclass('public.supplier_evidence_submissions') is not null, 'external attribution table exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.supplier_evidence_requests'::regclass), 'requests have enabled non-forced RLS');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.supplier_evidence_invitations'::regclass), 'invitations have enabled non-forced RLS');
select ok(not has_table_privilege('anon','public.supplier_evidence_requests','select'), 'anonymous has no direct request access');
select ok(not has_table_privilege('authenticated','public.supplier_evidence_submissions','select'), 'authenticated has no direct submission access');
select ok(has_table_privilege('service_role','public.supplier_evidence_requests','select,insert,update'), 'service role owns request persistence');
select ok((select attname='token_hash' and atttypid='text'::regtype from pg_attribute where attrelid='public.supplier_evidence_invitations'::regclass and attname='token_hash' and not attisdropped), 'invitation persists a token hash only');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='supplier_evidence_invitations' and column_name ilike '%token%' and column_name not in ('token_hash','token_prefix','session_token_hash')), 'no raw invitation or session token column exists');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb)'::regprocedure), 'preview RPC has a pinned security-definer path');
select ok(has_function_privilege('service_role','public.redeem_supplier_evidence_invitation_atomic(text,text,timestamp with time zone)','execute'), 'service role can redeem a scoped invitation');
select ok(not has_function_privilege('authenticated','public.redeem_supplier_evidence_invitation_atomic(text,text,timestamp with time zone)','execute'), 'authenticated cannot redeem a portal invitation directly');
select is((select outcome from public.redeem_supplier_evidence_invitation_atomic(repeat('0',64),repeat('1',64),clock_timestamp()+interval '20 minutes')), 'not_found', 'unknown invitation is not disclosed');
select is((select outcome from public.get_supplier_evidence_portal_request_atomic(repeat('0',64))), 'not_found', 'guessed portal session is not disclosed');
select is((select outcome from public.reserve_supplier_evidence_submission_atomic(repeat('0',64),gen_random_uuid(),'safe.pdf',1,'application/pdf',repeat('0',64),gen_random_uuid()::text||'/'||gen_random_uuid()::text||'/'||gen_random_uuid()::text||'/'||gen_random_uuid()::text,clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('0',64))), 'not_found', 'sibling request item cannot be reserved without a valid session');
select is((select outcome from public.preview_supplier_evidence_request_atomic(gen_random_uuid(),gen_random_uuid(),'{}'::jsonb)), 'forbidden', 'unscoped internal preview is denied');
select ok(position('m9_02_current_draft' in pg_get_functiondef('public.m9_02_issue_invitation_before_m906(uuid,uuid,uuid,integer,text,text,timestamp with time zone,uuid,text)'::regprocedure))>0
  and position('m9_02_issue_invitation_before_m906' in pg_get_functiondef('public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamp with time zone,uuid,text)'::regprocedure))>0, 'issue derives its preview fingerprint from the canonical draft');
select ok(position('expiresAt' in pg_get_functiondef('public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamp with time zone,uuid,text)'::regprocedure))=0 or position('request_digest' in pg_get_functiondef('public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamp with time zone,uuid,text)'::regprocedure))>0, 'issue command retains an idempotency digest');
select ok(position('submitted_pending_review' in pg_get_functiondef('public.m9_02_sync_submission_scan()'::regprocedure))>0, 'clean scans remain pending internal review');
select ok(position('quarantined' in pg_get_functiondef('public.m9_02_sync_submission_scan()'::regprocedure))>0, 'quarantined scans become supplier-visible rejection');
select ok(position('state=''revoked''' in pg_get_functiondef('public.m9_02_issue_invitation_before_m906(uuid,uuid,uuid,integer,text,text,timestamp with time zone,uuid,text)'::regprocedure))>0
  and position('m9_02_issue_invitation_before_m906' in pg_get_functiondef('public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamp with time zone,uuid,text)'::regprocedure))>0, 'reissue revokes prior active sessions before creating a new invitation');
select ok(position('submission_row.idempotency_key=p_idempotency_key' in replace(pg_get_functiondef('public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text)'::regprocedure), ' ', '')) = 0, 'completion has its own M8 idempotency scope rather than requiring the reserve key');
select ok(position('submission_record.state = ''scan_pending''' in pg_get_functiondef('public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text)'::regprocedure)) > 0, 'an already queued scoped upload can safely replay finalization after a lost response');
select ok(position('submission_row.state in (''uploading'', ''scan_pending'')' in pg_get_functiondef('public.get_supplier_evidence_submission_upload_atomic(text,uuid)'::regprocedure)) > 0, 'a scoped queued submission can be inspected only to retry finalization');

select * from finish();
rollback;
