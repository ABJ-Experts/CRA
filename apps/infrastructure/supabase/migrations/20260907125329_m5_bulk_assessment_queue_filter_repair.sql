-- Apply effective VEX state before exposing M5 queue rows. The underlying
-- keyset routine remains the authoritative tenant/filter/cursor implementation;
-- the wrapper deliberately removes only raw VEX filters then applies those two
-- predicates against the undo-aware revision projection.
alter function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)
  rename to list_finding_triage_queue_raw;
create or replace function public.list_finding_triage_queue(
  p_organization_id uuid, p_actor_user_id uuid, p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50, p_cursor text default null, p_sort text default null, p_order text default null
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_raw jsonb; v_rows jsonb;
begin
  select raw.result into v_raw from public.list_finding_triage_queue_raw(
    p_organization_id,p_actor_user_id,p_filters-'vexStatuses'-'approvalStates',p_limit,p_cursor,p_sort,p_order
  ) raw limit 1;
  if v_raw is null then return query select 'not_found'::text,null::jsonb; return; end if;
  select coalesce(jsonb_agg(
    jsonb_set(jsonb_set(item,'{vexStatus}',coalesce(to_jsonb(effective.value->>'status'),'null'::jsonb),true),'{approvalState}',coalesce(to_jsonb(effective.value->>'approvalState'),'null'::jsonb),true)
    order by ordinality),'[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(v_raw->'rows','[]'::jsonb)) with ordinality rows(item,ordinality)
  left join lateral (select public.m5_vex_assessment_json(p_organization_id,public.m5_bulk_effective_assessment_id(p_organization_id,(item#>>'{finding,id}')::uuid)) value) effective on true
  where (p_filters->'vexStatuses' is null or effective.value->>'status'=any(array(select jsonb_array_elements_text(p_filters->'vexStatuses'))))
    and (p_filters->'approvalStates' is null or effective.value->>'approvalState'=any(array(select jsonb_array_elements_text(p_filters->'approvalStates'))));
  return query select 'found'::text,jsonb_set(v_raw,'{rows}',v_rows,true);
end;
$$;
alter function public.list_finding_triage_queue_raw(uuid,uuid,jsonb,integer,text,text,text) owner to postgres;
alter function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text) owner to postgres;
revoke all on function public.list_finding_triage_queue_raw(uuid,uuid,jsonb,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text) to service_role;
