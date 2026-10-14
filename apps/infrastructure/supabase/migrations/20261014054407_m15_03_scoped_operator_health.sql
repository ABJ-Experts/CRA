-- Latest diagnostic metadata only; remote identifiers never reference local tenants.
create type public.m15_03_source_observation as (
 source text,status text,source_at timestamptz,observed_at timestamptz,
 attempted_at timestamptz,succeeded_at timestamptz,received_at timestamptz,reasons text[]
);
create table public.operator_registry_observations (
 instance_id uuid not null, entity_kind text not null check(entity_kind in ('instance','tenant')),entity_id uuid not null,
 label text not null check(length(label) between 1 and 120 and label=btrim(label) and label!~'[[:cntrl:]]'),
 revision bigint not null check(revision between 0 and 9007199254740991),digest text not null check(digest~'^[a-f0-9]{64}$'),
 status text not null check(status in ('healthy','degraded','stale','unreachable','unknown')),
 source_observed_at timestamptz not null,entity_observed_at timestamptz,received_at timestamptz not null,attempted_at timestamptz not null,succeeded_at timestamptz not null,
 poll_reason text check(poll_reason in ('collection_unreachable','source_timeout','source_unavailable')),
 version text check(length(version) between 1 and 80),commit text check(commit~'^[a-f0-9]{7,40}$'),
 expected_version text check(length(expected_version) between 1 and 80),version_source_at timestamptz,
 licence_state text check(licence_state in ('missing','active','grace','expired_read_only','invalid','clock_untrusted')),
 licence_expires_at timestamptz,grace_ends_at timestamptz,licence_source_at timestamptz,
 sources public.m15_03_source_observation[] not null default '{}',
 primary key(instance_id,entity_kind,entity_id),check(entity_kind<>'instance' or entity_id=instance_id),
 check(cardinality(sources)<=12),check(source_observed_at<=succeeded_at and succeeded_at<=received_at)
);
alter table public.operator_registry_observations enable row level security;
revoke all on public.operator_registry_observations from public,anon,authenticated,service_role;
create role cra_operator_registry_reader nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant cra_operator_registry_reader to authenticator;
grant usage on schema public to cra_operator_registry_reader;
-- These indexes serve bounded tenant/status keysets; source tables are unchanged.
create index m15_03_evidence_scan_health on public.evidence_document_scan_jobs(organization_id,status,created_at,id);
create index m15_03_evidence_extraction_health on public.evidence_document_extraction_jobs(organization_id,status,created_at,id);
create index m15_03_feed_health on public.vulnerability_feed_sync_runs(status,created_at,id);

create function public.m15_03_canonical_json(p_value jsonb) returns text language plpgsql immutable set search_path=pg_catalog,public as $$
declare result text;begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.m15_03_canonical_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(p_value);
 when 'array' then select '['||coalesce(string_agg(public.m15_03_canonical_json(value),',' order by ord),'')||']' into result from jsonb_array_elements(p_value) with ordinality v(value,ord);
 else result:=p_value::text;end case;return result;end $$;

