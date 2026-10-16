-- Disposable clone only. Rollback is the default; explicit committed mode
-- retains uniquely identified synthetic organizations for HTTP verification.
begin;
do $$begin
 if current_database() not in('cra_m14_benchmark','cra_m14_05_benchmark') then
  raise exception 'Portfolio benchmark requires an isolated database';
 end if;
end$$;
set local statement_timeout='30min';
create temporary table m14_05_benchmark_config as select
 :'components'::integer components,:'samples'::integer samples,
 gen_random_uuid() run_id,gen_random_uuid() org,gen_random_uuid() small_org,
 gen_random_uuid() entity,gen_random_uuid() small_entity,
 (select id from public.users where email='owner@cra.test') actor,
 (select id from public.users where email='admin@cra.test') small_actor;
do $$declare c record;begin
 select *into c from m14_05_benchmark_config;
 if c.components not in(10000,100000,1000000)or c.samples not between 2 and 500 or c.actor is null or c.small_actor is null or c.actor=c.small_actor then
  raise exception 'Benchmark requires valid scale and distinct existing owner/admin identities';
 end if;
end$$;
-- Replica mode avoids write-side audit/snapshot costs in disposable fixtures.
-- Checks and uniqueness remain enforced; tenant graph is validated below.
set local session_replication_role=replica;
insert into public.organizations(id,name,slug)
select org,'M14-05 synthetic benchmark','m14-05-bench-'||run_id from m14_05_benchmark_config
union all select small_org,'M14-05 synthetic small tenant','m14-05-small-'||run_id from m14_05_benchmark_config;
-- Replica bulk loading bypasses the organization bootstrap trigger. Explicitly
-- retain its active lifecycle so the real authentication guard stays enabled.
insert into public.organization_lifecycles(organization_id)
select org from m14_05_benchmark_config union all select small_org from m14_05_benchmark_config;
insert into public.organization_permissions_version(organization_id)
select org from m14_05_benchmark_config union all select small_org from m14_05_benchmark_config;
insert into public.organization_members(organization_id,user_id,role)
select org,actor,'owner'from m14_05_benchmark_config union all select small_org,small_actor,'owner'from m14_05_benchmark_config;
insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)
select entity,org,'benchmark','Synthetic benchmark entity','needs_completion','inactive',actor,actor from m14_05_benchmark_config
union all select small_entity,small_org,'benchmark','Synthetic small entity','needs_completion','inactive',small_actor,small_actor from m14_05_benchmark_config;
create temporary table m14_05_benchmark_ids as
select n,gen_random_uuid()product,gen_random_uuid()release,gen_random_uuid()source,
 gen_random_uuid()raw,gen_random_uuid()job,gen_random_uuid()document,
 case when n<=1000 then c.org else c.small_org end org,
 case when n<=1000 then c.entity else c.small_entity end entity,
 case when n<=1000 then c.actor else c.small_actor end actor
