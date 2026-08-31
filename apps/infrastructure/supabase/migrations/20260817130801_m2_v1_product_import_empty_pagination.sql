-- Keep empty paged responses compatible with the shared pagination contract:
-- an empty collection still has one logical page.
create or replace function public.list_product_import_jobs(
  p_organization_id uuid,p_actor_user_id uuid,p_status text,p_page integer,p_page_size integer
) returns table(outcome text,imports jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb; return; end if;
  if p_page not between 1 and 100000 or p_page_size not between 1 and 100 or
     (p_status is not null and p_status not in (
       'queued','parsing','validating','dry_run_completed','dry_run_failed','committing',
       'retrying','dead_letter','stale_conflict','canceled','expired','completed'
     )) then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select count(*) into v_total from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and (p_status is null or jobs.status=p_status);
  select coalesce(jsonb_agg(public.product_import_job_json(p_organization_id,page.id)
    order by page.created_at desc,page.id desc),'[]'::jsonb) into v_rows from (
    select jobs.id,jobs.created_at from public.product_import_jobs jobs
    where jobs.organization_id=p_organization_id and (p_status is null or jobs.status=p_status)
    order by jobs.created_at desc,jobs.id desc limit p_page_size offset ((p_page-1)*p_page_size)
  ) page;
  return query select 'found'::text,jsonb_build_object(
    'rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,
    'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer));
end;
$$;

create or replace function public.list_product_import_rows(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,p_result text,
  p_page integer,p_page_size integer
) returns table(outcome text,rows jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(
    select 1 from public.product_import_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_import_id
  ) then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_page not between 1 and 100000 or p_page_size not between 1 and 100 or
     (p_result is not null and p_result not in ('planned','committed','failed','skipped')) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  select count(*) into v_total from public.product_import_rows import_rows
   where import_rows.organization_id=p_organization_id and import_rows.import_id=p_import_id
     and (p_result is null or import_rows.result=p_result);
  select coalesce(jsonb_agg(public.product_import_row_json(page)
    order by page.source_row_number),'[]'::jsonb) into v_rows from (
    select import_rows.* from public.product_import_rows import_rows
    where import_rows.organization_id=p_organization_id and import_rows.import_id=p_import_id
      and (p_result is null or import_rows.result=p_result)
    order by import_rows.source_row_number limit p_page_size offset ((p_page-1)*p_page_size)
  ) page;
  return query select 'found'::text,jsonb_build_object(
    'rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,
    'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer));
end;
$$;

alter function public.list_product_import_jobs(uuid,uuid,text,integer,integer) owner to postgres;
alter function public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer) owner to postgres;

revoke all on function
  public.list_product_import_jobs(uuid,uuid,text,integer,integer),
  public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer)
from public,anon,authenticated;

grant execute on function
  public.list_product_import_jobs(uuid,uuid,text,integer,integer),
  public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer)
to service_role;
