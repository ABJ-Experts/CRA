-- A resumed cursor bypasses kernel initialization. Preserve and compare its
-- frozen predecessor explicitly, with a structural break and no verified prefix.
create or replace function public.m13_04_revalidate_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_row public.audit_logs; v_permissions jsonb; v_categories text[]:='{}'; v_category text; v_sequence text; v_breaks jsonb; v_samples jsonb; v_frozen_predecessor jsonb; begin
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if public.m13_04_current_scope(v_job) is not null or not v_job.authorization_complete then return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',true,'scopeAvailable',false); end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,v_job.requester_id);
 -- Re-read the predecessor, so a changed/deleted anchor reaches the kernel's
 -- precise predecessor_failure check instead of an unavailable green fallback.
 v_frozen_predecessor:=v_job.predecessor;
 if v_job.from_sequence>1 then
  select * into v_row from public.audit_logs where organization_id=p_organization_id and chain_sequence=v_job.from_sequence-1;
  if found and not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',true,'scopeAvailable',false); end if;
  v_job.predecessor:=case when v_row.id is null then null else public.m13_04_row_json(v_row) end;
  if v_job.cursor is not null and v_job.predecessor is distinct from v_frozen_predecessor then
   v_breaks:=coalesce(v_job.cursor->'breaks','[]'::jsonb); v_samples:=coalesce(v_job.cursor->'sampleSequences','[]'::jsonb);
   if jsonb_array_length(v_breaks)<100 and not exists(select 1 from jsonb_array_elements(v_breaks) b where b->>'category'='predecessor_failure' and b->>'fromSequence'=v_job.from_sequence::text) then v_breaks:=jsonb_build_array(jsonb_build_object('category','predecessor_failure','fromSequence',v_job.from_sequence::text,'toSequence',v_job.from_sequence::text))||v_breaks; end if;
   if jsonb_array_length(v_samples)<100 and not v_samples ? v_job.from_sequence::text then v_samples:=jsonb_build_array(v_job.from_sequence::text)||v_samples; end if;
   v_job.cursor:=jsonb_set(jsonb_set(jsonb_set(v_job.cursor,'{breaks}',v_breaks),'{sampleSequences}',v_samples),'{verifiedPrefixTo}','null'::jsonb);
  end if;
 end if;
 -- A resumed checkpoint binds its last checked row and exact canonical bytes.
 -- Continue with bounded diagnostics when the persisted checkpoint was altered.
 if v_job.cursor->>'lastEventId' is not null then
  v_sequence:=v_job.cursor->>'checkedTo';
  select * into v_row from public.audit_logs where organization_id=p_organization_id and id=(v_job.cursor->>'lastEventId')::uuid;
  if not found then v_categories:=array['missing_sequence_interval'];
  else
   if not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',true,'scopeAvailable',false); end if;
   if v_row.chain_sequence::text is distinct from v_sequence then v_categories:=array_append(v_categories,'frozen_boundary_mismatch'); end if;
   if v_row.chain_version<>1 then v_categories:=array_append(v_categories,'unsupported_version'); end if;
   if v_row.canonical_content is distinct from public.m13_02_canonical_content(v_row,v_row.chain_sequence) then v_categories:=array_append(v_categories,'canonical_mismatch'); end if;
   if v_row.previous_hash !~ '^[a-f0-9]{64}$' or v_row.content_hash !~ '^[a-f0-9]{64}$' then v_categories:=array_append(v_categories,'hash_mismatch');
   elsif v_row.content_hash is distinct from encode(extensions.digest(decode(v_row.previous_hash,'hex')||convert_to(v_row.canonical_content,'UTF8'),'sha256'),'hex') or v_row.content_hash is distinct from v_job.cursor->>'previousHash' then v_categories:=array_append(v_categories,'hash_mismatch'); end if;
  end if;
  v_breaks:=coalesce(v_job.cursor->'breaks','[]'::jsonb); v_samples:=coalesce(v_job.cursor->'sampleSequences','[]'::jsonb);
  foreach v_category in array v_categories loop
   if jsonb_array_length(v_breaks)>=100 then exit; end if;
   if not exists(select 1 from jsonb_array_elements(v_breaks) b where b->>'category'=v_category and b->>'fromSequence'=v_sequence and b->>'toSequence'=v_sequence) then
    v_breaks:=v_breaks||jsonb_build_array(jsonb_build_object('category',v_category,'fromSequence',v_sequence,'toSequence',v_sequence));
   end if;
  end loop;
  if cardinality(v_categories)>0 then
   if jsonb_array_length(v_samples)<100 and not v_samples ? v_sequence then v_samples:=v_samples||to_jsonb(v_sequence); end if;
   v_job.cursor:=jsonb_set(jsonb_set(jsonb_set(v_job.cursor,'{breaks}',v_breaks),'{sampleSequences}',v_samples),'{verifiedPrefixTo}',case when v_job.cursor->>'verifiedPrefixTo' is null or v_sequence::bigint<=v_job.from_sequence then 'null'::jsonb else to_jsonb(least((v_job.cursor->>'verifiedPrefixTo')::bigint,v_sequence::bigint-1)::text) end);
  end if;
 end if;
 return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',true,'scopeAvailable',true);
end $$;

-- A source-stale projection may come from any stored workflow state. Resume
-- reauthorizes that frozen range rather than rejecting its underlying state.
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
  if public.m13_04_current_scope(v_job)='dataset_changed' then raise exception 'verification_dataset_changed' using errcode='23505'; end if;
  if v_job.state not in ('cancelled','failed','stale') and public.m13_04_current_scope(v_job) is distinct from 'access_changed' then raise exception 'verification_transition_conflict' using errcode='23505'; end if;
  if (select count(*) from public.audit_verification_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and id<>p_job_id and state in ('queued','processing'))>=2 or (select count(*) from public.audit_verification_jobs where organization_id=p_organization_id and id<>p_job_id and state in ('queued','processing'))>=10 then raise exception 'verification_queue_full' using errcode='54000'; end if;
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