from generate_series(1,1010)n cross join m14_05_benchmark_config c;
insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
select i.product,i.org,i.entity,0,'{}','Synthetic portfolio '||n,'m14-05-'||c.run_id||'-'||n,'standalone_software',i.actor,i.actor,i.actor
from m14_05_benchmark_ids i cross join m14_05_benchmark_config c;
insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,lifecycle,placed_on_market_at,created_by,updated_by)
select i.release,i.org,i.product,i.entity,0,'{}','Synthetic marketed release','1.0.0','placed_on_market',statement_timestamp(),i.actor,i.actor
from m14_05_benchmark_ids i cross join m14_05_benchmark_config c;
insert into public.sbom_raw_objects(id,organization_id,sha256,byte_size,media_type,storage_key)
select i.raw,i.org,md5(i.raw::text)||md5(i.raw::text),200*case when i.n<=1000 then c.components/1000 else 10 end,'application/json',i.org||'/'||i.source||'/'||md5(i.raw::text)||md5(i.raw::text)from m14_05_benchmark_ids i cross join m14_05_benchmark_config c;
insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,status,upload_expires_at,verified_at,raw_object_id,correlation_id)
select i.source,i.org,i.product,i.release,i.actor,'manual_upload',gen_random_uuid(),md5(i.source::text)||md5(i.source::text),'synthetic.json','application/json',200*case when n<=1000 then c.components/1000 else 10 end,md5(i.raw::text)||md5(i.raw::text),i.org||'/'||i.source||'/'||md5(i.raw::text)||md5(i.raw::text),'verified',statement_timestamp()+interval'1 hour',statement_timestamp(),i.raw,gen_random_uuid()
from m14_05_benchmark_ids i cross join m14_05_benchmark_config c;
insert into public.sbom_ingest_jobs(id,organization_id,source_id,release_id,actor_user_id,correlation_id,idempotency_key,input_sha256,status,progress_stage,progress_percent,completed_at,validation_status,validator_name,validator_version,validation_completed_at,validation_report)
select i.job,i.org,i.source,i.release,i.actor,gen_random_uuid(),gen_random_uuid(),md5(i.raw::text)||md5(i.raw::text),'completed','completed',100,statement_timestamp(),'valid','synthetic','1',statement_timestamp(),
jsonb_build_object('completedAt',public.m6_utc_second_z(statement_timestamp()),'detected',jsonb_build_object('format','cyclonedx','serialization','json','specificationVersion','1.6'),'diagnostics','[]'::jsonb,'errorCount',0,'omittedDiagnosticCount',0,'status','valid','validator',jsonb_build_object('name','synthetic','schemaAssetSha256',repeat('a',64),'version','1'),'warningCount',0)
from m14_05_benchmark_ids i cross join m14_05_benchmark_config c;
insert into public.sbom_documents(id,organization_id,source_id,raw_object_id,ingest_job_id,document_sha256,format,serialization,specification_version,parser_name,parser_version,normalizer_name,normalizer_version,validation_status,state,progress_stage,completed_at,component_count)
select i.document,i.org,i.source,i.raw,i.job,md5(i.document::text)||md5(i.document::text),'cyclonedx','json','1.6','synthetic','1','synthetic','1','valid','completed','completed',statement_timestamp(),case when n<=1000 then c.components/1000 else 10 end
from m14_05_benchmark_ids i cross join m14_05_benchmark_config c;
insert into public.sbom_document_sources(organization_id,document_id,source_id,raw_object_id,release_id)
select org,document,source,raw,release from m14_05_benchmark_ids;
-- Every package is shared by all 1000 products, giving a tie-heavy deterministic
-- ranking. A row represents a real distinct product/document/component tuple.
insert into public.sbom_components(organization_id,document_id,document_local_ref,source_offset,source_byte_end,source_path,original_name,normalized_name,original_version,normalized_version,canonical_purl,ecosystem,depth)
select i.org,i.document,'component-'||g.n,(g.n-1)*200,g.n*200,'components['||g.n||']','synthetic-'||g.n,'synthetic-'||g.n,'1.0.0','1.0.0','pkg:npm/synthetic-'||g.n||'@1.0.0','npm',1
from m14_05_benchmark_ids i cross join m14_05_benchmark_config c
cross join lateral generate_series(1,case when i.n<=1000 then c.components/1000 else 10 end)g(n);
set local session_replication_role=origin;
do $$declare c record;begin
 select *into c from m14_05_benchmark_config;
 if(select count(*)from public.sbom_components where organization_id=c.org)<>c.components
 or(select count(*)from public.products where organization_id=c.org)<>1000
 or(select count(*)from public.sbom_components where organization_id=c.small_org)<>100 then
  raise exception 'Synthetic membership cardinality mismatch';
 end if;
 if exists(select 1 from m14_05_benchmark_ids i
 left join public.products p on p.organization_id=i.org and p.id=i.product
 left join public.product_releases r on r.organization_id=i.org and r.id=i.release and r.product_id=i.product
 left join public.sbom_sources s on s.organization_id=i.org and s.id=i.source and s.product_id=i.product and s.release_id=i.release and s.raw_object_id=i.raw
 left join public.sbom_ingest_jobs j on j.organization_id=i.org and j.id=i.job and j.source_id=i.source and j.release_id=i.release
 left join public.sbom_documents d on d.organization_id=i.org and d.id=i.document and d.source_id=i.source and d.raw_object_id=i.raw and d.ingest_job_id=i.job
 left join public.sbom_document_sources l on l.organization_id=i.org and l.document_id=i.document and l.source_id=i.source and l.release_id=i.release and l.raw_object_id=i.raw
 where p.id is null or r.id is null or s.id is null or j.id is null or d.id is null or l.document_id is null)then
  raise exception 'Synthetic tenant/source lineage invalid';
 end if;
