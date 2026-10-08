-- Frozen M4 source characterization: no source policy or validation changes.
-- All synthetic source graphs and temporary reference functions roll back.
begin;
create extension if not exists pgtap;
select plan(4);
select ok(to_regprocedure('public.m4_03_cvss_rows(uuid[])')is not null,'source-owned batch CVSS rows exists');
do $$begin if to_regprocedure('public.m4_03_cvss_rows(uuid[])')is null then raise exception 'M14 RED: source batch projection missing';end if;end$$;
select ok(not has_function_privilege('authenticated','public.m4_03_cvss_rows(uuid[])','execute'),'CVSS source rows are not browser accessible');
select ok(not has_function_privilege('service_role','public.m4_03_cvss_rows(uuid[])','execute'),'CVSS source rows are not a direct service RPC');
select ok(to_regprocedure('public.m5_cvss_score_severity(numeric)')is not null,'existing score threshold mapping is shared privately');
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14 CVSS check failed: %',name;end if;raise notice 'M14 CVSS verified: %',name;end$$;
create or replace function pg_temp.m14_cvss_reference(
  p_vulnerability_id uuid,
  p_assessed_at timestamptz
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with src as (
    select
      records.id as record_id,
      records.feed_key,
      records.source_updated_at,
      versions.id as version_id,
      versions.promoted_at,
      enrichments.enrichment_type,
      enrichments.enrichment,
      configs.freshness_state
    from public.vulnerability_source_records records
    join public.vulnerability_source_record_versions versions
      on versions.id = records.current_version_id
    join public.vulnerability_enrichments enrichments
      on enrichments.source_record_version_id = versions.id
    join public.vulnerability_feed_configs configs
      on configs.feed_key = records.feed_key
    where records.vulnerability_id = p_vulnerability_id
      and records.record_state = 'active'
  ),
  epss_candidates as (
    select
      src.*,
      case
        when jsonb_typeof(enrichment -> 'value') = 'number'
          and enrichment ->> 'value' ~ '^(0|1)(\\.[0-9]+)?$'
          then (enrichment ->> 'value')::numeric
        when jsonb_typeof(enrichment -> 'value') = 'object'
          and enrichment -> 'value' ->> 'epss' ~ '^(0|1)(\\.[0-9]+)?$'
          then (enrichment -> 'value' ->> 'epss')::numeric
        else null
      end as probability
    from src
    where enrichment_type = 'epss'
  ),
  epss as (
    select * from epss_candidates where probability is not null
    order by source_updated_at desc nulls last, promoted_at desc
    limit 1
  ),
  cvss as (
    select src.*, value as data
    from src
    cross join lateral jsonb_path_query(enrichment -> 'value', '$.**.cvssData') value
    union all
    select src.*, enrichment -> 'value'
    from src
    where enrichment_type = 'cvss'
  ),
  cvss_rows as (
    select
      jsonb_build_object(
        'version', coalesce(data ->> 'version', substring(data ->> 'vectorString' from 'CVSS:([0-9.]+)')),
        'baseScore', (coalesce(data ->> 'baseScore', data ->> 'score'))::numeric,
        'vector', data ->> 'vectorString',
        'provenance', jsonb_build_object(
          'sourceFeed', feed_key,
          'sourceRecordId', record_id,
          'sourceRecordVersionId', version_id,
          'observedAt', source_updated_at,
          'retrievedAt', promoted_at
        )
      ) as value,
      coalesce(data ->> 'version', substring(data ->> 'vectorString' from 'CVSS:([0-9.]+)')) as version,
      source_updated_at,
      promoted_at,
      freshness_state
    from cvss
    where coalesce(data ->> 'baseScore', data ->> 'score') ~ '^[0-9]+(\\.[0-9]+)?$'
      and coalesce(data ->> 'vectorString', '') <> ''
  ),
  cwe_rows as (
    select jsonb_build_object(
      'id', value ->> 'cweId',
      'name', null,
      'provenance', jsonb_build_object(
        'sourceFeed', src.feed_key,
        'sourceRecordId', src.record_id,
        'sourceRecordVersionId', src.version_id,
        'observedAt', src.source_updated_at,
        'retrievedAt', src.promoted_at
      )
    ) as value
    from src
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(src.enrichment -> 'value') = 'array'
        then src.enrichment -> 'value' else '[]'::jsonb end
    ) value
    where src.enrichment_type = 'cwes'
      and value ->> 'cweId' ~ '^CWE-[1-9][0-9]*$'
    union all
    select jsonb_build_object(
      'id', description ->> 'value',
      'name', null,
      'provenance', jsonb_build_object(
        'sourceFeed', src.feed_key,
        'sourceRecordId', src.record_id,
        'sourceRecordVersionId', src.version_id,
        'observedAt', src.source_updated_at,
        'retrievedAt', src.promoted_at
      )
    )
    from src
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(src.enrichment -> 'value') = 'array'
        then src.enrichment -> 'value' else '[]'::jsonb end
    ) weakness
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(weakness -> 'description') = 'array'
        then weakness -> 'description' else '[]'::jsonb end
    ) description
    where src.enrichment_type = 'weaknesses'
      and description ->> 'value' ~ '^CWE-[1-9][0-9]*$'
  )
  select jsonb_build_object(
    'cvss', jsonb_build_object(
      'freshness', case
        when exists(select 1 from cvss_rows) then coalesce(
          (select case freshness_state when 'healthy' then 'fresh' when 'stale' then 'stale' else 'unavailable' end from cvss_rows limit 1),
          'absent'
        )
        else 'absent'
      end,
      'assessedAt', p_assessed_at,
      'preferred', (select value from cvss_rows order by
        case version when '4.0' then 4 when '3.1' then 3 when '3.0' then 2 when '2.0' then 1 else 0 end desc,
        source_updated_at desc nulls last, promoted_at desc limit 1),
      'observations', coalesce((select jsonb_agg(value order by source_updated_at desc nulls last, promoted_at desc) from cvss_rows), '[]'::jsonb)
    ),
    'epss', jsonb_build_object(
      'freshness', coalesce(
        (select case freshness_state when 'healthy' then 'fresh' when 'stale' then 'stale' else 'unavailable' end from epss),
        (select case freshness_state when 'healthy' then 'absent' when 'stale' then 'absent' else 'unavailable' end from public.vulnerability_feed_configs where feed_key = 'epss')
      ),
      'assessedAt', p_assessed_at,
      'value', (select probability from epss),
      'observationDate', (select source_updated_at::date from epss),
      'provenance', (select jsonb_build_object(
        'sourceFeed', feed_key,
        'sourceRecordId', record_id,
        'sourceRecordVersionId', version_id,
        'observedAt', source_updated_at,
        'retrievedAt', promoted_at
      ) from epss)
    ),
    'kev', jsonb_build_object(
      'freshness', 'absent', 'assessedAt', p_assessed_at,
      'status', 'not_listed', 'listingDate', null, 'provenance', null
    ),
    'cwes', coalesce((select jsonb_agg(value order by value ->> 'id') from cwe_rows), '[]'::jsonb),
    'aliases', '[]'::jsonb,
    'references', '[]'::jsonb
  );
