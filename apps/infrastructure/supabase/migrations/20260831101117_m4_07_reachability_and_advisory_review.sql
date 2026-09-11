-- CRA-M4-07: immutable reachability evidence and advisory-review ledger.
-- The adapter allowlist remains deployment configuration; this migration never
-- accepts browser supplied analyser configuration or source payloads.

alter table public.vulnerability_feed_staged_records drop constraint vulnerability_feed_staged_records_record_state_check;
alter table public.vulnerability_feed_staged_records add constraint vulnerability_feed_staged_records_record_state_check check (record_state in ('active','withdrawn','rejected','disputed','deleted'));
alter table public.vulnerabilities drop constraint vulnerabilities_lifecycle_state_check;
alter table public.vulnerabilities add constraint vulnerabilities_lifecycle_state_check check (lifecycle_state in ('active','withdrawn','rejected','disputed','deleted'));
alter table public.vulnerability_source_records drop constraint vulnerability_source_records_record_state_check;
alter table public.vulnerability_source_records add constraint vulnerability_source_records_record_state_check check (record_state in ('active','withdrawn','rejected','disputed','deleted'));
alter table public.vulnerability_source_record_versions drop constraint vulnerability_source_record_versions_record_state_check;
alter table public.vulnerability_source_record_versions add constraint vulnerability_source_record_versions_record_state_check check (record_state in ('active','withdrawn','rejected','disputed','deleted'));
alter table public.vulnerability_feed_snapshot_source_records drop constraint vulnerability_feed_snapshot_source_records_record_state_check;
alter table public.vulnerability_feed_snapshot_source_records add constraint vulnerability_feed_snapshot_source_records_record_state_check check (record_state in ('active','withdrawn','rejected','disputed','deleted'));

