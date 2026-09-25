begin;
create extension if not exists pgtap;
select plan(27);

select ok(to_regclass('public.evidence_document_access_grants') is not null,
  'access grants are durable records rather than storage signed URLs');
select ok((select relrowsecurity and not relforcerowsecurity
  from pg_class where oid = 'public.evidence_document_access_grants'::regclass),
  'access grants have enabled non-forced RLS');
select ok(has_table_privilege('service_role', 'public.evidence_document_access_grants', 'select,insert,update,delete'),
  'only service role receives access-grant table access');
select ok(not has_table_privilege('authenticated', 'public.evidence_document_access_grants', 'select'),
  'authenticated users cannot read bearer grant records');
select ok(exists(select 1 from pg_constraint where conname = 'evidence_access_grants_version_document_fkey'),
  'grant document and version must belong together');
select ok((select public = false from storage.buckets where id = 'evidence-documents'),
  'evidence bucket remains private');
select ok((select 'image/jpeg' = any(allowed_mime_types) and 'image/png' = any(allowed_mime_types)
  and 'image/webp' = any(allowed_mime_types) and not ('image/svg+xml' = any(allowed_mime_types))
  from storage.buckets where id = 'evidence-documents'),
  'safe preview images are allowed while SVG remains rejected');
select ok(position('''image/webp''' in pg_get_functiondef(
  'public.finalize_evidence_document_upload_atomic(uuid,uuid,uuid,bigint,text,text,uuid,text)'::regprocedure)) > 0,
  'finalization accepts verified WebP content');
select ok(to_regprocedure('public.reserve_evidence_document_replacement_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text)') is not null,
  'replacement reservation RPC exists');
select ok(to_regprocedure('public.list_evidence_document_versions(uuid,uuid,uuid,uuid)') is not null,
  'version history RPC exists');
select ok(to_regprocedure('public.authorize_evidence_document_access_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz)') is not null,
  'access authorization RPC exists');
select ok(to_regprocedure('public.redeem_evidence_document_access_atomic(uuid,uuid,text,uuid,bigint,bigint)') is not null,
  'access redemption RPC exists');
select ok(to_regprocedure('public.record_evidence_document_integrity_failure_atomic(uuid,uuid,uuid,bigint,text,text,uuid)') is not null,
  'integrity failure RPC exists');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
  where oid = 'public.reserve_evidence_document_replacement_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text)'::regprocedure),
  'replacement RPC uses a pinned security-definer path');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
  where oid = 'public.redeem_evidence_document_access_atomic(uuid,uuid,text,uuid,bigint,bigint)'::regprocedure),
  'redemption RPC uses a pinned security-definer path');
select ok(has_function_privilege('service_role',
  'public.authorize_evidence_document_access_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated',
  'public.authorize_evidence_document_access_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz)', 'execute'),
  'authorization RPC is service-role only');
select ok(has_function_privilege('service_role',
  'public.record_evidence_document_integrity_failure_atomic(uuid,uuid,uuid,bigint,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
  'public.record_evidence_document_integrity_failure_atomic(uuid,uuid,uuid,bigint,text,text,uuid)', 'execute'),
  'integrity RPC is service-role only');
select ok(position('for update' in lower(pg_get_functiondef(
  'public.reserve_evidence_document_replacement_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text)'::regprocedure))) > 0
  and position('current_version_id <> p_expected_current_version_id' in pg_get_functiondef(
  'public.reserve_evidence_document_replacement_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text)'::regprocedure)) > 0,
  'replacement locks the document and detects stale current-version writes');
select ok(position('coalesce(max(version_number), 0) + 1' in pg_get_functiondef(
  'public.reserve_evidence_document_replacement_atomic(uuid,uuid,uuid,uuid,text,text,uuid,uuid[],date,date,text,bigint,text,timestamptz,uuid,text)'::regprocedure)) > 0,
  'replacement assigns deterministic append-only version numbers');
select ok(position('evidence_document_version_products' in pg_get_functiondef(
  'public.authorize_evidence_document_access_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz)'::regprocedure)) > 0,
  'authorization verifies version-pinned product scope');
select ok(position('evidence.byte_delivery_started' in pg_get_functiondef(
  'public.redeem_evidence_document_access_atomic(uuid,uuid,text,uuid,bigint,bigint)'::regprocedure)) > 0,
  'redemption records byte delivery separately from authorization');
select ok(position('p_range_end>=v_version.actual_size_bytes' in replace(pg_get_functiondef(
  'public.redeem_evidence_document_access_atomic(uuid,uuid,text,uuid,bigint,bigint)'::regprocedure), ' ', '')) > 0,
  'redemption rejects out-of-bounds byte ranges');
select ok(position('evidence_integrity_failure' in pg_get_functiondef(
  'public.record_evidence_document_integrity_failure_atomic(uuid,uuid,uuid,bigint,text,text,uuid)'::regprocedure)) > 0,
  'integrity failures enqueue responsible-owner notification');
select ok(position('terminal_outcome = ''integrity_failed''' in pg_get_functiondef(
  'public.record_evidence_document_integrity_failure_atomic(uuid,uuid,uuid,bigint,text,text,uuid)'::regprocedure)) > 0,
  'integrity failure terminally records the correlated delivery grant');
select ok(position('''eventType'', n.event_type' in pg_get_functiondef(
  'public.claim_evidence_document_notification_atomic(uuid,uuid,integer)'::regprocedure)) > 0,
  'notification claim identifies integrity versus quarantine alert');
select ok(position('evidence.access_authorized' in pg_get_functiondef(
  'public.authorize_evidence_document_access_atomic(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz)'::regprocedure)) > 0,
  'authorization and issuance are durably audited in the same RPC');
select ok(position('order by v.version_number desc' in lower(pg_get_functiondef(
  'public.list_evidence_document_versions(uuid,uuid,uuid,uuid)'::regprocedure))) > 0
  and position('evidence_document_version_products' in pg_get_functiondef(
  'public.list_evidence_document_versions(uuid,uuid,uuid,uuid)'::regprocedure)) > 0,
  'version history is newest-first and product-scoped');

select * from finish();
rollback;
