-- Source-owned final-state ledgers. Baselines describe observation time, never invented transitions.
create table public.vulnerability_finding_lifecycle_facts (
 sequence bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 product_id uuid, release_id uuid, finding_id uuid,
 fact_kind text not null check(fact_kind in ('baseline','observation')),
 effective_at timestamptz not null default transaction_timestamp(),
 recorded_at timestamptz not null default clock_timestamp(),
 recorded_transaction_id xid8 not null default pg_current_xact_id(),
 previous_sequence bigint,
 unique(organization_id,sequence),
 foreign key(organization_id,previous_sequence)references public.vulnerability_finding_lifecycle_facts(organization_id,sequence),
 payload jsonb not null,
 provenance text not null default 'source_transaction',
 foreign key(organization_id,product_id) references public.products(organization_id,id),
 foreign key(organization_id,release_id) references public.product_releases(organization_id,id),
 foreign key(organization_id,finding_id) references public.vulnerability_findings(organization_id,id)
);
create unique index m5_trend_baseline_org on public.vulnerability_finding_lifecycle_facts(organization_id) where finding_id is null;
create index m5_trend_scope on public.vulnerability_finding_lifecycle_facts(organization_id,product_id,finding_id,sequence desc);
create table public.sbom_release_coverage_facts (
 sequence bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 product_id uuid, release_id uuid,
 fact_kind text not null check(fact_kind in ('baseline','observation')),
 effective_at timestamptz not null default transaction_timestamp(),
 recorded_at timestamptz not null default clock_timestamp(),
 recorded_transaction_id xid8 not null default pg_current_xact_id(),
 previous_sequence bigint,
 unique(organization_id,sequence),
 foreign key(organization_id,previous_sequence)references public.sbom_release_coverage_facts(organization_id,sequence),
 payload jsonb not null,
 provenance text not null default 'source_transaction',
 foreign key(organization_id,product_id) references public.products(organization_id,id),
 foreign key(organization_id,release_id) references public.product_releases(organization_id,id)
);
create unique index m3_trend_baseline_org on public.sbom_release_coverage_facts(organization_id) where release_id is null;
create index m3_trend_scope on public.sbom_release_coverage_facts(organization_id,product_id,release_id,sequence desc);
alter table public.vulnerability_finding_lifecycle_facts enable row level security;
alter table public.sbom_release_coverage_facts enable row level security;
revoke all on public.vulnerability_finding_lifecycle_facts,public.sbom_release_coverage_facts from public,anon,authenticated,service_role;
alter table public.technical_file_snapshots add column trend_sequence bigint generated always as identity;
alter table public.technical_file_snapshots add column recorded_transaction_id xid8 not null default pg_current_xact_id();
create index m7_trend_scope on public.technical_file_snapshots(organization_id,product_id,created_at,trend_sequence);
create function public.m14_02_snapshot_metadata_immutable()returns trigger language plpgsql set search_path=public,pg_temp as $$begin if new.trend_sequence is distinct from old.trend_sequence or new.recorded_transaction_id is distinct from old.recorded_transaction_id then raise exception 'snapshot transaction visibility metadata is immutable';end if;return new;end$$;
create trigger m14_02_snapshot_metadata_immutable before update on public.technical_file_snapshots for each row execute function public.m14_02_snapshot_metadata_immutable();
create function public.m14_02_fact_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin raise exception 'source trend facts are immutable';end$$;
create trigger m5_trend_immutable before update or delete on public.vulnerability_finding_lifecycle_facts for each row execute function public.m14_02_fact_immutable();
create trigger m3_trend_immutable before update or delete on public.sbom_release_coverage_facts for each row execute function public.m14_02_fact_immutable();

