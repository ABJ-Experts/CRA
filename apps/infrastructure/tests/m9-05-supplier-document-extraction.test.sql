begin;
create extension if not exists pgtap;
select plan(34);

select ok(to_regclass('public.ai_inference_runs') is not null, 'inference runs are durable');
select ok(to_regclass('public.supplier_document_fields') is not null, 'field suggestions are durable');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.ai_inference_runs'::regclass), 'runs use non-forced RLS');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.supplier_document_fields'::regclass), 'fields use non-forced RLS');
select ok(not has_table_privilege('authenticated','public.ai_inference_runs','select'), 'runs are not directly exposed');
select ok(not has_table_privilege('authenticated','public.supplier_document_fields','select'), 'fields are not directly exposed');
select ok(has_table_privilege('service_role','public.ai_inference_runs','select,insert,update'), 'service role owns run state');
select ok(has_table_privilege('service_role','public.supplier_document_fields','select,insert,update'), 'service role owns suggestions');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='evidence_document_version_texts' and column_name='page_map'), 'OCR page map is additive');
select ok(to_regprocedure('public.start_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid)') is not null, 'start RPC exists');
select ok(to_regprocedure('public.claim_supplier_document_extraction_atomic(uuid,integer)') is not null, 'worker claim RPC exists');
select ok(to_regprocedure('public.complete_supplier_document_extraction_atomic(uuid,uuid,uuid,text,text,jsonb,text)') is not null, 'lease-bound completion RPC exists');
select ok(to_regprocedure('public.get_supplier_document_extraction_worker_atomic(uuid,uuid,uuid)') is not null, 'lease-bound worker read RPC exists');
select ok(to_regprocedure('public.attach_supplier_document_page_map_atomic(uuid,uuid,uuid,jsonb)') is not null, 'on-demand page-map RPC exists');
select ok(to_regprocedure('public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer,jsonb)') is not null, 'new OCR completion accepts page map');
select ok(to_regprocedure('public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid,text,integer)') is not null, 'bounded scoped read RPC exists');
select ok(to_regprocedure('public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid)') is null, 'unbounded read overload was removed');
select ok(to_regprocedure('public.decide_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid)') is not null, 'atomic field decision RPC exists');
select ok(to_regprocedure('public.add_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,uuid)') is not null, 'manual field RPC exists');
select ok(not has_function_privilege('authenticated','public.decide_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid)','execute'), 'ordinary sessions cannot bypass the API');
select ok(has_function_privilege('service_role','public.decide_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid)','execute'), 'service role can make scoped decisions');
select is((select outcome from public.get_supplier_document_extraction_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())), 'forbidden', 'unverified identity cannot read extraction');
select is((select outcome from public.start_supplier_document_extraction_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,clock_timestamp(),gen_random_uuid(),repeat('a',64),gen_random_uuid())), 'forbidden', 'tenant substitution cannot queue extraction');
select is((select outcome from public.get_supplier_document_extraction_atomic('00000000-0000-4000-8000-0000000000ca',gen_random_uuid(),gen_random_uuid(),gen_random_uuid())), 'forbidden', 'product and actor substitution cannot read suggestions');
select is((select outcome from public.get_supplier_document_extraction_atomic('00000000-0000-4000-8000-0000000000ca',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,101)), 'forbidden', 'unauthorized read is denied before pagination validation');
select ok(public.m9_05_page_map_valid('[{"page":1,"text":"A"},{"page":2,"text":""}]'::jsonb), 'page map permits blank OCR pages');
select ok(not public.m9_05_page_map_valid('[{"page":2,"text":"A"}]'::jsonb), 'page map rejects missing first page');
select ok(not public.m9_05_page_map_valid('[{"page":1,"text":"A"},{"page":1,"text":"B"}]'::jsonb), 'page map rejects duplicate pages');
select is(public.attach_supplier_document_page_map_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'[{"page":1,"text":"A"}]'::jsonb), 'not_found', 'unknown run cannot attach a page map');
select is(public.complete_evidence_text_extraction_job_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  repeat('a',64),'m8-03-local-v1','complete','Truncated text','low',true,null,null,null),
  'not_found', 'truncated OCR without a page map reaches legacy completion');
select is(public.complete_evidence_text_extraction_job_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  repeat('a',64),'m8-03-local-v1','complete','Truncated text','low',true,null,null,'[]'::jsonb),
  'not_found', 'truncated OCR with an empty page map reaches legacy completion');
select is(public.complete_evidence_text_extraction_job_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  repeat('a',64),'m8-03-local-v1','complete','Full text','sufficient',false,null,null,null),
  'invalid_request', 'nontruncated OCR requires a locatable page map');
select ok(not has_function_privilege('service_role',
  'public.m9_05_decide_supplier_document_field_core(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid)',
  'execute'), 'service role cannot bypass the confidence gate through the legacy core');
select ok(has_function_privilege('service_role','public.m9_04_reminder_offsets_valid(integer[])','execute'),
  'service role can satisfy the existing organization-settings reminder check while configuring local AI');

select * from finish();
rollback;
