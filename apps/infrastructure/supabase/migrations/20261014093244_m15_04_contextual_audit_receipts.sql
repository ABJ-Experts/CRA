-- Diagnostic digests are permitted only in a source-bound diagnostic receipt.
-- Restore every existing caller's generic SHA256/free-string redaction behavior.
do $$ declare d text;branch text;begin
 d:=pg_get_functiondef('public.m13_01_project_v2_audit_json(jsonb)'::regprocedure);
 branch:=E'    elsif v_key in (''selectionDigest'',''previewDigest'',''sha256'') and v_text ~ ''^[a-f0-9]{64}$''\n    then v_result:=v_result||jsonb_build_object(v_key,v_value);\n';
 if position(branch in d)=0 then raise exception 'M15-04 generic diagnostic branch missing';end if;
 execute replace(d,branch,'');
end $$;

create function public.m15_04_audit_receipt_json(p_organization_id uuid,p_entity_id text,p_action text,p_value jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare j public.support_diagnostic_jobs;result jsonb;begin
 if p_action not in ('support.diagnostic.consented','support.diagnostic.cancelled','support.diagnostic.ready','support.diagnostic.failed','support.diagnostic.accessed','support.diagnostic.grant_issued','support.diagnostic.downloaded','support.diagnostic.cleanup_requested','support.diagnostic.cleanup_deleted','support.diagnostic.cleanup_failed')
 or p_entity_id is null or p_entity_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_value is null or jsonb_typeof(p_value)<>'object' then raise exception 'invalid_diagnostic_audit_receipt' using errcode='22023';end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_entity_id::uuid;
 if not found or p_value->>'selectionDigest' is distinct from j.selection_digest or p_value->>'previewDigest' is distinct from j.preview_digest
 or p_value->>'selectionDigest' !~ '^[a-f0-9]{64}$' or p_value->>'previewDigest' !~ '^[a-f0-9]{64}$'
 or p_value->>'reasonCode' is distinct from j.disclosure_version then raise exception 'invalid_diagnostic_audit_binding' using errcode='22023';end if;
 result:=public.m13_01_project_v2_audit_json(p_value)-array['selectionDigest','previewDigest','sha256'];
 result:=result||jsonb_build_object('selectionDigest',j.selection_digest,'previewDigest',j.preview_digest);
 if j.artifact is not null then
  if p_value->>'sha256' is distinct from j.artifact->>'sha256' or p_value->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'invalid_diagnostic_audit_hash' using errcode='22023';end if;
  result:=result||jsonb_build_object('sha256',j.artifact->>'sha256');
 end if;
 return result;
end $$;
revoke all on function public.m15_04_audit_receipt_json(uuid,text,text,jsonb) from public,anon,authenticated,service_role;

-- Append computes exactly the same contextual projection that the insert guard
-- stores, so durable idempotency still compares the complete authoritative row.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)'::regprocedure);
 anchor:='v_after:=public.m13_01_project_v2_audit_json(p_after_redacted);';
 if position(anchor in d)=0 then raise exception 'M15-04 append projection anchor missing';end if;
 execute replace(d,anchor,anchor||E'\n  if p_entity_type=''support_diagnostic'' then v_after:=public.m15_04_audit_receipt_json(p_organization_id,p_entity_id,p_action,p_after_redacted);end if;');
 d:=pg_get_functiondef('public.m13_01_guard_audit_insert()'::regprocedure);
 anchor:='new.after_redacted:=public.m13_01_project_v2_audit_json(new.after_redacted);';
 if position(anchor in d)=0 then raise exception 'M15-04 insert guard projection anchor missing';end if;
 execute replace(d,anchor,E'if new.entity_type=''support_diagnostic'' then new.after_redacted:=public.m15_04_audit_receipt_json(new.organization_id,new.entity_id,new.action,new.after_redacted);else '||anchor||'end if;');
end $$;
