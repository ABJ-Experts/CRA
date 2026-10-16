-- Fail large registry captures before constructing source-owned JSON values.
-- The final atomic capture ordinal/byte guard remains authoritative if data
-- changes after this bounded preflight statement.
create function public.m14_03_registry_capture_preflight(p_organization_id uuid,p_actor_user_id uuid,p_filters jsonb)
returns void language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_count integer;
begin
 if not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
 or not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_export_products') then raise exception 'export_access_denied' using errcode='42501';end if;
 select count(*) into v_count from (
 select 1 from public.products p where p.organization_id=p_organization_id
 and public.m14_03_product_matches(p,nullif(p_filters->>'q',''),(p_filters->>'archived')::boolean,p_filters->>'productType',(p_filters->>'responsibleOwnerId')::uuid)
 limit 100001
 ) bounded;
 if v_count>100000 then raise exception 'export_capture_limit' using errcode='54000';end if;
end $$;
revoke all on function public.m14_03_registry_capture_preflight(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_registry_capture_preflight(uuid,uuid,jsonb) to service_role;
do $capture$ declare v_def text;v_old text;begin
 v_def:=pg_get_functiondef('public.m14_03_capture_export(uuid,uuid,text,integer)'::regprocedure);
 v_old:='if v_job.row_count is not null then return public.m14_03_private_job_json(v_job); end if;';
 if position(v_old in v_def)=0 then raise exception 'export_preflight_capture_baseline_changed';end if;
 v_def:=replace(v_def,v_old,v_old||' if v_job.source=''products.registry'' and v_job.scope=''all_filtered'' then perform public.m14_03_registry_capture_preflight(p_organization_id,v_job.requester_id,v_job.filters);end if;');
 execute v_def;
end $capture$;
