-- Additive compatibility rollout: decimals are valid source CVSS scores.
-- Invalid scores, source preference and source provenance remain unchanged.
begin;
create extension if not exists pgtap;
select plan(8);
create temporary table cvss_decimal_cases(score text,severity text,vulnerability uuid default gen_random_uuid(),source uuid default gen_random_uuid(),source_version uuid default gen_random_uuid(),run uuid default gen_random_uuid());
insert into cvss_decimal_cases(score,severity)values('9.8','critical'),('4.1','medium'),('bad','unknown'),('-1','unknown');
insert into public.vulnerabilities(id,canonical_id,title)select vulnerability,'CVE-M14-05-DECIMAL-'||vulnerability,'Rollback decimal CVSS'from cvss_decimal_cases;
insert into public.vulnerability_feed_sync_runs(id,feed_key,run_kind,correlation_id)select run,'osv','manual',gen_random_uuid()from cvss_decimal_cases limit 1;
insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id)select source,'osv','m14-05-decimal-'||source,vulnerability from cvss_decimal_cases;
insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload)select source_version,source,(select run from cvss_decimal_cases limit 1),repeat('b',64),'active','{}','{}'from cvss_decimal_cases;
update public.vulnerability_source_records r set current_version_id=c.source_version from cvss_decimal_cases c where r.id=c.source;
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)select vulnerability,source_version,'osv','cvss',jsonb_build_object('value',jsonb_build_object('version','3.1','baseScore',score,'vectorString','CVSS:3.1/AV:N'))from cvss_decimal_cases;
select is(public.m5_triage_observation_severity(vulnerability,statement_timestamp()),severity,'source score '||score||' maps to '||severity)from cvss_decimal_cases order by score;
select is((select (value->>'baseScore')::numeric from cvss_decimal_cases c cross join lateral public.m4_03_cvss_rows(array[c.vulnerability])x where score='9.8'),9.8::numeric,'batch projection retains decimal numeric value');
select is((select value#>>'{provenance,sourceRecordVersionId}'from cvss_decimal_cases c cross join lateral public.m4_03_cvss_rows(array[c.vulnerability])x where score='4.1'),(select source_version::text from cvss_decimal_cases where score='4.1'),'decimal retains exact promoted source provenance');
select ok(not has_function_privilege('service_role','public.m4_03_cvss_rows(uuid[])','execute'),'source batch helper stays private');
select ok((select proconfig @> array['search_path=public, pg_temp']from pg_proc where oid='public.m4_03_cvss_rows(uuid[])'::regprocedure),'source batch helper retains search path');
select *from finish();
rollback;
