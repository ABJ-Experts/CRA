-- A lost completion response is recoverable without a second object upload.
-- The replay branch is reachable only after the session, invitation, request,
-- and immutable evidence version have all been revalidated.
create or replace function public.finalize_supplier_evidence_submission_atomic(
  p_session_token_hash text,
  p_version_id uuid,
  p_actual_size bigint,
  p_media_type text,
  p_sha256 text,
  p_idempotency_key uuid,
  p_request_digest text
)
returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation_record public.supplier_evidence_invitations%rowtype;
  submission_record public.supplier_evidence_submissions%rowtype;
  finalize_result record;
  output_state text;
  output_reason text;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$'
    or p_idempotency_key is null
    or p_request_digest !~ '^[a-f0-9]{64}$' then
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
  for update;
  if not found then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  if submission_record.state = 'scan_pending' then
    return query select 'replayed', jsonb_build_object(
      'submission', jsonb_build_object(
        'id', submission_record.id,
        'checklistItemId', submission_record.request_item_id,
        'state', submission_record.state,
        'fileName', submission_record.original_filename,
        'mediaType', submission_record.declared_media_type,
        'byteSize', submission_record.declared_size_bytes,
        'sha256', submission_record.declared_sha256,
        'rejectionReason', submission_record.supplier_visible_reason,
        'createdAt', to_char(submission_record.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'updatedAt', to_char(submission_record.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    );
    return;
  end if;

  select * into finalize_result
  from public.finalize_evidence_document_upload_atomic(
    invitation_record.organization_id,
    (select internal_owner_user_id
       from public.supplier_evidence_requests
      where organization_id = invitation_record.organization_id
        and id = submission_record.request_id),
    p_version_id,
    p_actual_size,
    p_media_type,
    p_sha256,
    p_idempotency_key,
    p_request_digest
  );
  output_state := case
    when finalize_result.outcome in ('scan_pending', 'replayed') then 'scan_pending'
    when finalize_result.outcome = 'failed' then 'failed'
    else submission_record.state
  end;
  output_reason := case
    when finalize_result.outcome = 'failed'
      then 'Upload could not be verified. Select the file again and retry.'
    else submission_record.supplier_visible_reason
  end;
  update public.supplier_evidence_submissions
  set state = output_state,
      supplier_visible_reason = output_reason,
      updated_at = clock_timestamp()
  where id = submission_record.id;
  return query select
    case
      when finalize_result.outcome = 'scan_pending' then 'queued'
      when finalize_result.outcome = 'failed' then 'rejected'
      else finalize_result.outcome
    end,
    jsonb_build_object(
      'submission', jsonb_build_object(
        'id', submission_record.id,
        'checklistItemId', submission_record.request_item_id,
        'state', output_state,
        'fileName', submission_record.original_filename,
        'mediaType', submission_record.declared_media_type,
        'byteSize', submission_record.declared_size_bytes,
        'sha256', submission_record.declared_sha256,
        'rejectionReason', output_reason,
        'createdAt', to_char(submission_record.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    );
end;
$$;

alter function public.finalize_supplier_evidence_submission_atomic(text, uuid, bigint, text, text, uuid, text) owner to postgres;
revoke all on function public.finalize_supplier_evidence_submission_atomic(text, uuid, bigint, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_supplier_evidence_submission_atomic(text, uuid, bigint, text, text, uuid, text) to service_role;
notify pgrst, 'reload schema';
