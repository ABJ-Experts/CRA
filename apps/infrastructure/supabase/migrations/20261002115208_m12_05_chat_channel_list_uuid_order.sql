-- PostgreSQL does not define max(uuid); take the final key from an ordered array.
create or replace function public.m12_05_list_chat_channels(
  p_organization_id uuid,p_actor_user_id uuid,p_limit integer,p_after_id uuid,p_mode text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_next uuid;
begin
  if not (public.m12_05_chat_admin(p_organization_id,p_actor_user_id)
    or public.m12_05_chat_auditor(p_organization_id,p_actor_user_id)) then
    return jsonb_build_object('outcome','forbidden','channels','[]'::jsonb,'nextCursor',null); end if;
  if p_limit not between 1 and 100 or (p_mode is not null and p_mode not in
    ('slack_webhook','slack_bot','teams_workflow_webhook','teams_bot_proactive')) then
    return jsonb_build_object('outcome','invalid_request','channels','[]'::jsonb,'nextCursor',null); end if;
  with page as (select c.* from public.notification_chat_channels c
    where c.organization_id=p_organization_id and (p_after_id is null or c.id>p_after_id)
      and (p_mode is null or c.mode=p_mode)
    order by c.id limit p_limit+1), visible as (select * from page order by id limit p_limit)
  select coalesce(jsonb_agg(public.m12_05_chat_channel_public(v) order by v.id),'[]'::jsonb),
    (array_agg(v.id order by v.id desc))[1]
    into v_items,v_next from visible v;
  return jsonb_build_object('outcome','ok','channels',v_items,
    'nextCursor',case when jsonb_array_length(v_items)=p_limit and exists(
      select 1 from public.notification_chat_channels c where c.organization_id=p_organization_id
        and c.id>v_next and (p_mode is null or c.mode=p_mode)) then v_next else null end);
end $$;

revoke all on function public.m12_05_list_chat_channels(uuid,uuid,integer,uuid,text)
  from public,anon,authenticated;
grant execute on function public.m12_05_list_chat_channels(uuid,uuid,integer,uuid,text)
  to service_role;
