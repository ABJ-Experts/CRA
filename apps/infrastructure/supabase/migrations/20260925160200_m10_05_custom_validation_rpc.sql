-- Dry-run custom content through the same strict SQL validator as publication.
-- The validator rolls back its temporary import and audit in a subtransaction.
create function public.m10_custom_pack_validate(
  p_organization_id uuid,p_actor_user_id uuid,p_document jsonb)
returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if not public.m10_validate_custom_document(p_organization_id,gen_random_uuid(),p_document) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  return query select 'validated'::text,jsonb_build_object('valid',true);
end $$;
revoke all on function public.m10_custom_pack_validate(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_custom_pack_validate(uuid,uuid,jsonb) to service_role;
