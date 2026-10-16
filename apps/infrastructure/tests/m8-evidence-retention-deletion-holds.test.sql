begin;
create extension if not exists pgtap;
select plan(30);

select ok(to_regclass('public.evidence_document_version_retention_protections') is not null,
  'each immutable evidence version has a durable retention protection projection');
select ok(to_regclass('public.evidence_document_legal_holds') is not null,
  'legal holds are durable document-scoped records');
select ok(to_regclass('public.evidence_document_deletion_intents') is not null,
  'reviewed deletion is durable rather than an automatic purge');
select ok(to_regclass('public.evidence_document_deletion_cleanup_items') is not null,
  'physical cleanup is tracked independently for safe retry');
select ok(exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='evidence_documents' and column_name='lifecycle_state'),
  'evidence documents keep a lifecycle state without deleting audit metadata');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class
  where oid='public.evidence_document_legal_holds'::regclass),
  'legal holds use enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.evidence_document_legal_holds','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.evidence_document_legal_holds','select'),
  'holds remain service-role mediated');
select ok(exists(select 1 from pg_constraint where conname='evidence_document_deletion_intents_idempotency_key'),
  'deletion requests have an idempotency constraint');
select ok(exists(select 1 from pg_constraint where conname='evidence_document_legal_holds_active_release_check'),
  'a released hold retains actor, time and release reason');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='evidence_document_active_holds_idx'),
  'active legal holds have a focused lookup index');

select ok(to_regprocedure('public.refresh_evidence_document_retention_protection_atomic(uuid,uuid)') is not null,
  'retention projection refresh RPC exists');
select ok(to_regprocedure('public.get_evidence_document_retention_review_atomic(uuid,uuid,uuid)') is not null,
  'retention review RPC exists');
select ok(to_regprocedure('public.list_evidence_document_legal_holds_atomic(uuid,uuid,uuid)') is not null,
  'legal-hold history RPC exists');
select ok(to_regprocedure('public.place_evidence_document_legal_hold_atomic(uuid,uuid,uuid,text,uuid)') is not null,
  'legal hold placement RPC exists');
select ok(to_regprocedure('public.release_evidence_document_legal_hold_atomic(uuid,uuid,uuid,uuid,text,uuid)') is not null,
  'legal hold release RPC exists');
select ok(to_regprocedure('public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)') is not null,
  'explicit deletion confirmation RPC exists');
select ok(to_regprocedure('public.claim_evidence_document_deletion_cleanup_atomic(uuid,uuid,integer)') is not null,
  'cleanup claim RPC exists');
select ok(to_regprocedure('public.complete_evidence_document_deletion_cleanup_atomic(uuid,uuid,uuid,uuid,text,text)') is not null,
  'cleanup completion RPC exists');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
  where oid='public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure),
  'destructive confirmation has a pinned security-definer path');
select ok(has_function_privilege('service_role','public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)','execute'),
  'destructive confirmation is service-role mediated');
select ok(position('retention_protection_until' in pg_get_functiondef(
  'public.refresh_evidence_document_retention_protection_atomic(uuid,uuid)'::regprocedure))>0
  and position('retention_status' in pg_get_functiondef(
  'public.refresh_evidence_document_retention_protection_atomic(uuid,uuid)'::regprocedure))>0,
  'the projection consumes persisted M2 protection and status rather than date arithmetic');
select ok(position('left join public.products' in lower(pg_get_functiondef(
  'public.refresh_evidence_document_retention_protection_atomic(uuid,uuid)'::regprocedure)))>0
  and position('archived_at is null' in lower(pg_get_functiondef(
  'public.refresh_evidence_document_retention_protection_atomic(uuid,uuid)'::regprocedure)))=0,
  'archived linked products remain part of evidence protection');
select ok(position('greatest' in lower(pg_get_functiondef(
  'public.refresh_evidence_document_retention_protection_atomic(uuid,uuid)'::regprocedure)))>0,
  'protection refresh preserves the strongest known protection');
select ok(position('for update' in lower(pg_get_functiondef(
  'public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure)))>0,
  'confirmation locks the evidence document against concurrent replacement or holds');
select ok(position('evidence_document_legal_holds' in pg_get_functiondef(
  'public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure))>0,
  'confirmation checks active holds in the same transaction');
select ok(position('technical_file_section_sources' in pg_get_functiondef(
  'public.m8_05_retention_review_json(uuid,uuid,uuid)'::regprocedure))>0,
  'confirmation blocks document references retained by technical-file sources');
select ok(position('evidence.access_revoked_for_deletion' in pg_get_functiondef(
  'public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure))>0,
  'access revocation and deletion intent are durably audited together');
select ok(position('m8_05_retention_review_json' in pg_get_functiondef(
  'public.claim_evidence_document_deletion_cleanup_atomic(uuid,uuid,integer)'::regprocedure))>0,
  'cleanup rechecks protection before exposing an object deletion claim');
select ok(position('''deleted'',''missing'',''retry'',''failed''' in pg_get_functiondef(
 'public.complete_evidence_document_deletion_cleanup_atomic(uuid,uuid,uuid,uuid,text,text)'::regprocedure))>0,
 'cleanup completion accepts the worker’s idempotent deleted outcome');

with target as (
  select d.organization_id, d.id as document_id, u.id as actor_id
    from public.evidence_documents d
    join public.organization_members m on m.organization_id = d.organization_id
    join public.users u on u.id = m.user_id
   where u.email = 'owner@cra.test'
   order by d.created_at desc
   limit 1
), review as (
  select (public.get_evidence_document_retention_review_atomic(
    t.organization_id, t.actor_id, t.document_id
  )).result as result
  from target t
)
select ok(
  (select result ?& array[
    'reviewedAt', 'retentionIncomplete', 'productLegalHoldActive',
    'retentionUntil', 'retentionProtectionUntil', 'linkedProductIds'
  ] from review),
  'the live review RPC exposes every required conservative-protection field'
);

select * from finish();
rollback;
