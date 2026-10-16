-- Replace the unbounded read with a scoped, keyset-paginated projection.
-- The four-argument API call still works through defaults. Page text is
-- clipped only in the response; stored OCR evidence and citations remain full.
drop function public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid);

create function public.get_supplier_document_extraction_atomic(
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
    and submission_id=p_submission_id order by created_at desc,id desc limit 1;
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

revoke all on function public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid,text,integer)
  to service_role;
