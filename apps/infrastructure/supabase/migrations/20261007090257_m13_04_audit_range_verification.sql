-- M13-04: additive resumable diagnostics. Existing ledger bytes are untouched.
alter table public.organizations
 add column audit_dataset_epoch uuid not null default gen_random_uuid(),
 add column audit_dataset_context text not null default 'unknown' check(audit_dataset_context in ('unknown','live','restored'));

create table public.audit_verification_jobs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 requester_id uuid not null references public.users(id) on delete restrict,
 request_id uuid not null, request_digest text not null check(request_digest ~ '^[0-9a-f]{64}$'),
 from_sequence bigint not null check(from_sequence>0), requested_to_sequence bigint,
 to_sequence bigint not null check(to_sequence>=0), high_water_sequence bigint not null check(high_water_sequence>=0),
 state text not null default 'queued' check(state in ('queued','processing','completed','failed','cancelled','stale')),
 phase text not null default 'authorization' check(phase in ('authorization','verification')),
 version integer not null default 1 check(version>0), attempts integer not null default 0 check(attempts between 0 and 3),
 scope_version bigint not null, dataset_epoch uuid not null, dataset_context text not null,
 database_identity text not null, dependency_policy_version integer not null default 1,
 authorization_snapshot pg_snapshot not null, authorization_xid xid8 not null, authorization_after_sequence bigint not null default 0,
 authorization_complete boolean not null default false, authorization_after_legacy_id uuid, authorization_count bigint not null default 0 check(authorization_count between 0 and 1000000),
 frozen_head jsonb, frozen_boundary jsonb, predecessor jsonb, prior_checkpoint jsonb,
 prior_checkpoint_status text not null default 'not_supplied' check(prior_checkpoint_status in ('not_supplied','matched','mismatch','ahead','unavailable')),
 legacy_count bigint not null default 0, cursor jsonb, result jsonb,
 worker_id text, lease_token uuid, lease_expires_at timestamptz,
 failure_code text, operation_receipts jsonb not null default '{}'::jsonb,
 scheduled_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(organization_id,requester_id,request_id),
 check(requested_to_sequence is null or requested_to_sequence>=from_sequence),
 check(pg_column_size(cursor)<=131072), check(pg_column_size(result)<=131072),
 check(failure_code is null or failure_code in ('access_changed','dataset_changed','provider_unavailable','event_limit','byte_limit','attempt_limit','verification_failed','checkpoint_unavailable'))
);
alter table public.audit_verification_jobs enable row level security;
revoke all on public.audit_verification_jobs from public,anon,authenticated,service_role;
grant select on public.audit_verification_jobs to service_role;
create index audit_verification_jobs_queue on public.audit_verification_jobs(scheduled_at,created_at,id) where state in ('queued','processing');
create index audit_verification_jobs_requester on public.audit_verification_jobs(organization_id,requester_id,created_at desc);
create unique index audit_verification_jobs_active_tenant on public.audit_verification_jobs(organization_id) where state='processing';
create trigger set_audit_verification_jobs_updated_at before update on public.audit_verification_jobs for each row execute function public.set_updated_at();

-- An action-specific projection after M13-01's generic projection. The SECURITY
-- receipts never join the tenant chain being checked and disclose no content.
create function public.m13_04_guard_receipt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; begin
 if new.entity_type<>'audit_verification' or new.action not like 'audit.range.%' then return new; end if;
 v:=new.changes;
 if new.organization_id is not null or new.event_scope<>'security' or v is null or jsonb_typeof(v)<>'object'
  or v->>'organizationId' is null or v->>'organizationId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or v->>'operationDigest' is null or v->>'operationDigest' !~ '^[a-f0-9]{64}$'
 then raise exception 'invalid range receipt' using errcode='22023'; end if;
 new.after_redacted:=jsonb_build_object('organizationId',v->>'organizationId','operationDigest',v->>'operationDigest');
 if new.action='audit.range.scope_changed' then
  if v->>'epoch' is null or v->>'epoch' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or v->>'xid' is null or v->>'xid' !~ '^[0-9]{1,20}$' or v->>'policyVersion' is distinct from '1'
  then raise exception 'invalid scope receipt' using errcode='22023'; end if;
  new.after_redacted:=new.after_redacted||jsonb_build_object('epoch',v->>'epoch','xid',v->>'xid','policyVersion',1);
 end if;
 if new.action='audit.range.dataset_rotated' then
  if v->>'rotatedEpoch' is null or v->>'rotatedEpoch' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid rotated epoch' using errcode='22023'; end if;
  new.after_redacted:=new.after_redacted||jsonb_build_object('rotatedEpoch',v->>'rotatedEpoch');
 end if;
 new.before_redacted:=null; new.reason:=null; new.changes:=null; return new;
end $$;
create trigger m13_04_guard_receipt before insert on public.audit_logs for each row execute function public.m13_04_guard_receipt();
create index audit_logs_range_scope_changes on public.audit_logs((after_redacted->>'organizationId'),(after_redacted->>'epoch'),((after_redacted->>'xid')::xid8)) where action='audit.range.scope_changed' and organization_id is null;