create function public.m15_03_health_can(p_organization_id uuid,p_actor_user_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
 select coalesce((select case when jsonb_typeof(o.permissions->'can_view_system_health')='boolean' then (o.permissions->>'can_view_system_health')::boolean
 else m.role in ('owner','admin') or exists(select 1 from public.user_role_assignments a join public.custom_roles r on r.organization_id=a.organization_id and r.id=a.role_id and r.is_active and not r.is_deleted where a.organization_id=m.organization_id and a.user_id=m.user_id and r.permissions->'can_view_system_health'='true'::jsonb) end
 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active and u.email_verified_at is not null join public.organizations g on g.id=m.organization_id and g.is_active
 left join public.base_role_permission_overrides o on o.organization_id=m.organization_id and o.base_role=m.role where m.organization_id=p_organization_id and m.user_id=p_actor_user_id),false)
$$;
create function public.m15_03_queue(p_id text,p_pending bigint,p_running bigint,p_retrying bigint,p_review bigint,p_uncertain bigint,p_failed bigint,p_oldest timestamptz,p_source_at timestamptz) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_id,'label',case p_id when 'evidence_processing' then 'Evidence processing' when 'vulnerability_feeds' then 'Vulnerability feeds' else initcap(p_id) end,'availability','ready',
 'pending',least(p_pending,10000),'running',least(p_running,10000),'retrying',least(p_retrying,10000),'waitingForReview',least(p_review,10000),'uncertainDelivery',least(p_uncertain,10000),'failedTerminal',least(p_failed,10000),
 'oldestPendingAt',public.m7_snapshot_timestamp_utc(p_oldest),'countRelation',case when greatest(p_pending,p_running,p_retrying,p_review,p_uncertain,p_failed)>=10000 then 'at_least' else 'exact' end,
 'sourceAt',public.m7_snapshot_timestamp_utc(p_source_at),'observedAt',public.m7_snapshot_timestamp_utc(statement_timestamp()),'status',case when p_failed+p_retrying+p_uncertain>0 then 'degraded' else 'unknown' end,
 'reasons',case when p_uncertain>0 then '["queue_uncertain_delivery"]'::jsonb when p_failed>0 then '["queue_terminal_failures"]'::jsonb when p_retrying>0 then '["queue_backlog"]'::jsonb else '[]'::jsonb end,'interpretation','queue_observation')
$$;
create function public.m15_03_read_health_source(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_product_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
declare d jsonb; m public.organization_usage_meters; source_at timestamptz; observed text:=public.m7_snapshot_timestamp_utc(statement_timestamp()); q jsonb; freshness jsonb; n bigint; running bigint; retrying bigint; failed bigint; review bigint; oldest timestamptz; permission text;begin
 if not public.m15_03_health_can(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden','source',p_source,'observedAt',null,'data',null,'reasons',array['source_permission_withheld']);end if;
 if p_source is null or p_source not in ('deadline_monitor','vulnerability_feeds','usage_metering','licensing','exports','evidence_processing','reports','notifications','connectors','sboms') then raise exception 'invalid health source' using errcode='22023';end if;
 permission:=case p_source when 'deadline_monitor' then 'can_view_reporting' when 'vulnerability_feeds' then 'can_view_findings' when 'usage_metering' then 'can_view_licensing' when 'licensing' then 'can_view_licensing' when 'evidence_processing' then 'can_view_evidence' when 'connectors' then 'can_view_connectors' when 'sboms' then 'can_view_sboms' end;
 if permission is null or (permission='can_view_licensing' and not public.m15_01_actor_can(p_organization_id,p_actor_user_id,permission)) or (permission<>'can_view_licensing' and not public.m14_03_actor_can(p_organization_id,p_actor_user_id,permission))
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
 -- Feed execution is instance-scoped; bounded by fixed configured feeds/status.
 select count(*)filter(where status='queued'),count(*)filter(where status='processing'),count(*)filter(where status='failed'),count(*)filter(where status='dead_letter'),min(created_at)filter(where status='queued') into n,running,retrying,failed,oldest from (select r.* from unnest(array['queued','processing','failed','dead_letter']) v(category) cross join lateral(select status,created_at from public.vulnerability_feed_sync_runs where status=v.category order by created_at,id limit 10000)r) bounded;
 q:=public.m15_03_queue('vulnerability_feeds',n,running,retrying,0,0,failed,oldest,statement_timestamp());d:=jsonb_build_object('feedFreshness',coalesce(freshness,'[]'::jsonb),'queue',q);
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
 else return jsonb_build_object('outcome','withheld','source',p_source,'observedAt',observed,'data',null,'reasons',array['source_unavailable']);
 end case;
 return jsonb_build_object('outcome','ready','source',p_source,'observedAt',observed,'sourceAt',public.m7_snapshot_timestamp_utc(source_at),'data',d,'reasons','[]'::jsonb);
end $$;

create function public.m15_03_sources(p_sources jsonb) returns public.m15_03_source_observation[] language plpgsql immutable set search_path=pg_catalog,public as $$
declare result public.m15_03_source_observation[]:='{}';v jsonb;s public.m15_03_source_observation;begin
 if jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources)>12 then raise exception 'invalid observation sources' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_sources) loop
 if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('source','status','sourceAt','observedAt','attemptedAt','succeededAt','receivedAt','reasons')) or v->>'source' not in ('local','database','audit','deadline_monitor','licensing','usage_metering','vulnerability_feeds','storage','backups','version') or v->>'status' not in ('healthy','degraded','stale','unreachable','unknown') or jsonb_typeof(v->'reasons')<>'array' or jsonb_array_length(v->'reasons')>30 then raise exception 'invalid observation source' using errcode='22023';end if;
 s:=row(v->>'source',v->>'status',(v->>'sourceAt')::timestamptz,(v->>'observedAt')::timestamptz,(v->>'attemptedAt')::timestamptz,(v->>'succeededAt')::timestamptz,(v->>'receivedAt')::timestamptz,array(select jsonb_array_elements_text(v->'reasons')))::public.m15_03_source_observation;
 if s.source is null or s.status is null or (s.status='healthy' and (s.source_at is null or s.observed_at is null or s.attempted_at is null or s.succeeded_at is null or s.received_at is null or cardinality(s.reasons)>0)) or (s.source_at is not null and (not isfinite(s.source_at) or s.source_at>statement_timestamp()+interval '5 seconds')) or (s.succeeded_at is not null and s.succeeded_at>s.received_at) or (s.source_at is not null and s.source_at>s.observed_at) or exists(select 1 from unnest(s.reasons) r where r not in ('source_unavailable','source_permission_withheld','source_stale','source_timeout','database_unavailable','audit_unavailable','worker_heartbeat_stale','worker_heartbeat_unavailable','queue_backlog','queue_terminal_failures','queue_uncertain_delivery','queue_human_review','meter_unavailable','storage_unreachable','storage_integrity_unknown','m15_05_not_available','version_unavailable','version_drift','licence_unavailable','licence_expired','licence_grace','licence_invalid','clock_untrusted','no_successful_observation','collection_unreachable')) or exists(select 1 from unnest(result) r where r.source=s.source) then raise exception 'invalid observation provenance' using errcode='22023';end if;
 result:=array_append(result,s);end loop;return result;end $$;

