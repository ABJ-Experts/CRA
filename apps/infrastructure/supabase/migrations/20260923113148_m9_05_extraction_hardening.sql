-- M9-05 corrective migration. Preserve successful M8 text even when a
-- truncated extraction cannot carry trustworthy page offsets.
create or replace function public.complete_evidence_text_extraction_job_atomic(
  p_organization_id uuid,p_worker_id uuid,p_version_id uuid,p_source_sha256 text,
  p_extractor_version text,p_outcome text,p_extracted_text text,p_quality text,
  p_is_truncated boolean,p_failure_code text,p_retry_after_seconds integer,p_page_map jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result_code text;
begin
  if p_outcome='complete' and not coalesce(p_is_truncated,false)
    and not public.m9_05_page_map_valid(p_page_map) then return 'invalid_request'; end if;
  if p_outcome='complete' and p_page_map is not null
    and not public.m9_05_page_map_valid(p_page_map) then return 'invalid_request'; end if;
  result_code:=public.complete_evidence_text_extraction_job_atomic(p_organization_id,p_worker_id,p_version_id,
    p_source_sha256,p_extractor_version,p_outcome,p_extracted_text,p_quality,p_is_truncated,
    p_failure_code,p_retry_after_seconds);
  if result_code='completed' and p_outcome='complete' then
    update public.evidence_document_version_texts set page_map=p_page_map
    where organization_id=p_organization_id and version_id=p_version_id
      and source_sha256=p_source_sha256 and extractor_version=p_extractor_version
      and extraction_status='complete';
  end if;
  return result_code;
end $$;

-- The displayed run must be pinned to the currently attached clean evidence,
-- just like each suggestion and each displayed page.
create or replace function public.get_supplier_document_extraction_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_submission_id uuid,
  p_cursor text default null,p_limit integer default 25
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; r public.ai_inference_runs%rowtype; cursor_row public.supplier_document_fields%rowtype;
  suggestion_rows jsonb; row_count integer; next_cursor text;
begin
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if c is null then return query select 'forbidden',null::jsonb; return; end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_cursor is not null and p_cursor !~ '^[0-9]{20}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  if p_cursor is not null then
    select * into cursor_row from public.supplier_document_fields f where f.organization_id=p_organization_id
      and f.submission_id=p_submission_id and f.evidence_version_id=(c->>'evidenceVersionId')::uuid
      and f.evidence_sha256=c->>'evidenceSha256' and f.id=right(p_cursor,36)::uuid;
    if not found or p_cursor<>to_char(cursor_row.created_at at time zone 'UTC','YYYYMMDDHH24MISSUS')||':'||cursor_row.id::text then
      return query select 'invalid_request',null::jsonb; return;
    end if;
  end if;
  select * into r from public.ai_inference_runs where organization_id=p_organization_id
    and submission_id=p_submission_id and evidence_version_id=(c->>'evidenceVersionId')::uuid
    and evidence_sha256=c->>'evidenceSha256' order by created_at desc,id desc limit 1;
  with page as (
    select f.id,f.created_at from public.supplier_document_fields f
    where f.organization_id=p_organization_id and f.submission_id=p_submission_id
      and f.evidence_version_id=(c->>'evidenceVersionId')::uuid and f.evidence_sha256=c->>'evidenceSha256'
      and (p_cursor is null or (f.created_at,f.id)<(cursor_row.created_at,cursor_row.id))
    order by f.created_at desc,f.id desc limit p_limit+1
  ), numbered as (
    select page.id,page.created_at,row_number() over(order by page.created_at desc,page.id desc) rn from page
  ) select count(*)::integer,
    coalesce(jsonb_agg(public.m9_05_field_json(p_organization_id,n.id)
      order by n.created_at desc,n.id desc) filter(where n.rn<=p_limit),'[]'::jsonb)
    into row_count,suggestion_rows from numbered n;
  if row_count>p_limit then
    next_cursor:=to_char(((suggestion_rows->(p_limit-1))->>'createdAt')::timestamptz at time zone 'UTC',
      'YYYYMMDDHH24MISSUS')||':'||((suggestion_rows->(p_limit-1))->>'id');
  end if;
  return query select 'found',jsonb_build_object(
    'run',case when r.id is null then null else public.m9_05_run_json(p_organization_id,r.id) end,
    'suggestions',suggestion_rows,
    'pages',case when p_cursor is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('page',page_row->'page','text',left(page_row->>'text',25000))
        order by (page_row->>'page')::integer)
      from public.evidence_document_version_texts t,
        lateral jsonb_array_elements(t.page_map) page_row
      where t.organization_id=p_organization_id and t.version_id=(c->>'evidenceVersionId')::uuid
        and t.source_sha256=c->>'evidenceSha256' and t.extraction_status='complete'
    ),'[]'::jsonb) end,
    'nextCursor',next_cursor);
end $$;

-- Keep the existing audited, lock-aware decision routine intact; remove its
-- direct grant and expose a wrapper that enforces the confidence floor at the
-- database boundary. It is intentionally unavailable to ordinary sessions.
alter function public.decide_supplier_document_field_atomic(
  uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid
) rename to m9_05_decide_supplier_document_field_core;
revoke all on function public.m9_05_decide_supplier_document_field_core(
  uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid
) from public,anon,authenticated,service_role;

create function public.decide_supplier_document_field_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_request_id uuid,p_submission_id uuid,
  p_expected_request_version integer,p_expected_submission_updated_at timestamptz,
  p_expected_evidence_version_id uuid,p_expected_sha256 text,
  p_field_id uuid,p_expected_version integer,p_decision text,p_corrected_value text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; f public.supplier_document_fields%rowtype;
begin
  if p_decision='confirmed' then
    c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
    if c is not null and (c->>'accepted')::boolean and (c->>'current')::boolean
      and c->>'requestId'=p_request_id::text
      and c->>'evidenceVersionId'=p_expected_evidence_version_id::text
      and c->>'evidenceSha256'=p_expected_sha256 then
      select * into f from public.supplier_document_fields
      where organization_id=p_organization_id and submission_id=p_submission_id
        and id=p_field_id and evidence_version_id=p_expected_evidence_version_id
        and evidence_sha256=p_expected_sha256 and status='pending'
        and version=p_expected_version and run_id is not null and confidence<0.8;
      if found then
        return query select 'low_confidence',jsonb_build_object(
          'field',public.m9_05_field_json(p_organization_id,f.id));
        return;
      end if;
    end if;
  end if;
  return query select d.outcome,d.result from public.m9_05_decide_supplier_document_field_core(
    p_organization_id,p_actor_user_id,p_product_id,p_request_id,p_submission_id,
    p_expected_request_version,p_expected_submission_updated_at,p_expected_evidence_version_id,p_expected_sha256,
    p_field_id,p_expected_version,p_decision,p_corrected_value,p_idempotency_key) d;
end $$;

revoke all on function public.decide_supplier_document_field_atomic(
  uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.decide_supplier_document_field_atomic(
  uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid
) to service_role;
