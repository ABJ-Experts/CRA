begin;
create extension if not exists pgtap;
select plan(42);

select ok(to_regclass('public.supplier_evidence_submission_reviews') is not null, 'immutable supplier-review history exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.supplier_evidence_submission_reviews'::regclass), 'review history has enabled non-forced RLS');
select ok(not has_table_privilege('anon', 'public.supplier_evidence_submission_reviews', 'select'), 'anonymous callers cannot read review history');
select ok(not has_table_privilege('authenticated', 'public.supplier_evidence_submission_reviews', 'select'), 'authenticated callers cannot read review history directly');
select ok(has_table_privilege('service_role', 'public.supplier_evidence_submission_reviews', 'select,insert'), 'service role persists review history');

select ok(exists(
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'supplier_evidence_requests'
    and column_name = 'review_state'
), 'request has an explicit aggregate review state');
select ok(exists(
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'supplier_evidence_invitations'
    and column_name = 'delivery_state'
), 'invitation has a durable delivery state');
select ok(exists(
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'supplier_evidence_request_items'
    and column_name = 'source_request_item_id'
), 'follow-up item keeps immutable source-item lineage');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.supplier_evidence_submission_reviews'::regclass
    and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, submission_id)'
), 'a submission may have only one immutable review');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.supplier_evidence_submission_reviews'::regclass
    and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, reviewer_user_id, idempotency_key)'
), 'review retries are attributed to a reviewer idempotency key');

select ok(to_regprocedure('public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)') is not null, 'review RPC exists');
select ok(to_regprocedure('public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)') is not null, 're-request RPC exists');
select ok(to_regprocedure('public.mark_supplier_evidence_invitation_delivery_atomic(uuid,uuid,uuid,uuid,integer,text,text,uuid)') is not null, 'delivery RPC exists');
select ok(to_regprocedure('public.get_supplier_evidence_request_review_atomic(uuid,uuid,uuid)') is not null, 'review-detail RPC exists');
select ok(to_regprocedure('public.list_supplier_evidence_request_reviews_atomic(uuid,uuid,uuid,uuid,text,integer,uuid)') is not null, 'review queue RPC exists');
select ok(to_regprocedure('public.list_supplier_evidence_requests_filtered_atomic(uuid,uuid,uuid,uuid,text,integer,uuid)') is not null, 'filtered safe request-list RPC exists');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)'::regprocedure), 'review RPC has a pinned security-definer path');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)'::regprocedure), 're-request RPC has a pinned security-definer path');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.mark_supplier_evidence_invitation_delivery_atomic(uuid,uuid,uuid,uuid,integer,text,text,uuid)'::regprocedure), 'delivery RPC has a pinned security-definer path');
select ok(has_function_privilege('service_role', 'public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)', 'execute'), 'service role can review submitted evidence');
select ok(not has_function_privilege('authenticated', 'public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)', 'execute'), 'authenticated callers cannot invoke the review RPC directly');
select ok(has_function_privilege('service_role', 'public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)', 'execute'), 'service role can create a scoped re-request');
select ok(not has_function_privilege('authenticated', 'public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)', 'execute'), 'authenticated callers cannot invoke a re-request directly');
select ok(has_function_privilege('service_role', 'public.list_supplier_evidence_requests_filtered_atomic(uuid,uuid,uuid,uuid,text,integer,uuid)', 'execute'), 'service role can use filtered safe request listing');

select ok(position('processing_state <> ''clean''' in pg_get_functiondef('public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)'::regprocedure)) > 0, 'review rejects versions that are no longer clean');
select ok(position('submission_row.updated_at <> p_expected_submission_updated_at' in pg_get_functiondef('public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)'::regprocedure)) > 0, 'review uses the rendered submission revision as an optimistic-concurrency check');
select ok(position('HH24:MI:SS.US' in pg_get_functiondef('public.m9_03_submission_json(uuid,uuid)'::regprocedure)) > 0, 'rendered submission revision retains microseconds for the optimistic-concurrency check');
select ok(position('Re-check after taking the decision locks' in pg_get_functiondef('public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)'::regprocedure)) > 0, 'review rechecks active reviewer authority after locking the decision');
select ok(position('p_supplier_visible_reason is null' in pg_get_functiondef('public.review_supplier_evidence_submission_atomic(uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid,text,text,text,text,uuid)'::regprocedure)) > 0, 'rejection reason validation is inside the atomic write');
select ok(position('review_row.decision = ''accepted''' in pg_get_functiondef('public.m9_03_review_item_json(uuid,uuid)'::regprocedure)) > 0, 'per-item state keeps acceptance distinct from scan state');
select ok(position('source_request_item_id' in pg_get_functiondef('public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)'::regprocedure)) > 0, 're-request persists item lineage instead of overwriting the old revision');
select ok(position('state not in (''rejected'', ''failed'', ''cancelled'')' in pg_get_functiondef('public.m9_03_validate_follow_up_payload(uuid,uuid,jsonb)'::regprocedure)) > 0, 're-request rejects pending or accepted source items server-side');
select ok(position('state = ''revoked''' in pg_get_functiondef('public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)'::regprocedure)) > 0, 're-request revokes prior scoped invitations before issuing a replacement');
select ok(position('delivery_state <> ''pending''' in pg_get_functiondef('public.mark_supplier_evidence_invitation_delivery_atomic(uuid,uuid,uuid,uuid,integer,text,text,uuid)'::regprocedure)) > 0, 'delivery state is not silently overwritten');
select ok(position('deliveryFailureMessage' in pg_get_functiondef('public.m9_02_invitation_json(uuid,uuid)'::regprocedure)) > 0, 'invitation JSON exposes supplier-request delivery failure state internally');
select ok(position('aggregateReviewState' in pg_get_functiondef('public.m9_02_request_summary_json(uuid,uuid)'::regprocedure)) > 0, 'request summary JSON exposes aggregate review state');
select ok(position('reviewItems' in pg_get_functiondef('public.m9_03_request_review_json(uuid,uuid)'::regprocedure)) > 0, 'review detail JSON exposes review checklist projections');
select ok(position('reviews' in pg_get_functiondef('public.m9_03_submission_json(uuid,uuid)'::regprocedure)) > 0, 'submission JSON exposes immutable review history');
select ok(position('reviewItems' in pg_get_functiondef('public.m9_02_request_json(uuid,uuid)'::regprocedure)) = 0, 'ordinary request detail does not expose reviewer-only notes or provenance');
select ok(position('reRequestReason' in pg_get_functiondef('public.m9_02_portal_json(uuid,uuid)'::regprocedure)) > 0, 'portal checklist projection always supplies the nullable re-request reason contract field');
select ok(position('not between 1 and 25' in pg_get_functiondef('public.m9_03_validate_follow_up_payload(uuid,uuid,jsonb)'::regprocedure)) > 0
  and position('not between 1 and 160' in pg_get_functiondef('public.m9_03_validate_follow_up_payload(uuid,uuid,jsonb)'::regprocedure)) > 0
  and position('> 2000' in pg_get_functiondef('public.m9_03_validate_follow_up_payload(uuid,uuid,jsonb)'::regprocedure)) > 0, 'follow-up SQL limits match the shared Zod contract');
select ok(position('''expiresAt''' in pg_get_functiondef('public.re_request_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,jsonb,text,timestamp with time zone,uuid)'::regprocedure)) = 0, 're-request replay digest excludes regenerated invitation expiry');

select * from finish();
rollback;