create function public.m15_03_source_json(p_sources public.m15_03_source_observation[]) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('source',s.source,'status',s.status,'sourceAt',public.m7_snapshot_timestamp_utc(s.source_at),'observedAt',public.m7_snapshot_timestamp_utc(s.observed_at),'attemptedAt',public.m7_snapshot_timestamp_utc(s.attempted_at),'succeededAt',public.m7_snapshot_timestamp_utc(s.succeeded_at),'receivedAt',public.m7_snapshot_timestamp_utc(s.received_at),'reasons',s.reasons) order by s.source),'[]'::jsonb) from unnest(p_sources) s
$$;
create function public.m15_03_registry_json(p_row public.operator_registry_observations) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select case when p_row.entity_kind='instance' then jsonb_build_object('instanceId',p_row.instance_id,'label',p_row.label,'status',p_row.status,'version',p_row.version,'commit',p_row.commit,'expectedVersion',p_row.expected_version,'versionDrift',case when p_row.version is null or p_row.expected_version is null then 'unknown' when p_row.version=p_row.expected_version then 'matched' else 'different' end,'versionSourceAt',public.m7_snapshot_timestamp_utc(p_row.version_source_at),'lastObservedAt',public.m7_snapshot_timestamp_utc(p_row.entity_observed_at),'licenceSummary',jsonb_build_object('active',null,'grace',null,'expiredReadOnly',null,'invalid',null,'missing',null,'unknown',null),'tenantCount',null,'countScope','authorized_tenants','sources',public.m15_03_source_json(p_row.sources))
 else jsonb_build_object('tenantId',p_row.entity_id,'label',p_row.label,'status',p_row.status,'licenceState',p_row.licence_state,'licenceExpiresAt',public.m7_snapshot_timestamp_utc(p_row.licence_expires_at),'graceEndsAt',public.m7_snapshot_timestamp_utc(p_row.grace_ends_at),'licenceSourceAt',public.m7_snapshot_timestamp_utc(p_row.licence_source_at),'lastObservedAt',public.m7_snapshot_timestamp_utc(p_row.entity_observed_at),'sources',public.m15_03_source_json(p_row.sources)) end