$$;

create temporary table m14_cvss_cases as select n,gen_random_uuid()vulnerability_id from generate_series(1,15)n;
create temporary table m14_cvss_records as select v.n case_n,g.n slot,v.vulnerability_id,gen_random_uuid()record_id,gen_random_uuid()version_id from m14_cvss_cases v cross join generate_series(1,4)g(n);
set local session_replication_role=replica;
insert into public.vulnerability_feed_configs(feed_key,schedule_interval_seconds,stale_threshold_seconds,sync_state,freshness_state)values('osv',86400,172800,'healthy','healthy'),('nvd',86400,172800,'healthy','stale'),('github_advisory',86400,172800,'healthy','healthy')on conflict(feed_key)do update set enabled=true,disabled_reason=null,sync_state=excluded.sync_state,freshness_state=excluded.freshness_state;
insert into public.vulnerability_feed_sync_runs(id,feed_key,run_kind,correlation_id,status)values('00000000-0000-4000-8000-0000000014c1','osv','manual',gen_random_uuid(),'completed');
insert into public.vulnerabilities(id,canonical_id,title)select vulnerability_id,'CVE-M14-CVSS-'||vulnerability_id,'M14 synthetic source parity'from m14_cvss_cases;
insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id,source_updated_at,record_state)
select record_id,case when case_n>=13 then'github_advisory'when case_n=11 and slot=2 then'nvd'else'osv'end,'m14-cvss-'||record_id,vulnerability_id,
case when case_n=2 and slot=4 then null when case_n=12 then'2026-01-02'::timestamptz else '2026-01-01'::timestamptz+make_interval(days=>slot)end,
case when case_n=4 and slot in(2,4)then'withdrawn'else'active'end from m14_cvss_records;
insert into public.vulnerability_source_record_versions(id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload,promoted_at)
select version_id,record_id,'00000000-0000-4000-8000-0000000014c1',repeat('b',64),'active','{}','{}',case when case_n=12 then'2026-02-01'::timestamptz else '2026-02-01'::timestamptz+make_interval(days=>slot)end from m14_cvss_records;
update public.vulnerability_source_records r set current_version_id=i.version_id from m14_cvss_records i where r.id=i.record_id and not(i.case_n=4 and i.slot=3)and not(i.case_n=12 and i.slot in(3,4));
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)
select vulnerability_id,version_id,case when case_n>=13 then'github_advisory'when case_n=11 and slot=2 then'nvd'else'osv'end,case when case_n=5 then'nvd_metrics'else'cvss'end,jsonb_build_object('type','cvss','value',
case
 when case_n=13 then jsonb_build_object('score',9,'vectorString','CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
 when case_n=14 then jsonb_build_object('baseScore',4,'score',9,'version','3.1','vectorString','CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
 when case_n=15 then jsonb_build_object('score',8.1,'vectorString','CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
 when case_n=5 then jsonb_build_object('metrics',jsonb_build_array(jsonb_build_object('cvssData',jsonb_build_object('version','4.0','baseScore',9,'vectorString','CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'))))
 when case_n=3 then jsonb_build_object('version','3.1','baseScore',case slot when 1 then'bad'when 2 then'-1'when 3 then'9,3'else'NaN'end,'vectorString','CVSS:3.1/AV:N')
 else jsonb_build_object('version',case when case_n=1 then case slot when 1 then'2.0'when 2 then'3.0'when 3 then'3.1'else'4.0'end else'3.1'end,
 'baseScore',case when case_n=4 then case when slot=1 then to_jsonb(4)else to_jsonb(9)end when case_n=6 then to_jsonb(9007199254740993::numeric) when case_n=7 then 'null'::jsonb when case_n=8 then to_jsonb(9.9::numeric)else to_jsonb(case slot when 1 then 1 when 2 then 4 when 3 then 7 else 9 end)end,
 'vectorString',case when case_n=9 then''when case_n=11 then'CVSS:'||case slot when 1 then'2.0'when 2 then'3.0'when 3 then'3.1'else'4.0'end||'/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'else'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'end)-case when case_n=11 then'version'else'm14_unused_key'end
end)from m14_cvss_records;
-- Unrelated source payloads must retain full-reader behavior after CVSS extraction.
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)
select vulnerability_id,version_id,'osv','epss',jsonb_build_object('type','epss','value',case when slot=1 then to_jsonb(0)when slot=2 then'{"epss":1}'::jsonb else'{"epss":"bad"}'::jsonb end)from m14_cvss_records where case_n=10;
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)
select vulnerability_id,version_id,'osv','cwes',jsonb_build_object('type','cwes','value',case when slot=1 then'[{"cweId":"CWE-79"}]'::jsonb else to_jsonb('malformed'::text)end)from m14_cvss_records where case_n=10;
insert into public.vulnerability_enrichments(vulnerability_id,source_record_version_id,feed_key,enrichment_type,enrichment)
select vulnerability_id,version_id,'osv','weaknesses',jsonb_build_object('type','weaknesses','value',case when slot=1 then'[{"description":[{"value":"CWE-89","lang":"en"}]}]'::jsonb else'[{"description":"malformed"}]'::jsonb end)from m14_cvss_records where case_n=10;
set local session_replication_role=origin;
analyze public.vulnerability_source_records;
analyze public.vulnerability_source_record_versions;
analyze public.vulnerability_enrichments;
do $$declare r record;old_value jsonb;new_value jsonb;preferred numeric;observed timestamptz;baseline_severity text;at_time jsonb;begin
for r in select *from m14_cvss_cases loop
 old_value:=pg_temp.m14_cvss_reference(r.vulnerability_id,'2025-01-01');new_value:=public.m4_03_intelligence_json(r.vulnerability_id,'2025-01-01');
 if r.n=12 then
 -- Equal priority/timestamps have no source tiebreak contract. Preserve the
 -- valid candidate set and unrelated fields without asserting arbitrary order.
 perform pg_temp.check('unspecified tie remains a valid source candidate',old_value#>>'{cvss,preferred,baseScore}'in('1','4')and new_value#>>'{cvss,preferred,baseScore}'in('1','4'));
 perform pg_temp.check('tie preserves unrelated intelligence',old_value-'cvss'=new_value-'cvss');
 else perform pg_temp.check('full intelligence unchanged case '||r.n,old_value=new_value);end if;
 select(value->>'baseScore')::numeric into preferred from public.m4_03_cvss_rows(array[r.vulnerability_id]) order by case version when'4.0'then 4 when'3.1'then 3 when'3.0'then 2 when'2.0'then 1 else 0 end desc,source_updated_at desc nulls last,promoted_at desc limit 1;
 if r.n=12 then perform pg_temp.check('batch tie stays within authoritative candidate set',preferred in(1,4));else perform pg_temp.check('batch preferred source matches frozen reader case '||r.n,preferred is not distinct from(old_value#>>'{cvss,preferred,baseScore}')::numeric);end if;
 perform pg_temp.check('observation time is preserved as metadata case '||r.n,public.m4_03_intelligence_json(r.vulnerability_id,'2024-01-01')#>'{cvss,preferred}'=new_value#>'{cvss,preferred}'and public.m4_03_intelligence_json(r.vulnerability_id,'2024-01-01')#>>'{cvss,assessedAt}'<>new_value#>>'{cvss,assessedAt}');
-- Equal-ranked ties have no preferred-order contract; do not invent one here.
if r.n<>12 then
baseline_severity:=public.m5_triage_observation_severity(r.vulnerability_id,'2025-01-01');
foreach observed in array array['1970-01-01'::timestamptz,'2000-01-01'::timestamptz,'2100-01-01'::timestamptz,statement_timestamp()]loop
at_time:=public.m4_03_intelligence_with_provenance_json(r.vulnerability_id,observed);
perform pg_temp.check('scalar severity date independence case '||r.n||' time '||observed,public.m5_triage_observation_severity(r.vulnerability_id,observed)=baseline_severity);
perform pg_temp.check('preferred source date independence case '||r.n||' time '||observed,at_time#>'{cvss,preferred}'=new_value#>'{cvss,preferred}');
perform pg_temp.check('source freshness and metadata dates preserved case '||r.n||' time '||observed,at_time#>'{cvss,freshness}'=new_value#>'{cvss,freshness}'and at_time#>'{cvss,assessedAt}'=to_jsonb(observed));
end loop;
end if;

end loop;
perform pg_temp.check('GitHub score alias retained by full reader and batch',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=9 and public.m5_triage_observation_severity(vulnerability_id,now())='critical'from m14_cvss_cases where n=13));
perform pg_temp.check('baseScore takes priority over GitHub score alias',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=4 from m14_cvss_cases where n=14));
perform pg_temp.check('inherited GitHub decimal score exclusion unchanged',(select public.m4_03_intelligence_json(vulnerability_id,now())#>'{cvss,preferred}'='null'::jsonb from m14_cvss_cases where n=15));
perform pg_temp.check('four-version source precedence',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=9 from m14_cvss_cases where n=1));
perform pg_temp.check('null observed time sorts last',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=7 from m14_cvss_cases where n=2));
perform pg_temp.check('malformed decimal/locale/IEEE values remain excluded',(select public.m4_03_intelligence_json(vulnerability_id,now())#>'{cvss,preferred}'='null'::jsonb from m14_cvss_cases where n=3));
perform pg_temp.check('withdrawn and noncurrent versions excluded',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=4 from m14_cvss_cases where n=4));
perform pg_temp.check('nested CVSS extraction retained',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=9 from m14_cvss_cases where n=5));
perform pg_temp.check('large numeric score remains numeric',(select(public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,baseScore}')::numeric=9007199254740993 from m14_cvss_cases where n=6));
perform pg_temp.check('missing vectors excluded',(select public.m4_03_intelligence_json(vulnerability_id,now())#>'{cvss,preferred}'='null'::jsonb from m14_cvss_cases where n=9));
perform pg_temp.check('EPS number/object normalization preserved',(select public.m4_03_intelligence_json(vulnerability_id,now())#>>'{epss,value}'='1'from m14_cvss_cases where n=10));
perform pg_temp.check('CWE and weakness enrichment preserved',(select jsonb_array_length(public.m4_03_intelligence_json(vulnerability_id,now())->'cwes')=2 from m14_cvss_cases where n=10));
perform pg_temp.check('vector-derived version fallback retained',(select public.m4_03_intelligence_json(vulnerability_id,now())#>>'{cvss,preferred,version}'='4.0'from m14_cvss_cases where n=11));
perform pg_temp.check('mixed feed freshness rows preserved',(select count(distinct freshness_state)=2 from public.m4_03_cvss_rows(array[(select vulnerability_id from m14_cvss_cases where n=11)])));
perform pg_temp.check('unknown vulnerability batch yields no material',not exists(select 1 from public.m4_03_cvss_rows(array[gen_random_uuid()])));
perform pg_temp.check('empty batch yields no material',not exists(select 1 from public.m4_03_cvss_rows('{}'::uuid[])));
perform pg_temp.check('source helper pinned/private',(select proconfig@>array['search_path=public, pg_temp']from pg_proc where oid='public.m4_03_cvss_rows(uuid[])'::regprocedure));
end$$;
select *from finish();
rollback;
