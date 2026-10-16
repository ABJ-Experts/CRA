begin;
create extension if not exists pgtap;
select plan(31);
select ok(to_regclass('public.framework_curated_crosswalks') is not null,'curated crosswalk table exists');
select ok(to_regclass('public.framework_upgrade_reviews') is not null,'upgrade review table exists');
select ok(to_regclass('public.framework_upgrade_decisions') is not null,'upgrade decisions table exists');
select ok(exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='framework_pack_versions' and column_name='distribution_rights'),
  'rights metadata extends immutable pack versions');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.framework_curated_crosswalks'::regclass),'crosswalk RLS enabled without force');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.framework_upgrade_reviews'::regclass),'review RLS enabled without force');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.framework_upgrade_decisions'::regclass),'decision RLS enabled without force');
select ok(not has_table_privilege('authenticated','public.framework_upgrade_reviews','select'),'browser role cannot directly read reviews');
select ok(not has_table_privilege('service_role','public.framework_upgrade_reviews','insert'),'service role cannot bypass review RPC');
select ok(has_function_privilege('service_role','public.m10_upgrade_preview(uuid,uuid,text,text,integer,uuid)','execute'),'service can preview');
select ok(has_function_privilege('service_role','public.m10_create_upgrade_review(uuid,uuid,text,text,integer,uuid)','execute'),'service can create review');
select ok(has_function_privilege('service_role','public.m10_set_upgrade_decision(uuid,uuid,uuid,uuid,text[],integer,uuid)','execute'),'service can record decision');
select ok(has_function_privilege('service_role','public.m10_commit_upgrade(uuid,uuid,uuid,integer,uuid)','execute'),'service can commit upgrade');
select is((select outcome from public.m10_upgrade_preview(gen_random_uuid(),gen_random_uuid(),'cra-annex-i','missing',20,null)),'forbidden','unknown actor cannot preview');
select is((select outcome from public.m10_create_upgrade_review(gen_random_uuid(),gen_random_uuid(),'cra-annex-i','missing',1,gen_random_uuid())),'forbidden','unknown actor cannot create review');
select is((select outcome from public.m10_commit_upgrade(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,gen_random_uuid())),'forbidden','unknown actor cannot commit');
select ok(exists(select 1 from pg_proc where oid='public.m10_upgrade_fingerprint(uuid,text,text)'::regprocedure),'fingerprint helper exists');
select ok(exists(select 1 from pg_trigger where tgrelid='public.framework_curated_crosswalks'::regclass and tgname='framework_curated_crosswalks_immutable'),'curated relationships are append-only');

create function pg_temp.multi_pack(p_version text,p_a text,p_b text) returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion',1,'packKey','m10-04-crosswalk-test',
    'versionKey',p_version,'title','Crosswalk fixture','editionDate','2024-01-01',
    'language','en','sourceUrl','https://example.org/fixture',
    'sourcePublicationDate','2024-01-01','attribution','Approved fixture',
    'reviewEvidence','Test review','sourceKind','approved_fixture',
    'requirements',jsonb_build_array(
      jsonb_build_object('requirementKey',p_a,'identifier',upper(p_a),'parentKey',null,
        'position',1,'heading',upper(p_a),'text','Fixture only','sourceReference','Fixture'),
      jsonb_build_object('requirementKey',p_b,'identifier',upper(p_b),'parentKey',null,
        'position',2,'heading',upper(p_b),'text','Fixture only','sourceReference','Fixture')))
$$;
select is(public.m10_import_framework_pack(pg_temp.multi_pack('v1','old-a','old-b')),
  'imported','two source requirements import');
select is(public.m10_import_framework_pack(pg_temp.multi_pack('v2','new-a','new-b')),
  'imported','two target requirements import');
