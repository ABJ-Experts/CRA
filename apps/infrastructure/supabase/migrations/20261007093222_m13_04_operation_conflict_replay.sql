-- M13-04: deterministic business conflicts are not transaction serialization
-- failures. PostgREST may retry 40001; return the existing 23505/HTTP409 contract.
-- Concurrent logical read/denial retries share one immutable security receipt.
create or replace function public.m13_04_security_receipt(p_org uuid,p_actor uuid,p_request uuid,p_action text,p_entity uuid,p_digest text,p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_existing public.audit_logs; begin
 if p_org is null or p_request is null or p_digest !~ '^[0-9a-f]{64}$' or p_action not in ('audit.range.created','audit.range.status_read','audit.range.cancelled','audit.range.resumed','audit.range.claimed','audit.range.checkpoint','audit.range.completed','audit.range.failed','audit.range.denied','audit.range.scope_changed','audit.range.dataset_rotated') then raise exception 'invalid range receipt' using errcode='22023'; end if;
 -- Random source-change receipts do not accumulate per-row advisory locks.
 if p_action<>'audit.range.scope_changed' then perform pg_advisory_xact_lock(hashtextextended('cra:audit-range-receipt:'||p_action||':'||p_request::text,0)); end if;
 select * into v_existing from public.audit_logs where schema_version=2 and organization_id is null and event_scope='security' and event_key=p_action||':'||p_request::text;
 if found then
  if v_existing.after_redacted->>'organizationId'<>p_org::text or v_existing.after_redacted->>'operationDigest'<>p_digest or v_existing.actor_id<>coalesce(p_actor::text,'system') then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return v_existing.id;
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version)
 values(null,p_actor,p_action,'audit_verification',p_entity::text,2,'security',p_action||':'||p_request::text,case when p_actor is null then 'system' else 'user' end,coalesce(p_actor::text,'system'),case when p_action='audit.range.denied' then 'denied' when p_action='audit.range.failed' then 'failed' when p_action='audit.range.cancelled' then 'cancelled' else 'completed' end,p_request,jsonb_build_object('organizationId',p_org,'operationDigest',p_digest)||p_extra,1) returning id into v_id;
 return v_id;
end $$;

create or replace function public.m13_04_control_verification(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_request_id uuid,p_expected_version integer,p_operation text)
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
 if v_job.version<>p_expected_version then raise exception 'verification_version_conflict' using errcode='23505'; end if;
 if p_operation='cancel' then
  if v_job.state not in ('queued','processing') then raise exception 'verification_transition_conflict' using errcode='23505'; end if;
  v_job.state:='cancelled'; v_job.result:=public.m13_04_unavailable_result(v_job,'incomplete');
 else
  if v_job.state not in ('cancelled','failed','stale') then raise exception 'verification_transition_conflict' using errcode='23505'; end if;
  if public.m13_04_current_scope(v_job)='dataset_changed' then raise exception 'verification_dataset_changed' using errcode='23505'; end if;
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

create or replace function public.m13_04_assert_lease(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer)
returns public.audit_verification_jobs language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; begin
 select * into v_job from public.audit_verification_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found or v_job.state<>'processing' or v_job.worker_id is distinct from p_worker_id or v_job.lease_token is distinct from p_lease_token or v_job.version is distinct from p_expected_version or v_job.lease_expires_at<=clock_timestamp() then raise exception 'verification_lease_conflict' using errcode='23505'; end if;
 return v_job;
end $$;

create or replace function public.m13_04_rotate_dataset_marker(p_organization_id uuid,p_request_id uuid,p_expected_epoch uuid,p_context text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_epoch uuid; v_new uuid:=gen_random_uuid(); v_digest text; v_receipt public.audit_logs; begin
 if session_user<>'postgres' or p_context not in ('live','restored') or p_request_id is null or p_expected_epoch is null then raise exception 'operator rotation denied' using errcode='42501'; end if;
 v_digest:=encode(extensions.digest(convert_to(p_expected_epoch::text||':'||p_context,'UTF8'),'sha256'),'hex');
 select * into v_receipt from public.audit_logs where schema_version=2 and organization_id is null and event_key='audit.range.dataset_rotated:'||p_request_id::text and event_scope='security';
 if found then
  if v_receipt.after_redacted->>'organizationId'<>p_organization_id::text or v_receipt.after_redacted->>'operationDigest'<>v_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return jsonb_build_object('epoch',v_receipt.after_redacted->>'rotatedEpoch','replayed',true);
 end if;
 select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id for update;
 if not found or v_epoch<>p_expected_epoch then raise exception 'dataset_marker_conflict' using errcode='23505'; end if;
 perform set_config('cra.audit_dataset_rotation','allowed',true);
 update public.organizations set audit_dataset_epoch=v_new,audit_dataset_context=p_context where id=p_organization_id;
 perform set_config('cra.audit_dataset_rotation','',true);
 perform public.m13_04_security_receipt(p_organization_id,null,p_request_id,'audit.range.dataset_rotated',null,v_digest,jsonb_build_object('rotatedEpoch',v_new));
 return jsonb_build_object('epoch',v_new,'replayed',false);
end $$;

create or replace function public.m13_04_current_scope(p_job public.audit_verification_jobs) returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_epoch uuid; v_version bigint; begin
 select audit_dataset_epoch into v_epoch from public.organizations where id=p_job.organization_id;
 if v_epoch is distinct from p_job.dataset_epoch or public.m13_04_database_identity()<>p_job.database_identity then return 'dataset_changed'; end if;
 if p_job.dependency_policy_version<>1 then return 'access_changed'; end if;
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
