begin;

create extension if not exists pgtap;
select plan(25);

select ok(to_regclass('public.technical_file_section_source_reviews') is not null, 'append-only evidence review ledger exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_section_source_reviews'::regclass), 'review ledger has enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.technical_file_section_source_reviews','select,insert,update,delete'), 'service role has review ledger access');
select ok(not has_table_privilege('authenticated','public.technical_file_section_source_reviews','select'), 'authenticated has no direct review ledger access');

select ok((select allowed_source_kinds @> array['product'] from public.technical_file_templates where template_key='annex_vii' and template_version='2024-01' and section_key='general_description'), 'general description requires product evidence');
select ok((select allowed_source_kinds = array['support_period'] from public.technical_file_templates where template_key='annex_vii' and template_version='2024-01' and section_key='support_period_basis'), 'support section accepts only its support record');
select ok((select allowed_source_kinds @> array['finding','risk_register'] from public.technical_file_templates where template_key='annex_vii' and template_version='2024-01' and section_key='vulnerability_handling'), 'vulnerability handling accepts triage and risk evidence');
select ok((select allowed_source_kinds = array['sbom_document'] from public.technical_file_templates where template_key='annex_vii' and template_version='2024-01' and section_key='release_sbom'), 'SBOM section accepts only immutable SBOM evidence');

select ok((select convalidated from pg_constraint where conname='technical_file_section_sources_source_kind_check'), 'risk-register source kind constraint is validated');
select ok((select count(*) = 4 from information_schema.columns where table_schema='public' and table_name='technical_file_section_sources' and column_name in ('source_fingerprint','stale_at','stale_reason','reviewed_at')), 'source links persist fingerprints and review state');
select ok((select count(*) = 1 from pg_indexes where schemaname='public' and indexname='technical_file_section_sources_reverse_idx'), 'reverse lookup index exists');
select ok((select count(*) = 1 from pg_indexes where schemaname='public' and indexname='technical_file_section_sources_stale_idx'), 'stale lookup index exists');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_technical_file_readiness(uuid,uuid,uuid)'::regprocedure), 'readiness RPC is pinned security definer');
select ok(has_function_privilege('service_role','public.get_technical_file_readiness(uuid,uuid,uuid)','execute'), 'service role can read readiness');
select ok(not has_function_privilege('authenticated','public.get_technical_file_readiness(uuid,uuid,uuid)','execute'), 'authenticated cannot call readiness RPC');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid)'::regprocedure), 'stale review RPC is pinned security definer');
select ok(has_function_privilege('service_role','public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid)','execute'), 'M8 reverse projection is service-role callable');
select ok(position('sourceFingerprint' in pg_get_functiondef('public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid)'::regprocedure)) > 0 and position('''productId''' in pg_get_functiondef('public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid)'::regprocedure)) = 0, 'reverse projection exposes pinned link metadata without product metadata');
select ok(position('payloadDigest' in pg_get_functiondef('public.m7_mark_technical_file_section_source_material_change_impl(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid)'::regprocedure)) > 0, 'material-change implementation persists a replay digest');
select ok(position('reviewId' in pg_get_functiondef('public.m7_review_technical_file_section_source_impl(uuid,uuid,uuid,text,uuid,integer,text,text,uuid)'::regprocedure)) > 0, 'review implementation persists a replayable review identity');
select ok(position('snap.revision' in pg_get_functiondef('public.m7_review_technical_file_section_source_impl(uuid,uuid,uuid,text,uuid,integer,text,text,uuid)'::regprocedure)) = 0 and position('v_reviewed_revision' in pg_get_functiondef('public.m7_review_technical_file_section_source_impl(uuid,uuid,uuid,text,uuid,integer,text,text,uuid)'::regprocedure)) > 0, 'manual-reference reviews do not dereference an unassigned source snapshot');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid)'::regprocedure)) > 0, 'material-change replay is serialized by command key');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid)'::regprocedure)) > 0, 'review replay is serialized by command key');

select is((select outcome from public.get_technical_file_readiness(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())), 'forbidden', 'unverified tenant actor cannot inspect readiness');
select is((select outcome from public.get_technical_file_evidence_reverse_links(gen_random_uuid(),gen_random_uuid(),'product',gen_random_uuid())), 'forbidden', 'unverified tenant actor cannot inspect reverse links');

select * from finish();
rollback;
