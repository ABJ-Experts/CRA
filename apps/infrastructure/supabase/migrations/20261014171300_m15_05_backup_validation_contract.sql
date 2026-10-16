-- Forward-compatible refresh of the complete final M15-05 workflow, including native validation, cleanup, scoped certificates and feed-only alerts.
-- Kept in sync with the canonical initial migration; applying the files in order must not regress lifecycle behavior.
alter table public.backup_policies add column if not exists is_approved boolean not null default true;
alter table public.backup_policies add column if not exists validation_candidate jsonb;
alter table public.backup_policies add column if not exists validation_candidate_digest text;
alter table public.backup_policies add column if not exists validated_candidate_digest text;
alter table public.backup_policies add column if not exists candidate_validated_at timestamptz;
alter table public.backup_policies add column if not exists candidate_failure_code text;
alter table public.backup_policies add column if not exists candidate_failed_at timestamptz;
alter table public.backup_policies add column if not exists mutation_receipts jsonb not null default '{}' check(pg_column_size(mutation_receipts)<=1048576);
alter table public.backup_policies add column if not exists alert_state jsonb not null default '{"active":{},"events":[]}' check(jsonb_typeof(alert_state)='object' and pg_column_size(alert_state)<=1048576);
alter table public.backup_runs add column if not exists cancellation_key uuid;
alter table public.backup_runs add column if not exists cleanup_actor text;
alter table public.backup_runs add column if not exists cleanup_attempts integer not null default 0 check(cleanup_attempts between 0 and 3);
alter role cra_backup_control set statement_timeout='35s';
-- Metadata reads append durable audit; bound them before execution so a write pause cannot exhaust the shared HTTP pool.
alter role cra_operator_registry_reader set statement_timeout='500ms';
drop index if exists public.m15_05_parent;
create index if not exists m15_05_parent_full on public.backup_runs(instance_id,parent_capture_id,parent_kind) where parent_capture_id is not null;

