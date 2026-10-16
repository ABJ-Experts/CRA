alter table public.vulnerability_kev_alerts
  add column if not exists reporting_idempotency_key uuid;
create unique index if not exists vulnerability_kev_alerts_reporting_idempotency_idx
  on public.vulnerability_kev_alerts(organization_id, id, reporting_idempotency_key)
  where reporting_idempotency_key is not null;

create or replace function public.record_vulnerability_kev_reporting_intent_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_alert_id uuid,
  p_reporting_status text,p_external_obligation_id text,p_idempotency_key uuid
) returns table(outcome text,alert jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.vulnerability_kev_alerts%rowtype;
begin
 if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_alert_id is null or p_idempotency_key is null
   or p_reporting_status not in ('downstream_unavailable','linked') or not public.m4_03_actor_can_edit_findings(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb;return;end if;
 select alerts.* into a from public.vulnerability_kev_alerts alerts where alerts.organization_id=p_organization_id and alerts.id=p_alert_id and exists(
  select 1 from public.vulnerability_findings f join public.vulnerability_finding_component_occurrences l on l.finding_id=f.id and l.organization_id=f.organization_id and l.state='active'
  join public.vulnerability_component_occurrences o on o.id=l.occurrence_id and o.organization_id=f.organization_id
  where f.organization_id=p_organization_id and f.release_id=alerts.release_id and f.vulnerability_id=alerts.vulnerability_id and f.status='active' and o.document_id=p_document_id) for update;
 if not found then return query select 'not_found'::text,null::jsonb;return;end if;
 if a.state='resolved' then return query select 'invalid_state'::text,null::jsonb;return;end if;
 if a.reporting_idempotency_key is null then
   update public.vulnerability_kev_alerts set reporting_status=case when p_reporting_status='linked' then 'linked' else 'downstream_unavailable' end,
     external_obligation_id=case when p_reporting_status='linked' then p_external_obligation_id else null end,
     reporting_intent_opened_at=clock_timestamp(),reporting_intent_opened_by=p_actor_user_id,reporting_idempotency_key=p_idempotency_key
   where organization_id=p_organization_id and id=p_alert_id;
   insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.kev_reporting_intent_recorded','vulnerability_kev_alert',p_alert_id::text,jsonb_build_object('documentId',p_document_id,'reportingStatus',p_reporting_status,'idempotencyKey',p_idempotency_key));
 elsif a.reporting_idempotency_key<>p_idempotency_key then return query select 'conflict'::text,null::jsonb;return;end if;
 return query select 'recorded'::text,public.m4_03_kev_alert_json(p_organization_id,p_alert_id);
end;$$;

create or replace function public.m4_03_intelligence_json(p_vulnerability_id uuid,p_assessed_at timestamptz)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with src as (select r.id record_id,r.feed_key,r.source_updated_at,v.id version_id,v.promoted_at,e.enrichment_type,e.enrichment
  from public.vulnerability_source_records r join public.vulnerability_source_record_versions v on v.id=r.current_version_id
  join public.vulnerability_enrichments e on e.source_record_version_id=v.id where r.vulnerability_id=p_vulnerability_id),
 epss as (select * from src where enrichment_type='epss' order by source_updated_at desc nulls last,promoted_at desc limit 1),
 cvss as (select s.*,d.value data from src s cross join lateral jsonb_path_query(s.enrichment->'value','$.**.cvssData') d(value)
  union all select s.*,s.enrichment->'value' from src s where s.enrichment_type='cvss'),
 cvss_rows as (select jsonb_build_object('version',coalesce(data->>'version',substring(data->>'vectorString' from 'CVSS:([0-9.]+)')),
   'baseScore',(data->>'baseScore')::numeric,'vector',data->>'vectorString','provenance',jsonb_build_object('sourceFeed',feed_key,'sourceRecordId',record_id,'sourceRecordVersionId',version_id,'observedAt',source_updated_at,'retrievedAt',promoted_at)) j,
   coalesce(data->>'version',substring(data->>'vectorString' from 'CVSS:([0-9.]+)')) ver from cvss where (data->>'baseScore') ~ '^[0-9]+(\\.[0-9]+)?$' and coalesce(data->>'vectorString','')<>''),
 cwe as (select jsonb_build_object('id',value->>'cweId','name',null,'provenance',jsonb_build_object('sourceFeed',s.feed_key,'sourceRecordId',s.record_id,'sourceRecordVersionId',s.version_id,'observedAt',s.source_updated_at,'retrievedAt',s.promoted_at)) j from src s cross join lateral jsonb_array_elements(coalesce(s.enrichment->'value','[]'::jsonb)) value where s.enrichment_type='cwes' and value->>'cweId' ~ '^CWE-[1-9][0-9]*$')
 select jsonb_build_object('cvss',jsonb_build_object('freshness',case when exists(select 1 from cvss_rows) then 'fresh' else 'absent' end,'assessedAt',p_assessed_at,'preferred',(select j from cvss_rows order by case ver when '4.0' then 4 when '3.1' then 3 when '3.0' then 2 when '2.0' then 1 else 0 end desc limit 1),'observations',coalesce((select jsonb_agg(j) from cvss_rows),'[]'::jsonb)),
 'epss',jsonb_build_object('freshness',case when exists(select 1 from epss) then 'fresh' else 'absent' end,'assessedAt',p_assessed_at,'value',(select (enrichment->'value'->>'epss')::numeric from epss),'observationDate',(select source_updated_at::date from epss),'provenance',(select jsonb_build_object('sourceFeed',feed_key,'sourceRecordId',record_id,'sourceRecordVersionId',version_id,'observedAt',source_updated_at,'retrievedAt',promoted_at) from epss)),
 'kev',jsonb_build_object('freshness','absent','assessedAt',p_assessed_at,'status','not_listed','listingDate',null,'provenance',null),'cwes',coalesce((select jsonb_agg(j) from cwe),'[]'::jsonb),'aliases','[]'::jsonb,'references','[]'::jsonb);
$$;
alter function public.record_vulnerability_kev_reporting_intent_atomic(uuid,uuid,uuid,uuid,text,text,uuid) owner to postgres;
alter function public.m4_03_intelligence_json(uuid,timestamptz) owner to postgres;
revoke all on function public.record_vulnerability_kev_reporting_intent_atomic(uuid,uuid,uuid,uuid,text,text,uuid),public.m4_03_intelligence_json(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_vulnerability_kev_reporting_intent_atomic(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;
