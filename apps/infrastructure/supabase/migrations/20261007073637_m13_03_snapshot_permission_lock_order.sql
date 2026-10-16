-- Role writers can hold the audit lock before their RBAC version trigger runs.
-- A snapshot must not hold a conflicting version-row lock while waiting for
-- that same tenant audit lock. Preserve existing signatures, grants, receipts
-- and canonical bytes; scope changes still invalidate subsequent access.
create or replace function public.m13_03_create_snapshot(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_filter_digest text,p_scope_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.audit_logs; v_head bigint; v_version bigint; v_metadata jsonb; begin
 if p_request_id is null or p_filter_digest is null or p_filter_digest !~ '^[a-f0-9]{64}$' or p_scope_digest is null or p_scope_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid snapshot' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 -- Plain MVCC reads avoid a version-row lock while owning the audit lock.
 -- Current authorization and subsequent snapshot-version checks remain mandatory.
 select version into v_version from public.organization_permissions_version where organization_id=p_organization_id;
 if not public.m13_03_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501'; end if;
 select * into v_row from public.audit_logs where organization_id=p_organization_id and event_key='audit.search:'||p_request_id::text;
 if found then
  if v_row.actor_id<>p_actor_user_id::text or v_row.after_redacted->>'filterDigest'<>p_filter_digest or v_row.after_redacted->>'scopeDigest'<>p_scope_digest then raise exception 'audit_request_conflict' using errcode='23505'; end if;
 else
  select coalesce(last_sequence,0) into v_head from public.audit_chain_heads where organization_id=p_organization_id;
  v_metadata:=jsonb_build_object('filterDigest',p_filter_digest,'scopeDigest',p_scope_digest,'highWaterSequence',coalesce(v_head,0)::text,'scopeVersion',coalesce(v_version,0),'expiresAt',to_char((clock_timestamp()+interval '30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,schema_version,event_scope,event_key,actor_type,actor_id,outcome,correlation_id,changes,redaction_version) values(p_organization_id,p_actor_user_id,'audit.search.created','audit_search',p_request_id::text,2,'organization','audit.search:'||p_request_id::text,'user',p_actor_user_id::text,'completed',p_request_id,v_metadata,1) returning * into v_row;
 end if;
 return jsonb_build_object('receiptId',v_row.id,'highWaterSequence',v_row.after_redacted->>'highWaterSequence','expiresAt',v_row.after_redacted->>'expiresAt','filterDigest',p_filter_digest,'scopeDigest',p_scope_digest,'scopeVersion',(v_row.after_redacted->>'scopeVersion')::bigint);
end $$;