end$$;
analyze public.products;
analyze public.product_releases;
analyze public.sbom_sources;
analyze public.sbom_ingest_jobs;
analyze public.sbom_documents;
analyze public.sbom_document_sources;
analyze public.sbom_components;
create temporary table m14_05_benchmark_timings(endpoint text,ms numeric,bytes integer);
do $$declare c record;endpoint text;n integer;started timestamptz;v jsonb;component jsonb;filters jsonb;begin
 select *into c from m14_05_benchmark_config;
 select public.get_portfolio_projection(c.org,c.actor,'concentration','{"limit":20}') into v;
 if v->>'outcome'<>'found'or(v#>>'{result,coverage,data,totalComponents}')::integer<>c.components then
  raise exception 'Projection cardinality mismatch: %',v->>'outcome';
 end if;
 component:=v#>'{result,concentration,data,rows,0}';
 if component is null or(component->>'productCount')::integer<>1000 or(component->>'releaseCount')::integer<>1000 then
  raise exception 'Tie-heavy distinct product/release concentration mismatch';end if;
 foreach endpoint in array array['products','concentration','detail']loop
  filters:=case when endpoint='detail'then jsonb_build_object('limit',20,'component',jsonb_build_object('identityDigest',public.m14_05_identity_digest(component->>'packageIdentity',component->>'version')))else'{"limit":20}'::jsonb end;
  for n in 1..c.samples loop
   started:=clock_timestamp();v:=public.get_portfolio_projection(c.org,c.actor,endpoint,filters);
   insert into m14_05_benchmark_timings values(endpoint,1000*extract(epoch from clock_timestamp()-started),octet_length(v::text));
   if v->>'outcome'<>'found'then raise exception 'Measured projection failed: %',v->>'outcome';end if;
   if jsonb_array_length(v#>array['result',case endpoint when'products'then'products'when'concentration'then'concentration'else'affectedReleases'end,'data','rows'])>20 then
    raise exception 'Measured projection exceeded bounded page';end if;
  end loop;
 end loop;
end$$;
select jsonb_build_object('benchmarkRunId',run_id,'organizationId',org,'entityId',entity,'smallOrganizationId',small_org,'smallEntityId',small_entity,'actorId',actor,'smallActorId',small_actor,'components',components,'products',1000,'committed',:'committed'::boolean)from m14_05_benchmark_config;
select jsonb_build_object('endpoint',endpoint,'samples',count(*),'p50Ms',percentile_disc(0.50)within group(order by ms),'p95Ms',percentile_disc(0.95)within group(order by ms),'p99Ms',percentile_disc(0.99)within group(order by ms),'maxResponseBytes',max(bytes),'rawElapsedMs',jsonb_agg(ms),'measurement','SQL projection; authenticated HTTP requires separate harness','concurrentSmallTenant',false)
from m14_05_benchmark_timings group by endpoint order by endpoint;
explain(analyze,buffers,format json)select public.get_portfolio_projection(org,actor,'concentration','{"limit":20}')from m14_05_benchmark_config;
\if :committed
commit;
\else
rollback;
\endif