create function public.m13_04_security_receipt(p_org uuid,p_actor uuid,p_request uuid,p_action text,p_entity uuid,p_digest text,p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_existing public.audit_logs; begin
 if p_org is null or p_request is null or p_digest !~ '^[0-9a-f]{64}$' or p_action not in ('audit.range.created','audit.range.status_read','audit.range.cancelled','audit.range.resumed','audit.range.claimed','audit.range.checkpoint','audit.range.completed','audit.range.failed','audit.range.denied','audit.range.scope_changed','audit.range.dataset_rotated') then raise exception 'invalid range receipt' using errcode='22023'; end if;
 select * into v_existing from public.audit_logs where event_scope='security' and event_key=p_action||':'||p_request::text;
 if found then
  if v_existing.after_redacted->>'organizationId'<>p_org::text or v_existing.after_redacted->>'operationDigest'<>p_digest or v_existing.actor_id<>coalesce(p_actor::text,'system') then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return v_existing.id;
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version)
 values(null,p_actor,p_action,'audit_verification',p_entity::text,2,'security',p_action||':'||p_request::text,case when p_actor is null then 'system' else 'user' end,coalesce(p_actor::text,'system'),case when p_action='audit.range.denied' then 'denied' when p_action='audit.range.failed' then 'failed' when p_action='audit.range.cancelled' then 'cancelled' else 'completed' end,p_request,jsonb_build_object('organizationId',p_org,'operationDigest',p_digest)||p_extra,1) returning id into v_id;
 return v_id;
end $$;

create function public.m13_04_database_identity() returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select system_identifier::text||':'||current_database() from pg_control_system()
$$;

-- Only predicate-read identity, relationship, and permission fields invalidate. No shared
-- version/job row is touched by source writes; rolled-back receipts disappear.
create function public.m13_04_scope_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_old jsonb; v_new jsonb; v_org uuid; v_orgs uuid[]:='{}'; v_epoch uuid; v_xid text:=pg_current_xact_id()::text; begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 if tg_op='UPDATE' and (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(v_old) where key=any(array['id','organization_id','user_id','role_id','role','base_role','permissions','is_active','is_deleted','version','product_id','product_release_id','release_id','source_id','request_id','submission_id','technical_file_id','section_id','snapshot_id','document_id','version_id']))=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(v_new) where key=any(array['id','organization_id','user_id','role_id','role','base_role','permissions','is_active','is_deleted','version','product_id','product_release_id','release_id','source_id','request_id','submission_id','technical_file_id','section_id','snapshot_id','document_id','version_id'])) then return new; end if;
 if tg_table_name='organizations' then
  v_orgs:=array[coalesce(v_new->>'id',v_old->>'id')::uuid];
 elsif tg_table_name='users' then
  select coalesce(array_agg(distinct organization_id),'{}'::uuid[]) into v_orgs from public.organization_members where user_id=coalesce(v_new->>'id',v_old->>'id')::uuid;
 else
  if v_old->>'organization_id' is not null then v_orgs:=array_append(v_orgs,(v_old->>'organization_id')::uuid); end if;
  if v_new->>'organization_id' is not null then v_orgs:=array_append(v_orgs,(v_new->>'organization_id')::uuid); end if;
 end if;
 for v_org in select distinct unnest(v_orgs) loop
  select audit_dataset_epoch into v_epoch from public.organizations where id=v_org;
  if v_epoch is null then continue; end if;
  perform public.m13_04_security_receipt(v_org,null,gen_random_uuid(),'audit.range.scope_changed',null,
   encode(extensions.digest(convert_to(tg_table_name||':'||tg_op||':'||v_xid,'UTF8'),'sha256'),'hex'),jsonb_build_object('epoch',v_epoch,'xid',v_xid,'policyVersion',1));
 end loop;
 return coalesce(new,old);
end $$;

-- Exhaustive registry extracted from m13_03_event_visible_cached plus every
-- table read by its called authorization helpers. A fingerprint parity test
-- requires explicit review if those predicates change.
create function public.m13_04_scope_dependencies() returns text[] language sql immutable set search_path=pg_catalog,public as $$
 select array['organizations','users','organization_members','user_role_assignments','custom_roles','base_role_permission_overrides','organization_permissions_version','workflow_out_of_office','ai_inference_runs','products','product_releases','connectors','sbom_documents','sbom_ingest_jobs','sbom_supplier_requests','sbom_supplier_submissions','sbom_sources','evidence_document_versions','evidence_documents','evidence_document_version_products','supplier_contacts','supplier_document_fields','supplier_evidence_invitations','supplier_evidence_requests','supplier_evidence_submissions','supplier_evidence_submission_reviews','supplier_organizations','technical_files','technical_file_auditor_snapshot_grants','technical_file_declarations','technical_file_sections','technical_file_section_sources','technical_file_snapshots','technical_file_snapshot_exports','vulnerability_match_jobs','vulnerability_reevaluation_jobs','vulnerability_findings','reporting_obligations','reporting_submissions']::text[]
$$;
do $$ declare v_table text; begin
 foreach v_table in array public.m13_04_scope_dependencies() loop
  if to_regclass('public.'||v_table) is not null then
   execute format('create trigger m13_04_scope_changed after insert or update or delete on public.%I for each row execute function public.m13_04_scope_changed()',v_table);
  end if;
 end loop;
end $$;

create function public.m13_04_guard_dataset_marker() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if tg_op='INSERT' then new.audit_dataset_epoch:=gen_random_uuid(); new.audit_dataset_context:='unknown';
 elsif (new.audit_dataset_epoch,new.audit_dataset_context) is distinct from (old.audit_dataset_epoch,old.audit_dataset_context) and (session_user<>'postgres' or current_setting('cra.audit_dataset_rotation',true) is distinct from 'allowed') then raise exception 'dataset marker is operator owned' using errcode='42501'; end if;
 return new;