create or replace function public.m15_05_policy_json(p public.backup_policies) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('instanceId',p.instance_id,'version',p.version,'configurationRevision',p.configuration_revision,'configuration',p.configuration,'approvedAt',public.m7_snapshot_timestamp_utc(p.approved_at),'approvedBy',p.approved_by,'lastValidatedAt',public.m7_snapshot_timestamp_utc(p.last_validated_at))
$$;
create or replace function public.m15_05_run_json(r public.backup_runs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',r.id,'instanceId',r.instance_id,'kind',r.kind,'parentRunId',r.parent_capture_id,'state',r.state,'stage',r.stage,'progress',r.progress,'version',r.version,'attempt',r.attempts,'configurationRevision',r.configuration_revision,'createdAt',public.m7_snapshot_timestamp_utc(r.created_at),'startedAt',public.m7_snapshot_timestamp_utc(r.started_at),'completedAt',public.m7_snapshot_timestamp_utc(r.completed_at),'durationMs',case when r.completed_at is not null and r.started_at is not null then greatest(0,floor(extract(epoch from r.completed_at-r.started_at)*1000)) end,'failureCode',r.failure_code,'certificate',r.certificate,'verification',r.verification,'cleanup',jsonb_build_object('state',r.cleanup_state,'deletedAt',public.m7_snapshot_timestamp_utc(r.deleted_at)))
$$;
create or replace function public.m15_05_configuration_valid(c jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text;begin
 if c is null or jsonb_typeof(c)<>'object' or (select count(*) from jsonb_object_keys(c))<>12 or not c ?& array['sourceAlias','repositoryAlias','stagingAlias','keyAlias','targetProfile','residency','schedulingEnabled','checkpointIntervalMinutes','baseIntervalHours','verificationIntervalDays','retentionDays','pauseLimitSeconds'] then return false;end if;
 foreach k in array array['sourceAlias','repositoryAlias','stagingAlias','keyAlias','targetProfile'] loop if jsonb_typeof(c->k)<>'string' or c->>k !~ '^[a-z][a-z0-9_-]{0,79}$' then return false;end if;end loop;
 if jsonb_typeof(c->'residency')<>'string' or c->>'residency' !~ '^[a-z][a-z0-9_-]{0,79}$' or jsonb_typeof(c->'schedulingEnabled')<>'boolean' then return false;end if;
 foreach k in array array['checkpointIntervalMinutes','baseIntervalHours','verificationIntervalDays','retentionDays','pauseLimitSeconds'] loop if jsonb_typeof(c->k)<>'number' or c->>k !~ '^[0-9]{1,5}$' then return false;end if;end loop;
 return (c->>'checkpointIntervalMinutes')::integer between 1 and 30 and (c->>'baseIntervalHours')::integer between 1 and 24 and (c->>'verificationIntervalDays')::integer between 1 and 30 and (c->>'retentionDays')::integer between 30 and 36500 and (c->>'pauseLimitSeconds')::integer between 1 and 120;
end $$;
create or replace function public.m15_05_audit_receipt_json(p_entity_id text,p_action text,p_value jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;bound_digest text;begin
 if p_action not in ('backup.configured','backup.validated','backup.validation_requested','backup.validation_failed','backup.requested','backup.started','backup.failed','backup.cancelled','backup.pause_started','backup.certified','backup.verified','backup.cleanup_authorized','backup.cleanup_completed','backup.cleanup_requested','backup.cleanup_started','backup.cleanup_blocked','backup.retry_requested','backup.alert_raised','backup.alert_resolved') or p_entity_id!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_backup_receipt' using errcode='22023';end if;
 if p_action in ('backup.configured','backup.validated','backup.validation_requested','backup.validation_failed','backup.alert_raised','backup.alert_resolved') then select case when p_action in ('backup.validation_requested','backup.validated','backup.validation_failed') then coalesce(validated_candidate_digest,validation_candidate_digest,configuration_digest) else configuration_digest end into bound_digest from public.backup_policies where instance_id=p_entity_id::uuid;
 else select coalesce(certificate->>'manifestSha256',configuration_digest) into bound_digest from public.backup_runs where id=p_entity_id::uuid;end if;
 if bound_digest is null or bound_digest!~'^[a-f0-9]{64}$' then raise exception 'invalid_backup_receipt_binding' using errcode='22023';end if;
 result:=public.m13_01_project_v2_audit_json(p_value)-'sha256';
 return result||jsonb_build_object('sha256',bound_digest);
end $$;

create or replace function public.m15_05_audit(p_instance_id uuid,p_actor text,p_action text,p_request_id uuid,p_version integer,p_run_id uuid default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare receipt record; actor_kind text;begin
 actor_kind:=case when p_actor~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then 'operator' else 'system' end;
 select * into receipt from public.m13_01_append_audit_event(null,'security','backup.'||p_action||':'||p_request_id::text,actor_kind,p_actor,'backup.'||p_action,'backup',coalesce(p_run_id,p_instance_id)::text,case when p_action='failed' then 'failed' when p_action='cancelled' then 'cancelled' else 'completed' end,p_request_id,null,jsonb_build_object('requestId',p_request_id,'version',p_version,'reasonCode',p_action),null,null,null,null);
 if receipt.outcome is null or receipt.outcome not in ('inserted','replayed') then raise exception 'backup_audit_unavailable' using errcode='40001';end if;
end $$;

create or replace function public.m15_05_cleanup_review(r public.backup_runs) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare blockers jsonb:=jsonb_build_array();g uuid;protection jsonb:=jsonb_build_array();facts jsonb;required_days integer;fingerprint text;begin
 if r.state not in ('certified','verified','failed','incomplete','cancelled') or r.cleanup_state='deleted' then blockers:=blockers||'["run_active"]';end if;
 select (configuration->>'retentionDays')::integer into required_days from public.backup_policies where instance_id=r.instance_id;
 if r.completed_at is null or r.completed_at>clock_timestamp()-make_interval(days=>coalesce(required_days,36500)) then blockers:=blockers||'["retention_active"]';end if;
 if cardinality(r.covered_organization_ids)=0 then blockers:=blockers||'["authority_unknown"]';end if;
 for g in select distinct covered_id from unnest(r.covered_organization_ids) covered_id order by covered_id loop
  perform public.m15_01_lock(g);
  if exists(select 1 from (values('product'),('evidence_class'),('obligation'),('legal_hold')) k(kind) where not exists(select 1 from public.retention_authority_states s where s.organization_id=g and s.authority_kind=k.kind and s.available and s.last_reconciled_at is not null)) then blockers:=blockers||'["authority_unknown"]';end if;
  if exists(select 1 from public.evidence_document_legal_holds where organization_id=g and released_at is null) or exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=g and active and authority_kind='legal_hold') or exists(select 1 from public.retention_authoritative_facts where organization_id=g and active and (reason_kind='legal_hold' or protect_through>clock_timestamp())) then blockers:=blockers||'["legal_hold"]';end if;
  if not exists(select 1 from public.organization_retention_policies where organization_id=g) or exists(select 1 from public.retention_evidence_classes c where c.enabled and not exists(select 1 from public.organization_retention_policies q where q.organization_id=g and q.evidence_class=c.identifier)) then blockers:=blockers||'["authority_unknown"]';end if;
  if exists(select 1 from public.organization_retention_policies where organization_id=g and coalesce(r.completed_at,r.created_at)>clock_timestamp()-make_interval(days=>effective_retention_days)) then blockers:=blockers||'["retention_active"]';end if;
  if exists(select 1 from public.organization_export_jobs where organization_id=g and status in ('queued','running')) then blockers:=blockers||'["run_active"]';end if;
  protection:=protection||jsonb_build_array(jsonb_build_object('organization',g,'states',(select jsonb_agg(to_jsonb(s) order by authority_kind) from public.retention_authority_states s where organization_id=g),'policies',(select jsonb_agg(to_jsonb(s) order by evidence_class) from public.organization_retention_policies s where organization_id=g),'facts',(select jsonb_agg(to_jsonb(s) order by source_record_id) from public.retention_authoritative_facts s where organization_id=g and active)));
 end loop;
 if r.kind='capture' then
  if (select count(distinct c.certificate->>'baseRunId') from public.backup_runs c where c.instance_id=r.instance_id and c.kind='capture' and c.state='certified' and c.cleanup_state<>'deleted' and c.id<>r.id and exists(select 1 from public.backup_runs v where v.instance_id=c.instance_id and v.parent_capture_id=c.id and v.state='verified' and v.cleanup_state<>'deleted'))<2 then blockers:=blockers||'["last_recoverable_chain"]';end if;
  if exists(select 1 from public.backup_runs c where c.instance_id=r.instance_id and c.id<>r.id and c.cleanup_state<>'deleted' and (c.certificate->>'baseRunId'=r.id::text or c.parent_capture_id=r.id)) then blockers:=blockers||'["required_dependency"]';end if;
 end if;
 select coalesce(jsonb_agg(distinct b),'[]') into blockers from jsonb_array_elements(blockers) b;
 facts:=jsonb_build_object('instance',r.instance_id,'id',r.id,'certificate',r.certificate,'policyDays',required_days,'protections',protection,'blockers',blockers,'dependencies',(select jsonb_agg(jsonb_build_array(id,case when cleanup_state='deleted' then 'deleted' else 'retained' end,certificate->>'baseRunId') order by id) from public.backup_runs where instance_id=r.instance_id and cleanup_state<>'deleted'));
 fingerprint:=encode(extensions.digest(public.m15_03_canonical_json(facts),'sha256'),'hex');
 return jsonb_build_object('runId',r.id,'version',r.version,'eligible',jsonb_array_length(blockers)=0,'blockers',blockers,'reviewFingerprint',fingerprint,'reviewedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()));
end $$;

create or replace function public.m15_05_certificate_valid(c jsonb,r public.backup_runs) returns boolean language plpgsql volatile set search_path=pg_catalog,public as $$
declare k text;fields text[]:=array['version','checkpointId','certifiedAt','recoveryPointAt','manifestSha256','repositoryGeneration','keyId','baseRunId','timeline','checkpointLsn','sourceSystemIdentifier','databaseBytes','objectBytes','objectCount','walBytes','postgresqlVersion','integrity'];begin
 if c is null or jsonb_typeof(c)<>'object' or not c ?& fields or (select count(*) from jsonb_object_keys(c))<>cardinality(fields) or c->>'version' is distinct from '1' or c->>'checkpointId' is distinct from r.id::text or c->>'keyId' is distinct from r.configuration->>'keyAlias' or c->>'postgresqlVersion' is distinct from '17.6' or c->>'integrity' is distinct from 'passed' then return false;end if;
 foreach k in array array['checkpointId','certifiedAt','recoveryPointAt','manifestSha256','repositoryGeneration','keyId','baseRunId','checkpointLsn','sourceSystemIdentifier','postgresqlVersion','integrity'] loop if jsonb_typeof(c->k) is distinct from 'string' then return false;end if;end loop;
 if jsonb_typeof(c->'version') is distinct from 'number' then return false;end if;
 if c->>'manifestSha256'!~'^[a-f0-9]{64}$' or c->>'checkpointLsn'!~'^[0-9A-F]{1,8}/[0-9A-F]{1,8}$' or c->>'sourceSystemIdentifier'!~'^[0-9]{1,20}$' or c->>'repositoryGeneration'!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or c->>'baseRunId'!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return false;end if;
 foreach k in array array['databaseBytes','objectBytes','objectCount','walBytes','timeline'] loop if jsonb_typeof(c->k)<>'number' or c->>k!~'^[0-9]{1,16}$' or (c->>k)::numeric>9007199254740991 then return false;end if;end loop;
 if (c->>'timeline')::numeric<1 or c->>'certifiedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or c->>'recoveryPointAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then return false;end if;
 return (c->>'certifiedAt')::timestamptz<=clock_timestamp()+interval '5 seconds' and (c->>'recoveryPointAt')::timestamptz<=(c->>'certifiedAt')::timestamptz and (c->>'recoveryPointAt')::timestamptz>=r.started_at;
 exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create or replace function public.m15_05_verification_valid(v jsonb,p_profile text) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare required text[]:=array['ciphertext_authentication','manifest_integrity','schema_migrations','extensions','ownership_acl_rls','sequences','object_integrity','audit_continuity','external_keys','credential_quarantine','session_revocation','dataset_markers','authentication','tenant_isolation','product_isolation','private_evidence_access','egress_denied','runtime_compatibility'];begin
 if v is null or v->>'integrity' is distinct from 'passed' or v->>'targetProfile' is distinct from p_profile or jsonb_typeof(v->'checks') is distinct from 'array' then return false;end if;
 return jsonb_array_length(v->'checks')=18 and not exists(select 1 from jsonb_array_elements(v->'checks') c where c->>'code'<>all(required) or c->>'status' is distinct from 'passed' or c->'failureCode' is distinct from 'null'::jsonb) and (select count(distinct c->>'code') from jsonb_array_elements(v->'checks') c)=18;
end $$;

create or replace function public.m15_05_reconcile_alerts(p_instance_id uuid,p_actor text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.backup_policies;c public.backup_runs;v public.backup_runs;code text;overdue boolean;event_id uuid;event_at timestamptz:=clock_timestamp();alert_data jsonb;scope uuid[];begin
 select * into p from public.backup_policies where instance_id=p_instance_id and is_approved for update;
 if not found then return;end if;
 select * into c from public.backup_runs where instance_id=p_instance_id and kind='capture' and state='certified' and cleanup_state<>'deleted' order by completed_at desc,id desc limit 1;
 select * into v from public.backup_runs where instance_id=p_instance_id and kind='verification' and state='verified' and cleanup_state<>'deleted' order by completed_at desc,id desc limit 1;
 alert_data:=p.alert_state;
 scope:=case when c.id is not null then c.covered_organization_ids else array(select id from public.organizations order by id) end;
 foreach code in array array['capture_overdue','verification_overdue'] loop
  overdue:=case when code='capture_overdue' then coalesce((c.certificate->>'recoveryPointAt')::timestamptz,p.approved_at)<event_at-interval '1 hour'
    else c.id is not null and coalesce(v.completed_at,(select min(completed_at) from public.backup_runs where instance_id=p_instance_id and kind='capture' and state='certified'))<event_at-make_interval(days=>(p.configuration->>'verificationIntervalDays')::integer) end;
  if overdue and alert_data->'active'->>code is null then
   if jsonb_array_length(alert_data->'events')>=1000 then raise exception 'backup_alert_capacity' using errcode='54000';end if;
   event_id:=gen_random_uuid();
   alert_data:=jsonb_set(alert_data,array['active',code],to_jsonb(event_id::text),true);
   alert_data:=jsonb_set(alert_data,'{events}',alert_data->'events'||jsonb_build_array(jsonb_build_object('id',event_id,'code',code,'at',public.m7_snapshot_timestamp_utc(event_at),'coveredOrganizationIds',to_jsonb(scope))));
   update public.backup_policies set alert_state=alert_data where instance_id=p_instance_id;
   perform public.m15_05_audit(p_instance_id,p_actor,'alert_raised',event_id,p.version);
  elsif not overdue and alert_data->'active'->>code is not null then
   alert_data:=alert_data#-array['active',code];
   update public.backup_policies set alert_state=alert_data where instance_id=p_instance_id;
   perform public.m15_05_audit(p_instance_id,p_actor,'alert_resolved',gen_random_uuid(),p.version);
  end if;
 end loop;
end $$;

create or replace function public.m15_05_backup_control(p_instance_id uuid,p_actor text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='5s' as $$
declare p public.backup_policies;r public.backup_runs;parent public.backup_runs;request_id uuid;payload_digest text;rows jsonb;review jsonb;run_id uuid;lim integer;new_configuration jsonb;begin
 if p_instance_id is null or p_actor is null or p_actor!~'^[a-z0-9][a-z0-9:_/-]{0,199}$' or p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>65536 or p_action is null or p_action not in ('policy/read','policy/validate','policy/validation-read','policy/validated','policy/validation-failed','policy/update','run/create','run/list','run/read','run/reconcile','run/cancel','run/claim','run/heartbeat','run/complete','run/fail','run/retry','run/pause','cleanup/review','cleanup/request','cleanup/claim','cleanup/authorize','cleanup/finish','schedule/enqueue','alerts/reconcile') then raise exception 'invalid_backup_operation' using errcode='22023';end if;
 if p_action in ('alerts/reconcile','schedule/enqueue','policy/validated','policy/validation-failed','policy/validate','policy/update','run/create','run/claim','cleanup/request','cleanup/claim','cleanup/authorize','cleanup/finish','run/reconcile') and exists(select 1 from public.backup_runs q where q.instance_id=p_instance_id and q.kind='capture' and q.state='running' and q.pause_started_at<=clock_timestamp() and q.pause_deadline_at>clock_timestamp()) then
  return case when p_action in ('run/claim','cleanup/claim','schedule/enqueue') then jsonb_build_object('outcome','empty') when p_action in ('alerts/reconcile','policy/validated','policy/validation-failed') then jsonb_build_object('outcome','ok','result',null) when p_action='run/reconcile' then jsonb_build_object('outcome','ok','result',jsonb_build_object('eligible',false)) else jsonb_build_object('outcome','conflict') end;
 end if;
 if p_action not in ('policy/read','policy/validation-read','run/read','run/list','run/heartbeat','run/cancel') then
  perform pg_advisory_xact_lock(hashtextextended('m15_05:'||p_instance_id::text,0));
  select * into p from public.backup_policies where instance_id=p_instance_id for update;
 else select * into p from public.backup_policies where instance_id=p_instance_id;end if;
 if p_action in ('alerts/reconcile','schedule/enqueue','policy/validated','policy/validation-failed','policy/validate','policy/update','run/create','run/claim','cleanup/request','cleanup/claim','cleanup/authorize','cleanup/finish','run/reconcile') and exists(select 1 from public.backup_runs q where q.instance_id=p_instance_id and q.kind='capture' and q.state='running' and q.pause_started_at<=clock_timestamp() and q.pause_deadline_at>clock_timestamp()) then
  return case when p_action in ('run/claim','cleanup/claim','schedule/enqueue') then jsonb_build_object('outcome','empty') when p_action in ('alerts/reconcile','policy/validated','policy/validation-failed') then jsonb_build_object('outcome','ok','result',null) when p_action='run/reconcile' then jsonb_build_object('outcome','ok','result',jsonb_build_object('eligible',false)) else jsonb_build_object('outcome','conflict') end;
 end if;

 if p_action='alerts/reconcile' then
  if p.instance_id is null or not p.is_approved then return jsonb_build_object('outcome','ok','result',null);end if;
  perform public.m15_05_reconcile_alerts(p_instance_id,p_actor);
  return jsonb_build_object('outcome','ok','result',null);
 end if;
 if p_action='policy/read' then return jsonb_build_object('outcome','ok','result',case when p.instance_id is not null and p.is_approved then public.m15_05_policy_json(p) end);end if;
 if p_action='policy/validate' then
  payload_digest:=encode(extensions.digest(public.m15_03_canonical_json(coalesce(p_input->'configuration','{}'::jsonb)),'sha256'),'hex');
  if not public.m15_05_configuration_valid(p_input->'configuration') then
   return jsonb_build_object('outcome','ok','result',jsonb_build_object('valid',false,'checkedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'configurationDigest',payload_digest,'checks',jsonb_build_array(jsonb_build_object('code','configuration_invalid','status','failed'))));
  end if;
  if p.instance_id is null then
   insert into public.backup_policies(instance_id,is_approved,configuration,configuration_digest,approved_by,mutation_key,mutation_digest,validation_candidate,validation_candidate_digest)
   values(p_instance_id,false,p_input->'configuration',payload_digest,p_actor,gen_random_uuid(),payload_digest,p_input->'configuration',payload_digest) returning * into p;
   perform public.m15_05_audit(p_instance_id,p_actor,'validation_requested',gen_random_uuid(),p.version);
  elsif p.validation_candidate_digest is distinct from payload_digest then
   update public.backup_policies set validation_candidate=p_input->'configuration',validation_candidate_digest=payload_digest,validated_candidate_digest=null,candidate_validated_at=null,candidate_failure_code=null,candidate_failed_at=null where instance_id=p_instance_id returning * into p;
   perform public.m15_05_audit(p_instance_id,p_actor,'validation_requested',gen_random_uuid(),p.version);
  end if;
  return jsonb_build_object('outcome','ok','result',jsonb_build_object('valid',coalesce(p.validated_candidate_digest=payload_digest and p.candidate_validated_at>clock_timestamp()-interval '5 minutes',false),'checkedAt',public.m7_snapshot_timestamp_utc(coalesce(p.candidate_failed_at,p.candidate_validated_at,clock_timestamp())),'configurationDigest',payload_digest,'checks',jsonb_build_array(jsonb_build_object('code',coalesce(p.candidate_failure_code,'runtime_compatibility'),'status',case when p.candidate_failure_code is not null then 'failed' when p.validated_candidate_digest=payload_digest and p.candidate_validated_at>clock_timestamp()-interval '5 minutes' then 'passed' else 'unavailable' end))));
 end if;
 if p_action='policy/validation-read' then
  return jsonb_build_object('outcome','ok','result',case when p.validation_candidate is not null then jsonb_build_object('configuration',p.validation_candidate,'configurationRevision',case when p.is_approved then p.configuration_revision+1 else p.configuration_revision end,'configurationDigest',p.validation_candidate_digest) end);
 end if;
 if p_action='policy/validation-failed' then
  if p.instance_id is null then return jsonb_build_object('outcome','not_found');end if;
  if p_input->>'configurationDigest' is distinct from p.validation_candidate_digest then return jsonb_build_object('outcome','conflict');end if;
  if p_input->>'failureCode' is null or p_input->>'failureCode' not in ('authorization_changed','configuration_changed','configuration_invalid','source_unavailable','source_identity_changed','incompatible_runtime','key_unavailable','historical_key_unavailable','repository_unavailable','repository_full','repository_discontinuity','staging_unsafe','insufficient_capacity','wal_gap','wal_receiver_failed','base_backup_failed','base_integrity_failed','object_missing','object_corrupt','partial_publication','fence_expired','write_drain_timeout','cancelled','lease_lost','interrupted','ciphertext_invalid','manifest_invalid','archive_unsafe','target_unsafe','target_unavailable','restore_failed','schema_mismatch','audit_discontinuity','credentials_not_quarantined','egress_not_blocked','probe_failed','audit_unavailable','retention_authority_unavailable','cleanup_failed','internal_failure') then return jsonb_build_object('outcome','invalid');end if;
  if p.candidate_failure_code=p_input->>'failureCode' then return jsonb_build_object('outcome','ok','result',null);end if;
  update public.backup_policies set candidate_failure_code=p_input->>'failureCode',candidate_failed_at=clock_timestamp(),validated_candidate_digest=null,candidate_validated_at=null where instance_id=p_instance_id returning * into p;
  perform public.m15_05_audit(p_instance_id,p_actor,'validation_failed',gen_random_uuid(),p.version);
  return jsonb_build_object('outcome','ok','result',null);
 end if;
 if p_action='policy/validated' then
  if p.instance_id is null then return jsonb_build_object('outcome','not_found');end if;
  if p_input->>'configurationDigest'=p.validation_candidate_digest then
   update public.backup_policies set validated_candidate_digest=p.validation_candidate_digest,candidate_validated_at=clock_timestamp(),candidate_failure_code=null,candidate_failed_at=null where instance_id=p_instance_id returning * into p;
  elsif p.is_approved and p_input->>'configurationDigest'=p.configuration_digest then
   update public.backup_policies set last_validated_at=clock_timestamp(),validation_digest=configuration_digest where instance_id=p_instance_id returning * into p;
  else return jsonb_build_object('outcome','conflict');end if;
  perform public.m15_05_audit(p_instance_id,p_actor,'validated',gen_random_uuid(),p.version);
  return jsonb_build_object('outcome','ok','result',case when p.is_approved then public.m15_05_policy_json(p) end);
 end if;
 if p_action='policy/update' then
  new_configuration:=p_input->'configuration';request_id:=(p_input->>'idempotencyKey')::uuid;
  if request_id is null or not public.m15_05_configuration_valid(new_configuration) then return jsonb_build_object('outcome','invalid');end if;
  payload_digest:=encode(extensions.digest(public.m15_03_canonical_json(new_configuration),'sha256'),'hex');
  if p.mutation_receipts ? request_id::text then
   if p.mutation_receipts->request_id::text->>'digest'<>payload_digest then return jsonb_build_object('outcome','conflict');end if;
   return jsonb_build_object('outcome','ok','result',p.mutation_receipts->request_id::text->'result');
  end if;
  if (case when p.is_approved then p.version else 0 end) is distinct from (p_input->>'expectedVersion')::integer then return jsonb_build_object('outcome','conflict');end if;
  if p.validated_candidate_digest is distinct from payload_digest or p.candidate_validated_at is null or p.candidate_validated_at<=clock_timestamp()-interval '5 minutes' then return jsonb_build_object('outcome','blocked');end if;
  if (new_configuration->>'schedulingEnabled')::boolean and (p.last_validated_at is null or p.validation_digest is distinct from p.configuration_digest or (p.configuration-'schedulingEnabled') is distinct from (new_configuration-'schedulingEnabled') or not exists(select 1 from public.backup_runs v join public.backup_runs c on c.instance_id=v.instance_id and c.id=v.parent_capture_id where v.instance_id=p_instance_id and v.state='verified' and (c.configuration-'schedulingEnabled')=(new_configuration-'schedulingEnabled') and v.completed_at>clock_timestamp()-interval '30 days')) then return jsonb_build_object('outcome','blocked');end if;
  if p.instance_id is null then
   insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest) values(p_instance_id,new_configuration,payload_digest,p_actor,request_id,payload_digest) returning * into p;
  else
   update public.backup_policies set is_approved=true,version=case when is_approved then version+1 else 1 end,configuration_revision=case when is_approved then configuration_revision+1 else 1 end,configuration=new_configuration,configuration_digest=payload_digest,approved_at=clock_timestamp(),approved_by=p_actor,mutation_key=request_id,mutation_digest=payload_digest,last_validated_at=candidate_validated_at,validation_digest=payload_digest,validation_candidate=null,validation_candidate_digest=null,validated_candidate_digest=null,candidate_validated_at=null,candidate_failure_code=null,candidate_failed_at=null where instance_id=p_instance_id returning * into p;
  end if;
  update public.backup_policies set mutation_receipts=mutation_receipts||jsonb_build_object(request_id::text,jsonb_build_object('digest',payload_digest,'result',public.m15_05_policy_json(p))) where instance_id=p_instance_id returning * into p;
  perform public.m15_05_audit(p_instance_id,p_actor,'configured',request_id,p.version);
  return jsonb_build_object('outcome','ok','result',public.m15_05_policy_json(p));
 end if;
 if p_action='run/list' and (p.instance_id is null or not p.is_approved) then return jsonb_build_object('outcome','ok','result',jsonb_build_object('items','[]'::jsonb,'nextCursor',null));end if;
 if p_action='run/reconcile' and (p.instance_id is null or not p.is_approved) then return jsonb_build_object('outcome','ok','result',jsonb_build_object('eligible',false));end if;
 if p.instance_id is null or not p.is_approved then return jsonb_build_object('outcome','not_found');end if;
 if p_action='run/list' then
  lim:=least(100,greatest(1,coalesce((p_input->>'limit')::integer,25)));
  select coalesce(jsonb_agg(public.m15_05_run_json(x) order by x.created_at desc,x.id desc),'[]') into rows from (select q.* from public.backup_runs q where q.instance_id=p_instance_id and (p_input->'certifiedOnly' is distinct from 'true'::jsonb or (q.kind='capture' and q.state='certified' and q.cleanup_state<>'deleted')) and (p_input->>'kind' is null or q.kind=p_input->>'kind') and (p_input->>'cursor' is null or (q.created_at,q.id)<(select c.created_at,c.id from public.backup_runs c where c.instance_id=p_instance_id and c.id=(p_input->>'cursor')::uuid)) order by q.created_at desc,q.id desc limit lim) x;
  return jsonb_build_object('outcome','ok','result',jsonb_build_object('items',rows,'nextCursor',case when jsonb_array_length(rows)=lim then rows->(lim-1)->>'id' end));
 end if;
 if p_action in ('run/create','schedule/enqueue') then
  request_id:=(p_input->>'idempotencyKey')::uuid;
  if request_id is null then return jsonb_build_object('outcome','invalid');end if;
  payload_digest:=encode(extensions.digest(public.m15_03_canonical_json(p_input-'expectedVersion'),'sha256'),'hex');
  select * into r from public.backup_runs where instance_id=p_instance_id and idempotency_key=request_id;
  if found then if r.request_digest<>payload_digest then return jsonb_build_object('outcome','conflict');end if;return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r));end if;
  if (coalesce(p_input->>'kind','capture')='capture' and p.version is distinct from (p_input->>'expectedVersion')::integer) or (p_action='schedule/enqueue' and not (p.configuration->>'schedulingEnabled')::boolean) then return jsonb_build_object('outcome','conflict');end if;
  if coalesce(p_input->>'kind','capture') not in ('capture','verification') then return jsonb_build_object('outcome','invalid');end if;
  if p_input->>'kind'='verification' then
   select * into parent from public.backup_runs where instance_id=p_instance_id and id=(p_input->>'parentRunId')::uuid and kind='capture' and state='certified' and cleanup_state='retained' for update;
   if not found then return jsonb_build_object('outcome','not_found');end if;
   if parent.version is distinct from (p_input->>'expectedVersion')::integer or p_input->>'targetProfile' is distinct from p.configuration->>'targetProfile' then return jsonb_build_object('outcome','conflict');end if;
  end if;
  if exists(select 1 from public.backup_runs where instance_id=p_instance_id and kind=coalesce(p_input->>'kind','capture') and state in ('queued','running')) then return jsonb_build_object('outcome','conflict');end if;
  insert into public.backup_runs(instance_id,kind,parent_capture_id,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,occurrence_key,actor_id,covered_organization_ids)
  values(p_instance_id,coalesce(p_input->>'kind','capture'),parent.id,case when parent.id is null then p.configuration_revision else parent.configuration_revision end,case when parent.id is null then p.configuration else parent.configuration||jsonb_build_object('targetProfile',p_input->>'targetProfile') end,case when parent.id is null then p.configuration_digest else encode(extensions.digest(public.m15_03_canonical_json(parent.configuration||jsonb_build_object('targetProfile',p_input->>'targetProfile')),'sha256'),'hex') end,request_id,payload_digest,p_input->>'occurrenceKey',p_actor,case when parent.id is null then array(select id from public.organizations order by id) else parent.covered_organization_ids end) returning * into r;
  perform public.m15_05_audit(p_instance_id,p_actor,'requested',request_id,r.version,r.id);
  return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r));
 end if;
 if p_action='cleanup/claim' then
  if p_input->>'workerId' is null or p_input->>'workerId'!~'^[a-z0-9][a-z0-9_-]{0,79}$' then return jsonb_build_object('outcome','invalid');end if;
  select * into r from public.backup_runs where instance_id=p_instance_id and cleanup_state='reviewed' and (cleanup_lease_owner is null or cleanup_lease_expires_at<=clock_timestamp()) order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('outcome','empty');end if;
  review:=public.m15_05_cleanup_review(r);
  if r.cleanup_attempts>=3 or not (review->>'eligible')::boolean or r.cleanup_review_fingerprint is distinct from review->>'reviewFingerprint' then
   update public.backup_runs set cleanup_state='retained',cleanup_lease_owner=null,cleanup_lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'cleanup_blocked',gen_random_uuid(),r.version,r.id);
   return jsonb_build_object('outcome','empty');
  end if;
  update public.backup_runs set cleanup_lease_owner=p_input->>'workerId',cleanup_lease_expires_at=clock_timestamp()+interval '60 seconds',cleanup_attempts=cleanup_attempts+1,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
  perform public.m15_05_audit(p_instance_id,p_actor,'cleanup_started',gen_random_uuid(),r.version,r.id);
  return jsonb_build_object('outcome','ok','result',jsonb_build_object('run',public.m15_05_run_json(r),'execution',jsonb_build_object('configuration',r.configuration,'actor',r.cleanup_actor,'reviewFingerprint',r.cleanup_review_fingerprint,'idempotencyKey',r.cleanup_request_key,'workerId',r.cleanup_lease_owner)));
 end if;
 if p_action='run/claim' then
  if p_input->>'workerId' is null or p_input->>'kind' is null or p_input->>'workerId' !~'^[a-z0-9][a-z0-9_-]{0,79}$' or p_input->>'kind' not in ('capture','verification') then return jsonb_build_object('outcome','invalid');end if;
  -- Stale interrupted cuts are terminal: never reacquire a cut made from mixed states.
  for r in select * from public.backup_runs where instance_id=p_instance_id and kind=p_input->>'kind' and state='running' and lease_expires_at<=clock_timestamp() for update skip locked loop
   update public.backup_runs set state='failed',stage='failed',failure_code='lease_lost',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'failed',gen_random_uuid(),r.version,r.id);
  end loop;
  select * into r from public.backup_runs where instance_id=p_instance_id and kind=p_input->>'kind' and state='queued' order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('outcome','empty');end if;
  update public.backup_runs set state='running',stage='validating',attempts=attempts+1,started_at=clock_timestamp(),covered_organization_ids=case when kind='capture' then array(select id from public.organizations order by id) else covered_organization_ids end,lease_owner=p_input->>'workerId',lease_expires_at=clock_timestamp()+interval '60 seconds',version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
  perform public.m15_05_audit(p_instance_id,p_actor,'started',gen_random_uuid(),r.version,r.id);
  select * into parent from public.backup_runs where instance_id=p_instance_id and id=r.parent_capture_id;
  return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r),'execution',jsonb_build_object('configuration',r.configuration,'parentCertificate',parent.certificate));
 end if;
 run_id:=(p_input->>'runId')::uuid;
 if p_action='run/read' then select * into r from public.backup_runs where instance_id=p_instance_id and id=run_id;
 else select * into r from public.backup_runs where instance_id=p_instance_id and id=run_id for update;end if;
 if not found then if p_action='run/reconcile' then return jsonb_build_object('outcome','ok','result',jsonb_build_object('eligible',false));end if;return jsonb_build_object('outcome','not_found');end if;
 if p_action='run/reconcile' then
  if r.kind<>'verification' then return jsonb_build_object('outcome','ok','result',jsonb_build_object('eligible',false));end if;
  if r.state='running' and r.lease_expires_at<=clock_timestamp() then
   update public.backup_runs set state='failed',stage='failed',failure_code='interrupted',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'failed',gen_random_uuid(),r.version,r.id);
  end if;
  return jsonb_build_object('outcome','ok','result',jsonb_build_object('eligible',r.state in ('verified','failed','cancelled','incomplete')));
 end if;
 if p_action='run/read' then return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r));end if;
 if p_action='cleanup/review' then return jsonb_build_object('outcome','ok','result',public.m15_05_cleanup_review(r));end if;
 if p_action='run/cancel' and r.state='cancelled' and r.cancellation_key=(p_input->>'idempotencyKey')::uuid then return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r));end if;
 if p_action='cleanup/request' and r.cleanup_request_key=(p_input->>'idempotencyKey')::uuid then
  if r.cleanup_review_fingerprint is distinct from p_input->>'reviewFingerprint' then return jsonb_build_object('outcome','conflict');end if;
  return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r));
 end if;
 if r.version is distinct from (p_input->>'expectedVersion')::integer then return jsonb_build_object('outcome','conflict');end if;
 if p_action='run/cancel' then
  request_id:=(p_input->>'idempotencyKey')::uuid;
  if request_id is null or r.state not in ('queued','running') then return jsonb_build_object('outcome','conflict');end if;
  update public.backup_runs set state='cancelled',stage='cancelled',cancellation_key=request_id,completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
  perform public.m15_05_audit(p_instance_id,p_actor,'cancelled',request_id,r.version,r.id);
 elsif p_action in ('cleanup/request','cleanup/authorize','cleanup/finish') then
  review:=public.m15_05_cleanup_review(r);
  if not (review->>'eligible')::boolean or review->>'reviewFingerprint' is distinct from p_input->>'reviewFingerprint' then return jsonb_build_object('outcome','blocked','result',review);end if;
  if p_action='cleanup/request' then
   request_id:=(p_input->>'idempotencyKey')::uuid;
   if request_id is null or r.cleanup_state<>'retained' then return jsonb_build_object('outcome','conflict');end if;
   update public.backup_runs set cleanup_state='reviewed',cleanup_review_fingerprint=p_input->>'reviewFingerprint',cleanup_request_key=request_id,cleanup_actor=p_actor,cleanup_attempts=0,cleanup_lease_owner=null,cleanup_lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'cleanup_requested',request_id,r.version,r.id);
  elsif p_action='cleanup/authorize' then
   if r.cleanup_state<>'reviewed' or r.cleanup_actor is distinct from p_actor or r.cleanup_request_key is distinct from (p_input->>'idempotencyKey')::uuid or r.cleanup_lease_owner is distinct from p_input->>'workerId' or r.cleanup_lease_owner is null or r.cleanup_lease_expires_at<=clock_timestamp() or r.cleanup_review_fingerprint is distinct from p_input->>'reviewFingerprint' then return jsonb_build_object('outcome','conflict');end if;
   perform public.m15_05_audit(p_instance_id,p_actor,'cleanup_authorized',gen_random_uuid(),r.version,r.id);
   return jsonb_build_object('outcome','ok','result',jsonb_build_object('run',public.m15_05_run_json(r),'retainedCaptureRunIds',(select coalesce(jsonb_agg(id order by id),'[]') from public.backup_runs where instance_id=p_instance_id and kind='capture' and state='certified' and cleanup_state<>'deleted' and id<>r.id),'verifiedBaseRunIds',(select coalesce(jsonb_agg(distinct c.certificate->>'baseRunId'),'[]') from public.backup_runs c where c.instance_id=p_instance_id and c.state='certified' and c.kind='capture' and c.cleanup_state<>'deleted' and c.id<>r.id and exists(select 1 from public.backup_runs v where v.instance_id=c.instance_id and v.parent_capture_id=c.id and v.state='verified' and v.cleanup_state<>'deleted'))));
  else
   if r.cleanup_state<>'reviewed' or r.cleanup_actor is distinct from p_actor or r.cleanup_request_key is distinct from (p_input->>'idempotencyKey')::uuid or r.cleanup_review_fingerprint is distinct from p_input->>'reviewFingerprint' or r.cleanup_lease_owner is distinct from p_input->>'workerId' or r.cleanup_lease_expires_at<=clock_timestamp() then return jsonb_build_object('outcome','conflict');end if;
   update public.backup_runs set cleanup_state='deleted',deleted_at=clock_timestamp(),cleanup_lease_owner=null,cleanup_lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'cleanup_completed',gen_random_uuid(),r.version,r.id);
  end if;
 else
  if r.state<>'running' or r.lease_owner is distinct from p_input->>'workerId' or r.lease_expires_at<=clock_timestamp() then return jsonb_build_object('outcome','conflict');end if;
  if r.pause_deadline_at is not null and r.pause_deadline_at<=clock_timestamp() and p_action<>'run/fail' then
   update public.backup_runs set state='failed',stage='failed',failure_code='fence_expired',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'failed',gen_random_uuid(),r.version,r.id);
   return jsonb_build_object('outcome','conflict');
  end if;
  if p_action='run/heartbeat' then
   if coalesce(p_input->>'stage',r.stage)!~'^[a-z][a-z_]{0,63}$' or coalesce((p_input->>'progress')::integer,r.progress) not between r.progress and 99 or pg_column_size(coalesce(p_input->'checkpoint','{}'))>32768 then return jsonb_build_object('outcome','invalid');end if;
   update public.backup_runs set lease_expires_at=clock_timestamp()+interval '60 seconds',stage=coalesce(p_input->>'stage',stage),progress=coalesce((p_input->>'progress')::integer,progress),checkpoint=coalesce(p_input->'checkpoint',checkpoint),version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
  elsif p_action='run/pause' then
   if r.kind<>'capture' or r.pause_started_at is not null then return jsonb_build_object('outcome','conflict');end if;
   update public.backup_runs set pause_started_at=clock_timestamp(),pause_deadline_at=clock_timestamp()+make_interval(secs=>(configuration->>'pauseLimitSeconds')::integer),version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'pause_started',gen_random_uuid(),r.version,r.id);
  elsif p_action='run/retry' then
   if r.pause_started_at is not null or r.attempts>=3 or p_input->>'failureCode' is null or p_input->>'failureCode' not in ('source_unavailable','repository_unavailable','wal_receiver_failed','base_backup_failed','interrupted') then return jsonb_build_object('outcome','conflict');end if;
   update public.backup_runs set state='queued',stage='queued',progress=0,started_at=null,checkpoint='{}',lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'retry_requested',gen_random_uuid(),r.version,r.id);
  elsif p_action='run/fail' then
   if p_input->>'failureCode' is null or p_input->>'failureCode' !~'^[a-z][a-z_]{0,63}$' or (p_input->'verification' is not null and (r.kind<>'verification' or jsonb_typeof(p_input->'verification')<>'object' or pg_column_size(p_input->'verification')>32768 or p_input->'verification'->>'integrity' not in ('failed','incomplete'))) then return jsonb_build_object('outcome','invalid');end if;
   update public.backup_runs set state=case when p_input->>'incomplete'='true' then 'incomplete' else 'failed' end,stage='failed',failure_code=p_input->>'failureCode',verification=coalesce(p_input->'verification',verification),completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   perform public.m15_05_audit(p_instance_id,p_actor,'failed',gen_random_uuid(),r.version,r.id);
  elsif p_action='run/complete' then
   if r.kind='capture' then
    if not coalesce(public.m15_05_certificate_valid(p_input->'certificate',r),false) or r.pause_started_at is null or jsonb_typeof(p_input->'coveredOrganizationIds') is distinct from 'array' or jsonb_array_length(p_input->'coveredOrganizationIds')>100000 then return jsonb_build_object('outcome','invalid');end if;
    update public.backup_runs set state='certified',stage='completed',progress=100,certificate=p_input->'certificate',covered_organization_ids=array(select distinct x::uuid from jsonb_array_elements_text(p_input->'coveredOrganizationIds')x),completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   else
    if not coalesce(public.m15_05_verification_valid(p_input->'verification',r.configuration->>'targetProfile'),false) then return jsonb_build_object('outcome','invalid');end if;
    update public.backup_runs set state='verified',stage='completed',progress=100,verification=p_input->'verification',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,version=version+1 where instance_id=p_instance_id and id=r.id returning * into r;
   end if;
   perform public.m15_05_audit(p_instance_id,p_actor,case when r.kind='capture' then 'certified' else 'verified' end,gen_random_uuid(),r.version,r.id);
  end if;
 end if;
 return jsonb_build_object('outcome','ok','result',public.m15_05_run_json(r));
