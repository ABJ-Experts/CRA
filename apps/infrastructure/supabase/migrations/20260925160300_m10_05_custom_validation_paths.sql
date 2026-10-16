-- A dry run still delegates acceptance to the publication validator. On a
-- rejection, report the first actionable field without exposing SQL errors.
create function public.m10_custom_validation_error(p_document jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_field text; v_item jsonb; v_index bigint; v_path text; v_message text;
begin
  if p_document is null or jsonb_typeof(p_document)<>'object' then
    return jsonb_build_object('path','content','message','Content must be an object');
  end if;
  if pg_column_size(p_document)>2097152 then
    return jsonb_build_object('path','content','message','Content exceeds the 2 MB publication limit');
  end if;
  select k into v_field from jsonb_object_keys(p_document) k
    where k not in ('title','editionDate','language','attribution','sourceUrl','requirements')
    order by k limit 1;
  if found then return jsonb_build_object('path','content.'||v_field,
    'message','Field is not supported'); end if;
  for v_field in select key from jsonb_each_text(p_document)
    where key<>'requirements' and (value ~ '<[[:alpha:]/][^>]*>' or value ~ '[[:cntrl:]]')
    order by key loop
    return jsonb_build_object('path','content.'||v_field,
      'message','Markup and control characters are not allowed');
  end loop;
  if coalesce(p_document->>'editionDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('path','content.editionDate','message','Enter a valid edition date');
  end if;
  if jsonb_typeof(p_document->'requirements')<>'array' then
    return jsonb_build_object('path','content.requirements','message','Requirements must be an array');
  end if;
  if jsonb_array_length(p_document->'requirements') not between 1 and 1000 then
    return jsonb_build_object('path','content.requirements','message','Enter 1 to 1000 requirements');
  end if;
  for v_item,v_index in select item,ordinality-1 from
    jsonb_array_elements(p_document->'requirements') with ordinality as r(item,ordinality) loop
    v_path:='content.requirements.'||v_index::text;
    if jsonb_typeof(v_item)<>'object' then
      return jsonb_build_object('path',v_path,'message','Requirement must be an object');
    end if;
    select k into v_field from jsonb_object_keys(v_item) k
      where k not in ('requirementKey','identifier','parentKey','position',
        'heading','text','sourceReference') order by k limit 1;
    if found then return jsonb_build_object('path',v_path||'.'||v_field,
      'message','Field is not supported'); end if;
    if v_item->>'parentKey' is not null and not exists (
      select 1 from jsonb_array_elements(p_document->'requirements') parent
        where parent->>'requirementKey'=v_item->>'parentKey') then
      return jsonb_build_object('path',v_path||'.parentKey',
        'message','Parent requirement does not exist');
    end if;
    if exists(select 1 from jsonb_array_elements(p_document->'requirements') with ordinality
      as previous(item,ordinality) where previous.ordinality<=v_index
      and previous.item->>'requirementKey'=v_item->>'requirementKey') then
      return jsonb_build_object('path',v_path||'.requirementKey',
        'message','Requirement key is duplicated');
    end if;
    if exists(select 1 from jsonb_array_elements(p_document->'requirements') with ordinality
      as previous(item,ordinality) where previous.ordinality<=v_index
      and previous.item->>'identifier'=v_item->>'identifier') then
      return jsonb_build_object('path',v_path||'.identifier',
        'message','Requirement identifier is duplicated');
    end if;
    if exists(select 1 from jsonb_array_elements(p_document->'requirements') with ordinality
      as previous(item,ordinality) where previous.ordinality<=v_index
      and previous.item->>'parentKey' is not distinct from v_item->>'parentKey'
      and previous.item->>'position'=v_item->>'position') then
      return jsonb_build_object('path',v_path||'.position',
        'message','Sibling position is duplicated');
    end if;
    for v_field in select key from jsonb_each_text(v_item)
      where key in ('identifier','heading','text','sourceReference')
        and (value ~ '<[[:alpha:]/][^>]*>' or value ~ '[[:cntrl:]]')
      order by key loop
      return jsonb_build_object('path',v_path||'.'||v_field,
        'message','Markup and control characters are not allowed');
    end loop;
  end loop;
  -- The publication validator remains authoritative. A structural mismatch
  -- that reaches here is assigned to the requirements collection for review.
  return jsonb_build_object('path','content.requirements',
    'message','Requirements do not meet publication rules');
end $$;

create or replace function public.m10_custom_pack_validate(
  p_organization_id uuid,p_actor_user_id uuid,p_document jsonb)
returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if not public.m10_validate_custom_document(p_organization_id,gen_random_uuid(),p_document) then
    return query select 'invalid_request'::text,jsonb_build_object('valid',false,
      'errors',jsonb_build_array(public.m10_custom_validation_error(p_document))); return;
  end if;
  return query select 'validated'::text,jsonb_build_object('valid',true);
end $$;

revoke all on function public.m10_custom_validation_error(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_custom_pack_validate(uuid,uuid,jsonb) to service_role;
