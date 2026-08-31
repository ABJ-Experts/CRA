-- Contract projection repair. Derived values are built from immutable current
-- source versions; absence remains explicit and never manufactures evidence.
create or replace function public.m4_03_kev_alert_json(p_organization_id uuid, p_alert_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',alerts.id,'findingId',alerts.triggering_finding_id,'releaseId',alerts.release_id,
    'productName',products.name,'releaseName',releases.label,'advisoryId',findings.canonical_advisory_id,
    'lifecycleState',alerts.lifecycle_state,'severity','high','status',case when alerts.state='new' then 'newly_listed'
      when alerts.state='acknowledged' then 'acknowledged' when alerts.reporting_status='linked' then 'obligation_exists' else 'resolved' end,
    'notificationStatus',case alerts.delivery_status when 'queued' then 'pending' when 'leased' then 'pending' else alerts.delivery_status end,
    'reportingStatus','downstream_reporting_unavailable',
    'kev',jsonb_build_object('freshness',case configs.freshness_state when 'healthy' then 'fresh' when 'stale' then 'stale' else 'unavailable' end,
      'assessedAt',versions.promoted_at,'status',case records.record_state when 'active' then 'listed' when 'withdrawn' then 'removed' when 'rejected' then 'disputed' else 'not_listed' end,
      'listingDate',alerts.kev_listing_date,'provenance',jsonb_build_object('sourceFeed','cisa_kev','sourceRecordId',records.id,
      'sourceRecordVersionId',versions.id,'observedAt',coalesce(records.source_updated_at,versions.source_updated_at),'retrievedAt',versions.promoted_at)),
    'createdAt',alerts.created_at,'updatedAt',alerts.updated_at,'acknowledgedAt',alerts.acknowledged_at,'obligation',null)
  from public.vulnerability_kev_alerts alerts join public.vulnerability_findings findings on findings.id=alerts.triggering_finding_id
  join public.product_releases releases on releases.organization_id=alerts.organization_id and releases.id=alerts.release_id
  join public.products products on products.organization_id=releases.organization_id and products.id=releases.product_id
  join public.vulnerability_source_records records on records.id=alerts.kev_source_record_id
  join public.vulnerability_source_record_versions versions on versions.id=alerts.kev_source_record_version_id
  join public.vulnerability_feed_configs configs on configs.feed_key='cisa_kev'
  where alerts.organization_id=p_organization_id and alerts.id=p_alert_id;
$$;

