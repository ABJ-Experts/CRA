-- Bind a detected retrieval mismatch to the correlated delivery grant without
-- mislabelling unrelated historical grants.
create or replace function public.record_evidence_document_integrity_failure_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_version_id uuid,
  p_observed_size_bytes bigint, p_observed_media_type text, p_observed_sha256 text,
  p_request_correlation_id uuid
) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.evidence_document_versions%rowtype;
begin
  if p_actor_user_id is null or p_request_correlation_id is null
    or not public.m8_evidence_actor_active(p_organization_id, p_actor_user_id)
  then return 'forbidden'; end if;
  select * into v from public.evidence_document_versions
  where organization_id = p_organization_id and id = p_version_id for update;
  if not found then return 'not_found'; end if;
  if v.processing_state = 'failed' and v.failure_code = 'integrity_mismatch' then return 'replayed'; end if;
  if v.processing_state <> 'clean' then return 'unavailable'; end if;
  update public.evidence_document_versions
  set processing_state = 'failed', failure_code = 'integrity_mismatch'
  where organization_id = p_organization_id and id = v.id;
  update public.evidence_document_access_grants
  set terminal_outcome = 'integrity_failed'
  where organization_id = p_organization_id and version_id = v.id
    and actor_user_id = p_actor_user_id and request_correlation_id = p_request_correlation_id;
  insert into public.evidence_document_notification_outbox(organization_id, version_id, owner_user_id, event_type)
  values (p_organization_id, v.id, v.owner_user_id, 'evidence_integrity_failure') on conflict do nothing;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'evidence.integrity_failure', 'evidence_document_version', v.id::text,
    jsonb_build_object('correlationId', p_request_correlation_id, 'expectedSha256', v.original_sha256,
      'observedSha256', nullif(p_observed_sha256, ''), 'expectedByteSize', v.actual_size_bytes,
      'observedByteSize', p_observed_size_bytes, 'expectedMediaType', v.detected_media_type,
      'observedMediaType', nullif(p_observed_media_type, '')));
  return 'recorded';
end $$;

notify pgrst, 'reload schema';
