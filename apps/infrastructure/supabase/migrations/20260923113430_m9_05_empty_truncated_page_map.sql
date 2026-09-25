-- A truncated extractor may report either null or an empty page array.
-- Both mean that no reliable citation offsets can be persisted, while M8 text
-- and search completion must still succeed.
create or replace function public.complete_evidence_text_extraction_job_atomic(
  p_organization_id uuid,p_worker_id uuid,p_version_id uuid,p_source_sha256 text,
  p_extractor_version text,p_outcome text,p_extracted_text text,p_quality text,
  p_is_truncated boolean,p_failure_code text,p_retry_after_seconds integer,p_page_map jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result_code text; effective_page_map jsonb;
begin
  effective_page_map:=case when coalesce(p_is_truncated,false)
    and p_page_map='[]'::jsonb then null else p_page_map end;
  if p_outcome='complete' and not coalesce(p_is_truncated,false)
    and not public.m9_05_page_map_valid(effective_page_map) then return 'invalid_request'; end if;
  if p_outcome='complete' and effective_page_map is not null
    and not public.m9_05_page_map_valid(effective_page_map) then return 'invalid_request'; end if;
  result_code:=public.complete_evidence_text_extraction_job_atomic(p_organization_id,p_worker_id,p_version_id,
    p_source_sha256,p_extractor_version,p_outcome,p_extracted_text,p_quality,p_is_truncated,
    p_failure_code,p_retry_after_seconds);
  if result_code='completed' and p_outcome='complete' then
    update public.evidence_document_version_texts set page_map=effective_page_map
    where organization_id=p_organization_id and version_id=p_version_id
      and source_sha256=p_source_sha256 and extractor_version=p_extractor_version
      and extraction_status='complete';
  end if;
  return result_code;
end $$;