$$;

create function public.m15_03_store_entity(p_instance_id uuid,p_kind text,p_entity jsonb,p_revision bigint,p_source_at timestamptz) returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare eid uuid;d text;old public.operator_registry_observations;s public.m15_03_source_observation[];begin
 if p_kind='instance' then
 if exists(select 1 from jsonb_object_keys(p_entity) k where k not in ('instanceId','label','status','version','commit','expectedVersion','versionDrift','versionSourceAt','lastObservedAt','licenceSummary','tenantCount','countScope','sources')) or p_entity->>'instanceId' is distinct from p_instance_id::text then raise exception 'invalid instance metadata' using errcode='22023';end if;eid:=p_instance_id;
 else
 if exists(select 1 from jsonb_object_keys(p_entity) k where k not in ('tenantId','label','status','licenceState','licenceExpiresAt','graceEndsAt','licenceSourceAt','lastObservedAt','sources')) then raise exception 'invalid tenant metadata' using errcode='22023';end if;eid:=(p_entity->>'tenantId')::uuid;end if;
 if eid is null or jsonb_typeof(p_entity)<>'object' or p_entity->>'status' is null or p_entity->>'label' is null or jsonb_typeof(p_entity->'sources')<>'array' then raise exception 'invalid entity metadata' using errcode='22023';end if;
 s:=public.m15_03_sources(p_entity->'sources');d:=encode(extensions.digest(public.m15_03_canonical_json(p_entity),'sha256'),'hex');
 select * into old from public.operator_registry_observations where instance_id=p_instance_id and entity_kind=p_kind and entity_id=eid for update;
 if found then
 if p_revision<old.revision or p_source_at<old.source_observed_at then return 'out_of_order';end if;
 if p_revision=old.revision then return case when d=old.digest and p_source_at=old.source_observed_at then 'replayed' else 'conflict' end;end if;
 -- Each independently observed source must also be monotonic.
 if exists(select 1 from unnest(s) n join unnest(old.sources) o on o.source=n.source where n.source_at<o.source_at or (o.source_at is not null and n.source_at is null) or n.succeeded_at<o.succeeded_at) then return 'out_of_order';end if;
 end if;
 insert into public.operator_registry_observations(instance_id,entity_kind,entity_id,label,revision,digest,status,source_observed_at,entity_observed_at,received_at,attempted_at,succeeded_at,version,commit,expected_version,version_source_at,licence_state,licence_expires_at,grace_ends_at,licence_source_at,sources)
 values(p_instance_id,p_kind,eid,p_entity->>'label',p_revision,d,p_entity->>'status',p_source_at,(p_entity->>'lastObservedAt')::timestamptz,statement_timestamp(),statement_timestamp(),statement_timestamp(),p_entity->>'version',p_entity->>'commit',p_entity->>'expectedVersion',(p_entity->>'versionSourceAt')::timestamptz,p_entity->>'licenceState',(p_entity->>'licenceExpiresAt')::timestamptz,(p_entity->>'graceEndsAt')::timestamptz,(p_entity->>'licenceSourceAt')::timestamptz,s)
 on conflict(instance_id,entity_kind,entity_id) do update set label=excluded.label,revision=excluded.revision,digest=excluded.digest,status=excluded.status,source_observed_at=excluded.source_observed_at,entity_observed_at=excluded.entity_observed_at,received_at=excluded.received_at,attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,poll_reason=null,version=excluded.version,commit=excluded.commit,expected_version=excluded.expected_version,version_source_at=excluded.version_source_at,licence_state=excluded.licence_state,licence_expires_at=excluded.licence_expires_at,grace_ends_at=excluded.grace_ends_at,licence_source_at=excluded.licence_source_at,sources=excluded.sources;
 return 'published';end $$;