create function public.m14_02_capture_finding(p_org uuid,p_finding uuid,p_baseline boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.vulnerability_findings; r public.product_releases; a public.vulnerability_finding_assessments; prev public.vulnerability_finding_lifecycle_facts; data jsonb; triage timestamptz; fixed timestamptz; fixed_assessments jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('m14-finding:'||p_org||':'||p_finding,0));
 select *into f from public.vulnerability_findings where organization_id=p_org and id=p_finding; if not found then return;end if;
 select *into r from public.product_releases where organization_id=p_org and id=f.release_id;
 select *into a from public.vulnerability_finding_assessments where organization_id=p_org and id=public.m5_bulk_effective_assessment_id(p_org,p_finding);
 select min(x.submitted_at)into triage from public.vulnerability_finding_assessments x left join public.vulnerability_finding_assessment_bulk_operation_targets t on t.organization_id=p_org and t.id=x.bulk_operation_target_id where x.organization_id=p_org and x.finding_id=p_finding and x.submitted_by is not null ;
 select min(case when x.approval_required then x.decided_at else x.submitted_at end),coalesce(jsonb_agg(jsonb_build_object('assessmentId',x.id,'revision',x.revision,'effectiveAt',case when x.approval_required then x.decided_at else x.submitted_at end)order by x.revision),'[]')into fixed,fixed_assessments from public.vulnerability_finding_assessments x left join public.vulnerability_finding_assessment_bulk_operation_targets t on t.organization_id=p_org and t.id=x.bulk_operation_target_id where x.organization_id=p_org and x.finding_id=p_finding and x.vex_status='fixed'and x.approval_state in ('approved','approval_not_required')and coalesce(t.state,'')<>'undone';
 data:=jsonb_build_object('open',public.m5_finding_is_open(p_org,p_finding),'superseded',f.superseded_at is not null,'firstDetectedAt',f.first_detected_at,'triagedAt',triage,'fixedAt',fixed,'validFixedAssessments',fixed_assessments,'assessmentId',a.id,'assessmentRevision',a.revision,'closedAt',f.closed_at,'reevaluationState',f.reevaluation_state,'sourceVersionId',f.source_record_version_id);
 select *into prev from public.vulnerability_finding_lifecycle_facts where organization_id=p_org and finding_id=p_finding order by sequence desc limit 1;
 if prev.payload=data then return;end if;
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,product_id,release_id,finding_id,fact_kind,previous_sequence,payload,provenance)values(p_org,r.product_id,f.release_id,f.id,case when p_baseline then 'baseline'else 'observation'end,prev.sequence,data,case when p_baseline then 'deployment_baseline'else 'source_transaction'end);
end$$;
create function public.m14_02_capture_release(p_org uuid,p_release uuid,p_baseline boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.product_releases; p public.products; prev public.sbom_release_coverage_facts; data jsonb; lineage jsonb; eligible boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('m14-release:'||p_org||':'||p_release,0));
 select *into r from public.product_releases where organization_id=p_org and id=p_release;if not found then return;end if;
 select *into p from public.products where organization_id=p_org and id=r.product_id;
 eligible:=r.archived_at is null and p.archived_at is null and r.placed_on_market_at is not null and r.lifecycle not in ('development','withdrawn');
 select coalesce(jsonb_agg(distinct jsonb_build_object('sourceId',s.id,'documentId',d.id,'documentSha256',d.document_sha256)),'[]')into lineage from public.sbom_document_sources l join public.sbom_sources s on s.organization_id=p_org and s.id=l.source_id and s.release_id=r.id join public.sbom_documents d on d.organization_id=p_org and d.id=l.document_id join public.sbom_ingest_jobs j on j.organization_id=p_org and j.id=d.ingest_job_id and j.source_id=d.source_id and j.release_id=r.id where l.organization_id=p_org and l.release_id=r.id and s.status='verified'and s.verified_at is not null and d.state='completed'and j.status='completed'and j.validation_status in ('valid','valid_with_warnings')and j.validation_completed_at is not null and d.validation_status in ('valid','valid_with_warnings')and d.completed_at is not null and l.raw_object_id=s.raw_object_id and d.raw_object_id=s.raw_object_id and d.source_id=coalesce(s.deduplicated_from_source_id,s.id)and s.product_id=r.product_id and exists(select 1 from public.sbom_sources canonical where canonical.organization_id=p_org and canonical.id=d.source_id and canonical.status='verified'and canonical.raw_object_id=d.raw_object_id and canonical.release_id=s.release_id and canonical.product_id=s.product_id);
 data:=jsonb_build_object('eligible',eligible,'covered',jsonb_array_length(lineage)>0,'sources',lineage);
 select *into prev from public.sbom_release_coverage_facts where organization_id=p_org and release_id=p_release order by sequence desc limit 1;
 if prev.payload=data then return;end if;
 insert into public.sbom_release_coverage_facts(organization_id,product_id,release_id,fact_kind,previous_sequence,payload,provenance)values(p_org,r.product_id,r.id,case when p_baseline then 'baseline'else 'observation'end,prev.sequence,data,case when p_baseline then 'deployment_baseline'else 'source_transaction'end);
