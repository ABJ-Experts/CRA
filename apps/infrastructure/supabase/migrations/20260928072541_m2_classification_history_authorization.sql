-- Recheck verified actor permission at the read transaction boundary.
-- Runtime adapters can no longer bypass this check through a direct history SELECT.
revoke select on public.product_classification_runs from service_role;

create function public.get_product_classification_history(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_page integer,p_page_size integer
) returns table(outcome text,history jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_product public.products%rowtype;
  v_latest public.product_classification_runs%rowtype;
  v_total bigint;
  v_rows jsonb;
begin
  perform 1 from public.organization_lifecycles l
    where l.organization_id=p_organization_id and l.status='active' for share;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if not public.m2_classification_actor_can(p_organization_id,p_actor_user_id,'can_view_products') then
    return query select 'forbidden'::text,null::jsonb; return; end if;
  if p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not between 1 and 100 then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  -- Coordinate with product edits and classification saves for a coherent latest/page view.
  select * into v_product from public.products
    where organization_id=p_organization_id and id=p_product_id for share;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_latest from public.product_classification_runs
    where organization_id=p_organization_id and product_id=p_product_id order by revision desc limit 1;
  select count(*) into v_total from public.product_classification_runs
    where organization_id=p_organization_id and product_id=p_product_id;
  select coalesce(jsonb_agg(public.m2_classification_run_json(page_row) order by page_row.revision desc),'[]'::jsonb)
    into v_rows from (
      select r.* from public.product_classification_runs r
        where r.organization_id=p_organization_id and r.product_id=p_product_id
        order by r.revision desc limit p_page_size offset (p_page-1)*p_page_size
    ) page_row;
  return query select 'found'::text,jsonb_build_object(
    'latest',case when v_latest.id is null then null else public.m2_classification_run_json(v_latest) end,
    'productVersion',v_product.version,
    'runs',jsonb_build_object('rows',v_rows,'page',p_page,'pageSize',p_page_size,'total',v_total,
      'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer)));
end $$;
revoke all on function public.get_product_classification_history(uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_product_classification_history(uuid,uuid,uuid,integer,integer) to service_role;