create function public.m15_03_publish_observation(p_expected_instance_id uuid,p_observation jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='500ms' as $$
declare m jsonb;rev bigint;t timestamptz;v jsonb;result text;any_published boolean:=false;begin
 if p_expected_instance_id is null or jsonb_typeof(p_observation)<>'object' or exists(select 1 from jsonb_object_keys(p_observation) k where k not in ('metadata','digest')) then return jsonb_build_object('outcome','invalid');end if;
 m:=p_observation->'metadata';
 if jsonb_typeof(m)<>'object' or exists(select 1 from jsonb_object_keys(m) k where k not in ('schemaVersion','instanceId','revision','sourceAt','observedAt','instance','tenants','nextCursor')) or m->>'schemaVersion'<>'1' or m->>'instanceId' is distinct from p_expected_instance_id::text or p_observation->>'digest' is distinct from encode(extensions.digest(public.m15_03_canonical_json(m),'sha256'),'hex') or jsonb_typeof(m->'tenants')<>'array' or jsonb_array_length(m->'tenants')>100 then return jsonb_build_object('outcome','invalid');end if;
 rev:=(m->>'revision')::bigint;t:=(m->>'sourceAt')::timestamptz;
 if rev is null or rev<0 or rev>9007199254740991 or t is null or not isfinite(t) or t>statement_timestamp()+interval '5 seconds' or (m->>'observedAt')::timestamptz<t or (m->>'observedAt')::timestamptz>statement_timestamp()+interval '5 seconds' then return jsonb_build_object('outcome','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('m15_03_registry:'||p_expected_instance_id::text,0));
 -- Any rejected row rolls the entire page back, including the instance row.
 begin
 result:=public.m15_03_store_entity(p_expected_instance_id,'instance',m->'instance',rev,t);
 if result in ('conflict','out_of_order') then raise exception '%',result using errcode='P0002';end if;any_published:=result='published';
 for v in select value from jsonb_array_elements(m->'tenants') loop
 result:=public.m15_03_store_entity(p_expected_instance_id,'tenant',v,rev,t);
 if result in ('conflict','out_of_order') then raise exception '%',result using errcode='P0002';end if;any_published:=any_published or result='published';end loop;
 exception when no_data_found then return jsonb_build_object('outcome',sqlerrm);end;
 return jsonb_build_object('outcome',case when any_published then 'published' else 'replayed' end);
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or check_violation or not_null_violation then return jsonb_build_object('outcome','invalid');end $$;

create function public.m15_03_record_poll_outcome(p_instance_id uuid,p_attempted_at timestamptz,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
begin
 if p_instance_id is null or p_attempted_at is null or not isfinite(p_attempted_at) or p_attempted_at>statement_timestamp()+interval '5 seconds' or p_reason not in ('collection_unreachable','source_timeout','source_unavailable') or p_reason is null then raise exception 'invalid poll outcome' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('m15_03_registry:'||p_instance_id::text,0));
 update public.operator_registry_observations set attempted_at=p_attempted_at,status='unreachable',poll_reason=p_reason where instance_id=p_instance_id and attempted_at<p_attempted_at;
 return jsonb_build_object('outcome','recorded');end $$;

create function public.m15_03_operator_read(p_operator_id uuid,p_request_id uuid,p_instance_ids uuid[],p_tenant_ids uuid[],p_kind text,p_instance_id uuid default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='300ms' as $$
declare result jsonb;rows jsonb;inst jsonb;next_id uuid;receipt record;reg public.operator_registry_observations;observed text:=public.m7_snapshot_timestamp_utc(statement_timestamp());begin
 if p_operator_id is null or p_request_id is null or p_instance_ids is null or p_tenant_ids is null or cardinality(p_instance_ids)>500 or cardinality(p_tenant_ids)>10000 or array_position(p_instance_ids,null) is not null or array_position(p_tenant_ids,null) is not null or p_limit is null or p_limit not between 1 and 100 or p_kind not in ('instances','detail','tenants','instance_metadata') or p_kind is null then raise exception 'invalid operator scope' using errcode='22023';end if;
 if p_kind<>'instances' and (p_instance_id is null or not p_instance_id=any(p_instance_ids)) then raise exception 'operator scope denied' using errcode='42501';end if;
 if p_kind='instances' then
 with page as(select r.* from public.operator_registry_observations r where entity_kind='instance' and instance_id=any(p_instance_ids) and (p_after_id is null or entity_id>p_after_id) order by entity_id limit p_limit+1)
 select coalesce(jsonb_agg(public.m15_03_registry_json(jsonb_populate_record(null::public.operator_registry_observations,to_jsonb(p))))filter(where rn<=p_limit),'[]'::jsonb),max(entity_id::text)filter(where rn=p_limit)::uuid into rows,next_id from(select page.*,row_number()over(order by entity_id)rn from page)p;
 if jsonb_array_length(rows)<p_limit or not exists(select 1 from public.operator_registry_observations where entity_kind='instance' and instance_id=any(p_instance_ids) and entity_id>next_id) then next_id:=null;end if;
 result:=jsonb_build_object('schemaVersion',1,'observedAt',observed,'instances',rows,'nextCursor',replace(next_id::text,'-',''));
 else
 select * into reg from public.operator_registry_observations where instance_id=p_instance_id and entity_kind='instance' and entity_id=p_instance_id;
 if not found then raise exception 'operator metadata not found' using errcode='P0002';end if;inst:=public.m15_03_registry_json(reg);
 if p_kind='detail' then result:=jsonb_build_object('schemaVersion',1,'observedAt',observed,'instance',inst);
 else
 with page as(select r.* from public.operator_registry_observations r where instance_id=p_instance_id and entity_kind='tenant' and entity_id=any(p_tenant_ids) and (p_after_id is null or entity_id>p_after_id) order by entity_id limit p_limit+1)
 select coalesce(jsonb_agg(public.m15_03_registry_json(jsonb_populate_record(null::public.operator_registry_observations,to_jsonb(p))))filter(where rn<=p_limit),'[]'::jsonb),max(entity_id::text)filter(where rn=p_limit)::uuid into rows,next_id from(select page.*,row_number()over(order by entity_id)rn from page)p;
 if jsonb_array_length(rows)<p_limit or not exists(select 1 from public.operator_registry_observations where instance_id=p_instance_id and entity_kind='tenant' and entity_id=any(p_tenant_ids) and entity_id>next_id) then next_id:=null;end if;
 if p_kind='tenants' then result:=jsonb_build_object('schemaVersion',1,'observedAt',observed,'instanceId',p_instance_id,'tenants',rows,'nextCursor',replace(next_id::text,'-',''));
 else result:=jsonb_build_object('schemaVersion',1,'instanceId',p_instance_id,'revision',reg.revision,'sourceAt',public.m7_snapshot_timestamp_utc(reg.source_observed_at),'observedAt',observed,'instance',inst,'tenants',rows,'nextCursor',replace(next_id::text,'-',''));end if;
 end if;end if;
 select * into receipt from public.m13_01_append_audit_event(null,'security','operator.metadata.read:'||p_request_id,'operator',p_operator_id::text,'operator.metadata.read','operator_registry',p_instance_id::text,'completed',p_request_id,null,jsonb_build_object('requestId',p_request_id,'actorId',p_operator_id,'count',case when p_kind='instances' then jsonb_array_length(rows) when p_kind='detail' then 1 else jsonb_array_length(rows) end,'reasonCode',p_kind),null,null,null,null);
 if receipt.outcome<>'inserted' or receipt.audit_id is null then raise exception 'operator disclosure audit unavailable' using errcode='42501';end if;
 return result;end $$;

-- Local worker observation is bounded and metadata-only. Licence validity needs
-- the runtime verifier; cached claims never become a database entitlement grant.
create function public.m15_03_observe_instance(p_instance_id uuid,p_observed_at timestamptz,p_after_id uuid default null,p_limit integer default 100) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='500ms' as $$
declare tenants jsonb;next_id uuid;inst jsonb;metadata jsonb;t timestamptz:=statement_timestamp();rev bigint;pub jsonb;begin
 if p_instance_id is null or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>t+interval '5 seconds' or p_observed_at<t-interval '5 minutes' or p_limit not between 1 and 100 then raise exception 'invalid local observation' using errcode='22023';end if;
 rev:=floor(extract(epoch from p_observed_at)*1000)::bigint;
 inst:=jsonb_build_object('instanceId',p_instance_id,'label','CRA instance','status','unknown','version',null,'commit',null,'expectedVersion',null,'versionDrift','unknown','versionSourceAt',null,'lastObservedAt',public.m7_snapshot_timestamp_utc(p_observed_at),'licenceSummary',jsonb_build_object('active',null,'grace',null,'expiredReadOnly',null,'invalid',null,'missing',null,'unknown',null),'tenantCount',null,'countScope','authorized_tenants','sources',jsonb_build_array(jsonb_build_object('source','local','status','unknown','sourceAt',public.m7_snapshot_timestamp_utc(p_observed_at),'observedAt',public.m7_snapshot_timestamp_utc(p_observed_at),'attemptedAt',public.m7_snapshot_timestamp_utc(p_observed_at),'succeededAt',public.m7_snapshot_timestamp_utc(p_observed_at),'receivedAt',public.m7_snapshot_timestamp_utc(p_observed_at),'reasons',array['no_successful_observation'])));
 with page as(select id,name,updated_at from public.organizations where is_active and (p_after_id is null or id>p_after_id) order by id limit p_limit+1)
 select coalesce(jsonb_agg(jsonb_build_object('tenantId',id,'label',name,'status','unknown','licenceState',null,'licenceExpiresAt',null,'graceEndsAt',null,'licenceSourceAt',null,'lastObservedAt',public.m7_snapshot_timestamp_utc(updated_at),'sources','[]'::jsonb) order by id)filter(where rn<=p_limit),'[]'::jsonb),max(id::text)filter(where rn=p_limit)::uuid into tenants,next_id from(select page.*,row_number()over(order by id)rn from page)p;
 if jsonb_array_length(tenants)<p_limit or not exists(select 1 from public.organizations where is_active and id>next_id) then next_id:=null;end if;
 metadata:=jsonb_build_object('schemaVersion',1,'instanceId',p_instance_id,'revision',rev,'sourceAt',public.m7_snapshot_timestamp_utc(p_observed_at),'observedAt',public.m7_snapshot_timestamp_utc(p_observed_at),'instance',inst,'tenants',tenants,'nextCursor',replace(next_id::text,'-',''));
 pub:=public.m15_03_publish_observation(p_instance_id,jsonb_build_object('metadata',metadata,'digest',encode(extensions.digest(public.m15_03_canonical_json(metadata),'sha256'),'hex')));
 if pub->>'outcome' not in ('published','replayed') then raise exception 'local observation publication rejected' using errcode='22023';end if;
 return metadata;end $$;

-- Narrow reader has no table privileges, inherited tenant roles or mutating RPCs.
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'm15_03_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role,cra_operator_registry_reader',f.signature);end loop;
end $$;
grant execute on function public.m15_03_operator_read(uuid,uuid,uuid[],uuid[],text,uuid,uuid,integer) to cra_operator_registry_reader;
grant execute on function public.m15_03_read_health_source(uuid,uuid,text,uuid),public.m15_03_publish_observation(uuid,jsonb),public.m15_03_record_poll_outcome(uuid,timestamptz,text),public.m15_03_observe_instance(uuid,timestamptz,uuid,integer) to service_role;
notify pgrst,'reload schema';