end$$;
-- Deferred triggers read final authoritative state; repeated callbacks hash/deduplicate.
create function public.m14_02_capture_trigger()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb:=coalesce(to_jsonb(new),to_jsonb(old)); org uuid:=(row_data->>'organization_id')::uuid; rid uuid; fid uuid;
begin
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,fact_kind,payload,provenance)values(org,'baseline',jsonb_build_object('epoch',gen_random_uuid()),'capture_started')on conflict(organization_id)where finding_id is null do nothing;
 insert into public.sbom_release_coverage_facts(organization_id,fact_kind,payload,provenance)values(org,'baseline',jsonb_build_object('epoch',gen_random_uuid()),'capture_started')on conflict(organization_id)where release_id is null do nothing;
 if tg_table_name='vulnerability_findings'then fid:=(row_data->>'id')::uuid;
 elsif tg_table_name in ('vulnerability_finding_assessments','vulnerability_finding_assessment_bulk_operation_targets')then fid:=(row_data->>'finding_id')::uuid;
 elsif tg_table_name='vulnerability_finding_assessment_history_events'then select finding_id into fid from public.vulnerability_finding_assessments where organization_id=org and id=(row_data->>'assessment_id')::uuid;end if;
 if fid is not null then perform public.m14_02_capture_finding(org,fid);return null;end if;
 if tg_table_name='products'then for rid in select id from public.product_releases where organization_id=org and product_id=(row_data->>'id')::uuid loop perform public.m14_02_capture_release(org,rid);end loop;
 elsif tg_table_name='sbom_documents'then for rid in select distinct release_id from public.sbom_document_sources where organization_id=org and document_id=(row_data->>'id')::uuid loop perform public.m14_02_capture_release(org,rid);end loop;
 else rid:=case when tg_table_name='product_releases'then(row_data->>'id')::uuid else(row_data->>'release_id')::uuid end;if rid is not null then perform public.m14_02_capture_release(org,rid);end if;end if;return null;
end$$;
do $$declare t text;begin foreach t in array array['vulnerability_findings','vulnerability_finding_assessments','vulnerability_finding_assessment_bulk_operation_targets','vulnerability_finding_assessment_history_events','products','product_releases','sbom_sources','sbom_documents','sbom_ingest_jobs','sbom_document_sources']loop execute format('create constraint trigger m14_02_capture after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.m14_02_capture_trigger()',t);end loop;end$$;
-- Install completeness boundaries and current-state baselines under the migration transaction.
do $$declare x record;begin
 insert into public.vulnerability_finding_lifecycle_facts(organization_id,fact_kind,payload,provenance)select id,'baseline',jsonb_build_object('epoch',gen_random_uuid()),'deployment_baseline'from public.organizations;
 insert into public.sbom_release_coverage_facts(organization_id,fact_kind,payload,provenance)select id,'baseline',jsonb_build_object('epoch',gen_random_uuid()),'deployment_baseline'from public.organizations;
 for x in select organization_id,id from public.vulnerability_findings loop perform public.m14_02_capture_finding(x.organization_id,x.id,true);end loop;
 for x in select organization_id,id from public.product_releases loop perform public.m14_02_capture_release(x.organization_id,x.id,true);end loop;