end $$;
create trigger m13_04_guard_dataset_marker before insert or update on public.organizations for each row execute function public.m13_04_guard_dataset_marker();
create function public.m13_04_rotate_dataset_marker(p_organization_id uuid,p_request_id uuid,p_expected_epoch uuid,p_context text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_epoch uuid; v_new uuid:=gen_random_uuid(); v_digest text; v_receipt public.audit_logs; begin
 if session_user<>'postgres' or p_context not in ('live','restored') or p_request_id is null or p_expected_epoch is null then raise exception 'operator rotation denied' using errcode='42501'; end if;
 v_digest:=encode(extensions.digest(convert_to(p_expected_epoch::text||':'||p_context,'UTF8'),'sha256'),'hex');
 select * into v_receipt from public.audit_logs where event_key='audit.range.dataset_rotated:'||p_request_id::text and event_scope='security';
 if found then
  if v_receipt.after_redacted->>'organizationId'<>p_organization_id::text or v_receipt.after_redacted->>'operationDigest'<>v_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return jsonb_build_object('epoch',v_receipt.after_redacted->>'rotatedEpoch','replayed',true);
 end if;
 select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id for update;
 if not found or v_epoch<>p_expected_epoch then raise exception 'dataset_marker_conflict' using errcode='40001'; end if;
 perform set_config('cra.audit_dataset_rotation','allowed',true);
 update public.organizations set audit_dataset_epoch=v_new,audit_dataset_context=p_context where id=p_organization_id;
 perform set_config('cra.audit_dataset_rotation','',true);
 perform public.m13_04_security_receipt(p_organization_id,null,p_request_id,'audit.range.dataset_rotated',null,v_digest,jsonb_build_object('rotatedEpoch',v_new));
 return jsonb_build_object('epoch',v_new,'replayed',false);
end $$;

create function public.m13_04_row_json(p_row public.audit_logs) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_row.id,'chain_version',p_row.chain_version,'chain_sequence',p_row.chain_sequence::text,'previous_hash',p_row.previous_hash,'content_hash',p_row.content_hash,'canonical_content',p_row.canonical_content,'recomputed_canonical_content',public.m13_02_canonical_content(p_row,p_row.chain_sequence))
$$;
create function public.m13_04_private_job(p_job public.audit_verification_jobs) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select (to_jsonb(p_job)-'authorization_snapshot'-'authorization_xid'-'operation_receipts')||jsonb_build_object('requested_to_sequence',p_job.requested_to_sequence::text,'from_sequence',p_job.from_sequence::text,'to_sequence',p_job.to_sequence::text,'high_water_sequence',p_job.high_water_sequence::text,'legacy_count',p_job.legacy_count::text,'predecessor',case when p_job.authorization_complete then p_job.predecessor else null end)
$$;
create function public.m13_04_public_job(p_job public.audit_verification_jobs) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare v_result jsonb:=p_job.result; v_cursor jsonb:=p_job.cursor; begin
 if v_result is null and p_job.authorization_complete and v_cursor is not null then
  v_result:=jsonb_build_object('outcome','incomplete','algorithm','sha256','chainVersion',1,
   'requestedRange',jsonb_build_object('from',p_job.from_sequence::text,'to',p_job.requested_to_sequence::text),
   'frozenRange',case when p_job.to_sequence>=p_job.from_sequence then jsonb_build_object('from',p_job.from_sequence::text,'to',p_job.to_sequence::text) else null end,
   'checkedRange',case when v_cursor->>'checkedFrom' is null or v_cursor->>'checkedTo' is null then null else jsonb_build_object('from',v_cursor->>'checkedFrom','to',v_cursor->>'checkedTo') end,
   'verifiedPrefix',case when v_cursor->>'verifiedPrefixTo' is null then null else jsonb_build_object('from',p_job.from_sequence::text,'to',v_cursor->>'verifiedPrefixTo') end,
   'checkedCount',v_cursor->>'checkedCount','firstAffectedSequence',case when jsonb_array_length(v_cursor->'breaks')>0 then v_cursor->'breaks'->0->>'fromSequence' else null end,
   'breaks',v_cursor->'breaks','sampleSequences',v_cursor->'sampleSequences','inspectionComplete',false,'checkedAt',p_job.updated_at,
   'datasetContext',p_job.dataset_context,'priorCheckpointStatus',p_job.prior_checkpoint_status,'authenticityProven',false,'completeLedgerVerified',false);
 end if;
 return jsonb_build_object('id',p_job.id,'status',p_job.state,'version',p_job.version,'createdAt',p_job.created_at,'updatedAt',p_job.updated_at,'result',v_result,'failureCode',p_job.failure_code);
end $$;

create function public.m13_04_current_scope(p_job public.audit_verification_jobs) returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_epoch uuid; v_version bigint; begin
 select audit_dataset_epoch into v_epoch from public.organizations where id=p_job.organization_id;
 if v_epoch is distinct from p_job.dataset_epoch or public.m13_04_database_identity()<>p_job.database_identity then return 'dataset_changed'; end if;
 if not public.m13_03_actor_can(p_job.organization_id,p_job.requester_id,'can_view_audit') then return 'access_changed'; end if;
 select version into v_version from public.organization_permissions_version where organization_id=p_job.organization_id;
 if coalesce(v_version,0)<>p_job.scope_version then return 'access_changed'; end if;
 if exists(select 1 from public.audit_logs a where a.organization_id is null and a.action='audit.range.scope_changed'
  and a.after_redacted->>'organizationId'=p_job.organization_id::text and a.after_redacted->>'epoch'=p_job.dataset_epoch::text
  and (a.after_redacted->>'xid')::xid8>=pg_snapshot_xmin(p_job.authorization_snapshot)
  and (a.after_redacted->>'xid')::xid8<>p_job.authorization_xid
  and not pg_visible_in_snapshot((a.after_redacted->>'xid')::xid8,p_job.authorization_snapshot)) then return 'access_changed'; end if;
 return null;
