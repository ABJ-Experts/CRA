-- Refine field diagnostics after the initial scoped dry-run migration.
create or replace function public.m10_custom_validation_error(p_document jsonb)
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
  if jsonb_typeof(p_document->'title')<>'string'
    or char_length(coalesce(p_document->>'title','')) not between 1 and 300 then
    return jsonb_build_object('path','content.title','message','Enter a title of 1 to 300 characters');
  end if;
  if coalesce(p_document->>'editionDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('path','content.editionDate','message','Enter a valid edition date');
  end if;
  if coalesce(p_document->>'language','') !~ '^[a-z]{2,3}(-[A-Z]{2})?$' then
    return jsonb_build_object('path','content.language','message','Enter a valid language tag');
  end if;
  if jsonb_typeof(p_document->'attribution')<>'string'
    or char_length(coalesce(p_document->>'attribution','')) not between 1 and 1000 then
    return jsonb_build_object('path','content.attribution','message','Enter attribution of 1 to 1000 characters');
  end if;
  if p_document ? 'sourceUrl' and
    (jsonb_typeof(p_document->'sourceUrl')<>'string' or
      coalesce(p_document->>'sourceUrl','') !~ '^https://[^[:space:]]+$' or
      char_length(p_document->>'sourceUrl')>2048) then
    return jsonb_build_object('path','content.sourceUrl','message','Enter an HTTPS source URL');
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
    if coalesce(v_item->>'requirementKey','') !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
      or char_length(v_item->>'requirementKey')>120 then
      return jsonb_build_object('path',v_path||'.requirementKey',
        'message','Enter a valid requirement key');
    end if;
    if jsonb_typeof(v_item->'identifier')<>'string'
      or char_length(coalesce(v_item->>'identifier','')) not between 1 and 120 then
      return jsonb_build_object('path',v_path||'.identifier',
        'message','Enter an identifier of 1 to 120 characters');
    end if;
    if v_item ? 'heading' and jsonb_typeof(v_item->'heading') not in ('string','null')
      or (v_item->>'heading' is not null and
        char_length(v_item->>'heading') not between 1 and 500) then
      return jsonb_build_object('path',v_path||'.heading',
        'message','Enter a heading of 1 to 500 characters');
    end if;
    if jsonb_typeof(v_item->'text')<>'string'
      or char_length(coalesce(v_item->>'text','')) not between 1 and 20000 then
      return jsonb_build_object('path',v_path||'.text',
        'message','Enter requirement text of 1 to 20000 characters');
    end if;
    if jsonb_typeof(v_item->'sourceReference')<>'string'
      or char_length(coalesce(v_item->>'sourceReference','')) not between 1 and 500 then
      return jsonb_build_object('path',v_path||'.sourceReference',
        'message','Enter a source reference of 1 to 500 characters');
    end if;
    if jsonb_typeof(v_item->'position')<>'number'
      or coalesce(v_item->>'position','') !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('path',v_path||'.position',
        'message','Enter a whole position from 1 to 10000');
    end if;
    if (v_item->>'position')::integer not between 1 and 10000 then
      return jsonb_build_object('path',v_path||'.position',
        'message','Enter a whole position from 1 to 10000');
    end if;
    if v_item ? 'parentKey' and jsonb_typeof(v_item->'parentKey') not in ('null','string') then
      return jsonb_build_object('path',v_path||'.parentKey',
        'message','Parent key must be text or null');
    end if;
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