end$$;
create function public.m14_02_snapshot_can(p_org uuid,p_actor uuid,p_snapshot uuid)returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.m14_actor_can(p_org,p_actor,'can_view_technical_files')and coalesce((select
 jsonb_typeof(s.payload#>'{technicalFile,sections}')='array'and jsonb_typeof(s.payload#>'{readiness,sections}')='array'and
 not exists(select 1 from jsonb_array_elements(s.payload#>'{technicalFile,sections}')section cross join lateral jsonb_array_elements(coalesce(section->'sources','[]'))x where not public.m7_dashboard_source_can(p_org,p_actor,s.product_id,x->>'kind',(x->>'recordId')::uuid))and
 not exists(select 1 from jsonb_path_query(s.payload,'$.riskRegister.**.evidenceReferences[*]')x where x->>'recordId' is not null and not public.m7_dashboard_source_can(p_org,p_actor,s.product_id,'evidence_document',(x->>'recordId')::uuid))
 from public.technical_file_snapshots s where s.organization_id=p_org and s.id=p_snapshot),false)
$$;
create function public.get_dashboard_trends(p_organization_id uuid,p_actor_user_id uuid,p_filters jsonb,p_snapshot jsonb default null)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare org uuid:=p_organization_id;actor uuid:=p_actor_user_id;product uuid:=(p_filters->>'productId')::uuid;from_date date:=(p_filters->>'from')::date;to_date date:=(p_filters->>'to')::date;zone text:=p_filters->>'timezone';bucket text:=p_filters->>'bucket';pin jsonb;baseline timestamptz;snap pg_snapshot;fm bigint;cm bigint;sm bigint;metric text;series jsonb:='{}';points jsonb;state text;reason text;unit text;revision text;access jsonb:=p_filters->'sourceAccess';now_at timestamptz:=statement_timestamp();
begin
 p_filters:=p_filters-'sourceAccess';
 if access->>'products'='false'or not public.m14_actor_can(org,actor,'can_view_dashboards')or not public.m14_actor_can(org,actor,'can_view_products')then return jsonb_build_object('outcome','not_found');end if;
 if product is not null and not exists(select 1 from public.products where organization_id=org and id=product)then return jsonb_build_object('outcome','not_found');end if;
 if from_date is null or to_date is null or to_date<from_date or to_date-from_date>365 or bucket not in ('day','week','month')or not exists(select 1 from pg_timezone_names where name=zone)then return jsonb_build_object('outcome','invalid_request');end if;
 if p_snapshot is null then
 pin:=jsonb_build_object('snapshot',pg_current_snapshot()::text,'maxFindingSequence',coalesce((select max(sequence)from public.vulnerability_finding_lifecycle_facts where organization_id=org),0)::text,'maxCoverageSequence',coalesce((select max(sequence)from public.sbom_release_coverage_facts where organization_id=org),0)::text,'maxSnapshotSequence',coalesce((select max(trend_sequence)from public.technical_file_snapshots where organization_id=org),0)::text,'epoch',(select payload->>'epoch'from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null));
 else pin:=p_snapshot;if pin->>'epoch' is distinct from(select payload->>'epoch'from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null)then return jsonb_build_object('outcome','conflict');end if;end if;
 snap:=(pin->>'snapshot')::pg_snapshot;fm:=(pin->>'maxFindingSequence')::bigint;cm:=(pin->>'maxCoverageSequence')::bigint;sm:=(pin->>'maxSnapshotSequence')::bigint;
 select effective_at into baseline from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null and sequence<=fm and pg_visible_in_snapshot(recorded_transaction_id,snap);
 revision:=encode(extensions.digest(pin::text||p_filters::text||'m14-02-v1','sha256'),'hex');
 foreach metric in array array['activity','triage','remediation','sbomCoverage','readiness']loop
 state:='available';reason:=null;unit:=case metric when'activity'then'count'when'triage'then'hours'when'remediation'then'days'else'percent'end;
 if (access->>(case when metric in('activity','triage','remediation')then'findings'else metric end))='false'or metric in ('activity','triage','remediation')and not public.m14_actor_can(org,actor,'can_view_findings')or metric='sbomCoverage'and not public.m14_actor_can(org,actor,'can_view_sboms')or metric='readiness'and not public.m14_actor_can(org,actor,'can_view_technical_files')then state:='restricted';reason:='source_permission_required';
 elsif metric in ('triage','remediation','readiness')and product is null then state:='unavailable';reason:='select_product';
 elsif metric<>'readiness'and baseline is null then state:='unavailable';reason:='history_unavailable';
 elsif metric='readiness'and exists(select 1 from public.technical_file_snapshots s where metric='readiness'and s.organization_id=org and s.product_id=product and s.trend_sequence<=sm and pg_visible_in_snapshot(s.recorded_transaction_id,snap)and s.created_at>=from_date::timestamp at time zone zone and s.created_at<(to_date+1)::timestamp at time zone zone and not public.m14_02_snapshot_can(org,actor,s.id))then state:='restricted';reason:='snapshot_source_permission_required';end if;
 if state<>'available'then points:='[]';else
 with boundaries as(select greatest(from_date::timestamp,d)::timestamp at time zone zone starts,least((to_date+1)::timestamp,d+case bucket when'day'then interval'1 day'when'week'then interval'1 week'else interval'1 month'end)::timestamp at time zone zone ends from generate_series(date_trunc(bucket,from_date::timestamp),to_date::timestamp,case bucket when'day'then interval'1 day'when'week'then interval'1 week'else interval'1 month'end)d),
 facts as materialized(select f.*,prev.payload previous from public.vulnerability_finding_lifecycle_facts f left join public.vulnerability_finding_lifecycle_facts prev on prev.organization_id=org and prev.sequence=f.previous_sequence where metric in('activity','triage','remediation')and f.organization_id=org and f.finding_id is not null and(product is null or f.product_id=product)and f.sequence<=fm and pg_visible_in_snapshot(f.recorded_transaction_id,snap)),
 latest as(select distinct on(finding_id)*from facts order by finding_id,sequence desc),
 events as(select f.finding_id,'opened'kind,(l.payload->>'firstDetectedAt')::timestamptz at from facts f join latest l using(finding_id)where f.previous_sequence is null and f.fact_kind='observation'
 union all select finding_id,'closed',coalesce((payload->>'closedAt')::timestamptz,(payload->>'fixedAt')::timestamptz,effective_at)from facts where fact_kind='observation'and previous->>'open'='true'and payload->>'open'='false'and payload->>'superseded'='false'
 union all select finding_id,'reopened',effective_at from facts where fact_kind='observation'and previous->>'open'='false'and payload->>'open'='true'),
 durations as(select finding_id,case metric when'triage'then(payload->>'triagedAt')::timestamptz else(payload->>'fixedAt')::timestamptz end at,extract(epoch from(case metric when'triage'then(payload->>'triagedAt')::timestamptz else(payload->>'fixedAt')::timestamptz end-(payload->>'firstDetectedAt')::timestamptz))/case metric when'triage'then 3600.0 else 86400.0 end value from latest),
 bucket_values as(select b.*,
 (select count(*)from events e where e.at>=b.starts and e.at<b.ends and kind='opened')opened,
 (select count(*)from events e where e.at>=b.starts and e.at<b.ends and kind='closed')closed,
 (select count(*)from events e where e.at>=b.starts and e.at<b.ends and kind='reopened')reopened,
 (select avg(value)from durations d where d.at>=b.starts and d.at<b.ends and d.at>=baseline and value>=0)duration_mean,
 (select count(*)from durations d where d.at>=b.starts and d.at<b.ends and d.at>=baseline and value>=0)sample_count,
 (select count(*)from durations d where d.at>=b.starts and d.at<b.ends and value<0)excluded_count,
 (select count(*)filter(where (x.payload->>'covered')::boolean)from(select distinct on(release_id)payload from public.sbom_release_coverage_facts where metric='sbomCoverage'and organization_id=org and release_id is not null and(product is null or product_id=product)and sequence<=cm and pg_visible_in_snapshot(recorded_transaction_id,snap)and effective_at<b.ends order by release_id,sequence desc)x where(x.payload->>'eligible')::boolean)covered,
 (select count(*)from(select distinct on(release_id)payload from public.sbom_release_coverage_facts where metric='sbomCoverage'and organization_id=org and release_id is not null and(product is null or product_id=product)and sequence<=cm and pg_visible_in_snapshot(recorded_transaction_id,snap)and effective_at<b.ends order by release_id,sequence desc)x where(x.payload->>'eligible')::boolean)eligible,
 (select s.payload from public.technical_file_snapshots s where metric='readiness'and s.organization_id=org and s.product_id=product and s.trend_sequence<=sm and pg_visible_in_snapshot(s.recorded_transaction_id,snap)and s.created_at>=b.starts and s.created_at<b.ends order by s.created_at desc,s.trend_sequence desc limit 1)readiness_payload,
 (select count(*)from public.technical_file_snapshots s where metric='readiness'and s.organization_id=org and s.product_id=product and s.trend_sequence<=sm and pg_visible_in_snapshot(s.recorded_transaction_id,snap)and s.created_at>=b.starts and s.created_at<b.ends)snapshot_count
 from boundaries b),
 readiness_values as(select v.*,(select count(*)from jsonb_array_elements(coalesce(v.readiness_payload#>'{technicalFile,sections}','[]'))s where s->>'applicability'='applicable')applicable,
 (select count(*)from jsonb_array_elements(coalesce(v.readiness_payload#>'{technicalFile,sections}','[]'))s join jsonb_array_elements(coalesce(v.readiness_payload#>'{readiness,sections}','[]'))r on r->>'sectionKey'=s->>'key'where s->>'applicability'='applicable'and r->>'status'='complete')complete from bucket_values v)
 select coalesce(jsonb_agg(jsonb_build_object('start',public.m7_snapshot_timestamp_utc(starts),'end',public.m7_snapshot_timestamp_utc(ends),'opened',case when metric='activity'and starts>=baseline then opened end,'closed',case when metric='activity'and starts>=baseline then closed end,'reopened',case when metric='activity'and starts>=baseline then reopened end,'value',case when metric in('triage','remediation')and ends>baseline then duration_mean when metric='sbomCoverage'and starts>=baseline and eligible>0 then round(100.0*covered/eligible,2)when metric='readiness'and applicable>0 then round(100.0*complete/applicable,2)end,'sampleCount',case when metric in('triage','remediation')then sample_count when metric='readiness'then snapshot_count else 0 end,'excludedCount',case when metric in('triage','remediation')then excluded_count else 0 end,'numerator',case when metric='sbomCoverage'and starts>=baseline then covered when metric='readiness'and readiness_payload is not null then complete end,'denominator',case when metric='sbomCoverage'and starts>=baseline then eligible when metric='readiness'and readiness_payload is not null then applicable end,'sourceCount',case when metric='activity'and starts>=baseline then opened+closed+reopened when metric in('triage','remediation')then sample_count+excluded_count when metric='sbomCoverage'and starts>=baseline then eligible when metric='readiness'then snapshot_count else 0 end)order by starts),'[]')into points from readiness_values;
 end if;
 series:=series||jsonb_build_object(metric,jsonb_build_object('state',state,'reason',reason,'unit',unit,'baselineAt',case when metric<>'readiness'then public.m7_snapshot_timestamp_utc(baseline)end,'buckets',points));
 end loop;
 return jsonb_build_object('outcome','found','snapshot',pin,'result',jsonb_build_object('organizationId',org,'filters',p_filters,'policyVersion','m14-02-v1','datasetRevision',revision,'generatedAt',public.m7_snapshot_timestamp_utc(now_at),'baselineAt',public.m7_snapshot_timestamp_utc(baseline),'series',series));
end$$;
create function public.get_dashboard_trend_sources(p_organization_id uuid,p_actor_user_id uuid,p_filters jsonb,p_snapshot jsonb default null)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare base_filters jsonb:=p_filters-array['metric','offset','limit'];dataset jsonb;pin jsonb;metric text:=p_filters->>'metric';product uuid:=(p_filters->>'productId')::uuid;off integer:=coalesce((p_filters->>'offset')::integer,0);lim integer:=coalesce((p_filters->>'limit')::integer,50);rows jsonb;n integer;from_at timestamptz:=(p_filters->>'from')::date::timestamp at time zone(p_filters->>'timezone');to_at timestamptz:=((p_filters->>'to')::date+1)::timestamp at time zone(p_filters->>'timezone');
begin
 if metric not in('activity','triage','remediation','sbomCoverage','readiness')or off<0 or lim not between 1 and 100 then return jsonb_build_object('outcome','invalid_request');end if;
 dataset:=public.get_dashboard_trends(p_organization_id,p_actor_user_id,base_filters,p_snapshot);if dataset->>'outcome'<>'found'then return dataset;end if;
 if dataset#>>array['result','series',metric,'state']<>'available'then return jsonb_build_object('outcome','forbidden');end if;pin:=dataset->'snapshot';
 with finding_facts as materialized(select f.*,p.payload previous from public.vulnerability_finding_lifecycle_facts f left join public.vulnerability_finding_lifecycle_facts p on p.organization_id=p_organization_id and p.sequence=f.previous_sequence where f.organization_id=p_organization_id and f.finding_id is not null and(product is null or f.product_id=product)and f.sequence<=(pin->>'maxFindingSequence')::bigint and pg_visible_in_snapshot(f.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)),
 finding_latest as(select distinct on(finding_id)*from finding_facts order by finding_id,sequence desc),
 finding_sources as(select f.sequence,f.product_id,f.finding_id,f.recorded_at,f.provenance,case when metric='triage'then(f.payload->>'triagedAt')::timestamptz when metric='remediation'then(f.payload->>'fixedAt')::timestamptz else f.effective_at end effective_at,case when metric='triage'then'first_triage'when metric='remediation'then'applied_remediation'else'observation'end kind from finding_latest f where metric in('triage','remediation')and extract(epoch from(case metric when'triage'then(f.payload->>'triagedAt')::timestamptz else(f.payload->>'fixedAt')::timestamptz end-(f.payload->>'firstDetectedAt')::timestamptz))>=0
 union all select f.sequence,f.product_id,f.finding_id,f.recorded_at,f.provenance,case when f.previous_sequence is null then(l.payload->>'firstDetectedAt')::timestamptz when f.previous->>'open'='true'then coalesce((f.payload->>'closedAt')::timestamptz,(f.payload->>'fixedAt')::timestamptz,f.effective_at)else f.effective_at end,case when f.previous_sequence is null then'opened'when f.previous->>'open'='true'then'closed'else'reopened'end from finding_facts f join finding_latest l using(finding_id)where metric='activity'and f.fact_kind='observation'and(f.previous_sequence is null or(f.previous->>'open'<>f.payload->>'open'and f.payload->>'superseded'='false'))),
 all_sources as(select 'finding-'||f.sequence||'-'||f.kind id,f.product_id,f.finding_id::text source_id,'finding'::text source_type,f.kind,f.effective_at,f.recorded_at,f.provenance,'/findings/'||f.finding_id href from finding_sources f where f.effective_at>=greatest(from_at,(dataset#>>'{result,baselineAt}')::timestamptz)and f.effective_at<to_at
 union all select 'coverage-'||f.sequence,f.product_id,f.release_id::text,'release','coverage_observation',f.effective_at,f.recorded_at,f.provenance,'/products/'||f.product_id from public.sbom_release_coverage_facts f where metric='sbomCoverage'and f.organization_id=p_organization_id and f.release_id is not null and(product is null or f.product_id=product)and f.sequence<=(pin->>'maxCoverageSequence')::bigint and pg_visible_in_snapshot(f.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)and f.effective_at<to_at
 union all select 'snapshot-'||s.id,s.product_id,s.id::text,'technical_file_snapshot','readiness_at_snapshot',s.created_at,s.created_at,'immutable_snapshot:'||s.payload_sha256,'/products/'||s.product_id||'/technical-file'from public.technical_file_snapshots s where metric='readiness'and s.organization_id=p_organization_id and s.product_id=product and s.trend_sequence<=(pin->>'maxSnapshotSequence')::bigint and pg_visible_in_snapshot(s.recorded_transaction_id,(pin->>'snapshot')::pg_snapshot)and s.created_at>=from_at and s.created_at<to_at),
 page as(select *from all_sources order by effective_at,id offset off limit(lim+1)),
 numbered as(select *,row_number()over(order by effective_at,id)ord from page)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'productId',product_id,'sourceId',source_id,'sourceType',source_type,'factKind',kind,'effectiveAt',public.m7_snapshot_timestamp_utc(effective_at),'recordedAt',public.m7_snapshot_timestamp_utc(recorded_at),'provenance',provenance,'href',href)order by ord)filter(where ord<=lim),'[]'),count(*)into rows,n from numbered;
 return jsonb_build_object('outcome','found','snapshot',pin,'result',jsonb_build_object('items',rows,'nextOffset',case when n>lim then off+lim end,'datasetRevision',dataset#>>'{result,datasetRevision}'));
end$$;
insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)values('vulnerability_detection_records','vulnerability_finding_lifecycle_facts','organization_id','sequence',7),('sbom_normalized_graph','sbom_release_coverage_facts','organization_id','sequence',11);
do $$declare v_definition text;v_anchor text:='  in share mode';begin select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)into v_definition;if position(v_anchor in v_definition)=0 then raise exception'export snapshot lock anchor missing';end if;execute replace(v_definition,v_anchor,', public.vulnerability_finding_lifecycle_facts, public.sbom_release_coverage_facts'||chr(10)||v_anchor);end$$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like'm14_02_%'or pronamespace='public'::regnamespace and proname in('get_dashboard_trends','get_dashboard_trend_sources')loop execute format('alter function %s owner to postgres',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);if f.signature::text like'get_dashboard_%'then execute format('grant execute on function %s to service_role',f.signature);end if;end loop;end$$;
notify pgrst,'reload schema';
