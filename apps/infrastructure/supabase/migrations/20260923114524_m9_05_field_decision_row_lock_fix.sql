-- Keep the target row separate from a possible idempotent replay row. The
-- earlier routine reused one record variable and could report success with no
-- field update while inserting an orphaned audit event.
create or replace function public.m9_05_decide_supplier_document_field_core(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_request_id uuid,p_submission_id uuid,
  p_expected_request_version integer,p_expected_submission_updated_at timestamptz,
  p_expected_evidence_version_id uuid,p_expected_sha256 text,
  p_field_id uuid,p_expected_version integer,p_decision text,p_corrected_value text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; target_field public.supplier_document_fields%rowtype;
  replay_field public.supplier_document_fields%rowtype;
  decided_field public.supplier_document_fields%rowtype; decision_digest text;
  request_row public.supplier_evidence_requests%rowtype;
  submission_row public.supplier_evidence_submissions%rowtype;
begin
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if c is null then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_field_id is null or p_request_id is null
    or p_expected_request_version is null or p_expected_submission_updated_at is null
    or p_expected_evidence_version_id is null or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_version is null or p_expected_version<0
    or p_decision is null or p_decision not in ('confirmed','rejected')
    or (p_decision='confirmed' and p_corrected_value is null)
    or (p_decision='rejected' and p_corrected_value is not null)
    or (p_corrected_value is not null and (char_length(p_corrected_value) not between 1 and 2000
      or p_corrected_value~'[[:cntrl:]]')) then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  decision_digest:=encode(extensions.digest(jsonb_build_object('productId',p_product_id,'requestId',p_request_id,
    'submissionId',p_submission_id,'expectedRequestVersion',p_expected_request_version,
    'expectedSubmissionUpdatedAt',p_expected_submission_updated_at,
    'expectedEvidenceVersionId',p_expected_evidence_version_id,'expectedSha256',p_expected_sha256,
    'fieldId',p_field_id,'expectedVersion',p_expected_version,
    'decision',p_decision,'correctedValue',p_corrected_value)::text,'sha256'),'hex');
  select * into replay_field from public.supplier_document_fields
  where organization_id=p_organization_id and reviewed_by_user_id=p_actor_user_id
    and idempotency_key=p_idempotency_key;
  if found then
    return query select case when replay_field.id=p_field_id and replay_field.request_digest=decision_digest
      then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('field',public.m9_05_field_json(p_organization_id,replay_field.id));
    return;
  end if;

  select * into target_field from public.supplier_document_fields
    where organization_id=p_organization_id and id=p_field_id and submission_id=p_submission_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  select * into request_row from public.supplier_evidence_requests
    where organization_id=p_organization_id and id=p_request_id and product_id=p_product_id for update;
  select * into submission_row from public.supplier_evidence_submissions
    where organization_id=p_organization_id and id=p_submission_id and request_id=p_request_id for update;
  select * into replay_field from public.supplier_document_fields
    where organization_id=p_organization_id and reviewed_by_user_id=p_actor_user_id
      and idempotency_key=p_idempotency_key;
  if found then
    return query select case when replay_field.id=p_field_id and replay_field.request_digest=decision_digest
      then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('field',public.m9_05_field_json(p_organization_id,replay_field.id));
    return;
  end if;
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if request_row.id is null or submission_row.id is null or c is null
    or not (c->>'accepted')::boolean or not (c->>'current')::boolean
    or c->>'requestId'<>p_request_id::text or request_row.version<>p_expected_request_version
    or submission_row.updated_at<>p_expected_submission_updated_at
    or c->>'evidenceVersionId'<>p_expected_evidence_version_id::text
    or c->>'evidenceSha256'<>p_expected_sha256
    or target_field.evidence_version_id::text<>c->>'evidenceVersionId'
    or target_field.evidence_sha256<>c->>'evidenceSha256'
    or target_field.status<>'pending' or target_field.version<>p_expected_version then
    return query select 'conflict',jsonb_build_object(
      'field',public.m9_05_field_json(p_organization_id,target_field.id));
    return;
  end if;
  if not public.m9_03_internal_can_review(p_organization_id,p_actor_user_id) then
    return query select 'forbidden',null::jsonb; return;
  end if;
  update public.supplier_document_fields set status=p_decision,corrected_value=p_corrected_value,
    version=version+1,reviewed_by_user_id=p_actor_user_id,reviewed_at=clock_timestamp(),
    idempotency_key=p_idempotency_key,request_digest=decision_digest
  where organization_id=p_organization_id and id=target_field.id
    and status='pending' and version=p_expected_version returning * into decided_field;
  if not found then raise exception 'field decision write affected no row'; end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'supplier.document_field_'||p_decision,
      'supplier_document_field',decided_field.id::text,
      jsonb_build_object('submissionId',p_submission_id,'evidenceVersionId',decided_field.evidence_version_id,
        'evidenceSha256',decided_field.evidence_sha256,'fieldKey',decided_field.field_key,
        'originalValue',decided_field.original_value,'correctedValue',p_corrected_value,
        'sourceSpan',decided_field.source_span,'idempotencyKey',p_idempotency_key));
  return query select p_decision,jsonb_build_object(
    'field',public.m9_05_field_json(p_organization_id,decided_field.id));
end $$;

revoke all on function public.m9_05_decide_supplier_document_field_core(
  uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid
) from public,anon,authenticated,service_role;