end $$;

create or replace function public.m15_05_customer_run_json(r public.backup_runs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select case when r.id is null then null else jsonb_build_object('id',r.id,'kind',r.kind,'state',r.state,'createdAt',public.m7_snapshot_timestamp_utc(r.created_at),'completedAt',public.m7_snapshot_timestamp_utc(r.completed_at),'durationMs',case when r.completed_at is not null and r.started_at is not null then greatest(0,floor(extract(epoch from r.completed_at-r.started_at)*1000)) end,'integrity',case when r.state in ('certified','verified') then 'passed' when r.state in ('failed','incomplete') then 'failed' else 'unknown' end,'failureCode',r.failure_code) end
$$;

-- Customer projection is deliberately free of global run IDs, mount aliases and keys.
create or replace function public.m15_05_backup_assurance(p_organization_id uuid,p_actor_user_id uuid,p_limit integer default 25,p_cursor uuid default null,p_kind text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='350ms' as $$
declare attempt public.backup_runs;capture public.backup_runs;verification public.backup_runs;latest_verification public.backup_runs;policy public.backup_policies;summary jsonb;history jsonb;reason_codes text[]:=array[]::text[];current_status text;begin
 if not public.m15_03_health_can(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden');end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('capture','verification')) then raise exception 'invalid_backup_limit' using errcode='22023';end if;
 if (select count(*) from public.backup_policies where is_approved)<>1 then
  return jsonb_build_object('outcome','ok','assurance',jsonb_build_object('status','unavailable','lastAttempt',null,'lastCapture',null,'lastVerification',null,'lastVerifiedRestoreAt',null,'recoverablePointAt',null,'verificationDueAt',null,'residency',null,'sourceAt',null,'observedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'reasons',array['not_configured']),'history',jsonb_build_object('items','[]'::jsonb,'nextCursor',null));
 end if;
 select * into policy from public.backup_policies where is_approved;
 select * into attempt from public.backup_runs where instance_id=policy.instance_id and p_organization_id=any(covered_organization_ids) order by created_at desc,id desc limit 1;
 select * into capture from public.backup_runs where instance_id=policy.instance_id and state='certified' and cleanup_state<>'deleted' and p_organization_id=any(covered_organization_ids) order by completed_at desc,id desc limit 1;
 select v.* into verification from public.backup_runs v join public.backup_runs c on c.instance_id=v.instance_id and c.id=v.parent_capture_id where v.instance_id=policy.instance_id and v.state='verified' and v.cleanup_state<>'deleted' and p_organization_id=any(c.covered_organization_ids) order by v.completed_at desc,v.id desc limit 1;
 select v.* into latest_verification from public.backup_runs v join public.backup_runs c on c.instance_id=v.instance_id and c.id=v.parent_capture_id where v.instance_id=policy.instance_id and p_organization_id=any(c.covered_organization_ids) order by v.created_at desc,v.id desc limit 1;
 current_status:='verified';
 if attempt.state in ('queued','running') then current_status:='running';reason_codes:=array['capture_running'];
 elsif latest_verification.state in ('queued','running') then current_status:='running';reason_codes:=array['verification_running'];
 elsif attempt.state='incomplete' then current_status:='incomplete';reason_codes:=array['capture_incomplete'];
 elsif attempt.state='failed' then current_status:='failed';reason_codes:=array['capture_failed'];
 elsif latest_verification.state='incomplete' then current_status:='incomplete';reason_codes:=array['verification_incomplete'];
 elsif latest_verification.state='failed' then current_status:='failed';reason_codes:=array['verification_failed'];
 elsif capture.id is null then current_status:='unverified';reason_codes:=array['no_certified_capture'];
 elsif verification.id is null then current_status:='unverified';reason_codes:=array['no_verified_restore'];
 elsif (capture.configuration-'schedulingEnabled')<>(policy.configuration-'schedulingEnabled') or not exists(select 1 from public.backup_runs c where c.instance_id=policy.instance_id and c.id=verification.parent_capture_id and (c.configuration-'schedulingEnabled')=(policy.configuration-'schedulingEnabled')) then current_status:='unverified';reason_codes:=array['configuration_changed'];
 elsif verification.completed_at<clock_timestamp()-make_interval(days=>(policy.configuration->>'verificationIntervalDays')::integer) then current_status:='overdue';reason_codes:=array['verification_overdue'];
 elsif (capture.certificate->>'recoveryPointAt')::timestamptz<clock_timestamp()-interval '1 hour' then current_status:='overdue';reason_codes:=array['recovery_point_overdue'];
 elsif (capture.certificate->>'recoveryPointAt')::timestamptz>clock_timestamp()+interval '5 seconds' or verification.completed_at>clock_timestamp()+interval '5 seconds' then current_status:='unavailable';reason_codes:=array['clock_untrusted'];
 end if;
 summary:=jsonb_build_object('status',current_status,'lastAttempt',public.m15_05_customer_run_json(attempt),'lastCapture',public.m15_05_customer_run_json(capture),'lastVerification',public.m15_05_customer_run_json(latest_verification),'lastVerifiedRestoreAt',public.m7_snapshot_timestamp_utc(verification.completed_at),'recoverablePointAt',capture.certificate->'recoveryPointAt','verificationDueAt',public.m7_snapshot_timestamp_utc(verification.completed_at+make_interval(days=>(policy.configuration->>'verificationIntervalDays')::integer)),'residency',policy.configuration->>'residency','sourceAt',public.m7_snapshot_timestamp_utc(greatest(attempt.completed_at,attempt.created_at,latest_verification.completed_at)),'observedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'reasons',reason_codes);
 select coalesce(jsonb_agg(public.m15_05_customer_run_json(x) order by x.created_at desc,x.id desc),'[]') into history from (select q.* from public.backup_runs q where q.instance_id=policy.instance_id and p_organization_id=any(q.covered_organization_ids) and (p_kind is null or q.kind=p_kind) and (p_cursor is null or (q.created_at,q.id)<(select c.created_at,c.id from public.backup_runs c where c.instance_id=policy.instance_id and c.id=p_cursor and p_organization_id=any(c.covered_organization_ids))) order by q.created_at desc,q.id desc limit p_limit) x;
 return jsonb_build_object('outcome','ok','assurance',summary,'history',jsonb_build_object('items',history,'nextCursor',case when jsonb_array_length(history)=p_limit then history->(p_limit-1)->>'id' end));
end $$;

create or replace function public.m15_05_backup_write_admission(p_instance_id uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog,public set statement_timeout='150ms' as $$
 with observed as materialized(select clock_timestamp() as at),pause as(select max(r.pause_deadline_at) as deadline from public.backup_runs r cross join observed o where r.instance_id=p_instance_id and r.kind='capture' and r.state='running' and r.pause_started_at<=o.at and r.pause_deadline_at>o.at)
 select jsonb_build_object('configured',exists(select 1 from public.backup_policies where instance_id=p_instance_id and is_approved),'paused',deadline is not null,'until',public.m7_snapshot_timestamp_utc(deadline)) from pause
$$;


-- Protective assurance uses the existing customer feed only; no delivery category or outbound dispatch is enabled.
create or replace function public.m15_05_feed_rows(p_organization_id uuid,p_actor_user_id uuid)
returns table(ref text,category text,severity text,occurred_at timestamptz,source_created_at timestamptz,title text,summary text,source_state text,notice_kind text,url text,fingerprint text)
language sql stable security definer set search_path=pg_catalog,public as $$
 with scope as(select s.notification_feed_started_at as started from public.organization_settings s where s.organization_id=p_organization_id and public.m15_03_health_can(p_organization_id,p_actor_user_id)),notices as(
 select 'm15_'||r.id::text||'_failure' as ref,r.completed_at as at,'Backup protection needs attention'::text as title,'A backup or restore check failed. Review System Health.'::text as summary,'failure'::text as kind,r.failure_code as code
 from public.backup_runs r where p_organization_id=any(r.covered_organization_ids) and r.state in ('failed','incomplete') and r.completed_at is not null
 union all
 select 'm15_'||(e->>'id')||'_event',(e->>'at')::timestamptz,case when e->>'code'='capture_overdue' then 'Recovery point overdue' else 'Restore verification overdue' end,'Review backup protection in System Health.','event',e->>'code'
 from public.backup_policies p cross join lateral jsonb_array_elements(p.alert_state->'events')e where e->'coveredOrganizationIds' ? p_organization_id::text
 )select n.ref,'backup_health'::text,'critical'::text,n.at,n.at,n.title,n.summary,'available'::text,n.kind,'/organization/health'::text,encode(extensions.digest(n.ref||':'||n.at::text||':'||coalesce(n.code,''),'sha256'),'hex')
 from notices n cross join scope s where n.at>=s.started and n.at>=statement_timestamp()-interval '180 days'
$$;

-- Extend the shared M12 projection once so grouped, unread and M14 consumers share one source.
do $$declare d text;b text;f record;begin
 select pg_get_functiondef(oid),prosrc into d,b from pg_proc where oid='public.m12_06_feed_rows(uuid,uuid)'::regprocedure;
 if position('m15_05_feed_rows' in b)=0 then execute replace(d,b,rtrim(b,E' \n\r;')||E'\n union all select * from public.m15_05_feed_rows(p_organization_id,p_actor_user_id)\n');end if;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('list_notification_feed_atomic','list_notification_feed_grouped_atomic','m12_06_list_filtered_feed_atomic','m14_04_list_notification_feed_atomic','mark_notification_feed_read_atomic','resolve_notification_feed_destination_atomic') loop
  d:=pg_get_functiondef(f.oid);
  d:=replace(d,'m(2|5|6|8|9|14)_','m(2|5|6|8|9|14|15)_');
  d:=replace(d,'m(2|5|6|8|9)_','m(2|5|6|8|9|15)_');
  d:=replace(d,'''reporting_deadline'',''scheduled_report'')','''reporting_deadline'',''scheduled_report'',''backup_health'')');
  d:=replace(d,'''support_period'',''reporting_deadline'')','''support_period'',''reporting_deadline'',''backup_health'')');
  execute d;
 end loop;
end $$;
alter table public.notification_feed_reads drop constraint notification_feed_reads_ref_check;
alter table public.notification_feed_reads add constraint notification_feed_reads_ref_check check(ref~'^m(2|5|6|8|9|14|15)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(event|failure)$');

-- Contextual backup hashes never relax generic audit redaction.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)'::regprocedure);
 anchor:='v_after:=public.m13_01_project_v2_audit_json(p_after_redacted);';
 if position(anchor in d)=0 then raise exception 'backup_append_anchor_missing';end if;
 if position('m15_05_audit_receipt_json' in d)=0 then execute replace(d,anchor,anchor||E'\n  if p_entity_type=''backup'' and p_scope=''security'' then v_after:=public.m15_05_audit_receipt_json(p_entity_id,p_action,p_after_redacted);end if;');end if;
 d:=pg_get_functiondef('public.m13_01_guard_audit_insert()'::regprocedure);
 anchor:='new.after_redacted:=public.m13_01_project_v2_audit_json(new.after_redacted);';
 if position(anchor in d)=0 then raise exception 'backup_insert_anchor_missing';end if;
 if position('m15_05_audit_receipt_json' in d)=0 then execute replace(d,anchor,'if new.entity_type=''backup'' and new.event_scope=''security'' then new.after_redacted:=public.m15_05_audit_receipt_json(new.entity_id,new.action,new.after_redacted);else '||anchor||'end if;');end if;
end $$;

do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'm15_05_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role,cra_operator_registry_reader,cra_backup_control',f.signature);end loop;
end $$;
grant execute on function public.m15_05_backup_control(uuid,text,text,jsonb) to cra_backup_control;
grant execute on function public.m15_05_backup_assurance(uuid,uuid,integer,uuid,text) to service_role;

grant execute on function public.m15_05_backup_write_admission(uuid) to service_role;

notify pgrst,'reload schema';
notify pgrst,'reload config';
