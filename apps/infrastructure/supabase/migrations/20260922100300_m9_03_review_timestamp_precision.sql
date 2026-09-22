-- M9-03 returns submission.updatedAt as the exact optimistic-concurrency
-- token consumed by review_supplier_evidence_submission_atomic. The original
-- renderer rounded to seconds while Postgres comparisons retain microseconds,
-- making every normal browser review conflict.

create or replace function public.m9_03_submission_json(
  p_organization_id uuid, p_submission_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', submission_row.id,
    'checklistItemId', submission_row.request_item_id,
    'revisionId', submission_row.revision_id,
    'state', submission_row.state,
    'fileName', submission_row.original_filename,
    'mediaType', submission_row.declared_media_type,
    'byteSize', submission_row.declared_size_bytes,
    'sha256', submission_row.declared_sha256,
    'evidenceDocumentId', submission_row.evidence_document_id,
    'evidenceVersionId', submission_row.evidence_version_id,
    'processingState', version_row.processing_state,
    'evidenceProcessingState', version_row.processing_state,
    'reviewState', coalesce((
      select review_row.decision
      from public.supplier_evidence_submission_reviews review_row
      where review_row.organization_id = p_organization_id and review_row.submission_id = submission_row.id
    ), case
      when submission_row.state = 'submitted_pending_review' then 'pending'
      when submission_row.state = 're_requested' then 're_requested'
      else null
    end),
    'rejectionReason', submission_row.supplier_visible_reason,
    'reviews', coalesce((
      select jsonb_agg(public.m9_03_review_json(p_organization_id, review_row.id, true) order by review_row.created_at, review_row.id)
      from public.supplier_evidence_submission_reviews review_row
      where review_row.organization_id = p_organization_id and review_row.submission_id = submission_row.id
    ), '[]'::jsonb),
    'createdAt', to_char(submission_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updatedAt', to_char(submission_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  from public.supplier_evidence_submissions submission_row
  join public.evidence_document_versions version_row
    on version_row.organization_id = submission_row.organization_id
   and version_row.id = submission_row.evidence_version_id
  where submission_row.organization_id = p_organization_id and submission_row.id = p_submission_id
$$;

alter function public.m9_03_submission_json(uuid, uuid) owner to postgres;
revoke all on function public.m9_03_submission_json(uuid, uuid) from public, anon, authenticated;
grant execute on function public.m9_03_submission_json(uuid, uuid) to service_role;
