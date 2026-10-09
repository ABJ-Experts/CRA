-- Synthetic-only bootstrap for an empty schema clone. Never run against development.
-- No retained source records, authentication identities, credentials, or secrets.
begin;
do $$
begin
  if current_database() <> 'cra_m14_benchmark' then
    raise exception 'M14 bootstrap requires isolated cra_m14_benchmark database';
  end if;
  if exists(select 1 from public.users) or exists(select 1 from public.products) then
    raise exception 'M14 bootstrap requires an empty synthetic schema clone';
  end if;
end $$;

insert into public.users(id,email,first_name,last_name)
values('00000000-0000-4000-8000-0000000000cb','owner@cra.test','Synthetic','Benchmark Owner');
insert into public.organizations(id,name,slug)
values('00000000-0000-4000-8000-0000000000ca','M14 synthetic disposable benchmark','m14-synthetic-disposable');
insert into public.organization_members(organization_id,user_id,role)
values('00000000-0000-4000-8000-0000000000ca','00000000-0000-4000-8000-0000000000cb','owner');
insert into public.organization_legal_entities(
  id,organization_id,identifier,display_name,legal_name,registered_address_line_1,
  registered_address_locality,registered_address_postal_code,registered_address_country,
  main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,
  completion_status,status,is_default,created_by,updated_by
)values(
  '00000000-0000-4000-8000-0000000000cc','00000000-0000-4000-8000-0000000000ca',
  'synthetic-benchmark','Synthetic Benchmark Entity','Synthetic Benchmark Entity',
  '1 Synthetic Fixture Street','Synthetic City','10000','DE','DE',
  'Synthetic Fixture Contact','synthetic-benchmark@example.invalid','complete','active',true,
  '00000000-0000-4000-8000-0000000000cb','00000000-0000-4000-8000-0000000000cb'
);
insert into public.products(
  id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,
  name,internal_code,product_type,responsible_owner_id,created_by,updated_by
)select
  '00000000-0000-4000-8000-0000000000cd',e.organization_id,e.id,e.version,to_jsonb(e),
  'Synthetic M14 Bootstrap Product','synthetic-bootstrap-product','standalone_software',
  '00000000-0000-4000-8000-0000000000cb','00000000-0000-4000-8000-0000000000cb',
  '00000000-0000-4000-8000-0000000000cb'
from public.organization_legal_entities e where e.id='00000000-0000-4000-8000-0000000000cc';
insert into public.product_releases(
  id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,
  label,release_version,lifecycle,placed_on_market_at,created_by,updated_by
)select
  '00000000-0000-4000-8000-0000000000ce',p.organization_id,p.id,p.legal_entity_id,
  p.legal_entity_version,p.legal_entity_snapshot,'Synthetic bootstrap release',
  'synthetic-bootstrap-release','placed_on_market',statement_timestamp(),p.created_by,p.updated_by
from public.products p where p.id='00000000-0000-4000-8000-0000000000cd';

-- Minimal source-owned global reference graph; all values are explicitly synthetic.
insert into public.vulnerability_feed_configs(
  feed_key,schedule_interval_seconds,stale_threshold_seconds,sync_state,freshness_state,
  last_success_at,last_source_snapshot_at
)values('osv',86400,172800,'healthy','healthy',statement_timestamp(),statement_timestamp());
insert into public.vulnerabilities(id,canonical_id,title)
values('00000000-0000-4000-8000-0000000000cf','CVE-M14-SYNTHETIC-BOOTSTRAP','Synthetic benchmark advisory');
insert into public.vulnerability_feed_sync_runs(id,feed_key,run_kind,correlation_id,status)
values('00000000-0000-4000-8000-0000000000d0','osv','manual','00000000-0000-4000-8000-0000000000d1','completed');
insert into public.vulnerability_source_records(id,feed_key,source_record_key,vulnerability_id)
values('00000000-0000-4000-8000-0000000000d2','osv','synthetic-m14-bootstrap-source','00000000-0000-4000-8000-0000000000cf');
insert into public.vulnerability_source_record_versions(
  id,source_record_id,run_id,record_sha256,record_state,raw_payload,normalized_payload
)values(
  '00000000-0000-4000-8000-0000000000d3','00000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d0',repeat('a',64),'active',
  '{"synthetic":true}','{"synthetic":true}'
);
insert into public.vulnerability_affected_ranges(id,vulnerability_id,source_record_version_id,range_value)
values('00000000-0000-4000-8000-0000000000d4','00000000-0000-4000-8000-0000000000cf','00000000-0000-4000-8000-0000000000d3','{}');
insert into public.vulnerability_findings(
  id,organization_id,release_id,component_identity,canonical_advisory_id,vulnerability_id,
  source_feed_key,source_record_id,source_record_version_id,affected_range_id,match_method,
  comparator_name,comparator_version,evaluated_component_value,affected_range,event_sequence,
  confidence,confidence_table_version,confidence_explanation
)values(
  '00000000-0000-4000-8000-0000000000d5','00000000-0000-4000-8000-0000000000ca',
  '00000000-0000-4000-8000-0000000000ce','synthetic-bootstrap-component',
  'CVE-M14-SYNTHETIC-BOOTSTRAP','00000000-0000-4000-8000-0000000000cf','osv',
  '00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000d3',
  '00000000-0000-4000-8000-0000000000d4','purl_osv','synthetic-m14-benchmark','1','1',
  '{}','[]',0.9,'synthetic-m14-benchmark','Synthetic disposable benchmark finding'
);

do $$
declare j jsonb;
begin
  j:=public.get_dashboard_projection('00000000-0000-4000-8000-0000000000ca','00000000-0000-4000-8000-0000000000cb','overview','{}');
  if j->>'outcome'<>'found' or j#>>'{result,products,state}'<>'available'
    or j#>>'{result,findings,state}'<>'available'
    or (j#>>'{result,findings,data,openCount}')::integer<>1
    or exists(select 1 from jsonb_each(j->'result')v where v.value->>'state'='unavailable')then
    raise exception 'Synthetic M14 bootstrap did not produce healthy source projections';
  end if;
end $$;
commit;
