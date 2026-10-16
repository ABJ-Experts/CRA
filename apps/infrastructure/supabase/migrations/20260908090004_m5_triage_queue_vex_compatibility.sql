-- Keep the established VEX queue wrapper as part of the public queue contract
-- while adding M5-04 operational projections and filters.  The initial M5-04
-- migration renamed that wrapper, which made the existing compatibility gate
-- unable to verify the VEX filters on the public function.

create or replace function public.list_finding_triage_queue(
  p_organization_id uuid, p_actor_user_id uuid, p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50, p_cursor text default null, p_sort text default null, p_order text default null
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_raw jsonb;
  v_rows jsonb;
begin
  perform public.m5_triage_materialize_due_work(p_organization_id);

  select raw.result into v_raw
  from public.list_finding_triage_queue_raw(
    p_organization_id,
    p_actor_user_id,
    p_filters - 'vexStatuses' - 'approvalStates' - 'suppressionStates' - 'internalSlaStates' - 'notificationDeliveryStates',
    p_limit,
    p_cursor,
    p_sort,
    p_order
  ) raw
  limit 1;

  if v_raw is null then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            item,
            '{vexStatus}',
            coalesce(to_jsonb(effective.value ->> 'status'), 'null'::jsonb),
            true
          ),
          '{approvalState}',
          coalesce(to_jsonb(effective.value ->> 'approvalState'), 'null'::jsonb),
          true
        ),
        '{operational}',
        operational.value,
        true
      ) order by ordinality
    ),
    '[]'::jsonb
  ) into v_rows
  from jsonb_array_elements(coalesce(v_raw -> 'rows', '[]'::jsonb)) with ordinality rows(item, ordinality)
  left join lateral (
    select public.m5_vex_assessment_json(
      p_organization_id,
      public.m5_bulk_effective_assessment_id(p_organization_id, (item #>> '{finding,id}')::uuid)
    ) value
  ) effective on true
  cross join lateral (
    select public.m5_triage_operational_json(p_organization_id, (item #>> '{finding,id}')::uuid) value
  ) operational
  where (p_filters -> 'vexStatuses' is null
      or effective.value ->> 'status' = any(array(select jsonb_array_elements_text(p_filters -> 'vexStatuses'))))
    and (p_filters -> 'approvalStates' is null
      or effective.value ->> 'approvalState' = any(array(select jsonb_array_elements_text(p_filters -> 'approvalStates'))))
    and (p_filters -> 'suppressionStates' is null
      or operational.value #>> '{suppression,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'suppressionStates'))))
    and (p_filters -> 'internalSlaStates' is null
      or operational.value #>> '{internalSla,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'internalSlaStates'))))
    and (p_filters -> 'notificationDeliveryStates' is null
      or operational.value #>> '{notification,state}' = any(array(select jsonb_array_elements_text(p_filters -> 'notificationDeliveryStates'))));

  return query select 'found'::text, jsonb_set(v_raw, '{rows}', v_rows, true);
end;
$$;

alter function public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text) owner to postgres;
revoke all on function public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text) to service_role;
