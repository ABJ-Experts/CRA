-- Receipt replay is independent of today's entitlement, key trust and clock state.
-- Current user authority is still checked and the request is bound to the original audit.
create function public.m15_01_activation_receipt(
 p_organization_id uuid,p_actor_user_id uuid,p_artifact text,p_artifact_digest text,
 p_idempotency_key uuid,p_request_digest text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.audit_logs%rowtype;v_license_id uuid;v_payload text;begin
 if not public.m15_01_actor_can(p_organization_id,p_actor_user_id,'can_manage_licensing') then
  return jsonb_build_object('outcome','forbidden');end if;
 if p_idempotency_key is null or p_artifact is null or octet_length(p_artifact)>32768
 or p_artifact_digest is null or p_request_digest is null
 or p_artifact_digest !~ '^[a-f0-9]{64}$' or p_request_digest !~ '^[a-f0-9]{64}$'
 or encode(extensions.digest(p_artifact,'sha256'),'hex')<>p_artifact_digest
 then raise exception 'invalid_licence_receipt_request' using errcode='22023';end if;
 perform 1 from public.users where id=p_actor_user_id and is_active and email_verified_at is not null for share;
 if not found then return jsonb_build_object('outcome','forbidden');end if;
 perform public.m15_01_lock(p_organization_id);
 if not public.m15_01_actor_can(p_organization_id,p_actor_user_id,'can_manage_licensing') then
  return jsonb_build_object('outcome','forbidden');end if;
 select * into a from public.audit_logs where organization_id=p_organization_id
 and event_key='licensing.activate:'||p_idempotency_key::text;
 if not found then return jsonb_build_object('outcome','absent');end if;
 if a.actor_id is distinct from p_actor_user_id::text
 or a.after_redacted->>'licenseRequestDigest' is distinct from p_request_digest
 or a.after_redacted->>'licenseArtifactDigest' is distinct from p_artifact_digest
 then return jsonb_build_object('outcome','conflict','version',(a.after_redacted->>'version')::integer);end if;
 if a.outcome='denied' then
  return jsonb_strip_nulls(jsonb_build_object('outcome','rejected','version',(a.after_redacted->>'version')::integer,
    'auditId',a.id,'reason',a.reason));end if;
 if a.outcome<>'completed' then raise exception 'invalid_licence_receipt' using errcode='22023';end if;
 v_license_id:=(a.after_redacted->>'artifactId')::uuid;
 if v_license_id is null then
  -- Compatibility for receipts created before this additive migration. The original
  -- successful audit binds the exact artifact bytes; decode only the receipt UUID.
  -- These decoded bytes never authorize capabilities, change state or renew a licence.
  if p_artifact !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
   raise exception 'licence_receipt_identifier_unavailable' using errcode='22023';end if;
  v_payload:=translate(split_part(p_artifact,'.',2),'-_','+/');
  v_payload:=v_payload||repeat('=',(4-length(v_payload)%4)%4);
  v_license_id:=(convert_from(decode(v_payload,'base64'),'UTF8')::jsonb->>'licenseId')::uuid;
 end if;
 if v_license_id is null then raise exception 'licence_receipt_identifier_unavailable' using errcode='22023';end if;
 return jsonb_build_object('outcome','replayed','version',(a.after_redacted->>'version')::integer,
  'auditId',a.id,'licenseId',v_license_id);
end $$;
revoke all on function public.m15_01_activation_receipt(uuid,uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.m15_01_activation_receipt(uuid,uuid,text,text,uuid,text) to service_role;

-- Preserve the deployed activation transaction and its source authority checks.
do $$ declare d text;old_replay text;new_replay text;begin
 d:=pg_get_functiondef('public.m15_01_activate(uuid,uuid,text,text,jsonb,integer,uuid,text,text,text)'::regprocedure);
 old_replay:=$old$return jsonb_build_object('outcome',case when a.outcome='denied' then 'rejected' else 'replayed' end,'version',(a.after_redacted->>'version')::integer,'auditId',a.id);$old$;
 new_replay:=$new$return public.m15_01_activation_receipt(p_organization_id,p_actor_user_id,p_artifact,p_artifact_digest,p_idempotency_key,p_request_digest);$new$;
 if position(old_replay in d)=0
 or position($old$'licenseRequestDigest',p_request_digest,'version',v_version$old$ in d)=0
 or position($old$'version',v_version,'auditId',v_audit);$old$ in d)=0
 then raise exception 'm15_activation_receipt_patch_mismatch';end if;
 d:=replace(d,old_replay,new_replay);
 d:=replace(d,$old$'licenseRequestDigest',p_request_digest,'version',v_version$old$,
   $new$'licenseRequestDigest',p_request_digest,'artifactId',case when p_rejection_reason is null then p_verified_claims->>'licenseId' else null end,'version',v_version$new$);
 d:=replace(d,$old$'version',v_version,'auditId',v_audit);$old$,
   $new$'version',v_version,'auditId',v_audit)||case when p_rejection_reason is null then jsonb_build_object('licenseId',p_verified_claims->>'licenseId') else '{}'::jsonb end;$new$);
 execute d;
end $$;

-- Cover the existing actor foreign key for identity maintenance and planner checks.
create index organization_storage_admissions_actor on public.organization_storage_admissions(actor_user_id);
