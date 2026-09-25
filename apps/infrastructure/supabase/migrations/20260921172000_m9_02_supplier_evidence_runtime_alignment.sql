-- M9-02 follow-up: reconcile the first local deployment and remove PL/pgSQL
-- ambiguity/volatility errors without changing persistent data.

create or replace function public.m9_02_validate_draft(p_organization_id uuid,p_actor_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item_value jsonb; v_supplier uuid; v_contact uuid; v_product uuid; v_owner uuid; v_due timestamptz; v_items jsonb; v_disclosure jsonb; v_title text; v_instructions text;
begin
 if jsonb_typeof(p_payload)<>'object' then return null; end if;
 begin v_supplier:=(p_payload->>'supplierId')::uuid; v_contact:=(p_payload->>'recipientContactId')::uuid; v_product:=(p_payload->>'productId')::uuid; v_owner:=(p_payload->>'ownerUserId')::uuid; v_due:=(p_payload->>'dueAt')::timestamptz; exception when others then return null; end;
 v_title:=p_payload->>'title'; v_instructions:=coalesce(p_payload->>'instructions',''); v_items:=p_payload->'items'; v_disclosure:=jsonb_build_object('content',nullif(p_payload->>'disclosureContent',''));
 if v_title is null or v_title<>btrim(v_title) or char_length(v_title) not between 1 and 160 or v_title~'[[:cntrl:]]' or char_length(v_instructions)>10000 or v_instructions~'[[:cntrl:]]' or v_due<=clock_timestamp() or jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items) not between 1 and 25 or octet_length(v_disclosure::text)>32768 then return null; end if;
 if not exists(select 1 from public.supplier_organizations supplier_record where supplier_record.organization_id=p_organization_id and supplier_record.id=v_supplier and supplier_record.archived_at is null)
  or not exists(select 1 from public.supplier_contacts contact_record where contact_record.organization_id=p_organization_id and contact_record.id=v_contact and contact_record.supplier_id=v_supplier and contact_record.archived_at is null and contact_record.email is not null)
  or not exists(select 1 from public.products product_record where product_record.organization_id=p_organization_id and product_record.id=v_product and product_record.archived_at is null)
  or not exists(select 1 from public.organization_members membership join public.users user_record on user_record.id=membership.user_id and user_record.is_active where membership.organization_id=p_organization_id and membership.user_id=v_owner) then return null; end if;
 for item_value in select element.value from jsonb_array_elements(v_items) as element(value) loop
   if item_value->>'title' is null or item_value->>'title'<>btrim(item_value->>'title') or char_length(item_value->>'title') not between 1 and 160 or item_value->>'title'~'[[:cntrl:]]' or coalesce(item_value->>'documentClass','') not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other') or (item_value ? 'instructions' and (item_value->>'instructions'<>btrim(item_value->>'instructions') or char_length(item_value->>'instructions')>2000 or item_value->>'instructions'~'[[:cntrl:]]')) then return null; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('title',element.value->>'title','instructions',coalesce(element.value->>'instructions',''),'documentClass',element.value->>'documentClass') order by element.ordinality) into v_items from jsonb_array_elements(v_items) with ordinality as element(value,ordinality);
 return jsonb_build_object('supplierId',v_supplier,'recipientContactId',v_contact,'productId',v_product,'ownerUserId',v_owner,'title',v_title,'instructions',v_instructions,'dueAt',to_char(v_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'disclosurePayload',v_disclosure,'items',v_items);
end $$;

create or replace function public.get_supplier_evidence_portal_request_atomic(p_session_token_hash text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation_record public.supplier_evidence_invitations%rowtype; request_record public.supplier_evidence_requests%rowtype;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' then return query select 'not_found',null::jsonb; return; end if;
 select * into invitation_record from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into request_record from public.supplier_evidence_requests where organization_id=invitation_record.organization_id and id=invitation_record.request_id and state='open';
 if not found then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',public.m9_02_portal_json(invitation_record.organization_id,invitation_record.id);
end $$;

create or replace function public.revise_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_payload jsonb,p_expected_version integer,p_preview_fingerprint text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare request_record public.supplier_evidence_requests%rowtype; draft jsonb; digest text; revision_id uuid; previous_command public.supplier_evidence_request_commands%rowtype;
begin
 if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if;
 draft:=public.m9_02_validate_draft(p_organization_id,p_actor_user_id,p_payload);
 if p_idempotency_key is null or p_preview_fingerprint !~ '^[a-f0-9]{64}$' or draft is null then return query select 'invalid_request',null::jsonb; return; end if;
 digest:=encode(extensions.digest(draft::text,'sha256'),'hex');
 if digest<>p_preview_fingerprint then return query select 'conflict',jsonb_build_object('previewFingerprint',digest); return; end if;
 select * into previous_command from public.supplier_evidence_request_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then return query select case when previous_command.operation='revise' and previous_command.request_digest=digest then 'replayed' else 'idempotency_conflict' end,previous_command.result; return; end if;
 select * into request_record from public.supplier_evidence_requests where organization_id=p_organization_id and id=p_request_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if request_record.state<>'draft' or request_record.version<>p_expected_version then return query select 'conflict',public.m9_02_request_json(p_organization_id,request_record.id); return; end if;
 update public.supplier_evidence_requests request_row set supplier_id=(draft->>'supplierId')::uuid,recipient_contact_id=(draft->>'recipientContactId')::uuid,recipient_name=contact_record.name,recipient_email=contact_record.email,product_id=(draft->>'productId')::uuid,internal_owner_user_id=(draft->>'ownerUserId')::uuid,version=request_row.version+1,updated_at=clock_timestamp() from public.supplier_contacts contact_record where contact_record.organization_id=p_organization_id and contact_record.id=(draft->>'recipientContactId')::uuid and request_row.organization_id=p_organization_id and request_row.id=request_record.id;
 revision_id:=public.m9_02_insert_revision(p_organization_id,p_actor_user_id,request_record.id,draft);
 update public.supplier_evidence_requests set current_revision_id=revision_id where organization_id=p_organization_id and id=request_record.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_request_revised','supplier_evidence_request',request_record.id::text,jsonb_build_object('revisionId',revision_id,'disclosureDigest',encode(extensions.digest((draft->'disclosurePayload')::text,'sha256'),'hex')));
 insert into public.supplier_evidence_request_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'revise',digest,public.m9_02_request_json(p_organization_id,request_record.id));
 return query select 'revised',public.m9_02_request_json(p_organization_id,request_record.id);
end $$;

create or replace function public.get_supplier_evidence_submission_upload_atomic(p_session_token_hash text,p_version_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation_record public.supplier_evidence_invitations%rowtype; submission_record public.supplier_evidence_submissions%rowtype; version_record public.evidence_document_versions%rowtype;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' then return query select 'not_found',null::jsonb; return; end if;
 select * into invitation_record from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select submission_row.* into submission_record from public.supplier_evidence_submissions submission_row join public.supplier_evidence_requests request_row on request_row.organization_id=submission_row.organization_id and request_row.id=submission_row.request_id and request_row.state='open' where submission_row.organization_id=invitation_record.organization_id and submission_row.invitation_id=invitation_record.id and submission_row.evidence_version_id=p_version_id and submission_row.state='uploading';
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into version_record from public.evidence_document_versions where organization_id=invitation_record.organization_id and id=submission_record.evidence_version_id and processing_state='uploading' and upload_expires_at>clock_timestamp();
 if not found then return query select 'conflict',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('versionId',version_record.id,'objectBucket',version_record.object_bucket,'objectKey',version_record.object_key,'declaredByteSize',version_record.declared_size_bytes,'fileName',version_record.original_filename,'expiresAt',version_record.upload_expires_at);
end $$;

create or replace function public.finalize_supplier_evidence_submission_atomic(p_session_token_hash text,p_version_id uuid,p_actual_size bigint,p_media_type text,p_sha256 text,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation_record public.supplier_evidence_invitations%rowtype; submission_record public.supplier_evidence_submissions%rowtype; finalize_result record; output_state text; output_reason text;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then return query select 'not_found',null::jsonb; return; end if;
 select * into invitation_record from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select submission_row.* into submission_record from public.supplier_evidence_submissions submission_row join public.supplier_evidence_requests request_row on request_row.organization_id=submission_row.organization_id and request_row.id=submission_row.request_id and request_row.state='open' where submission_row.organization_id=invitation_record.organization_id and submission_row.invitation_id=invitation_record.id and submission_row.evidence_version_id=p_version_id and submission_row.idempotency_key=p_idempotency_key for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into finalize_result from public.finalize_evidence_document_upload_atomic(invitation_record.organization_id,(select internal_owner_user_id from public.supplier_evidence_requests where organization_id=invitation_record.organization_id and id=submission_record.request_id),p_version_id,p_actual_size,p_media_type,p_sha256,p_idempotency_key,p_request_digest);
 output_state:=case when finalize_result.outcome in ('scan_pending','replayed') then 'scan_pending' when finalize_result.outcome='failed' then 'failed' else submission_record.state end;
 output_reason:=case when finalize_result.outcome='failed' then 'Upload could not be verified. Select the file again and retry.' else submission_record.supplier_visible_reason end;
 update public.supplier_evidence_submissions set state=output_state,supplier_visible_reason=output_reason,updated_at=clock_timestamp() where id=submission_record.id;
 return query select case when finalize_result.outcome='scan_pending' then 'queued' when finalize_result.outcome='failed' then 'rejected' else finalize_result.outcome end,jsonb_build_object('submission',jsonb_build_object('id',submission_record.id,'checklistItemId',submission_record.request_item_id,'state',output_state,'fileName',submission_record.original_filename,'mediaType',submission_record.declared_media_type,'byteSize',submission_record.declared_size_bytes,'sha256',submission_record.declared_sha256,'rejectionReason',output_reason,'createdAt',to_char(submission_record.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

alter function public.m9_02_validate_draft(uuid,uuid,jsonb) owner to postgres;
alter function public.revise_supplier_evidence_request_atomic(uuid,uuid,uuid,jsonb,integer,text,uuid) owner to postgres;
alter function public.get_supplier_evidence_portal_request_atomic(text) owner to postgres;
alter function public.get_supplier_evidence_submission_upload_atomic(text,uuid) owner to postgres;
alter function public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text) owner to postgres;
revoke all on function public.m9_02_validate_draft(uuid,uuid,jsonb),public.revise_supplier_evidence_request_atomic(uuid,uuid,uuid,jsonb,integer,text,uuid),public.get_supplier_evidence_portal_request_atomic(text),public.get_supplier_evidence_submission_upload_atomic(text,uuid),public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.revise_supplier_evidence_request_atomic(uuid,uuid,uuid,jsonb,integer,text,uuid),public.get_supplier_evidence_portal_request_atomic(text),public.get_supplier_evidence_submission_upload_atomic(text,uuid),public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text) to service_role;
notify pgrst,'reload schema';
