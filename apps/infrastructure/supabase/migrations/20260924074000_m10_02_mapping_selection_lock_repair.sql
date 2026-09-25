-- Forward repair: serialize mapping writes with M10-01 selection changes.
-- Keep the published RPC signature while making malformed product arrays
-- deterministic before the implementation can evaluate jsonb_array_length.
alter function public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)
  rename to m10_control_command_impl;

revoke all on function public.m10_control_command_impl(uuid,uuid,text,jsonb,integer,uuid)
  from public,anon,authenticated,service_role;

create function public.m10_control_command(
  p_organization_id uuid,p_actor_user_id uuid,p_operation text,p_payload jsonb,
  p_expected_revision integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_operation='upsert_mapping' then
    if jsonb_typeof(p_payload) is distinct from 'object'
      or jsonb_typeof(p_payload->'productIds') is distinct from 'array' then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    if jsonb_array_length(p_payload->'productIds') not between 1 and 100 then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    if p_organization_id is not null and p_payload->>'packKey' is not null then
      perform pg_advisory_xact_lock(hashtextextended(
        p_organization_id::text||':'||(p_payload->>'packKey'),0));
    end if;
  end if;
  return query select impl.outcome,impl.result
  from public.m10_control_command_impl(
    p_organization_id,p_actor_user_id,p_operation,p_payload,
    p_expected_revision,p_idempotency_key) impl;
end $$;

revoke all on function public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)
  to service_role;
notify pgrst,'reload schema';
