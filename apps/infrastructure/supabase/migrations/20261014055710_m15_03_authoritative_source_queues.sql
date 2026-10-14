-- Customer feed execution is not tenant-owned. Freshness remains separately gated.
drop index public.m15_03_feed_health;
create index m15_03_export_health on public.export_jobs(organization_id,requester_id,state,requested_at,id);
create index m15_03_org_export_health on public.organization_export_jobs(organization_id,actor_user_id,status,created_at,id);
create index m15_03_watermark_health on public.evidence_document_watermark_exports(organization_id,requested_by_user_id,status,created_at,id);
create index m15_03_sync_health on public.sync_runs(organization_id,status,created_at,id);
create index m15_03_sbom_health on public.sbom_ingest_jobs(organization_id,status,created_at,id);
create index m15_03_report_health on public.report_run_recipients(organization_id,generation_state,created_at,id);
create index m15_03_notification_health on public.notification_dispatches(organization_id,effective_recipient_user_id,status,created_at,id);

create function public.m15_03_notification_visible(p_org uuid,p_actor uuid,p_row public.notification_dispatches,p_product uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_row.organization_id<>p_org or p_row.effective_recipient_user_id<>p_actor then return false;end if;
 case p_row.source_type
 when 'evidence_validity','evidence_quarantined','evidence_integrity_failure' then
 return public.m14_03_actor_can(p_org,p_actor,'can_view_evidence') and public.m14_03_actor_can(p_org,p_actor,'can_view_products') and exists(select 1 from public.evidence_document_notification_outbox o join public.evidence_document_version_products l on l.organization_id=p_org and l.version_id=o.version_id join public.products p on p.organization_id=p_org and p.id=l.product_id where o.organization_id=p_org and o.id=p_row.source_id and (p_product is null or p.id=p_product));
 when 'finding_triage_alert' then
 return public.m14_03_actor_can(p_org,p_actor,'can_view_findings') and public.m14_03_actor_can(p_org,p_actor,'can_view_products') and exists(select 1 from public.vulnerability_triage_alert_events e join public.vulnerability_findings f on f.organization_id=p_org and f.id=e.finding_id join public.product_releases r on r.organization_id=p_org and r.id=f.release_id where e.organization_id=p_org and e.id=p_row.source_id and (p_product is null or r.product_id=p_product));
 when 'supplier_owner_escalation' then
 return public.m14_03_actor_can(p_org,p_actor,'can_view_suppliers') and public.m14_03_actor_can(p_org,p_actor,'can_view_products') and exists(select 1 from public.supplier_evidence_reminder_deliveries d join public.supplier_evidence_requests r on r.organization_id=p_org and r.id=d.request_id where d.organization_id=p_org and d.id=p_row.source_id and (p_product is null or r.product_id=p_product));
 when 'report_run_recipient' then
 return exists(select 1 from public.report_run_recipients q join public.report_runs r on r.organization_id=p_org and r.id=q.run_id where q.organization_id=p_org and q.id=p_row.source_id and q.user_id=p_actor and public.m14_04_source_access(p_org,p_actor,r.config) and (p_product is null or coalesce(r.config#>>'{report,productId}',r.config#>>'{report,context,productId}')=p_product::text));
 else return false;end case;end $$;

create function public.m15_03_source_queue(p_org uuid,p_actor uuid,p_source text,p_product uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
declare n bigint:=0;running bigint:=0;retrying bigint:=0;review bigint:=0;uncertain bigint:=0;failed bigint:=0;oldest timestamptz;begin
 case p_source
 when 'connectors' then
 -- Connector runs are organization-scoped. No product narrowing is implied by
 -- an integration mapping; a product-specific request withholds this source.
 if p_product is not null then return null;end if;
 select count(*)filter(where category='pending'),count(*)filter(where category='running'),count(*)filter(where category='retrying'),count(*)filter(where category='review'),count(*)filter(where category='failed'),min(created_at)filter(where category='pending') into n,running,retrying,review,failed,oldest
 from (select v.category,r.created_at from (values('pending','queued'),('running','running'),('retrying','retrying'),('review','waiting_for_review'),('failed','failed'))v(category,state) cross join lateral(select j.created_at from public.sync_runs j join public.connectors c on c.organization_id=p_org and c.id=j.connector_id where j.organization_id=p_org and j.status=v.state order by j.created_at,j.id limit 10000)r)bounded;
 when 'sboms' then
 select count(*)filter(where category='pending'),count(*)filter(where category='running'),count(*)filter(where category='retrying'),count(*)filter(where category='failed'),min(created_at)filter(where category='pending') into n,running,retrying,failed,oldest
 from (select v.category,r.created_at from (values('pending','queued'),('running','processing'),('retrying','failed'),('failed','dead_letter'))v(category,state) cross join lateral(select j.created_at from public.sbom_ingest_jobs j join public.sbom_sources s on s.organization_id=p_org and s.id=j.source_id join public.products p on p.organization_id=p_org and p.id=s.product_id where j.organization_id=p_org and j.status=v.state and (p_product is null or p.id=p_product) order by j.created_at,j.id limit 10000)r)bounded;
 when 'reports' then
 select count(*)filter(where category='pending'),count(*)filter(where category='running'),count(*)filter(where category='failed'),count(*)filter(where category='uncertain'),min(created_at)filter(where category='pending') into n,running,failed,uncertain,oldest
 from(select v.category,q.created_at from (values('pending','waiting'),('running','running'),('failed','failed'),('uncertain','ready'))v(category,state) cross join lateral(select q.created_at from public.report_run_recipients q join public.report_runs r on r.organization_id=p_org and r.id=q.run_id where q.organization_id=p_org and q.generation_state=v.state and (v.category<>'uncertain' or q.email_state='uncertain') and (r.owner_user_id=p_actor or q.user_id=p_actor) and public.m14_04_source_access(p_org,p_actor,r.config) and (p_product is null or coalesce(r.config#>>'{report,productId}',r.config#>>'{report,context,productId}')=p_product::text) order by q.created_at,q.id limit 10000)q)bounded;
 when 'notifications' then
 select count(*)filter(where category='pending'),count(*)filter(where category='running'),count(*)filter(where category='retrying'),count(*)filter(where category='failed'),min(created_at)filter(where category='pending') into n,running,retrying,failed,oldest
 from(select v.category,d.created_at from(values('pending','queued'),('pending','digest_pending'),('pending','burst_pending'),('running','leased'),('retrying','retrying'),('failed','failed'),('failed','exhausted'))v(category,state) cross join lateral(select d.created_at from public.notification_dispatches d where d.organization_id=p_org and d.effective_recipient_user_id=p_actor and d.status=v.state and public.m15_03_notification_visible(p_org,p_actor,d,p_product) order by d.created_at,d.id limit 10000)d)bounded;
 -- Scheduled email uncertainty is tenant/recipient scoped and requires the
 -- current report source authority. It is distinct from an ordinary retry.
 select count(*) into uncertain from(select q.id from public.report_run_recipients q join public.report_runs r on r.organization_id=p_org and r.id=q.run_id where q.organization_id=p_org and q.user_id=p_actor and q.email_state='uncertain' and public.m14_04_source_access(p_org,p_actor,r.config) and (p_product is null or coalesce(r.config#>>'{report,productId}',r.config#>>'{report,context,productId}')=p_product::text) order by q.created_at,q.id limit 10000)q;
 when 'exports' then
 select count(*)filter(where category='pending'),count(*)filter(where category='running'),count(*)filter(where category='retrying'),count(*)filter(where category='review'),count(*)filter(where category='failed'),min(created_at)filter(where category='pending') into n,running,retrying,review,failed,oldest from (
 select v.category,j.requested_at created_at from(values('pending','queued'),('running','capturing'),('running','audit_pending'),('running','rendering'),('failed','failed'))v(category,state) cross join lateral(select j.requested_at from public.export_jobs j where j.organization_id=p_org and j.requester_id=p_actor and j.state=v.state and public.m14_04_source_actor_access(p_org,p_actor,j.source,j.context) and (p_product is null or j.context->>'productId'=p_product::text) order by j.requested_at,j.id limit 10000)j
 union all
 select v.category,j.created_at from(values('pending','queued'),('running','running'),('retrying','failed'),('review','paused'),('failed','dead_letter'))v(category,state) cross join lateral(select j.created_at from public.organization_export_jobs j where p_product is null and j.organization_id=p_org and j.actor_user_id=p_actor and j.status=v.state and public.m14_03_actor_can(p_org,p_actor,'can_export_organization') order by j.created_at,j.id limit 10000)j
 union all
 select v.category,j.created_at from(values('pending','queued'),('running','claimed'),('failed','failed'))v(category,state) cross join lateral(select j.created_at from public.evidence_document_watermark_exports j join public.products p on p.organization_id=p_org and p.id=j.product_id where j.organization_id=p_org and j.requested_by_user_id=p_actor and j.status=v.state and public.m14_03_actor_can(p_org,p_actor,'can_view_evidence') and public.m14_03_actor_can(p_org,p_actor,'can_export_evidence') and public.m14_03_actor_can(p_org,p_actor,'can_view_products') and (p_product is null or j.product_id=p_product) order by j.created_at,j.id limit 10000)j
 )bounded;
 else return null;end case;
 return public.m15_03_queue(p_source,n,running,retrying,review,uncertain,failed,oldest,statement_timestamp());end $$;

revoke all on function public.m15_03_notification_visible(uuid,uuid,public.notification_dispatches,uuid),public.m15_03_source_queue(uuid,uuid,text,uuid) from public,anon,authenticated,service_role,cra_operator_registry_reader;

create or replace function public.m15_03_read_health_source(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_product_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
declare d jsonb; m public.organization_usage_meters; source_at timestamptz; observed text:=public.m7_snapshot_timestamp_utc(statement_timestamp()); q jsonb; freshness jsonb; n bigint; running bigint; retrying bigint; failed bigint; review bigint; oldest timestamptz; permission text;begin
 if not public.m15_03_health_can(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden','source',p_source,'observedAt',null,'data',null,'reasons',array['source_permission_withheld']);end if;
 if p_source is null or p_source not in ('deadline_monitor','vulnerability_feeds','usage_metering','licensing','exports','evidence_processing','reports','notifications','connectors','sboms') then raise exception 'invalid health source' using errcode='22023';end if;
 permission:=case p_source when 'deadline_monitor' then 'can_view_reporting' when 'vulnerability_feeds' then 'can_view_findings' when 'usage_metering' then 'can_view_licensing' when 'licensing' then 'can_view_licensing' when 'evidence_processing' then 'can_view_evidence' when 'connectors' then 'can_view_connectors' when 'sboms' then 'can_view_sboms' end;
 if (permission is null and p_source not in ('exports','reports','notifications')) or (permission='can_view_licensing' and not public.m15_01_actor_can(p_organization_id,p_actor_user_id,permission)) or (permission<>'can_view_licensing' and not public.m14_03_actor_can(p_organization_id,p_actor_user_id,permission))
 or (p_source in ('evidence_processing','connectors','sboms') and not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products'))
 or (p_product_id is not null and (not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id))) then
 return jsonb_build_object('outcome','withheld','source',p_source,'observedAt',observed,'data',null,'reasons',array['source_permission_withheld']);end if;
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
 if q is null then return jsonb_build_object('outcome','withheld','source',p_source,'observedAt',observed,'data',null,'reasons',array['source_permission_withheld']);end if;
 source_at:=statement_timestamp();d:=jsonb_build_object('queue',q);
 else return jsonb_build_object('outcome','withheld','source',p_source,'observedAt',observed,'data',null,'reasons',array['source_unavailable']);
 end case;
 return jsonb_build_object('outcome','ready','source',p_source,'observedAt',observed,'sourceAt',public.m7_snapshot_timestamp_utc(source_at),'data',d,'reasons','[]'::jsonb);
end $$;
notify pgrst,'reload schema';
