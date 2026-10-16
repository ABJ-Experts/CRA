-- Continue from the last returned row, not the lookahead row. All page rows,
-- lookahead detection and cursor selection share one bounded SQL snapshot.
create or replace function public.list_sbom_sources_for_release(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid,
  p_release_id uuid, p_limit integer, p_cursor text
) returns table(outcome text, sources jsonb, next_cursor text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
begin
  if p_limit is null or p_limit not between 1 and 100
    or not public.m2_active_member(p_organization_id, p_actor_user_id)
    or not exists(select 1 from public.product_releases releases
      where releases.organization_id=p_organization_id and releases.product_id=p_product_id
        and releases.id=p_release_id) then
    return query select 'not_found'::text,null::jsonb,null::text; return;
  end if;
  if p_cursor is not null then
    begin
      if coalesce(array_length(string_to_array(p_cursor,'|'),1),0)<>2 then
        raise exception 'invalid cursor';
      end if;
      v_cursor_created_at:=split_part(p_cursor,'|',1)::timestamptz;
      v_cursor_id:=split_part(p_cursor,'|',2)::uuid;
      if not isfinite(v_cursor_created_at) then raise exception 'invalid cursor'; end if;
    exception when others then
      return query select 'invalid_request'::text,null::jsonb,null::text; return;
    end;
  end if;
  return query
  with page as materialized (
    select source_rows.id,source_rows.created_at from public.sbom_sources source_rows
    where source_rows.organization_id=p_organization_id and source_rows.product_id=p_product_id
      and source_rows.release_id=p_release_id
      and(p_cursor is null or(source_rows.created_at,source_rows.id)<(v_cursor_created_at,v_cursor_id))
    order by source_rows.created_at desc,source_rows.id desc limit p_limit+1
  ), included as materialized (
    select page.id,page.created_at from page order by page.created_at desc,page.id desc limit p_limit
  )
  select 'found'::text,coalesce(jsonb_agg(jsonb_build_object(
      'source',public.sbom_source_json(p_organization_id,listed.id),
      'validation',public.sbom_validation_summary_json(p_organization_id,listed.id))
      order by listed.created_at desc,listed.id desc),'[]'::jsonb),
    case when(select count(*) from page)>p_limit then
      (select last_row.created_at::text||'|'||last_row.id::text from included last_row
        order by last_row.created_at desc,last_row.id desc offset p_limit-1 limit 1)
      else null::text end
  from included listed;
end $$;
revoke all on function public.list_sbom_sources_for_release(uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.list_sbom_sources_for_release(uuid,uuid,uuid,uuid,integer,text) to service_role;
-- Supplier catalog paging uses existing order: created_at DESC, id ASC.
-- Keep invitation/submission arrays complete within each included request.
create or replace function public.list_supplier_sbom_requests(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_release_id uuid,
  p_state text,p_limit integer,p_cursor text
) returns table(outcome text,requests jsonb,next_cursor text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_created timestamptz; v_id uuid;
begin
  if p_limit is null or p_limit not between 1 and 100
    or(p_state is not null and p_state not in('open','closed','revoked'))
    or not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb,null::text; return;
  end if;
  if p_cursor is not null then
    begin
      if coalesce(array_length(string_to_array(p_cursor,'|'),1),0)<>2 then raise exception 'invalid cursor'; end if;
      v_created:=split_part(p_cursor,'|',1)::timestamptz; v_id:=split_part(p_cursor,'|',2)::uuid;
      if not isfinite(v_created) then raise exception 'invalid cursor'; end if;
    exception when others then return query select 'invalid_request'::text,null::jsonb,null::text; return; end;
  end if;
  return query with page as materialized (
    select r.id,r.created_at from public.sbom_supplier_requests r
    where r.organization_id=p_organization_id and(p_product_id is null or r.product_id=p_product_id)
      and(p_release_id is null or r.release_id=p_release_id)and(p_state is null or r.status=p_state)
      and(p_cursor is null or r.created_at<v_created or(r.created_at=v_created and r.id>v_id))
    order by r.created_at desc,r.id asc limit p_limit+1
  ),included as materialized (
    select p.id,p.created_at from page p order by p.created_at desc,p.id asc limit p_limit
  )
  select 'found'::text,coalesce(jsonb_agg(jsonb_build_object(
    'request',public.sbom_supplier_request_json(p_organization_id,r.id),
    'invitations',coalesce((select jsonb_agg(public.sbom_supplier_invitation_json(p_organization_id,i.id) order by i.created_at desc)
      from public.sbom_supplier_invitations i where i.organization_id=p_organization_id and i.request_id=r.id),'[]'::jsonb),
    'submissions',coalesce((select jsonb_agg(public.sbom_supplier_submission_json(p_organization_id,s.id) order by s.created_at desc)
      from public.sbom_supplier_submissions s where s.organization_id=p_organization_id and s.request_id=r.id),'[]'::jsonb))
    order by r.created_at desc,r.id asc),'[]'::jsonb),
    case when(select count(*) from page)>p_limit then
      (select last_row.created_at::text||'|'||last_row.id::text from included last_row
        order by last_row.created_at desc,last_row.id asc offset p_limit-1 limit 1)
      else null::text end
  from included r;
end $$;
create or replace function public.list_supplier_sbom_submissions(
  p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_state text,p_limit integer,p_cursor text
) returns table(outcome text,submissions jsonb,next_cursor text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_created timestamptz; v_id uuid;
begin
  if p_limit is null or p_limit not between 1 and 100
    or(p_state is not null and p_state not in('pending','processing','validation_failed','awaiting_review','accepted','rejected','superseded'))
    or not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb,null::text; return;
  end if;
  if p_cursor is not null then
    begin
      if coalesce(array_length(string_to_array(p_cursor,'|'),1),0)<>2 then raise exception 'invalid cursor'; end if;
      v_created:=split_part(p_cursor,'|',1)::timestamptz; v_id:=split_part(p_cursor,'|',2)::uuid;
      if not isfinite(v_created) then raise exception 'invalid cursor'; end if;
    exception when others then return query select 'invalid_request'::text,null::jsonb,null::text; return; end;
  end if;
  return query with page as materialized (
    select s.id,s.created_at from public.sbom_supplier_submissions s
    where s.organization_id=p_organization_id and(p_request_id is null or s.request_id=p_request_id)
      and(p_state is null or s.status=p_state)
      and(p_cursor is null or s.created_at<v_created or(s.created_at=v_created and s.id>v_id))
    order by s.created_at desc,s.id asc limit p_limit+1
  ),included as materialized (
    select p.id,p.created_at from page p order by p.created_at desc,p.id asc limit p_limit
  )
  select 'found'::text,coalesce(jsonb_agg(public.sbom_supplier_submission_json(p_organization_id,s.id)
    order by s.created_at desc,s.id asc),'[]'::jsonb),
    case when(select count(*) from page)>p_limit then
      (select last_row.created_at::text||'|'||last_row.id::text from included last_row
        order by last_row.created_at desc,last_row.id asc offset p_limit-1 limit 1)
      else null::text end
  from included s;
end $$;
revoke all on function public.list_supplier_sbom_requests(uuid,uuid,uuid,uuid,text,integer,text),
 public.list_supplier_sbom_submissions(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.list_supplier_sbom_requests(uuid,uuid,uuid,uuid,text,integer,text),
 public.list_supplier_sbom_submissions(uuid,uuid,uuid,text,integer,text) to service_role;
