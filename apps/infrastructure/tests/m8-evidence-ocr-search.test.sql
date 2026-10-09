begin;
create extension if not exists pgtap;
select plan(31);

select ok(to_regclass('public.evidence_document_version_texts') is not null,
  'derived text is isolated from immutable evidence versions');
select ok(to_regclass('public.evidence_document_extraction_jobs') is not null,
  'durable extraction jobs exist');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class
  where oid='public.evidence_document_version_texts'::regclass),
  'derived text has enabled non-forced RLS');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class
  where oid='public.evidence_document_extraction_jobs'::regclass),
  'extraction jobs have enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.evidence_document_version_texts','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.evidence_document_version_texts','select'),
  'only service role can access extracted text rows');
select ok(has_table_privilege('service_role','public.evidence_document_extraction_jobs','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.evidence_document_extraction_jobs','select'),
  'only service role can access extraction jobs');
select ok(exists(select 1 from pg_constraint where conname like '%version_texts%'
  and contype='f'), 'derived text remains version and tenant linked');
select ok(exists(select 1 from pg_indexes where schemaname='public'
  and indexname='evidence_version_texts_search_idx' and indexdef ilike '%using gin%'
  and indexdef ilike '%extraction_status%complete%'),
  'completed derived text has a partial GIN full-text index');
select ok(not exists(select 1 from pg_extension where extname in ('vector','pg_trgm','unaccent')),
  'M8-03 introduces no vector, trigram, or unaccent extension');
select ok(exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='evidence_document_version_texts'
    and column_name='search_document' and data_type='tsvector'),
  'full-text vector is a database-derived column');
select ok((select position('to_tsvector' in pg_get_expr(adbin,adrelid)) > 0
  from pg_attrdef where adrelid='public.evidence_document_version_texts'::regclass
    and adnum=(select attnum from pg_attribute where attrelid='public.evidence_document_version_texts'::regclass
      and attname='search_document')), 'search vector derives from text rather than browser input');

select ok(to_regprocedure('public.claim_evidence_text_extraction_job_atomic(uuid,uuid,integer)') is not null,
  'extraction claim RPC exists');
select ok(to_regprocedure('public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer)') is not null,
  'extraction completion RPC exists');
select ok(to_regprocedure('public.retry_evidence_text_extraction_atomic(uuid,uuid,uuid,uuid,uuid)') is not null,
  'manual extraction retry RPC exists');
select ok(to_regprocedure('public.get_evidence_document_extracted_text_atomic(uuid,uuid,uuid,uuid,uuid)') is not null,
  'version-scoped extracted-text RPC exists');
select ok(to_regprocedure('public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)') is not null,
  'product-scoped search RPC supports bounded keyset input');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
  where oid='public.claim_evidence_text_extraction_job_atomic(uuid,uuid,integer)'::regprocedure),
  'claim RPC pins its security-definer search path');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
  where oid='public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer)'::regprocedure),
  'completion RPC pins its security-definer search path');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
  where oid='public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure),
  'search RPC pins its security-definer search path');
select ok(has_function_privilege('service_role','public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)','execute')
  and not has_function_privilege('authenticated','public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)','execute'),
  'search is service-role mediated, never browser-executable');
select ok(has_function_privilege('service_role','public.retry_evidence_text_extraction_atomic(uuid,uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.retry_evidence_text_extraction_atomic(uuid,uuid,uuid,uuid,uuid)','execute'),
  'manual retry is service-role mediated');

select ok(position('can_view_evidence' in pg_get_functiondef('public.m5_triage_actor_has_permission(uuid,uuid,text)'::regprocedure)) > 0
  and position('can_upload_evidence' in pg_get_functiondef('public.m5_triage_actor_has_permission(uuid,uuid,text)'::regprocedure)) > 0,
  'existing additive custom-role and override helper knows evidence permissions');
select ok(position('p_include_historical or d.current_version_id=v.id' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0,
  'search defaults to current versions unless history is explicit');
select ok(position('v.processing_state=''clean''' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0
  and position('validity_ends_on' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0,
  'search excludes unclean and expired evidence before ranking');
select ok(position('evidence_document_version_products' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0
  and position('p_product_id' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0,
  'search constrains version applicability to the requested product before matching');
select ok(position('m5_triage_actor_has_permission' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0,
  'search rechecks caller permission inside the database RPC');
select ok(position('ts_headline' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0
  and position('StartSel=, StopSel=' in pg_get_functiondef(
  'public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure)) > 0,
  'search returns plain snippet text rather than FTS-generated HTML');
select ok(position('worker lease expired' in pg_get_functiondef(
  'public.claim_evidence_text_extraction_job_atomic(uuid,uuid,integer)'::regprocedure)) > 0
  and position('for update of x skip locked' in lower(pg_get_functiondef(
  'public.claim_evidence_text_extraction_job_atomic(uuid,uuid,integer)'::regprocedure))) > 0,
  'claim recovers exhausted leases and prevents duplicate claims');
select ok(position('j.source_sha256<>p_source_sha256' in pg_get_functiondef(
  'public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer)'::regprocedure)) > 0
  and position('j.extractor_version<>p_extractor_version' in pg_get_functiondef(
  'public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer)'::regprocedure)) > 0,
  'stale jobs cannot overwrite a different source hash or extractor version');
select ok(position('evidence_document_version_texts' in pg_get_functiondef(
  'public.record_evidence_document_scan_atomic(uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'clean scan completion transactionally enqueues extraction');
select is((select outcome from public.search_evidence_documents_atomic(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'x',null,false,25,null,null,null)), 'invalid_request',
  'invalid short query is rejected before data selection');

select * from finish();
rollback;
