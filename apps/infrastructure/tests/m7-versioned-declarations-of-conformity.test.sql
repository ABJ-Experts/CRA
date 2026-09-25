begin;
create extension if not exists pgtap;
select plan(28);

select ok(to_regclass('public.technical_file_declaration_templates') is not null, 'declaration template table exists');
select ok(to_regclass('public.technical_file_declarations') is not null, 'declaration table exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_declarations'::regclass), 'declarations have enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.technical_file_declarations','select,insert,update,delete'), 'service role can manage declarations');
select ok(not has_table_privilege('authenticated','public.technical_file_declarations','select'), 'authenticated cannot access declarations directly');
select ok((select not public from storage.buckets where id='technical-file-declarations'), 'declaration bucket is private');
select ok((select count(*)=1 from public.technical_file_declaration_templates where template_key='cra-annex-v-eu-declaration-of-conformity' and template_version='2024-11-20'), 'Annex V template is pinned');
select ok((select count(*)=1 from pg_indexes where schemaname='public' and indexname='technical_file_declarations_current_issued_idx'), 'only one current issued declaration can exist per product');
select ok((select count(*)=1 from pg_constraint where conrelid='public.technical_file_declarations'::regclass and pg_get_constraintdef(oid) like '%eu_type_examination%' and pg_get_constraintdef(oid) like '%certificate_references%'), 'notified-body route requires certificate references');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid)'::regprocedure), 'issue RPC is a pinned security-definer');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.reissue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,jsonb,uuid)'::regprocedure), 'reissue RPC is a pinned security-definer');
select ok(not has_function_privilege('authenticated','public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid)','execute'), 'authenticated cannot issue directly');
select ok(has_function_privilege('service_role','public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid)','execute'), 'service role can issue through the RPC');
select ok(position('can_issue_technical_files' in pg_get_functiondef('public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid)'::regprocedure))>0, 'issue checks the dedicated permission');
select ok(position('m7_evidence_readiness_json' in pg_get_functiondef('public.get_technical_file_declaration_preview(uuid,uuid,uuid,uuid,text,text,text,text,jsonb)'::regprocedure))>0, 'preview rechecks current evidence readiness');
select ok(position('technical_file.declaration_issuance_prepared' in pg_get_functiondef('public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid)'::regprocedure))>0, 'issue preparation writes durable audit evidence');
select ok(position('technical_file.declaration_issued' in pg_get_functiondef('public.finalize_technical_file_declaration_atomic(uuid,uuid,uuid,text,text,bigint)'::regprocedure))>0, 'issuance finalization writes durable audit evidence');
select ok(position('objectPath' in pg_get_functiondef('public.m7_declaration_json(uuid,uuid,boolean)'::regprocedure))=0, 'public declaration JSON never exposes the private object path');
select ok(exists(select 1 from pg_trigger where tgrelid='public.technical_file_declarations'::regclass and tgname='technical_file_declaration_immutable' and not tgisinternal), 'issued declaration immutability trigger exists');
select ok((select stamp.tgname < guard.tgname from pg_trigger stamp cross join pg_trigger guard
  where stamp.tgrelid='public.technical_file_declarations'::regclass
    and guard.tgrelid=stamp.tgrelid
    and stamp.tgname='a_technical_file_declarations_set_updated_at'
    and guard.tgname='technical_file_declaration_immutable'), 'timestamp trigger runs before declaration immutability guard');
select ok(position('issued declaration payload is immutable' in pg_get_functiondef('public.m7_reject_technical_file_declaration_mutation()'::regprocedure))>0, 'trigger protects issued payload and bytes');
select ok(exists(select 1 from public.technical_file_declarations where status='issued'), 'issued declaration fixture exists for immutability probe');
select throws_ok($$update public.technical_file_declarations set updated_at=updated_at
  where id=(select id from public.technical_file_declarations where status='issued' limit 1)$$,
  'P0001', 'invalid issued declaration transition', 'issued no-op update cannot change timestamp after guard');
select is((select outcome from public.get_technical_file_declaration_preview(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'Responsible person','Brussels',null,null,'[]'::jsonb)), 'forbidden', 'cross-tenant unverified preview is forbidden');
select is((select outcome from public.issue_technical_file_declaration_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,repeat('a',64),repeat('b',64),true,gen_random_uuid())), 'forbidden', 'unverified tenant actor cannot issue');
select throws_ok($$insert into public.technical_file_declarations(organization_id,product_id,snapshot_id,template_id,declaration_version,signatory_user_id,signatory_name,signatory_capacity,issue_place,assessment_route,notified_body_identifier,certificate_references,idempotency_key,command_digest) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),(select id from public.technical_file_declaration_templates limit 1),1,gen_random_uuid(),'Signer','Officer','Brussels','eu_type_examination','1234','[{"reference":"test"}]'::jsonb,gen_random_uuid(),repeat('a',64))$$, '23503', NULL, 'cross-tenant invalid references cannot be inserted');
select ok(position('for update' in lower(pg_get_functiondef('public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid)'::regprocedure)))>0, 'issue locks its declaration before checking preview freshness');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.reissue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,jsonb,uuid)'::regprocedure))>0, 'reissue serializes competing successors');

select * from finish();
rollback;
