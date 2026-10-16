-- M13-04 measured correction: use the existing SECURITY replay index and
-- recheck source scope, supported checkpoint positions, and resumed cursor rows.
create or replace function public.m13_04_security_receipt(p_org uuid,p_actor uuid,p_request uuid,p_action text,p_entity uuid,p_digest text,p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_existing public.audit_logs; begin
 if p_org is null or p_request is null or p_digest !~ '^[0-9a-f]{64}$' or p_action not in ('audit.range.created','audit.range.status_read','audit.range.cancelled','audit.range.resumed','audit.range.claimed','audit.range.checkpoint','audit.range.completed','audit.range.failed','audit.range.denied','audit.range.scope_changed','audit.range.dataset_rotated') then raise exception 'invalid range receipt' using errcode='22023'; end if;
 select * into v_existing from public.audit_logs where schema_version=2 and organization_id is null and event_scope='security' and event_key=p_action||':'||p_request::text;
 if found then
  if v_existing.after_redacted->>'organizationId'<>p_org::text or v_existing.after_redacted->>'operationDigest'<>p_digest or v_existing.actor_id<>coalesce(p_actor::text,'system') then raise exception 'audit_request_conflict' using errcode='23505'; end if;
  return v_existing.id;
 end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version)
 values(null,p_actor,p_action,'audit_verification',p_entity::text,2,'security',p_action||':'||p_request::text,case when p_actor is null then 'system' else 'user' end,coalesce(p_actor::text,'system'),case when p_action='audit.range.denied' then 'denied' when p_action='audit.range.failed' then 'failed' when p_action='audit.range.cancelled' then 'cancelled' else 'completed' end,p_request,jsonb_build_object('organizationId',p_org,'operationDigest',p_digest)||p_extra,1) returning id into v_id;
 return v_id;
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
 if not found or v_epoch<>p_expected_epoch then raise exception 'dataset_marker_conflict' using errcode='40001'; end if;
 perform set_config('cra.audit_dataset_rotation','allowed',true);
 update public.organizations set audit_dataset_epoch=v_new,audit_dataset_context=p_context where id=p_organization_id;
 perform set_config('cra.audit_dataset_rotation','',true);
 perform public.m13_04_security_receipt(p_organization_id,null,p_request_id,'audit.range.dataset_rotated',null,v_digest,jsonb_build_object('rotatedEpoch',v_new));
 return jsonb_build_object('epoch',v_new,'replayed',false);
end $$;

create or replace function public.m13_04_create_verification(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_from_sequence text,p_to_sequence text,p_checkpoint jsonb,p_request_digest text)
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
   if (p_checkpoint->>'sequence')::bigint<greatest(1,p_from_sequence::bigint-1) or (p_checkpoint->>'sequence')::bigint>v_to then raise exception 'unsupported checkpoint position' using errcode='22023'; end if;
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

create or replace function public.m13_04_page_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer,p_after_sequence text,p_upper_sequence text,p_limit integer,p_maximum_bytes integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_row public.audit_logs; v_item jsonb; v_rows jsonb:='[]'; v_bytes bigint:=2; v_last bigint; v_permissions jsonb; begin
 if p_after_sequence is null or p_after_sequence !~ '^(0|[1-9][0-9]{0,18})$' or p_upper_sequence is null or p_upper_sequence !~ '^(0|[1-9][0-9]{0,18})$' or p_after_sequence::numeric>9223372036854775807 or p_upper_sequence::numeric>9223372036854775807 or p_limit is null or p_limit not between 1 and 250 or p_maximum_bytes is null or p_maximum_bytes not between 1 and 16777216 then raise exception 'invalid verification page' using errcode='22023'; end if;
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if not v_job.authorization_complete or public.m13_04_current_scope(v_job) is not null then raise exception 'audit_scope_changed' using errcode='42501'; end if;
 if p_upper_sequence::bigint<>v_job.to_sequence or p_after_sequence::bigint<greatest(0,v_job.from_sequence-1) or p_after_sequence::bigint>v_job.to_sequence then raise exception 'page outside frozen range' using errcode='22023'; end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,v_job.requester_id);
 v_last:=p_after_sequence::bigint;
 for v_row in select * from public.audit_logs where organization_id=p_organization_id and chain_sequence>v_last and chain_sequence<=v_job.to_sequence order by chain_sequence limit p_limit loop
  if not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then raise exception 'audit_scope_changed' using errcode='42501'; end if;
  v_item:=public.m13_04_row_json(v_row);
  if v_bytes+octet_length(v_item::text)>p_maximum_bytes then
   if v_bytes=2 then raise exception 'verification byte limit' using errcode='54000'; end if; exit;
  end if;
  v_rows:=v_rows||jsonb_build_array(v_item); v_bytes:=v_bytes+octet_length(v_item::text)+1; v_last:=v_row.chain_sequence;
 end loop;
 return jsonb_build_object('rows',v_rows,'exhausted',not exists(select 1 from public.audit_logs where organization_id=p_organization_id and chain_sequence>v_last and chain_sequence<=v_job.to_sequence));
end $$;

create or replace function public.m13_04_revalidate_verification(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_lease_token uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.audit_verification_jobs; v_row public.audit_logs; v_permissions jsonb; v_categories text[]:='{}'; v_category text; v_sequence text; v_breaks jsonb; v_samples jsonb; begin
 v_job:=public.m13_04_assert_lease(p_organization_id,p_job_id,p_worker_id,p_lease_token,p_expected_version);
 if public.m13_04_current_scope(v_job) is not null or not v_job.authorization_complete then return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',true,'scopeAvailable',false); end if;
 v_permissions:=public.m13_03_permission_snapshot(p_organization_id,v_job.requester_id);
 -- Re-read the predecessor, so a changed/deleted anchor reaches the kernel's
 -- precise predecessor_failure check instead of an unavailable green fallback.
 if v_job.from_sequence>1 then
  select * into v_row from public.audit_logs where organization_id=p_organization_id and chain_sequence=v_job.from_sequence-1;
  if found and not public.m13_03_event_visible_cached(p_organization_id,v_job.requester_id,v_row,v_permissions) then return jsonb_build_object('job',public.m13_04_private_job(v_job),'anchorsValid',true,'scopeAvailable',false); end if;
  v_job.predecessor:=case when v_row.id is null then null else public.m13_04_row_json(v_row) end;
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