create or replace function public.stage_vulnerability_feed_record(p_run_id uuid,p_worker_id text,p_source_record_key text,p_canonical_id text,p_record_state text,p_source_update_marker text,p_source_updated_at timestamptz,p_raw_payload jsonb,p_normalized_payload jsonb,p_record_sha256 text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.vulnerability_feed_sync_runs%rowtype;
begin
  if p_run_id is null or p_worker_id is null or char_length(btrim(coalesce(p_source_record_key,''))) not between 1 and 300
    or char_length(btrim(coalesce(p_canonical_id,''))) not between 1 and 300
    or p_record_state not in ('active','withdrawn','rejected','disputed','deleted')
    or jsonb_typeof(p_raw_payload) <> 'object' or jsonb_typeof(p_normalized_payload) <> 'object'
    or p_record_sha256 !~ '^[a-f0-9]{64}$' then return 'invalid_request'; end if;
  select * into v_run from public.vulnerability_feed_sync_runs where id=p_run_id for share;
  if not found or v_run.status <> 'processing' or v_run.lease_owner <> p_worker_id or v_run.lease_expires_at <= now() then return 'lease_lost'; end if;
  insert into public.vulnerability_feed_staged_records(run_id,source_record_key,canonical_id,record_state,source_update_marker,source_updated_at,raw_payload,normalized_payload,record_sha256)
  values(p_run_id,btrim(p_source_record_key),btrim(p_canonical_id),p_record_state,p_source_update_marker,p_source_updated_at,p_raw_payload,p_normalized_payload,p_record_sha256)
  on conflict(run_id,source_record_key) do update set canonical_id=excluded.canonical_id,record_state=excluded.record_state,source_update_marker=excluded.source_update_marker,source_updated_at=excluded.source_updated_at,raw_payload=excluded.raw_payload,normalized_payload=excluded.normalized_payload,record_sha256=excluded.record_sha256,received_at=now();
  return 'staged';
end; $$;

/* Superseded duplicate declarations from interrupted restoration. */
/*
set check_function_bodies = false;

create or replace function public.list_due_vulnerability_finding_review_notification_orgs(p_limit integer default 1000) returns table(organization_id uuid) language plpgsql security definer set search_path = public, pg_temp as $$ begin if p_limit not between 1 and 1000 then return; end if; return query select distinct e.organization_id from public.vulnerability_finding_review_events e where e.review_state='open' and e.notification_due_at<=clock_timestamp() and (e.notification_status in ('queued','retrying') or (e.notification_status='leased' and e.notification_lease_expires_at<=clock_timestamp())) order by e.organization_id limit p_limit; end; $$;
create or replace function public.claim_vulnerability_finding_review_notification(p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120) returns table(outcome text,review_event jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.vulnerability_finding_review_events%rowtype; begin
  if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_lease_seconds not between 10 and 3600 then return query select 'invalid_request',null::jsonb; return; end if;
  select * into e from public.vulnerability_finding_review_events x where x.organization_id=p_organization_id and x.review_state='open' and (x.notification_status in ('queued','retrying') or (x.notification_status='leased' and x.notification_lease_expires_at<=clock_timestamp())) order by x.notification_due_at,x.id for update skip locked limit 1;
  if not found then return query select 'none_due',null::jsonb; return; end if;
  update public.vulnerability_finding_review_events x set notification_status='leased',notification_attempts=x.notification_attempts+1,notification_last_attempt_at=clock_timestamp(),notification_lease_owner=btrim(p_worker_id),notification_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),notification_error_code=null,notification_error_message=null where x.organization_id=p_organization_id and x.id=e.id returning * into e;
  return query select 'claimed',jsonb_build_object('id',e.id,'findingId',e.finding_id,'transitionKind',e.transition_kind,'notificationAttempts',e.notification_attempts);
end; $$;
create or replace function public.get_vulnerability_finding_review_notification_details(p_organization_id uuid,p_event_id uuid) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_organization_id is null or p_event_id is null then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found',jsonb_build_object('recipient',jsonb_build_object('userId',u.id,'email',u.email),'review',jsonb_build_object('advisoryId',coalesce(v.canonical_id,s.source_record_key),'transition',replace(e.transition_kind,'advisory_',''),'reviewState',case when e.review_state='open' then 'review_required' else 'no_review_required' end)) from public.vulnerability_finding_review_events e join public.vulnerability_source_record_versions v on v.id=e.source_record_version_id join public.vulnerability_source_records s on s.id=e.source_record_id join public.organization_members m on m.organization_id=e.organization_id and m.role in ('owner','admin') join public.users u on u.id=m.user_id and u.is_active where e.organization_id=p_organization_id and e.id=p_event_id order by case m.role when 'owner' then 0 else 1 end,u.id limit 1;
  if not found then return query select 'not_found',null::jsonb; end if;
end; $$;
create or replace function public.complete_vulnerability_finding_review_notification(p_organization_id uuid,p_review_event_id uuid,p_worker_id text,p_delivered boolean,p_error_code text default null,p_error_message text default null) returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.vulnerability_finding_review_events%rowtype; begin
  if p_organization_id is null or p_review_event_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_delivered is null or (not p_delivered and (btrim(coalesce(p_error_code,'')) !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$' or char_length(btrim(coalesce(p_error_message,''))) not between 1 and 1000)) then return query select 'invalid_request'; return; end if;
  select * into e from public.vulnerability_finding_review_events x where x.organization_id=p_organization_id and x.id=p_review_event_id for update; if not found then return query select 'not_found'; return; end if;
  if e.notification_status<>'leased' or e.notification_lease_owner<>btrim(p_worker_id) or e.notification_lease_expires_at<=clock_timestamp() then return query select 'conflict'; return; end if;
  if p_delivered then update public.vulnerability_finding_review_events x set notification_status='delivered',notified_at=clock_timestamp(),notification_lease_owner=null,notification_lease_expires_at=null,notification_error_code=null,notification_error_message=null where x.organization_id=p_organization_id and x.id=p_review_event_id; return query select 'delivered'; return; end if;
  update public.vulnerability_finding_review_events x set notification_status=case when x.notification_attempts>=x.max_notification_attempts then 'dead_letter' else 'retrying' end,notification_due_at=case when x.notification_attempts>=x.max_notification_attempts then x.notification_due_at else clock_timestamp()+make_interval(secs=>least(900,30*power(2,greatest(0,x.notification_attempts-1))::integer)) end,notification_lease_owner=null,notification_lease_expires_at=null,notification_error_code=btrim(p_error_code),notification_error_message=btrim(p_error_message) where x.organization_id=p_organization_id and x.id=p_review_event_id; return query select case when e.notification_attempts>=e.max_notification_attempts then 'dead_letter' else 'retry_scheduled' end;
end; $$;

*/
create table public.vulnerability_reachability_results (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null, occurrence_id uuid not null, source_record_version_id uuid not null references public.vulnerability_source_record_versions(id) on delete restrict,
  analyzer_id text not null check (char_length(btrim(analyzer_id)) between 1 and 200), analyzer_version text not null check (char_length(btrim(analyzer_version)) between 1 and 100),
  ecosystem text not null check (char_length(btrim(ecosystem)) between 1 and 100), build_format text not null check (char_length(btrim(build_format)) between 1 and 100),
  component_identity text not null check (char_length(btrim(component_identity)) between 1 and 4096), vulnerable_symbol text check (vulnerable_symbol is null or char_length(btrim(vulnerable_symbol)) between 1 and 4096),
  verdict text not null check (verdict in ('unknown','reachable','not_reachable','not_analysed')),
  input_artifacts jsonb not null check (jsonb_typeof(input_artifacts)='array'), input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'), dependency_graph_fingerprint text check (dependency_graph_fingerprint is null or dependency_graph_fingerprint ~ '^[a-f0-9]{64}$'),
  executed_at timestamptz not null, evidence_path jsonb not null check(jsonb_typeof(evidence_path)='array'), confidence_score numeric(5,4) not null check(confidence_score between 0 and 1), confidence_level text not null check(confidence_level in ('high','medium','low')), confidence_explanation text not null check(char_length(btrim(confidence_explanation)) between 1 and 1000), limitations jsonb not null default '[]'::jsonb check(jsonb_typeof(limitations)='array'),
  freshness text not null default 'current' check(freshness in ('current','stale')), stale_at timestamptz, stale_reasons jsonb not null default '[]'::jsonb check(jsonb_typeof(stale_reasons)='array'), superseded_by_result_id uuid references public.vulnerability_reachability_results(id) on delete restrict,
  idempotency_key uuid not null, material_fingerprint text not null check(material_fingerprint ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(),
  check ((freshness='current' and stale_at is null and jsonb_array_length(stale_reasons)=0) or (freshness='stale' and stale_at is not null and jsonb_array_length(stale_reasons)>0)),
  check (verdict not in ('reachable','not_reachable') or (vulnerable_symbol is not null and jsonb_array_length(evidence_path)>0)),
  unique(organization_id,finding_id,idempotency_key), unique(organization_id,finding_id,material_fingerprint), unique(organization_id,id),
  foreign key(organization_id,finding_id) references public.vulnerability_findings(organization_id,id) on delete cascade,
  foreign key(organization_id,occurrence_id) references public.vulnerability_component_occurrences(organization_id,id) on delete cascade
);
create index vulnerability_reachability_results_finding_current_idx on public.vulnerability_reachability_results(organization_id,finding_id,executed_at desc,id) where freshness='current';
create index vulnerability_reachability_results_occurrence_current_idx on public.vulnerability_reachability_results(organization_id,occurrence_id,id) where freshness='current';

create table public.vulnerability_finding_review_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null, source_record_id uuid not null references public.vulnerability_source_records(id) on delete restrict, source_record_version_id uuid not null references public.vulnerability_source_record_versions(id) on delete restrict,
  transition_kind text not null check(transition_kind in ('advisory_withdrawn','advisory_rejected','advisory_disputed','advisory_reinstated','source_conflict')), prior_state jsonb not null check(jsonb_typeof(prior_state)='object'), proposed_state jsonb not null check(jsonb_typeof(proposed_state)='object'), material_fingerprint text not null check(material_fingerprint ~ '^[a-f0-9]{64}$'),
  review_state text not null default 'open' check(review_state in ('open','acknowledged')), notification_status text not null default 'queued' check(notification_status in ('queued','leased','retrying','delivered','dead_letter')), notification_attempts integer not null default 0 check(notification_attempts >= 0), notification_last_attempt_at timestamptz, max_notification_attempts integer not null default 12 check(max_notification_attempts between 1 and 20), notification_due_at timestamptz not null default clock_timestamp(), notification_lease_owner text check(notification_lease_owner is null or char_length(btrim(notification_lease_owner)) between 1 and 100), notification_lease_expires_at timestamptz, notified_at timestamptz, notification_error_code text check(notification_error_code is null or notification_error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'), notification_error_message text check(notification_error_message is null or char_length(btrim(notification_error_message)) between 1 and 1000), created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check ((notification_lease_owner is null)=(notification_lease_expires_at is null)), unique(organization_id,finding_id,material_fingerprint), unique(organization_id,id), foreign key(organization_id,finding_id) references public.vulnerability_findings(organization_id,id) on delete cascade
);
create index vulnerability_finding_review_events_finding_idx on public.vulnerability_finding_review_events(organization_id,finding_id,created_at desc,id);
create index vulnerability_finding_review_events_notification_due_idx on public.vulnerability_finding_review_events(organization_id,notification_due_at,id) where notification_status in ('queued','retrying');
create trigger set_vulnerability_finding_review_events_updated_at before update on public.vulnerability_finding_review_events for each row execute function public.set_updated_at();

alter table public.vulnerability_reachability_results enable row level security;
alter table public.vulnerability_finding_review_events enable row level security;
revoke all on table public.vulnerability_reachability_results, public.vulnerability_finding_review_events from public, anon, authenticated;
grant select,insert,update,delete on table public.vulnerability_reachability_results, public.vulnerability_finding_review_events to service_role;

create or replace function public.m4_07_reachability_result_json(p_result_id uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',r.id,'documentId',o.document_id,'findingId',r.finding_id,'componentId',o.component_id,'advisorySourceRecordVersionId',r.source_record_version_id,'verdict',r.verdict,'analyzer',jsonb_build_object('adapterId',r.analyzer_id,'version',r.analyzer_version,'ecosystem',r.ecosystem,'buildFormat',r.build_format),'inputArtifacts',r.input_artifacts,'inputFingerprint',r.input_fingerprint,'dependencyGraphFingerprint',r.dependency_graph_fingerprint,'componentIdentity',r.component_identity,'vulnerableSymbol',r.vulnerable_symbol,'evidencePath',r.evidence_path,'confidence',jsonb_build_object('score',r.confidence_score,'level',r.confidence_level,'explanation',r.confidence_explanation),'limitations',r.limitations,'executedAt',to_char(r.executed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'freshness',r.freshness,'staleReasons',r.stale_reasons,'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from public.vulnerability_reachability_results r join public.vulnerability_component_occurrences o on o.organization_id=r.organization_id and o.id=r.occurrence_id where r.id=p_result_id;
$$;

create or replace function public.mark_vulnerability_reachability_stale_for_finding(p_organization_id uuid,p_finding_id uuid,p_reason text) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; begin
  if p_organization_id is null or p_finding_id is null or p_reason not in ('sbom_changed','binary_artifact_changed','analysis_artifact_changed','analyzer_version_changed','advisory_changed','dependency_graph_changed','superseded_by_newer_analysis') then return 0; end if;
  update public.vulnerability_reachability_results r set freshness='stale',stale_at=clock_timestamp(),stale_reasons=jsonb_build_array(btrim(p_reason)) where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.freshness='current'; get diagnostics v_count=row_count; return v_count;
end; $$;
create or replace function public.m4_07_mark_reachability_stale_after_occurrence_change() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$ begin
  update public.vulnerability_reachability_results r set freshness='stale',stale_at=clock_timestamp(),stale_reasons=jsonb_build_array('sbom_changed') where r.organization_id=new.organization_id and r.occurrence_id=new.id and r.freshness='current'; return new;
end; $$;
create trigger m4_07_stale_reachability_after_occurrence_change after update of component_identity, component_version, canonical_purl, canonical_cpe on public.vulnerability_component_occurrences for each row when (old.component_identity is distinct from new.component_identity or old.component_version is distinct from new.component_version or old.canonical_purl is distinct from new.canonical_purl or old.canonical_cpe is distinct from new.canonical_cpe) execute function public.m4_07_mark_reachability_stale_after_occurrence_change();

create or replace function public.record_vulnerability_reachability_result_atomic(p_organization_id uuid,p_document_id uuid,p_finding_id uuid,p_result jsonb)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_finding public.vulnerability_findings%rowtype; v_occurrence public.vulnerability_component_occurrences%rowtype;
  v_existing public.vulnerability_reachability_results%rowtype; v_saved public.vulnerability_reachability_results%rowtype;
  v_verdict text; v_evidence jsonb; v_input_artifacts jsonb; v_limitations jsonb; v_confidence jsonb;
  v_freshness text := 'current'; v_stale_reasons jsonb := '[]'::jsonb; v_hash text;
begin
  if p_organization_id is null or p_document_id is null or p_finding_id is null or jsonb_typeof(p_result)<>'object' then return query select 'invalid_request'::text,null::jsonb; return; end if;
  v_verdict:=p_result->>'verdict'; v_evidence:=coalesce(p_result->'evidencePath','[]'::jsonb); v_input_artifacts:=coalesce(p_result->'inputArtifacts','[]'::jsonb); v_limitations:=coalesce(p_result->'limitations','[]'::jsonb); v_confidence:=coalesce(p_result->'confidence','{}'::jsonb);
  if v_verdict not in ('unknown','reachable','not_reachable','not_analysed') or p_result->>'documentId'<>p_document_id::text or p_result->>'findingId'<>p_finding_id::text
    or coalesce(p_result->>'componentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_result->>'advisorySourceRecordVersionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_result->>'idempotencyKey','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(btrim(coalesce(p_result #>> '{analyzer,adapterId}',''))) not between 1 and 200
    or char_length(btrim(coalesce(p_result #>> '{analyzer,version}',''))) not between 1 and 100
    or char_length(btrim(coalesce(p_result #>> '{analyzer,ecosystem}',''))) not between 1 and 100
    or char_length(btrim(coalesce(p_result #>> '{analyzer,buildFormat}',''))) not between 1 and 100
    or jsonb_typeof(v_evidence)<>'array' or jsonb_typeof(v_input_artifacts)<>'array' or jsonb_typeof(v_limitations)<>'array'
    or jsonb_array_length(v_input_artifacts) not between 1 and 20
    or coalesce(p_result->>'inputFingerprint','') !~ '^[a-f0-9]{64}$'
    or (p_result->>'dependencyGraphFingerprint' is not null and coalesce(p_result->>'dependencyGraphFingerprint','') !~ '^[a-f0-9]{64}$')
    or char_length(btrim(coalesce(p_result->>'componentIdentity',''))) not between 1 and 4096
    or (v_verdict in ('reachable','not_reachable') and (jsonb_array_length(v_evidence)=0 or char_length(btrim(coalesce(p_result->>'vulnerableSymbol',''))) not between 1 and 4096))
    or (v_verdict in ('unknown','not_analysed') and jsonb_array_length(v_limitations)=0)
    or exists(select 1 from jsonb_array_elements(v_input_artifacts) a where jsonb_typeof(a)<>'object' or a->>'kind' not in ('sbom','binary','analysis','dependency_graph') or coalesce(a->>'sha256','') !~ '^[a-f0-9]{64}$')
    or exists(select 1 from jsonb_array_elements(v_evidence) with ordinality as n(node,ord) where jsonb_typeof(node)<>'object' or coalesce(node->>'position','') !~ '^[0-9]+$' or (node->>'position')::integer<>ord or coalesce(node->>'relationship','') not in ('root','dependency','call','reference','unknown') or char_length(btrim(coalesce(node->>'componentIdentity',''))) not between 1 and 4096 or char_length(btrim(coalesce(node->>'displayLabel',''))) not between 1 and 4096 or coalesce(node->>'evidenceSha256','') !~ '^[a-f0-9]{64}$') then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  begin
    if (v_confidence->>'score')::numeric < 0 or (v_confidence->>'score')::numeric > 1 or coalesce(v_confidence->>'level','') not in ('high','medium','low')
      or ((v_confidence->>'score')::numeric >= .9 and v_confidence->>'level'<>'high')
      or ((v_confidence->>'score')::numeric >= .6 and (v_confidence->>'score')::numeric < .9 and v_confidence->>'level'<>'medium')
      or ((v_confidence->>'score')::numeric < .6 and v_confidence->>'level'<>'low')
      or char_length(btrim(coalesce(v_confidence->>'explanation',''))) not between 1 and 1000
      or (p_result->>'executedAt')::timestamptz is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
  exception when invalid_text_representation or invalid_datetime_format then return query select 'invalid_request'::text,null::jsonb; return; end;
  select * into v_finding from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active' for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select o.* into v_occurrence from public.vulnerability_component_occurrences o join public.vulnerability_finding_component_occurrences l on l.organization_id=o.organization_id and l.occurrence_id=o.id and l.finding_id=p_finding_id and l.state='active' where o.organization_id=p_organization_id and o.document_id=p_document_id and o.component_id=(p_result->>'componentId')::uuid and o.component_identity=btrim(p_result->>'componentIdentity') limit 1;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if not exists(select 1 from public.vulnerability_source_record_versions v join public.vulnerability_source_records r on r.id=v.source_record_id where v.id=(p_result->>'advisorySourceRecordVersionId')::uuid and r.vulnerability_id=v_finding.vulnerability_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  if (p_result->>'advisorySourceRecordVersionId')::uuid<>v_finding.source_record_version_id then v_freshness:='stale'; v_stale_reasons:=v_stale_reasons||jsonb_build_array('advisory_changed'); end if;
  if exists(select 1 from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.executed_at>(p_result->>'executedAt')::timestamptz) then v_freshness:='stale'; v_stale_reasons:=v_stale_reasons||jsonb_build_array('superseded_by_newer_analysis'); end if;
  v_hash:=encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'occurrenceId',v_occurrence.id,'sourceRecordVersionId',p_result->>'advisorySourceRecordVersionId','verdict',v_verdict,'analyzer',p_result->'analyzer','inputFingerprint',p_result->>'inputFingerprint','dependencyGraphFingerprint',p_result->>'dependencyGraphFingerprint','componentIdentity',btrim(p_result->>'componentIdentity'),'vulnerableSymbol',p_result->>'vulnerableSymbol','evidencePath',v_evidence,'executedAt',p_result->>'executedAt')::text,'sha256'),'hex');
  select * into v_existing from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.idempotency_key=(p_result->>'idempotencyKey')::uuid;
  if found then
    if v_existing.material_fingerprint<>v_hash then return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
    return query select 'idempotent'::text,public.m4_07_reachability_result_json(v_existing.id); return;
  end if;
  insert into public.vulnerability_reachability_results(organization_id,finding_id,occurrence_id,source_record_version_id,analyzer_id,analyzer_version,ecosystem,build_format,component_identity,vulnerable_symbol,verdict,input_artifacts,input_fingerprint,dependency_graph_fingerprint,executed_at,evidence_path,confidence_score,confidence_level,confidence_explanation,limitations,freshness,stale_at,stale_reasons,idempotency_key,material_fingerprint)
  values(p_organization_id,p_finding_id,v_occurrence.id,(p_result->>'advisorySourceRecordVersionId')::uuid,btrim(p_result #>> '{analyzer,adapterId}'),btrim(p_result #>> '{analyzer,version}'),btrim(p_result #>> '{analyzer,ecosystem}'),btrim(p_result #>> '{analyzer,buildFormat}'),btrim(p_result->>'componentIdentity'),nullif(btrim(coalesce(p_result->>'vulnerableSymbol','')),''),v_verdict,v_input_artifacts,p_result->>'inputFingerprint',nullif(p_result->>'dependencyGraphFingerprint',''),(p_result->>'executedAt')::timestamptz,v_evidence,(v_confidence->>'score')::numeric,v_confidence->>'level',btrim(v_confidence->>'explanation'),v_limitations,v_freshness,case when v_freshness='stale' then clock_timestamp() else null end,v_stale_reasons,(p_result->>'idempotencyKey')::uuid,v_hash)
  on conflict(organization_id,finding_id,material_fingerprint) do nothing returning * into v_saved;
  if not found then select * into v_saved from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.material_fingerprint=v_hash; return query select 'idempotent'::text,public.m4_07_reachability_result_json(v_saved.id); return; end if;
  if v_saved.freshness='current' then update public.vulnerability_reachability_results r set freshness='stale',stale_at=clock_timestamp(),stale_reasons=case when r.stale_reasons ? 'superseded_by_newer_analysis' then r.stale_reasons else r.stale_reasons||jsonb_build_array('superseded_by_newer_analysis') end,superseded_by_result_id=v_saved.id where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.id<>v_saved.id and r.freshness='current' and r.occurrence_id=v_saved.occurrence_id and r.executed_at<=v_saved.executed_at; end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'vulnerability.reachability_recorded','vulnerability_reachability_result',v_saved.id::text,jsonb_build_object('findingId',p_finding_id,'occurrenceId',v_saved.occurrence_id,'analyzerAdapterId',v_saved.analyzer_id,'analyzerVersion',v_saved.analyzer_version,'verdict',v_saved.verdict,'freshness',v_saved.freshness,'materialFingerprint',v_saved.material_fingerprint));
  return query select 'recorded'::text,public.m4_07_reachability_result_json(v_saved.id);
exception when unique_violation then return query select 'idempotency_conflict'::text,null::jsonb;
end; $$;

create or replace function public.m4_07_review_event_json(p_event_id uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',e.id,'findingId',e.finding_id,'sourceRecordVersionId',e.source_record_version_id,'transition',case e.transition_kind when 'advisory_withdrawn' then 'withdrawn' when 'advisory_rejected' then 'rejected' when 'advisory_disputed' then 'disputed' when 'advisory_reinstated' then 'reinstated' else e.transition_kind end,'priorStatus',nullif(e.prior_state->>'sourceStatus',''),'currentStatus',nullif(e.proposed_state->>'sourceStatus',''),'materialFingerprint',e.material_fingerprint,'reviewState',case when e.review_state='open' and e.transition_kind='source_conflict' then 'source_conflict' when e.review_state='open' then 'review_required' else 'no_review_required' end,'notification',jsonb_build_object('state',case when e.notification_status='queued' then 'pending' when e.notification_status='leased' then 'retrying' else e.notification_status end,'attempts',e.notification_attempts,'lastAttemptAt',case when e.notification_last_attempt_at is null then null else to_char(e.notification_last_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,'deliveredAt',case when e.notified_at is null then null else to_char(e.notified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end),'occurredAt',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from public.vulnerability_finding_review_events e where e.id=p_event_id;
$$;

create or replace function public.record_vulnerability_finding_advisory_review_atomic(p_organization_id uuid,p_document_id uuid,p_finding_id uuid,p_source_record_version_id uuid,p_transition_kind text,p_prior_state jsonb,p_proposed_state jsonb)
returns table(outcome text,event jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_finding public.vulnerability_findings%rowtype; v_source_record_id uuid; v_event public.vulnerability_finding_review_events%rowtype; v_hash text;
begin
  if p_organization_id is null or p_document_id is null or p_finding_id is null or p_source_record_version_id is null or p_transition_kind not in ('advisory_withdrawn','advisory_rejected','advisory_disputed','advisory_reinstated','source_conflict') or jsonb_typeof(p_prior_state)<>'object' or jsonb_typeof(p_proposed_state)<>'object' then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select f.* into v_finding from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and exists(select 1 from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=p_organization_id and l.finding_id=f.id and l.state='active' and o.document_id=p_document_id) for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select v.source_record_id into v_source_record_id from public.vulnerability_source_record_versions v join public.vulnerability_source_records r on r.id=v.source_record_id where v.id=p_source_record_version_id and r.vulnerability_id=v_finding.vulnerability_id;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  v_hash:=encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'sourceRecordVersionId',p_source_record_version_id,'transitionKind',p_transition_kind,'priorStatus',p_prior_state->>'sourceStatus','currentStatus',p_proposed_state->>'sourceStatus')::text,'sha256'),'hex');
  insert into public.vulnerability_finding_review_events(organization_id,finding_id,source_record_id,source_record_version_id,transition_kind,prior_state,proposed_state,material_fingerprint)
  values(p_organization_id,p_finding_id,v_source_record_id,p_source_record_version_id,p_transition_kind,p_prior_state,p_proposed_state,v_hash)
  on conflict(organization_id,finding_id,material_fingerprint) do nothing returning * into v_event;
  if not found then select * into v_event from public.vulnerability_finding_review_events e where e.organization_id=p_organization_id and e.finding_id=p_finding_id and e.material_fingerprint=v_hash; return query select 'idempotent'::text,public.m4_07_review_event_json(v_event.id); return; end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'vulnerability.finding_review_required','vulnerability_finding_review_event',v_event.id::text,jsonb_build_object('findingId',p_finding_id,'sourceRecordId',v_source_record_id,'sourceRecordVersionId',p_source_record_version_id,'transitionKind',p_transition_kind,'materialFingerprint',v_hash));
  return query select 'recorded'::text,public.m4_07_review_event_json(v_event.id);
end; $$;

alter function public.list_vulnerability_reevaluation_candidates(uuid, uuid, text, integer) rename to list_vulnerability_reevaluation_candidates_m4_06;
create or replace function public.list_vulnerability_reevaluation_candidates(p_organization_id uuid,p_job_id uuid,p_lease_owner text,p_limit integer default 250)
returns table(candidate jsonb) language sql security definer set search_path = public, pg_temp as $$
  select jsonb_set(rows.candidate,'{priorSourceStatus}',coalesce(to_jsonb(v.record_state),'null'::jsonb),true)
  from public.list_vulnerability_reevaluation_candidates_m4_06(p_organization_id,p_job_id,p_lease_owner,p_limit) rows
  left join lateral (
    select pv.record_state from public.vulnerability_findings f join public.vulnerability_source_record_versions pv on pv.id=f.source_record_version_id
    where f.organization_id=p_organization_id and f.id=nullif(rows.candidate #>> '{findings,0,id}','')::uuid and f.source_record_version_id is distinct from nullif(rows.candidate->>'sourceRecordVersionId','')::uuid limit 1
  ) v on true;
$$;

alter function public.persist_vulnerability_reevaluation_page_atomic(uuid, uuid, text, integer, jsonb, uuid, boolean) rename to persist_vulnerability_reevaluation_page_atomic_m4_06;
create or replace function public.persist_vulnerability_reevaluation_page_atomic(p_organization_id uuid,p_job_id uuid,p_lease_owner text,p_expected_checkpoint_version integer,p_transitions jsonb,p_next_occurrence_id uuid,p_is_final boolean)
returns table(outcome text,processed_count integer,created_count integer,review_required_count integer,checkpoint_version integer) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype; v_item record; v_finding public.vulnerability_findings%rowtype; v_source_status text; v_prior_status text; v_document_id uuid; v_pending jsonb:='[]'::jsonb; v_pending_item record; v_result record; v_kind text; v_prior jsonb;
begin
  if jsonb_typeof(p_transitions)='array' then
    select * into v_job from public.vulnerability_reevaluation_jobs j where j.organization_id=p_organization_id and j.id=p_job_id;
    if found then
      select record_state into v_source_status from public.vulnerability_source_record_versions where id=v_job.source_record_version_id;
      for v_item in select * from jsonb_to_recordset(p_transitions) as i("occurrenceId" uuid,"findingId" uuid,"reevaluationState" text,"transitionReason" text,"proposedState" jsonb) loop
        if v_item."findingId" is not null and v_item."reevaluationState"='review_required' and v_item."transitionReason" in ('advisory_withdrawn','advisory_disputed','advisory_reinstated') then
          select * into v_finding from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_item."findingId";
          if found then
            select record_state into v_prior_status from public.vulnerability_source_record_versions where id=v_finding.source_record_version_id;
            select o.document_id into v_document_id from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=p_organization_id and l.finding_id=v_finding.id and l.state='active' order by o.id limit 1;
            v_prior:=jsonb_strip_nulls(jsonb_build_object('automaticVerdict',v_finding.automatic_verdict,'humanVerdict',v_finding.human_verdict,'humanRationale',v_finding.human_rationale,'reevaluationState',v_finding.reevaluation_state,'status',v_finding.status,'sourceRecordVersionId',v_finding.source_record_version_id,'sourceStatus',v_prior_status));
            v_pending:=v_pending||jsonb_build_array(jsonb_build_object('documentId',v_document_id,'findingId',v_finding.id,'priorState',v_prior,'proposedState',coalesce(v_item."proposedState",'{}'::jsonb)||jsonb_build_object('sourceStatus',v_source_status),'transitionReason',v_item."transitionReason"));
          end if;
        end if;
      end loop;
    end if;
  end if;
  select * into v_result from public.persist_vulnerability_reevaluation_page_atomic_m4_06(p_organization_id,p_job_id,p_lease_owner,p_expected_checkpoint_version,p_transitions,p_next_occurrence_id,p_is_final);
  if v_result.outcome not in ('queued','completed') then return query select v_result.outcome,v_result.processed_count,v_result.created_count,v_result.review_required_count,v_result.checkpoint_version; return; end if;
  for v_pending_item in select * from jsonb_to_recordset(v_pending) as i("documentId" uuid,"findingId" uuid,"priorState" jsonb,"proposedState" jsonb,"transitionReason" text) loop
    v_kind:=case when v_pending_item."transitionReason"='advisory_reinstated' then 'advisory_reinstated' when v_pending_item."transitionReason"='advisory_disputed' then 'advisory_disputed' when v_source_status='rejected' then 'advisory_rejected' else 'advisory_withdrawn' end;
    perform 1 from public.record_vulnerability_finding_advisory_review_atomic(p_organization_id,v_pending_item."documentId",v_pending_item."findingId",v_job.source_record_version_id,v_kind,v_pending_item."priorState",v_pending_item."proposedState");
    perform public.mark_vulnerability_reachability_stale_for_finding(p_organization_id,v_pending_item."findingId",'advisory_changed');
    if v_kind='advisory_reinstated' then update public.vulnerability_findings f set reevaluation_state=case when f.human_verdict is not null and f.human_verdict<>f.automatic_verdict then 'review_required' else 'unchanged' end, proposed_state=case when f.human_verdict is not null and f.human_verdict<>f.automatic_verdict then f.proposed_state else '{}'::jsonb end, closed_at=null, closure_reason=null, updated_at=clock_timestamp() where f.organization_id=p_organization_id and f.id=v_pending_item."findingId"; end if;
  end loop;
  return query select v_result.outcome,v_result.processed_count,v_result.created_count,v_result.review_required_count,v_result.checkpoint_version;
end; $$;

create or replace function public.get_vulnerability_finding_reachability_evidence(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_finding_id uuid,p_include_stale boolean default false)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result_id uuid;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_finding_id is null or p_include_stale is null or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or not exists(select 1 from public.vulnerability_findings f join public.vulnerability_finding_component_occurrences l on l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active' and o.document_id=p_document_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select r.id into v_result_id from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and (p_include_stale or r.freshness='current') order by (r.freshness='current') desc,r.executed_at desc,r.created_at desc,r.id desc limit 1;
  return query select 'found'::text,jsonb_build_object('reachability',case when v_result_id is null then null else public.m4_07_reachability_result_json(v_result_id) end,'analyzerSupport',case when v_result_id is null then jsonb_build_object('state','unavailable','reason','No reachability result is available for this finding.') else jsonb_build_object('state','supported','reason',null) end);
end; $$;

create or replace function public.get_vulnerability_finding_advisory_review(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_finding_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_finding public.vulnerability_findings%rowtype; v_latest uuid; v_conflicts jsonb; v_state text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_finding_id is null or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select f.* into v_finding from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active' and exists(select 1 from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=p_organization_id and l.finding_id=f.id and l.state='active' and o.document_id=p_document_id);
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select e.id into v_latest from public.vulnerability_finding_review_events e where e.organization_id=p_organization_id and e.finding_id=p_finding_id order by e.created_at desc,e.id desc limit 1;
  with assertions as (select v.record_state from public.vulnerability_source_records r join public.vulnerability_source_record_versions v on v.id=r.current_version_id where r.vulnerability_id=v_finding.vulnerability_id)
  select case when count(distinct record_state)>1 then jsonb_build_array('source_status_conflict') else '[]'::jsonb end into v_conflicts from assertions;
  v_state:=case when jsonb_array_length(v_conflicts)>0 then 'source_conflict' when exists(select 1 from public.vulnerability_source_records r join public.vulnerability_source_record_versions v on v.id=r.current_version_id where r.vulnerability_id=v_finding.vulnerability_id and v.record_state in ('withdrawn','rejected','disputed','deleted')) or v_latest is not null then 'review_required' else 'no_review_required' end;
  return query with assertions as (
    select r.feed_key,r.source_record_key,v.id source_record_version_id,v.record_state,v.source_updated_at,v.promoted_at,v.normalized_payload
    from public.vulnerability_source_records r join public.vulnerability_source_record_versions v on v.id=r.current_version_id where r.vulnerability_id=v_finding.vulnerability_id
  ) select 'found'::text,jsonb_build_object('findingId',v_finding.id,'state',v_state,'sourceAssertions',coalesce(jsonb_agg(jsonb_build_object('sourceFeed',feed_key,'sourceRecordId',source_record_key,'sourceRecordVersionId',source_record_version_id,'status',record_state,'assertedAt',case when source_updated_at is null then null else to_char(source_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,'retrievedAt',to_char(promoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'publisher',nullif(coalesce(normalized_payload #>> '{csafProvenance,publisherName}',normalized_payload #>> '{publisher,name}',normalized_payload #>> '{publisher}'),''),'authoritative',true) order by feed_key,source_record_key),'[]'::jsonb),'conflicts',v_conflicts,'latestEvent',case when v_latest is null then null else public.m4_07_review_event_json(v_latest) end,'updatedAt',to_char(coalesce((select updated_at from public.vulnerability_finding_review_events where id=v_latest),v_finding.updated_at,clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from assertions;
end; $$;

create or replace function public.claim_vulnerability_finding_review_notification(p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120)
returns table(outcome text,review_event jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.vulnerability_finding_review_events%rowtype; begin
  if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_lease_seconds not between 10 and 3600 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_event from public.vulnerability_finding_review_events e where e.organization_id=p_organization_id and e.review_state='open' and (e.notification_status in ('queued','retrying') or (e.notification_status='leased' and e.notification_lease_expires_at<=clock_timestamp())) order by e.notification_due_at,e.id for update skip locked limit 1;
  if not found then return query select 'none_due'::text,null::jsonb; return; end if;
  update public.vulnerability_finding_review_events e set notification_status='leased',notification_attempts=e.notification_attempts+1,notification_last_attempt_at=clock_timestamp(),notification_lease_owner=btrim(p_worker_id),notification_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),notification_error_code=null,notification_error_message=null where e.organization_id=p_organization_id and e.id=v_event.id returning * into v_event;
  return query select 'claimed'::text,public.m4_07_review_event_json(v_event.id);
end; $$;

create or replace function public.complete_vulnerability_finding_review_notification(p_organization_id uuid,p_review_event_id uuid,p_worker_id text,p_delivered boolean,p_error_code text default null,p_error_message text default null)
returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.vulnerability_finding_review_events%rowtype; begin
  if p_organization_id is null or p_review_event_id is null or p_delivered is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or (not p_delivered and (btrim(coalesce(p_error_code,'')) !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$' or char_length(btrim(coalesce(p_error_message,''))) not between 1 and 1000)) then return query select 'invalid_request'::text; return; end if;
  select * into v_event from public.vulnerability_finding_review_events e where e.organization_id=p_organization_id and e.id=p_review_event_id for update;
  if not found then return query select 'not_found'::text; return; end if;
  if v_event.notification_status<>'leased' or v_event.notification_lease_owner<>btrim(p_worker_id) or v_event.notification_lease_expires_at<=clock_timestamp() then return query select 'conflict'::text; return; end if;
  if p_delivered then update public.vulnerability_finding_review_events e set notification_status='delivered',notified_at=clock_timestamp(),notification_lease_owner=null,notification_lease_expires_at=null,notification_error_code=null,notification_error_message=null where e.organization_id=p_organization_id and e.id=p_review_event_id; return query select 'delivered'::text; return; end if;
  update public.vulnerability_finding_review_events e set notification_status=case when e.notification_attempts>=e.max_notification_attempts then 'dead_letter' else 'retrying' end,notification_due_at=case when e.notification_attempts>=e.max_notification_attempts then e.notification_due_at else clock_timestamp()+make_interval(secs=>least(900,30*power(2,greatest(0,e.notification_attempts-1))::integer)) end,notification_lease_owner=null,notification_lease_expires_at=null,notification_error_code=btrim(p_error_code),notification_error_message=btrim(p_error_message) where e.organization_id=p_organization_id and e.id=p_review_event_id;
  return query select case when v_event.notification_attempts>=v_event.max_notification_attempts then 'dead_letter' else 'retry_scheduled' end;
end; $$;

alter function public.stage_vulnerability_feed_record(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text) owner to postgres;
alter function public.m4_07_reachability_result_json(uuid) owner to postgres;
alter function public.mark_vulnerability_reachability_stale_for_finding(uuid,uuid,text) owner to postgres;
alter function public.m4_07_mark_reachability_stale_after_occurrence_change() owner to postgres;
alter function public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb) owner to postgres;
alter function public.m4_07_review_event_json(uuid) owner to postgres;
alter function public.record_vulnerability_finding_advisory_review_atomic(uuid,uuid,uuid,uuid,text,jsonb,jsonb) owner to postgres;
alter function public.list_vulnerability_reevaluation_candidates(uuid,uuid,text,integer) owner to postgres;
alter function public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) owner to postgres;
alter function public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean) owner to postgres;
alter function public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.claim_vulnerability_finding_review_notification(uuid,text,integer) owner to postgres;
alter function public.complete_vulnerability_finding_review_notification(uuid,uuid,text,boolean,text,text) owner to postgres;

revoke all on function public.stage_vulnerability_feed_record(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text), public.m4_07_reachability_result_json(uuid), public.mark_vulnerability_reachability_stale_for_finding(uuid,uuid,text), public.m4_07_mark_reachability_stale_after_occurrence_change(), public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb), public.m4_07_review_event_json(uuid), public.record_vulnerability_finding_advisory_review_atomic(uuid,uuid,uuid,uuid,text,jsonb,jsonb), public.list_vulnerability_reevaluation_candidates(uuid,uuid,text,integer), public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean), public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean), public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid), public.claim_vulnerability_finding_review_notification(uuid,text,integer), public.complete_vulnerability_finding_review_notification(uuid,uuid,text,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function public.stage_vulnerability_feed_record(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text), public.mark_vulnerability_reachability_stale_for_finding(uuid,uuid,text), public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb), public.record_vulnerability_finding_advisory_review_atomic(uuid,uuid,uuid,uuid,text,jsonb,jsonb), public.list_vulnerability_reevaluation_candidates(uuid,uuid,text,integer), public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean), public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean), public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid), public.claim_vulnerability_finding_review_notification(uuid,text,integer), public.complete_vulnerability_finding_review_notification(uuid,uuid,text,boolean,text,text) to service_role;

/* Superseded duplicate record function and duplicate grants. */
/*
create or replace function public.record_vulnerability_reachability_result_atomic(p_organization_id uuid,p_document_id uuid,p_finding_id uuid,p_result jsonb)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_finding public.vulnerability_findings%rowtype; v_occurrence public.vulnerability_component_occurrences%rowtype; v_saved public.vulnerability_reachability_results%rowtype; v_existing public.vulnerability_reachability_results%rowtype; v_analyzer jsonb; v_confidence jsonb; v_evidence jsonb; v_artifacts jsonb; v_limitations jsonb; v_hash text; v_is_stale boolean;
begin
  if p_organization_id is null or p_document_id is null or p_finding_id is null or jsonb_typeof(p_result) <> 'object' then return query select 'invalid_request',null::jsonb; return; end if;
  v_analyzer:=p_result->'analyzer'; v_confidence:=p_result->'confidence'; v_evidence:=coalesce(p_result->'evidencePath','[]'::jsonb); v_artifacts:=coalesce(p_result->'inputArtifacts','[]'::jsonb); v_limitations:=coalesce(p_result->'limitations','[]'::jsonb);
  if p_result->>'verdict' not in ('unknown','reachable','not_reachable','not_analysed') or jsonb_typeof(v_analyzer)<>'object' or jsonb_typeof(v_confidence)<>'object' or jsonb_typeof(v_evidence)<>'array' or jsonb_typeof(v_artifacts)<>'array' or jsonb_typeof(v_limitations)<>'array' or jsonb_array_length(v_artifacts) not between 1 and 20
    or char_length(btrim(coalesce(v_analyzer->>'adapterId',''))) not between 1 and 200 or char_length(btrim(coalesce(v_analyzer->>'version',''))) not between 1 and 120 or char_length(btrim(coalesce(v_analyzer->>'ecosystem',''))) not between 1 and 120 or char_length(btrim(coalesce(v_analyzer->>'buildFormat',''))) not between 1 and 120
    or coalesce(p_result->>'inputFingerprint','') !~ '^[a-f0-9]{64}$' or p_result->>'documentId' <> p_document_id::text or p_result->>'findingId' <> p_finding_id::text or coalesce(p_result->>'componentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(p_result->>'advisorySourceRecordVersionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(p_result->>'idempotencyKey','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (p_result->>'dependencyGraphFingerprint' is not null and p_result->>'dependencyGraphFingerprint' !~ '^[a-f0-9]{64}$') or (p_result->>'verdict' in ('reachable','not_reachable') and (char_length(btrim(coalesce(p_result->>'vulnerableSymbol',''))) not between 1 and 4096 or jsonb_array_length(v_evidence)=0)) or (p_result->>'verdict' in ('unknown','not_analysed') and jsonb_array_length(v_limitations)=0)
    or exists(select 1 from jsonb_array_elements(v_artifacts) a where jsonb_typeof(a)<>'object' or a->>'kind' not in ('sbom','binary','analysis','dependency_graph') or coalesce(a->>'sha256','') !~ '^[a-f0-9]{64}$')
    or exists(select 1 from jsonb_array_elements(v_evidence) with ordinality p(item,ordinal) where jsonb_typeof(item)<>'object' or case when coalesce(item->>'position','') ~ '^[1-9][0-9]{0,3}$' then (item->>'position')::integer else -1 end <> ordinal or char_length(btrim(coalesce(item->>'componentIdentity',''))) not between 1 and 2000 or char_length(btrim(coalesce(item->>'displayLabel',''))) not between 1 and 2000 or coalesce(item->>'relationship','') not in ('root','dependency','call','reference','unknown') or coalesce(item->>'evidenceSha256','') !~ '^[a-f0-9]{64}$' or (item->>'vulnerableSymbol' is not null and char_length(btrim(item->>'vulnerableSymbol')) not between 1 and 2000)) then return query select 'invalid_request',null::jsonb; return; end if;
  begin
    if (v_confidence->>'score')::numeric not between 0 and 1 or v_confidence->>'level' not in ('high','medium','low') or char_length(btrim(coalesce(v_confidence->>'explanation',''))) not between 1 and 1000 or ((v_confidence->>'score')::numeric >= .9 and v_confidence->>'level'<>'high') or ((v_confidence->>'score')::numeric >= .6 and (v_confidence->>'score')::numeric < .9 and v_confidence->>'level'<>'medium') or ((v_confidence->>'score')::numeric < .6 and v_confidence->>'level'<>'low') or (p_result->>'executedAt')::timestamptz is null then return query select 'invalid_request',null::jsonb; return; end if;
  exception when invalid_text_representation or invalid_datetime_format then return query select 'invalid_request',null::jsonb; return; end;
  select f.* into v_finding from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and exists(select 1 from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' and o.document_id=p_document_id) for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  select o.* into v_occurrence from public.vulnerability_component_occurrences o join public.vulnerability_finding_component_occurrences l on l.organization_id=o.organization_id and l.occurrence_id=o.id where o.organization_id=p_organization_id and l.finding_id=p_finding_id and l.state='active' and o.document_id=p_document_id and o.component_id=(p_result->>'componentId')::uuid limit 1;
  if not found or v_occurrence.component_identity<>btrim(coalesce(p_result->>'componentIdentity','')) or not exists(select 1 from public.vulnerability_source_record_versions v join public.vulnerability_source_records s on s.id=v.source_record_id where v.id=(p_result->>'advisorySourceRecordVersionId')::uuid and s.vulnerability_id=v_finding.vulnerability_id) then return query select 'not_found',null::jsonb; return; end if;
  v_hash:=encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'occurrenceId',v_occurrence.id,'analyzer',v_analyzer,'advisorySourceRecordVersionId',p_result->>'advisorySourceRecordVersionId','verdict',p_result->>'verdict','inputArtifacts',v_artifacts,'inputFingerprint',p_result->>'inputFingerprint','dependencyGraphFingerprint',p_result->>'dependencyGraphFingerprint','vulnerableSymbol',nullif(btrim(coalesce(p_result->>'vulnerableSymbol','')),''),'evidencePath',v_evidence,'confidence',v_confidence,'limitations',v_limitations,'executedAt',p_result->>'executedAt')::text,'sha256'),'hex');
  select * into v_existing from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.idempotency_key=(p_result->>'idempotencyKey')::uuid;
  if found then if v_existing.material_fingerprint<>v_hash then return query select 'idempotency_conflict',null::jsonb; else return query select 'idempotent',public.m4_07_reachability_result_json(v_existing.id); end if; return; end if;
  select * into v_existing from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.material_fingerprint=v_hash;
  if found then return query select 'idempotent',public.m4_07_reachability_result_json(v_existing.id); return; end if;
  v_is_stale := (p_result->>'advisorySourceRecordVersionId')::uuid is distinct from v_finding.source_record_version_id or exists(select 1 from public.vulnerability_reachability_results r where r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.occurrence_id=v_occurrence.id and r.freshness='current' and r.executed_at>(p_result->>'executedAt')::timestamptz);
  insert into public.vulnerability_reachability_results(organization_id,finding_id,occurrence_id,source_record_version_id,analyzer_id,analyzer_version,ecosystem,build_format,component_identity,vulnerable_symbol,verdict,input_artifacts,input_fingerprint,dependency_graph_fingerprint,executed_at,evidence_path,confidence_score,confidence_level,confidence_explanation,limitations,freshness,stale_at,stale_reasons,idempotency_key,material_fingerprint) values(p_organization_id,p_finding_id,v_occurrence.id,(p_result->>'advisorySourceRecordVersionId')::uuid,btrim(v_analyzer->>'adapterId'),btrim(v_analyzer->>'version'),btrim(v_analyzer->>'ecosystem'),btrim(v_analyzer->>'buildFormat'),v_occurrence.component_identity,nullif(btrim(coalesce(p_result->>'vulnerableSymbol','')),''),p_result->>'verdict',v_artifacts,p_result->>'inputFingerprint',p_result->>'dependencyGraphFingerprint',(p_result->>'executedAt')::timestamptz,v_evidence,(v_confidence->>'score')::numeric,v_confidence->>'level',btrim(v_confidence->>'explanation'),v_limitations,case when v_is_stale then 'stale' else 'current' end,case when v_is_stale then clock_timestamp() end,case when not v_is_stale then '[]'::jsonb when (p_result->>'advisorySourceRecordVersionId')::uuid is distinct from v_finding.source_record_version_id then jsonb_build_array('advisory_changed') else jsonb_build_array('superseded_by_newer_analysis') end,(p_result->>'idempotencyKey')::uuid,v_hash) returning * into v_saved;
  update public.vulnerability_reachability_results r set freshness='stale',stale_at=clock_timestamp(),stale_reasons=jsonb_build_array('superseded_by_newer_analysis'),superseded_by_result_id=v_saved.id where not v_is_stale and r.organization_id=p_organization_id and r.finding_id=p_finding_id and r.id<>v_saved.id and r.freshness='current' and r.occurrence_id=v_saved.occurrence_id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'vulnerability.reachability_recorded','vulnerability_reachability_result',v_saved.id::text,jsonb_build_object('findingId',p_finding_id,'occurrenceId',v_saved.occurrence_id,'analyzerId',v_saved.analyzer_id,'analyzerVersion',v_saved.analyzer_version,'verdict',v_saved.verdict,'materialFingerprint',v_saved.material_fingerprint));
  return query select 'recorded',public.m4_07_reachability_result_json(v_saved.id);
end; $$;

alter function public.m4_07_reachability_result_json(uuid) owner to postgres;
alter function public.mark_vulnerability_reachability_stale_for_finding(uuid,uuid,text) owner to postgres;
alter function public.m4_07_mark_reachability_stale_after_occurrence_change() owner to postgres;
alter function public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb) owner to postgres;
alter function public.record_vulnerability_finding_advisory_review_atomic(uuid,uuid,uuid,uuid,text,jsonb,jsonb) owner to postgres;
alter function public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean) owner to postgres;
alter function public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.list_due_vulnerability_finding_review_notification_orgs(integer) owner to postgres;
alter function public.claim_vulnerability_finding_review_notification(uuid,text,integer) owner to postgres;
alter function public.get_vulnerability_finding_review_notification_details(uuid,uuid) owner to postgres;
alter function public.complete_vulnerability_finding_review_notification(uuid,uuid,text,boolean,text,text) owner to postgres;
revoke all on function public.m4_07_reachability_result_json(uuid),public.mark_vulnerability_reachability_stale_for_finding(uuid,uuid,text),public.m4_07_mark_reachability_stale_after_occurrence_change(),public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb),public.record_vulnerability_finding_advisory_review_atomic(uuid,uuid,uuid,uuid,text,jsonb,jsonb),public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean),public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid),public.list_due_vulnerability_finding_review_notification_organizations(integer),public.claim_vulnerability_finding_review_notification(uuid,text,integer),public.get_vulnerability_finding_review_notification_details(uuid,uuid),public.complete_vulnerability_finding_review_notification(uuid,uuid,text,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.mark_vulnerability_reachability_stale_for_finding(uuid,uuid,text),public.record_vulnerability_reachability_result_atomic(uuid,uuid,uuid,jsonb),public.record_vulnerability_finding_advisory_review_atomic(uuid,uuid,uuid,uuid,text,jsonb,jsonb),public.get_vulnerability_finding_reachability_evidence(uuid,uuid,uuid,uuid,boolean),public.get_vulnerability_finding_advisory_review(uuid,uuid,uuid,uuid),public.list_due_vulnerability_finding_review_notification_organizations(integer),public.claim_vulnerability_finding_review_notification(uuid,text,integer),public.get_vulnerability_finding_review_notification_details(uuid,uuid),public.complete_vulnerability_finding_review_notification(uuid,uuid,text,boolean,text,text) to service_role;
reset check_function_bodies;
*/

create or replace function public.list_due_vulnerability_finding_review_notification_orgs(p_limit integer default 1000) returns table(organization_id uuid) language plpgsql security definer set search_path = public, pg_temp as $$ begin if p_limit not between 1 and 1000 then return; end if; return query select distinct e.organization_id from public.vulnerability_finding_review_events e where e.review_state='open' and e.notification_due_at<=clock_timestamp() and (e.notification_status in ('queued','retrying') or (e.notification_status='leased' and e.notification_lease_expires_at<=clock_timestamp())) order by e.organization_id limit p_limit; end; $$;
create or replace function public.get_vulnerability_finding_review_notification_details(p_organization_id uuid,p_event_id uuid) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$ begin if p_organization_id is null or p_event_id is null then return query select 'not_found',null::jsonb; return; end if; return query select 'found',jsonb_build_object('recipient',jsonb_build_object('userId',u.id,'email',u.email),'review',jsonb_build_object('advisoryId',s.source_record_key,'transition',replace(e.transition_kind,'advisory_',''),'reviewState',case when e.review_state='open' then 'review_required' else 'no_review_required' end)) from public.vulnerability_finding_review_events e join public.vulnerability_source_records s on s.id=e.source_record_id join public.organization_members m on m.organization_id=e.organization_id and m.role in ('owner','admin') join public.users u on u.id=m.user_id and u.is_active where e.organization_id=p_organization_id and e.id=p_event_id order by case m.role when 'owner' then 0 else 1 end,u.id limit 1; if not found then return query select 'not_found',null::jsonb; end if; end; $$;
alter function public.list_due_vulnerability_finding_review_notification_orgs(integer) owner to postgres;
alter function public.get_vulnerability_finding_review_notification_details(uuid,uuid) owner to postgres;
revoke all on function public.list_due_vulnerability_finding_review_notification_orgs(integer), public.get_vulnerability_finding_review_notification_details(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_due_vulnerability_finding_review_notification_orgs(integer), public.get_vulnerability_finding_review_notification_details(uuid,uuid) to service_role;
