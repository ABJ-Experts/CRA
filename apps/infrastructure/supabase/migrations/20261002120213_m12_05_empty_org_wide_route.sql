-- Empty product allowlists are valid for explicitly scoped organization-wide
-- deadline routes. bool_and over zero rows is NULL, not TRUE.
create or replace function public.m12_05_chat_configuration_valid(
  p_organization_id uuid,p_actor_user_id uuid,p_configuration jsonb
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_typeof(p_configuration)='object' and octet_length(p_configuration::text)<=12000
    and p_configuration ?& array['mode','displayName','eventClasses','productIds','targetMetadata','includeOrganizationWide']
    and not exists(select 1 from jsonb_object_keys(p_configuration) k
      where k not in ('mode','displayName','eventClasses','productIds','targetMetadata','includeOrganizationWide'))
    and p_configuration->>'mode' in ('slack_webhook','slack_bot','teams_workflow_webhook','teams_bot_proactive')
    and p_configuration->>'displayName'=btrim(p_configuration->>'displayName')
    and char_length(p_configuration->>'displayName') between 1 and 120
    and (p_configuration->>'displayName') !~ '[@<>[:cntrl:]]'
    and jsonb_typeof(p_configuration->'eventClasses')='array'
    and jsonb_array_length(p_configuration->'eventClasses') between 1 and 3
    and (select count(*)=count(distinct value) and coalesce(bool_and(value in
      ('high_severity_alert','countdown_warning','approval_prompt')),false)
      from jsonb_array_elements_text(p_configuration->'eventClasses'))
    and jsonb_typeof(p_configuration->'productIds')='array'
    and jsonb_array_length(p_configuration->'productIds')<=100
    and (select count(*)=count(distinct value) and coalesce(bool_and(value ~
      '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'),true)
      from jsonb_array_elements_text(p_configuration->'productIds'))
    and (select count(*)=jsonb_array_length(p_configuration->'productIds')
      from public.products p where p.organization_id=p_organization_id and p.archived_at is null
        and p.id::text in (select value from jsonb_array_elements_text(p_configuration->'productIds')))
    and (p_configuration->>'includeOrganizationWide') in ('true','false')
    and (jsonb_array_length(p_configuration->'productIds')>0 or (p_configuration->>'includeOrganizationWide')='true')
    and jsonb_typeof(p_configuration->'targetMetadata')='object'
    and octet_length((p_configuration->'targetMetadata')::text)<=8000
    and not (p_configuration->'targetMetadata' ?| array['secret','token','credential','webhookUrl','url'])
    and public.m12_03_actor_has_effective_permission(p_organization_id,p_actor_user_id,'can_view_products')
$$;

revoke all on function public.m12_05_chat_configuration_valid(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.m12_05_chat_configuration_valid(uuid,uuid,jsonb)
  to service_role;
