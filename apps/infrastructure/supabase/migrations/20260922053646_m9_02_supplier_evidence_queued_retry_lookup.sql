create or replace function public.get_supplier_evidence_submission_upload_atomic(
  p_session_token_hash text,
  p_version_id uuid
)
returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation_record public.supplier_evidence_invitations%rowtype;
  submission_record public.supplier_evidence_submissions%rowtype;
  version_record public.evidence_document_versions%rowtype;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$' then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  select * into invitation_record
  from public.supplier_evidence_invitations
  where session_token_hash = p_session_token_hash
    and state = 'used'
    and session_expires_at > clock_timestamp()
  for share;
  if not found then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  select submission_row.* into submission_record
  from public.supplier_evidence_submissions submission_row
  join public.supplier_evidence_requests request_row
    on request_row.organization_id = submission_row.organization_id
   and request_row.id = submission_row.request_id
   and request_row.state = 'open'
  where submission_row.organization_id = invitation_record.organization_id
    and submission_row.invitation_id = invitation_record.id
    and submission_row.evidence_version_id = p_version_id
    and submission_row.state in ('uploading', 'scan_pending');
  if not found then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  select * into version_record
  from public.evidence_document_versions
  where organization_id = invitation_record.organization_id
    and id = submission_record.evidence_version_id
    and (
      (processing_state = 'uploading' and upload_expires_at > clock_timestamp())
      or processing_state = 'scan_pending'
    );
  if not found then
    return query select 'conflict', null::jsonb;
    return;
  end if;

  return query select 'found', jsonb_build_object(
    'versionId', version_record.id,
    'objectBucket', version_record.object_bucket,
    'objectKey', version_record.object_key,
    'declaredByteSize', version_record.declared_size_bytes,
    'fileName', version_record.original_filename,
    'expiresAt', version_record.upload_expires_at
  );
end;
$$;

alter function public.get_supplier_evidence_submission_upload_atomic(text, uuid) owner to postgres;
revoke all on function public.get_supplier_evidence_submission_upload_atomic(text, uuid) from public, anon, authenticated;
grant execute on function public.get_supplier_evidence_submission_upload_atomic(text, uuid) to service_role;
notify pgrst, 'reload schema';
