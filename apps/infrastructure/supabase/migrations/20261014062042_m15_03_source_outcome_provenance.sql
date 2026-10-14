-- Permission/outage outcomes keep the same strict provenance shape as success.
create or replace function public.m15_03_read_health_source(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_product_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
declare d jsonb; m public.organization_usage_meters; source_at timestamptz; observed text:=public.m7_snapshot_timestamp_utc(statement_timestamp()); q jsonb; freshness jsonb; n bigint; running bigint; retrying bigint; failed bigint; oldest timestamptz; permission text;begin
 if not public.m15_03_health_can(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden','source',p_source,'sourceAt',null,'observedAt',null,'data',null,'reasons',array['source_permission_withheld']);end if;
 if p_source is null or p_source not in ('deadline_monitor','vulnerability_feeds','usage_metering','licensing','exports','evidence_processing','reports','notifications','connectors','sboms') then raise exception 'invalid health source' using errcode='22023';end if;
 permission:=case p_source when 'deadline_monitor' then 'can_view_reporting' when 'vulnerability_feeds' then 'can_view_findings' when 'usage_metering' then 'can_view_licensing' when 'licensing' then 'can_view_licensing' when 'evidence_processing' then 'can_view_evidence' when 'connectors' then 'can_view_connectors' when 'sboms' then 'can_view_sboms' end;
 if (permission is null and p_source not in ('exports','reports','notifications')) or (permission='can_view_licensing' and not public.m15_01_actor_can(p_organization_id,p_actor_user_id,permission)) or (permission<>'can_view_licensing' and not public.m14_03_actor_can(p_organization_id,p_actor_user_id,permission))
 or (p_source in ('evidence_processing','connectors','sboms') and not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products'))
 or (p_product_id is not null and (not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id))) then
 return jsonb_build_object('outcome','withheld','source',p_source,'sourceAt',null,'observedAt',observed,'data',null,'reasons',array['source_permission_withheld']);end if;
 case p_source
 when 'deadline_monitor' then
 select last_evaluated_at,jsonb_build_object('lastHeartbeatAt',public.m7_snapshot_timestamp_utc(last_evaluated_at),'critical',critical_at is not null) into source_at,d from public.reporting_deadline_monitor_health where singleton;
 when 'usage_metering' then
 select * into m from public.organization_usage_meters where organization_id=p_organization_id;source_at:=m.updated_at;
 d:=jsonb_build_object('storage',jsonb_build_object('status',case when m.storage_ready and m.protected_storage_ready then 'degraded' else 'unknown' end,'customerBytes',case when m.storage_ready and m.protected_storage_ready then m.storage_bytes end,'customerReservedBytes',case when m.storage_ready and m.protected_storage_ready then m.storage_reserved_bytes end,'protectedBytes',case when m.storage_ready and m.protected_storage_ready then m.protected_storage_bytes end,'unit','bytes','sourceAt',public.m7_snapshot_timestamp_utc(source_at),'observedAt',observed,'reasons',case when m.storage_ready and m.protected_storage_ready then array['storage_integrity_unknown'] else array['meter_unavailable'] end,'reachability','unknown','integrity','unknown'));
 when 'licensing' then
 -- Signature, trusted clock and grace evaluation remain the runtime licensing authority.
 return jsonb_build_object('outcome','ready','source',p_source,'sourceAt',null,'observedAt',observed,'data','{}'::jsonb,'reasons','[]'::jsonb);
 when 'vulnerability_feeds' then
 select jsonb_agg(jsonb_build_object('id',feed_key,'label',upper(feed_key),'status',case when not enabled or coalesce(last_source_snapshot_at,last_success_at) is null then 'unknown' when coalesce(last_source_snapshot_at,last_success_at)<statement_timestamp()-make_interval(secs=>stale_threshold_seconds) then 'stale' else 'healthy' end,'lastSuccessAt',public.m7_snapshot_timestamp_utc(last_success_at),'lastSourceSnapshotAt',public.m7_snapshot_timestamp_utc(last_source_snapshot_at),'staleAfterSeconds',stale_threshold_seconds,'sourceAt',public.m7_snapshot_timestamp_utc(updated_at),'observedAt',observed,'reasons',case when not enabled or coalesce(last_source_snapshot_at,last_success_at) is null then array['no_successful_observation'] when coalesce(last_source_snapshot_at,last_success_at)<statement_timestamp()-make_interval(secs=>stale_threshold_seconds) then array['source_stale'] else '{}'::text[] end) order by feed_key),max(updated_at) into freshness,source_at from public.vulnerability_feed_configs;
 d:=jsonb_build_object('feedFreshness',coalesce(freshness,'[]'::jsonb),'queue',null);
 when 'evidence_processing' then
 -- A version linked to products outside the requested product must never leak aggregate work.
 with rows as (
 select 'pending' category,r.created_at from unnest(array['scan','extraction']) v(kind) cross join lateral(
 select j.created_at from public.evidence_document_scan_jobs j where v.kind='scan' and j.organization_id=p_organization_id and j.status='queued' and j.attempt_count=0 and (p_product_id is null or exists(select 1 from public.evidence_document_version_products l where l.organization_id=p_organization_id and l.version_id=j.version_id and l.product_id=p_product_id)) order by j.created_at,j.id limit 10000
 )r
 union all
 select v.category,r.created_at from (values('scan','running'),('scan','retrying'),('extraction','pending'),('extraction','running'),('extraction','retrying'),('extraction','failed'))v(kind,category) cross join lateral(
 select j.created_at from public.evidence_document_extraction_jobs j where v.kind='extraction' and j.organization_id=p_organization_id and j.status=case v.category when 'running' then 'leased' when 'failed' then 'failed' else 'queued' end and (v.category not in ('pending','retrying') or (v.category='pending' and j.attempt_count=0) or (v.category='retrying' and j.attempt_count>0)) and (p_product_id is null or exists(select 1 from public.evidence_document_version_products l where l.organization_id=p_organization_id and l.version_id=j.version_id and l.product_id=p_product_id)) order by j.created_at,j.id limit 10000
 )r
 union all
 select v.category,r.created_at from (values('running'),('retrying'))v(category) cross join lateral(
 select j.created_at from public.evidence_document_scan_jobs j where j.organization_id=p_organization_id and j.status=case v.category when 'running' then 'leased' else 'queued' end and (v.category='running' or j.attempt_count>0) and (p_product_id is null or exists(select 1 from public.evidence_document_version_products l where l.organization_id=p_organization_id and l.version_id=j.version_id and l.product_id=p_product_id)) order by j.created_at,j.id limit 10000
 )r
 ) select count(*)filter(where category='pending'),count(*)filter(where category='running'),count(*)filter(where category='retrying'),count(*)filter(where category='failed'),min(created_at)filter(where category='pending') into n,running,retrying,failed,oldest from rows;
 source_at:=statement_timestamp();d:=jsonb_build_object('queue',public.m15_03_queue('evidence_processing',n,running,retrying,0,0,failed,oldest,source_at));
 when 'exports','reports','notifications','connectors','sboms' then
 q:=public.m15_03_source_queue(p_organization_id,p_actor_user_id,p_source,p_product_id);
 if q is null then return jsonb_build_object('outcome','withheld','source',p_source,'sourceAt',null,'observedAt',observed,'data',null,'reasons',array['source_permission_withheld']);end if;
 source_at:=statement_timestamp();d:=jsonb_build_object('queue',q);
 else return jsonb_build_object('outcome','withheld','source',p_source,'sourceAt',null,'observedAt',observed,'data',null,'reasons',array['source_unavailable']);
 end case;
 return jsonb_build_object('outcome','ready','source',p_source,'observedAt',observed,'sourceAt',public.m7_snapshot_timestamp_utc(source_at),'data',d,'reasons','[]'::jsonb);
end $$;
notify pgrst,'reload schema';