end $$;
create function public.m13_04_unavailable_result(p_job public.audit_verification_jobs,p_outcome text) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('outcome',p_outcome,'algorithm','sha256','chainVersion',1,'requestedRange',jsonb_build_object('from',p_job.from_sequence::text,'to',p_job.requested_to_sequence::text),'frozenRange',null,'checkedRange',null,'verifiedPrefix',null,'checkedCount',null,'firstAffectedSequence',null,'breaks','[]'::jsonb,'sampleSequences','[]'::jsonb,'inspectionComplete',false,'checkedAt',clock_timestamp(),'datasetContext',p_job.dataset_context,'priorCheckpointStatus',case when p_outcome='scope_unavailable' and p_job.prior_checkpoint is not null then 'unavailable' else p_job.prior_checkpoint_status end,'authenticityProven',false,'completeLedgerVerified',false)
$$;
create function public.m13_04_create_verification(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_from_sequence text,p_to_sequence text,p_checkpoint jsonb,p_request_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_head public.audit_chain_heads; v_tail public.audit_logs; v_pre public.audit_logs; v_boundary public.audit_logs; v_org public.organizations; v_high bigint; v_to bigint; v_head_json jsonb; v_checkpoint_status text:='not_supplied'; v_version bigint; begin
 if p_request_id is null or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' or p_from_sequence is null or p_from_sequence !~ '^[1-9][0-9]{0,18}$' or p_from_sequence::numeric>9223372036854775807 or (p_to_sequence is not null and (p_to_sequence !~ '^[1-9][0-9]{0,18}$' or p_to_sequence::numeric>9223372036854775807 or p_to_sequence::numeric<p_from_sequence::numeric)) then raise exception 'invalid verification range' using errcode='22023'; end if;
 -- Serialize creation/replay/caps independently of tenant-chain/source locks.
 perform pg_advisory_xact_lock(hashtextextended('cra:audit-verification-create:'||p_organization_id::text,0));
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_verification_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and request_id=p_request_id;
 if found then
  if v_job.request_digest<>p_request_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  if public.m13_04_current_scope(v_job) is not null then v_job.state:='stale'; v_job.failure_code:=public.m13_04_current_scope(v_job); v_job.result:=public.m13_04_unavailable_result(v_job,'scope_unavailable'); end if;
  return public.m13_04_public_job(v_job);
 end if;
 if (select count(*) from public.audit_verification_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and state in ('queued','processing'))>=2 or (select count(*) from public.audit_verification_jobs where organization_id=p_organization_id and state in ('queued','processing'))>=10 then raise exception 'verification_queue_full' using errcode='54000'; end if;
 -- Captures only committed rows. No tenant receipt is inserted into this chain.
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 select * into strict v_org from public.organizations where id=p_organization_id;
 select * into v_head from public.audit_chain_heads where organization_id=p_organization_id;
 select * into v_tail from public.audit_logs where organization_id=p_organization_id and chain_sequence is not null order by chain_sequence desc limit 1;
 v_high:=greatest(coalesce(v_head.last_sequence,0),coalesce(v_tail.chain_sequence,0)); v_to:=coalesce(p_to_sequence::bigint,v_high);
 if p_to_sequence is not null and v_to>v_high then raise exception 'range exceeds frozen boundary' using errcode='22023'; end if;
 if v_to>=p_from_sequence::bigint and v_to-p_from_sequence::bigint+1>1000000 then raise exception 'verification_event_limit' using errcode='54000'; end if;
 if p_checkpoint is not null then
  if jsonb_typeof(p_checkpoint)<>'object' or p_checkpoint->>'organizationId' is distinct from p_organization_id::text or p_checkpoint->>'chainVersion'<>'1' or p_checkpoint->>'sequence' !~ '^[1-9][0-9]{0,18}$' or (p_checkpoint->>'sequence')::numeric>9223372036854775807 or p_checkpoint->>'hash' !~ '^[a-f0-9]{64}$' then raise exception 'invalid prior checkpoint' using errcode='22023'; end if;
  if v_head.organization_id is null then v_checkpoint_status:='unavailable';
  elsif (p_checkpoint->>'activationAt')::timestamptz is distinct from v_head.activation_at then raise exception 'checkpoint activation mismatch' using errcode='22023';
  elsif (p_checkpoint->>'sequence')::bigint>v_high then v_checkpoint_status:='ahead';
  else
   select * into v_pre from public.audit_logs where organization_id=p_organization_id and chain_sequence=(p_checkpoint->>'sequence')::bigint;
   v_checkpoint_status:=case when not found then 'unavailable' when v_pre.content_hash=p_checkpoint->>'hash' then 'matched' else 'mismatch' end;
  end if;
 end if;
 v_head_json:=case when v_head.organization_id is null then null else jsonb_build_object('organization_id',p_organization_id,'chain_version',1,'activation_at',v_head.activation_at,'last_sequence',v_head.last_sequence::text,'last_event_id',v_head.last_event_id,'last_hash',v_head.last_hash,'observed_sequence',coalesce(v_tail.chain_sequence,0)::text,'observed_event_id',v_tail.id,'observed_hash',v_tail.content_hash) end;
 select * into v_boundary from public.audit_logs where organization_id=p_organization_id and chain_sequence=v_to;
 select coalesce(version,0) into v_version from public.organization_permissions_version where organization_id=p_organization_id;
 insert into public.audit_verification_jobs(organization_id,requester_id,request_id,request_digest,from_sequence,requested_to_sequence,to_sequence,high_water_sequence,scope_version,dataset_epoch,dataset_context,database_identity,authorization_snapshot,authorization_xid,authorization_after_sequence,frozen_head,frozen_boundary,prior_checkpoint,prior_checkpoint_status,legacy_count)
 values(p_organization_id,p_actor_user_id,p_request_id,p_request_digest,p_from_sequence::bigint,p_to_sequence::bigint,v_to,v_high,coalesce(v_version,0),v_org.audit_dataset_epoch,v_org.audit_dataset_context,public.m13_04_database_identity(),pg_current_snapshot(),pg_current_xact_id(),greatest(0,p_from_sequence::bigint-2),v_head_json,case when v_boundary.id is null then null else jsonb_build_object('sequence',v_boundary.chain_sequence::text,'hash',v_boundary.content_hash,'eventId',v_boundary.id) end,p_checkpoint,v_checkpoint_status,coalesce(v_head.legacy_count,0)) returning * into v_job;
 perform public.m13_04_security_receipt(p_organization_id,p_actor_user_id,p_request_id,'audit.range.created',v_job.id,p_request_digest);
 return public.m13_04_public_job(v_job);
end $$;

create function public.m13_04_record_denial(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_operation_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 return jsonb_build_object('receiptId',public.m13_04_security_receipt(p_organization_id,p_actor_user_id,p_request_id,'audit.range.denied',null,p_operation_digest));
end $$;
create function public.m13_04_read_verification(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_scope text; begin
 if p_request_id is null then raise exception 'request id required' using errcode='22023'; end if;
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501'; end if;
 select * into v_job from public.audit_verification_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id;
 if not found then raise exception 'audit_verification_not_found' using errcode='P0002'; end if;
 v_scope:=public.m13_04_current_scope(v_job);
 if v_scope is not null then
  v_job.state:='stale'; v_job.failure_code:=v_scope; v_job.result:=public.m13_04_unavailable_result(v_job,'scope_unavailable');
 end if;
 perform public.m13_04_security_receipt(p_organization_id,p_actor_user_id,p_request_id,'audit.range.status_read',p_job_id,encode(extensions.digest(convert_to(p_job_id::text,'UTF8'),'sha256'),'hex'));
 return public.m13_04_public_job(v_job);
end $$;

create function public.m13_04_control_verification(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_request_id uuid,p_expected_version integer,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_digest text; v_replay jsonb; begin
 if p_request_id is null or p_expected_version is null or p_operation not in ('cancel','resume') then raise exception 'invalid operation' using errcode='22023'; end if;
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cra:audit-verification-create:'||p_organization_id::text,0));
 select * into v_job from public.audit_verification_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id=p_job_id for update;
 if not found then raise exception 'audit_verification_not_found' using errcode='P0002'; end if;
 v_digest:=encode(extensions.digest(convert_to(p_operation||':'||p_job_id::text||':'||p_expected_version::text,'UTF8'),'sha256'),'hex');
 v_replay:=v_job.operation_receipts->p_request_id::text;
 if v_replay is not null then
  if v_replay->>'digest'<>v_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  if public.m13_04_current_scope(v_job) is not null then v_job.state:='stale'; v_job.failure_code:=public.m13_04_current_scope(v_job); v_job.result:=public.m13_04_unavailable_result(v_job,'scope_unavailable'); return public.m13_04_public_job(v_job); end if;
  return v_replay->'response';
 end if;
 if v_job.version<>p_expected_version then raise exception 'verification_version_conflict' using errcode='40001'; end if;
 if p_operation='cancel' then
  if v_job.state not in ('queued','processing') then raise exception 'verification_transition_conflict' using errcode='40001'; end if;
  v_job.state:='cancelled'; v_job.result:=public.m13_04_unavailable_result(v_job,'incomplete');
 else
  if v_job.state not in ('cancelled','failed','stale') then raise exception 'verification_transition_conflict' using errcode='40001'; end if;
  if public.m13_04_current_scope(v_job)='dataset_changed' then raise exception 'verification_dataset_changed' using errcode='40001'; end if;
  if (select count(*) from public.audit_verification_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and state in ('queued','processing'))>=2 or (select count(*) from public.audit_verification_jobs where organization_id=p_organization_id and state in ('queued','processing'))>=10 then raise exception 'verification_queue_full' using errcode='54000'; end if;
  v_job.state:='queued'; v_job.phase:='authorization'; v_job.authorization_complete:=false; v_job.authorization_after_sequence:=greatest(0,v_job.from_sequence-2); v_job.authorization_count:=0; v_job.authorization_after_legacy_id:=null; v_job.authorization_snapshot:=pg_current_snapshot(); v_job.authorization_xid:=pg_current_xact_id();
  select coalesce(version,0) into v_job.scope_version from public.organization_permissions_version where organization_id=p_organization_id;
  v_job.result:=null; v_job.failure_code:=null; v_job.attempts:=0;
 end if;
 v_job.version:=v_job.version+1; v_job.worker_id:=null; v_job.lease_token:=null; v_job.lease_expires_at:=null; v_job.updated_at:=clock_timestamp();
 perform public.m13_04_security_receipt(p_organization_id,p_actor_user_id,p_request_id,case when p_operation='cancel' then 'audit.range.cancelled' else 'audit.range.resumed' end,p_job_id,v_digest);
 if (select count(*) from jsonb_object_keys(v_job.operation_receipts))>=100 then raise exception 'operation receipt limit' using errcode='54000'; end if;
 v_job.operation_receipts:=v_job.operation_receipts||jsonb_build_object(p_request_id::text,jsonb_build_object('digest',v_digest,'response',public.m13_04_public_job(v_job)));
 update public.audit_verification_jobs set state=v_job.state,phase=v_job.phase,authorization_complete=v_job.authorization_complete,authorization_after_sequence=v_job.authorization_after_sequence,authorization_count=v_job.authorization_count,authorization_snapshot=v_job.authorization_snapshot,authorization_xid=v_job.authorization_xid,scope_version=coalesce(v_job.scope_version,0),cursor=v_job.cursor,result=v_job.result,failure_code=v_job.failure_code,attempts=v_job.attempts,version=v_job.version,worker_id=null,lease_token=null,lease_expires_at=null,operation_receipts=v_job.operation_receipts,scheduled_at=clock_timestamp() where id=p_job_id returning * into v_job;
 return v_job.operation_receipts->p_request_id::text->'response';
end $$;

create function public.m13_04_assert_lease(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer)
returns public.audit_verification_jobs language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; begin
 select * into v_job from public.audit_verification_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found or v_job.state<>'processing' or v_job.worker_id is distinct from p_worker_id or v_job.lease_token is distinct from p_lease_token or v_job.version is distinct from p_expected_version or v_job.lease_expires_at<=clock_timestamp() then raise exception 'verification_lease_conflict' using errcode='40001'; end if;
 return v_job;
end $$;
create function public.m13_04_claim_verification(p_worker_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_expired public.audit_verification_jobs; begin
 if p_worker_id is null or p_worker_id !~ '^[a-zA-Z0-9:_-]{1,100}$' then raise exception 'invalid worker identity' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cra:audit-verification-slots',0));
 for v_expired in select * from public.audit_verification_jobs where state='processing' and lease_expires_at<=clock_timestamp() order by lease_expires_at for update skip locked loop
  update public.audit_verification_jobs set state=case when attempts>=2 then 'failed' else 'queued' end,attempts=least(3,attempts+1),version=version+1,worker_id=null,lease_token=null,lease_expires_at=null,scheduled_at=clock_timestamp(),failure_code=case when attempts>=2 then 'attempt_limit' else null end where id=v_expired.id returning * into v_expired;
  perform public.m13_04_security_receipt(v_expired.organization_id,v_expired.requester_id,gen_random_uuid(),'audit.range.failed',v_expired.id,v_expired.request_digest);
 end loop;
 if (select count(*) from public.audit_verification_jobs where state='processing' and lease_expires_at>clock_timestamp())>=2 then return null; end if;
 select * into v_job from public.audit_verification_jobs j where j.state='queued' and not exists(select 1 from public.audit_verification_jobs active where active.organization_id=j.organization_id and active.state='processing') order by j.scheduled_at,j.created_at,j.id for update skip locked limit 1;
 if not found then return null; end if;
 update public.audit_verification_jobs set state='processing',version=version+1,worker_id=p_worker_id,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds' where id=v_job.id returning * into v_job;
 perform public.m13_04_security_receipt(v_job.organization_id,v_job.requester_id,gen_random_uuid(),'audit.range.claimed',v_job.id,v_job.request_digest);
 return public.m13_04_private_job(v_job);
end $$;
create function public.m13_04_authorize_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer,p_limit integer,p_maximum_bytes integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_permissions jsonb; v_row public.audit_logs; v_count integer:=0; v_bytes bigint:=0; v_last bigint; v_last_legacy uuid; v_complete boolean; v_pre public.audit_logs; begin
 if p_limit is null or p_limit not between 1 and 250 or p_maximum_bytes is null or p_maximum_bytes not between 1 and 16777216 then raise exception 'invalid authorization batch' using errcode='22023'; end if;
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if public.m13_04_current_scope(v_job) is not null then return jsonb_build_object('job',public.m13_04_private_job(v_job),'complete',false,'scopeAvailable',false); end if;
 if v_job.authorization_complete then return jsonb_build_object('job',public.m13_04_private_job(v_job),'complete',true,'scopeAvailable',true); end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,v_job.requester_id);
 -- Every present event and predecessor is checked; unauthorized rows never get
 -- filtered out and then misrepresented as an intact contiguous range.
 for v_row in select * from public.audit_logs where organization_id=p_organization_id and chain_sequence>v_job.authorization_after_sequence and chain_sequence<=v_job.to_sequence order by chain_sequence limit p_limit loop
  v_bytes:=v_bytes+pg_column_size(v_row); if v_bytes>p_maximum_bytes and v_count=0 then raise exception 'verification byte limit' using errcode='54000'; elsif v_bytes>p_maximum_bytes then exit; end if;
  if not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then return jsonb_build_object('job',public.m13_04_private_job(v_job),'complete',false,'scopeAvailable',false); end if;
  v_count:=v_count+1; v_last:=v_row.chain_sequence;
 end loop;
 if v_job.high_water_sequence=0 then
  for v_row in select * from public.audit_logs where organization_id=p_organization_id and chain_version is null and (v_job.authorization_after_legacy_id is null or id>v_job.authorization_after_legacy_id) order by id limit p_limit loop
   v_bytes:=v_bytes+pg_column_size(v_row); if v_bytes>p_maximum_bytes and v_count=0 then raise exception 'verification byte limit' using errcode='54000'; elsif v_bytes>p_maximum_bytes then exit; end if;
   if not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then return jsonb_build_object('job',public.m13_04_private_job(v_job),'complete',false,'scopeAvailable',false); end if;
   v_count:=v_count+1; v_last_legacy:=v_row.id;
  end loop;
 end if;
 v_job.authorization_after_sequence:=coalesce(v_last,v_job.authorization_after_sequence); v_job.authorization_after_legacy_id:=coalesce(v_last_legacy,v_job.authorization_after_legacy_id); v_job.authorization_count:=v_job.authorization_count+v_count;
 if v_job.authorization_count>1000000 then raise exception 'verification event limit' using errcode='54000'; end if;
 v_complete:=not exists(select 1 from public.audit_logs where organization_id=p_organization_id and chain_sequence>v_job.authorization_after_sequence and chain_sequence<=v_job.to_sequence)
  and (v_job.high_water_sequence<>0 or not exists(select 1 from public.audit_logs where organization_id=p_organization_id and chain_version is null and (v_job.authorization_after_legacy_id is null or id>v_job.authorization_after_legacy_id)));
 if v_complete then
  if v_job.high_water_sequence=0 then v_job.legacy_count:=v_job.authorization_count; end if;
  for v_row in select * from public.audit_logs where organization_id=p_organization_id and (id=(v_job.frozen_head->>'last_event_id')::uuid or id=(v_job.frozen_head->>'observed_event_id')::uuid or (v_job.prior_checkpoint_status not in ('not_supplied','ahead') and chain_sequence=(v_job.prior_checkpoint->>'sequence')::bigint)) loop
   if not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then return jsonb_build_object('job',public.m13_04_private_job(v_job),'complete',false,'scopeAvailable',false); end if;
  end loop;
  if v_job.from_sequence>1 then select * into v_pre from public.audit_logs where organization_id=p_organization_id and chain_sequence=v_job.from_sequence-1; end if;
  v_job.predecessor:=case when v_pre.id is null then null else public.m13_04_row_json(v_pre) end;
  v_job.authorization_complete:=true; v_job.phase:='verification';
 end if;
 update public.audit_verification_jobs set authorization_after_sequence=v_job.authorization_after_sequence,authorization_after_legacy_id=v_job.authorization_after_legacy_id,authorization_count=v_job.authorization_count,authorization_complete=v_job.authorization_complete,phase=v_job.phase,predecessor=v_job.predecessor,legacy_count=v_job.legacy_count,version=version+1 where id=p_job_id returning * into v_job;
 perform public.m13_04_security_receipt(p_organization_id,v_job.requester_id,gen_random_uuid(),'audit.range.checkpoint',p_job_id,v_job.request_digest);
 return jsonb_build_object('job',public.m13_04_private_job(v_job),'complete',v_complete,'scopeAvailable',true);
end $$;

create function public.m13_04_revalidate_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_pre public.audit_logs; v_valid boolean:=true; begin
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if v_job.authorization_complete and v_job.predecessor is not null then
  select * into v_pre from public.audit_logs where organization_id=p_organization_id and id=(v_job.predecessor->>'id')::uuid;
  v_valid:=found and public.m13_04_row_json(v_pre)=v_job.predecessor;
 end if;
 return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',v_valid,'scopeAvailable',public.m13_04_current_scope(v_job) is null and v_job.authorization_complete);
end $$;
create function public.m13_04_page_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer,p_after_sequence text,p_upper_sequence text,p_limit integer,p_maximum_bytes integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_row public.audit_logs; v_item jsonb; v_rows jsonb:='[]'; v_bytes bigint:=2; v_last bigint; begin
 if p_after_sequence is null or p_after_sequence !~ '^(0|[1-9][0-9]{0,18})$' or p_upper_sequence is null or p_upper_sequence !~ '^(0|[1-9][0-9]{0,18})$' or p_after_sequence::numeric>9223372036854775807 or p_upper_sequence::numeric>9223372036854775807 or p_limit is null or p_limit not between 1 and 250 or p_maximum_bytes is null or p_maximum_bytes not between 1 and 16777216 then raise exception 'invalid verification page' using errcode='22023'; end if;
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if not v_job.authorization_complete or public.m13_04_current_scope(v_job) is not null then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 if p_upper_sequence::bigint<>v_job.to_sequence or p_after_sequence::bigint<greatest(0,v_job.from_sequence-1) or p_after_sequence::bigint>v_job.to_sequence then raise exception 'page outside frozen range' using errcode='22023'; end if;
 v_last:=p_after_sequence::bigint;
 for v_row in select * from public.audit_logs where organization_id=p_organization_id and chain_sequence>v_last and chain_sequence<=v_job.to_sequence order by chain_sequence limit p_limit loop
  v_item:=public.m13_04_row_json(v_row);
  if v_bytes+octet_length(v_item::text)>p_maximum_bytes then
   if v_bytes=2 then raise exception 'verification byte limit' using errcode='54000'; end if; exit;
  end if;
  v_rows:=v_rows||jsonb_build_array(v_item); v_bytes:=v_bytes+octet_length(v_item::text)+1; v_last:=v_row.chain_sequence;
 end loop;
 return jsonb_build_object('rows',v_rows,'exhausted',not exists(select 1 from public.audit_logs where organization_id=p_organization_id and chain_sequence>v_last and chain_sequence<=v_job.to_sequence));
end $$;

create function public.m13_04_checkpoint_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer,p_cursor jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_scope text; begin
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 v_scope:=public.m13_04_current_scope(v_job);
 if v_scope is not null then
  update public.audit_verification_jobs set state='stale',version=version+1,result=public.m13_04_unavailable_result(v_job,'scope_unavailable'),failure_code=v_scope,worker_id=null,lease_token=null,lease_expires_at=null where id=p_job_id returning * into v_job;
 else
  if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or pg_column_size(p_cursor)>131072 or (p_cursor->>'nextSequence') is null or p_cursor->>'nextSequence' !~ '^[1-9][0-9]{0,18}$' or (p_cursor->>'checkedCount')::numeric>1000000 or jsonb_array_length(p_cursor->'breaks')>100 or jsonb_array_length(p_cursor->'sampleSequences')>100) then raise exception 'invalid verification cursor' using errcode='22023'; end if;
  if p_result is not null and (not v_job.authorization_complete or jsonb_typeof(p_result)<>'object' or pg_column_size(p_result)>131072 or p_result->>'outcome' not in ('consistent','integrity_break','empty','legacy_unchained','checkpoint_unavailable','incomplete') or p_result->>'authenticityProven'<>'false' or p_result->>'completeLedgerVerified'<>'false' or jsonb_array_length(p_result->'breaks')>100 or jsonb_array_length(p_result->'sampleSequences')>100) then raise exception 'invalid verification result' using errcode='22023'; end if;
  update public.audit_verification_jobs set state=case when p_result is null then 'queued' else 'completed' end,version=version+1,cursor=coalesce(p_cursor,cursor),result=p_result,worker_id=null,lease_token=null,lease_expires_at=null,scheduled_at=clock_timestamp(),completed_at=case when p_result is null then null else clock_timestamp() end where id=p_job_id returning * into v_job;
  -- Move every pending job of the yielded tenant behind other ready tenants.
  update public.audit_verification_jobs set scheduled_at=v_job.scheduled_at where organization_id=p_organization_id and state='queued' and id<>p_job_id;
 end if;
 perform public.m13_04_security_receipt(p_organization_id,v_job.requester_id,gen_random_uuid(),case when v_job.state='completed' then 'audit.range.completed' else 'audit.range.checkpoint' end,p_job_id,v_job.request_digest);
 return public.m13_04_private_job(v_job);
end $$;
create function public.m13_04_finish_unavailable_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer,p_outcome text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; begin
 if p_outcome not in ('scope_unavailable','checkpoint_unavailable') then raise exception 'invalid unavailable outcome' using errcode='22023'; end if;
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 update public.audit_verification_jobs set state='completed',version=version+1,result=public.m13_04_unavailable_result(v_job,p_outcome),completed_at=clock_timestamp(),worker_id=null,lease_token=null,lease_expires_at=null where id=p_job_id returning * into v_job;
 perform public.m13_04_security_receipt(p_organization_id,v_job.requester_id,gen_random_uuid(),'audit.range.completed',p_job_id,v_job.request_digest);
 return public.m13_04_private_job(v_job);
end $$;
create function public.m13_04_fail_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer,p_code text,p_retryable boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; begin
 if p_code not in ('provider_unavailable','malformed_provider','event_limit','byte_limit') then raise exception 'invalid failure code' using errcode='22023'; end if;
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if public.m13_04_current_scope(v_job) is not null then
  update public.audit_verification_jobs set state='stale',version=version+1,result=public.m13_04_unavailable_result(v_job,'scope_unavailable'),failure_code=public.m13_04_current_scope(v_job),worker_id=null,lease_token=null,lease_expires_at=null where id=p_job_id returning * into v_job;
 else
 update public.audit_verification_jobs set state=case when p_retryable and attempts<2 then 'queued' else 'failed' end,attempts=least(3,attempts+1),version=version+1,failure_code=case when p_code='malformed_provider' then 'verification_failed' else p_code end,worker_id=null,lease_token=null,lease_expires_at=null,scheduled_at=clock_timestamp() where id=p_job_id returning * into v_job;
 end if;
 perform public.m13_04_security_receipt(p_organization_id,v_job.requester_id,gen_random_uuid(),'audit.range.failed',p_job_id,v_job.request_digest);
 return public.m13_04_private_job(v_job);
end $$;

-- Parity gate: reviewers must refresh these fingerprints and dependency
-- triggers together when an authorization predicate changes.
create function public.m13_04_dependency_fingerprints() returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select '{"m1201_group_admin(uuid,uuid)":"c6ffe8d0a56114ec80f61f3e319c1cd4","m12_03_actor_can_manage_notification_user(uuid,uuid,uuid)":"0ba436fe7477ed990a770eb5ae0738dc","m13_03_actor_can(uuid,uuid,text)":"045d3964f4f89578465e1a29f2c2126b","m13_03_event_visible_cached(uuid,uuid,audit_logs,jsonb)":"f46693aa6776bffbfcd74b09d7d6c1a0","m13_03_permission_snapshot(uuid,uuid)":"6d4f8539eaba3275d8cdce580d6ea353","m5_triage_actor_has_permission(uuid,uuid,text)":"d3f44d08aec618a11e59b7dbc7dcef73"}'::jsonb
$$;

-- Helpers remain inward-only even for service_role. Public HTTP calls invoke
-- only the explicitly granted boundary RPCs through verified application policy.
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'm13_04_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.m13_04_create_verification(uuid,uuid,uuid,text,text,jsonb,text),public.m13_04_read_verification(uuid,uuid,uuid,uuid),public.m13_04_control_verification(uuid,uuid,uuid,uuid,integer,text),public.m13_04_record_denial(uuid,uuid,uuid,text),public.m13_04_claim_verification(text),public.m13_04_authorize_verification(uuid,uuid,text,uuid,integer,integer,integer),public.m13_04_revalidate_verification(uuid,uuid,text,uuid,integer),public.m13_04_page_verification(uuid,uuid,text,uuid,integer,text,text,integer,integer),public.m13_04_checkpoint_verification(uuid,uuid,text,uuid,integer,jsonb,jsonb),public.m13_04_finish_unavailable_verification(uuid,uuid,text,uuid,integer,text),public.m13_04_fail_verification(uuid,uuid,text,uuid,integer,text,boolean) to service_role;
-- Operator-only originating identity: service_role cannot invoke the helper.
grant execute on function public.m13_04_rotate_dataset_marker(uuid,uuid,uuid,text) to postgres;