create or replace function public.list_vulnerability_enriched_findings_for_document_page(
  p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_include_low_confidence boolean,
  p_page integer default 1,p_page_size integer default 50,p_q text default null
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rows jsonb; v_total integer;
begin
 if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_include_low_confidence is null
    or p_page not between 1 and 1000000 or p_page_size not between 1 and 100 or p_q is not null and char_length(btrim(p_q))>200
    or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id)
    or not exists(select 1 from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_document_id) then
   return query select 'not_found'::text,null::jsonb; return; end if;
 with base as (
  select distinct f.*,o.component_id,o.canonical_purl,o.component_version,o.document_id,r.lifecycle,r.label,p.name as product_name
  from public.vulnerability_findings f join public.vulnerability_finding_component_occurrences l on l.finding_id=f.id and l.organization_id=f.organization_id and l.state='active'
  join public.vulnerability_component_occurrences o on o.id=l.occurrence_id and o.organization_id=f.organization_id
  join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
  join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
  where f.organization_id=p_organization_id and o.document_id=p_document_id and f.status='active'
   and (p_include_low_confidence or f.confidence>=.9) and (p_q is null or concat_ws(' ',f.canonical_advisory_id,o.canonical_purl,o.component_version) ilike '%'||btrim(p_q)||'%')
 ), numbered as (select base.*,count(*) over() as total_count from base), page as (
  select * from numbered order by confidence desc,id offset (p_page-1)*p_page_size limit p_page_size
 ) select coalesce((select max(total_count)::integer from numbered),0),coalesce(jsonb_agg(jsonb_build_object(
  'finding',jsonb_build_object('id',page.id,'documentId',page.document_id,'releaseId',page.release_id,'componentId',page.component_id,
   'canonicalPurl',page.canonical_purl,'evaluatedVersion',page.evaluated_component_value,'advisoryId',page.canonical_advisory_id,
   'advisoryAliases',coalesce((select jsonb_agg(a.alias order by a.alias) from public.vulnerability_aliases a where a.vulnerability_id=page.vulnerability_id),'[]'::jsonb),
   'matchMethod','purl_osv','outcome','affected','sourceFeed',page.source_feed_key,'sourceRecordId',page.source_record_id,
   'sourceRecordVersionId',page.source_record_version_id,'affectedRangeId',page.affected_range_id,'affectedRangeEvents',page.event_sequence,
   'affectedVersions',coalesce(page.affected_range->'versions','[]'::jsonb),'comparator',page.comparator_name,'comparatorVersion',page.comparator_version,
   'confidence',jsonb_build_object('score',page.confidence,'level',case when page.confidence>=.9 then 'high' when page.confidence>=.6 then 'medium' else 'low' end,'explanation',page.confidence_explanation,'tableVersion',page.confidence_table_version),
   'firstDetectedAt',page.first_detected_at,'lastEvaluatedAt',page.last_evaluated_at,'createdAt',page.created_at,'updatedAt',page.updated_at),
  'release',jsonb_build_object('productName',page.product_name,'releaseName',page.label,'lifecycleState',page.lifecycle),
  'intelligence',jsonb_build_object(
   'cvss',jsonb_build_object('freshness','absent','assessedAt',page.last_evaluated_at,'preferred',null,'observations','[]'::jsonb),
   'epss',jsonb_build_object('freshness','absent','assessedAt',page.last_evaluated_at,'value',null,'observationDate',null,'provenance',null),
   'kev',coalesce((select jsonb_build_object('freshness',case c.freshness_state when 'healthy' then 'fresh' when 'stale' then 'stale' else 'unavailable' end,'assessedAt',v.promoted_at,
    'status','listed','listingDate',coalesce(sr.source_updated_at,v.source_updated_at,v.promoted_at)::date,'provenance',jsonb_build_object('sourceFeed','cisa_kev','sourceRecordId',sr.id,'sourceRecordVersionId',v.id,'observedAt',coalesce(sr.source_updated_at,v.source_updated_at),'retrievedAt',v.promoted_at))
    from public.vulnerability_source_records sr join public.vulnerability_source_record_versions v on v.id=sr.current_version_id join public.vulnerability_enrichments e on e.source_record_version_id=v.id and e.enrichment_type='kev' and e.enrichment->'value'='true'::jsonb join public.vulnerability_feed_configs c on c.feed_key='cisa_kev' where sr.feed_key='cisa_kev' and sr.vulnerability_id=page.vulnerability_id and sr.record_state='active' limit 1),
    jsonb_build_object('freshness','absent','assessedAt',page.last_evaluated_at,'status','not_listed','listingDate',null,'provenance',null)),
   'cwes','[]'::jsonb,'aliases','[]'::jsonb,'references','[]'::jsonb)) order by page.confidence desc,page.id),'[]'::jsonb) into v_total,v_rows from page;
 return query select 'found'::text,jsonb_build_object('rows',v_rows,'alerts',coalesce((select jsonb_agg(public.m4_03_kev_alert_json(p_organization_id,a.id) order by a.created_at desc,a.id) from public.vulnerability_kev_alerts a where a.organization_id=p_organization_id and exists(select 1 from public.vulnerability_component_occurrences o where o.organization_id=p_organization_id and o.document_id=p_document_id and o.release_id=a.release_id)),'[]'::jsonb),'total',v_total);
end;
$$;
alter function public.m4_03_kev_alert_json(uuid,uuid) owner to postgres;
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) owner to postgres;
revoke all on function public.m4_03_kev_alert_json(uuid,uuid),public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) from public,anon,authenticated;
grant execute on function public.m4_03_kev_alert_json(uuid,uuid),public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) to service_role;