insert into public.framework_curated_crosswalks(source_pack_key,source_version_key,source_requirement_key,
  target_pack_key,target_version_key,target_requirement_key,strength,direction,rationale,provenance,
  reviewer,reviewed_at) values
  ('m10-04-crosswalk-test','v1','old-a','m10-04-crosswalk-test','v2','new-a',
    'supports','one_way','Human review needed','Fixture','Test reviewer',clock_timestamp()),
  ('m10-04-crosswalk-test','v1','old-a','m10-04-crosswalk-test','v2','new-b',
    'partial','one_way','Human review needed','Fixture','Test reviewer',clock_timestamp()),
  ('m10-04-crosswalk-test','v1','old-b','m10-04-crosswalk-test','v2','new-a',
    'equivalent','bidirectional','Human review needed','Fixture','Test reviewer',clock_timestamp()),
  ('m10-04-crosswalk-test','v1','old-b','m10-04-crosswalk-test','v2','new-b',
    'uncertain','one_way','Human review needed','Fixture','Test reviewer',clock_timestamp());
select is(public.m10_upgrade_diff('m10-04-crosswalk-test','v1','v2')->'split'->>0,
  'old-a','one source to two targets is split only by curated edges');
select is(public.m10_upgrade_diff('m10-04-crosswalk-test','v1','v2')->'merged'->>0,
  'new-a','two sources to one target is merged only by curated edges');
select ok(exists(select 1 from public.framework_curated_crosswalks
  where source_pack_key='m10-04-crosswalk-test' and strength='uncertain'
    and direction='one_way'),'uncertain one-way edge remains explicit');
select throws_ok($$update public.framework_curated_crosswalks set strength='equivalent'
  where source_pack_key='m10-04-crosswalk-test' and strength='uncertain'$$,
  '23514',null,'curated strength cannot be silently rewritten');
select throws_ok($$select public.m10_import_framework_pack(
  jsonb_set(pg_temp.multi_pack('v1','old-a','old-b'),'{packKey}','"iec-62443-4-1-fixture"'))$$,
  '22023',null,'licensed standard key requires explicit rights metadata');
select is(public.m10_import_framework_pack(
  jsonb_set(pg_temp.multi_pack('v1','old-a','old-b'),'{packKey}','"iec-62443-4-1-fixture"') ||
  jsonb_build_object('sourceKind','licensed_standard','editionLabel','Test fixture edition',
    'distributionRights','Fixture text only; test execution in rollback transaction',
    'rightsEvidence','Approved test fixture, no normative standard content',
    'reviewOwner','Test reviewer','approvedAt','2026-09-25T00:00:00Z')),
  'imported','licensed fixture imports only with edition and rights evidence');
select is(jsonb_array_length(public.m10_upgrade_diff('m10-04-crosswalk-test','v1','v2')->'split'),
  1,'uncertain edge does not create another split');
select throws_ok($$insert into public.framework_pack_versions(pack_key,version_key,title,
  edition_date,language,source_url,source_celex,source_eli,source_publication_date,
  attribution,review_evidence,content_hash,requirement_count,source_kind)
  select 'm10-04-illegal-law','v1',title,edition_date,language,source_url,null,source_eli,
    source_publication_date,attribution,review_evidence,content_hash,requirement_count,'public_law'
  from public.framework_pack_versions where pack_key='m10-04-crosswalk-test' and version_key='v1'$$,
  '23514',null,'table constraint rejects public law without CELEX');
select ok((select count(*) from public.organization_export_source_tables
  where source_id='framework_controls' and table_name in
    ('framework_upgrade_reviews','framework_upgrade_decisions'))=2,
  'durable upgrade facts are in tenant export registry');
select ok(position('public.framework_upgrade_reviews, public.framework_upgrade_decisions'
  in pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0,
  'snapshot transaction locks upgrade facts');
select ok((select count(*) from pg_constraint where conrelid='public.framework_upgrade_decisions'::regclass
  and conname in ('framework_upgrade_decisions_review_fkey','framework_upgrade_decisions_mapping_fkey')
  and confdeltype='c')=2,
  'authorized tenant purge cascades review decisions');
select * from finish();
rollback;
