create or replace function public.m6_reporting_template_content_valid(p_content jsonb, p_obligation_type text, p_stage_kind text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
 select jsonb_typeof(p_content)='object'
  and jsonb_typeof(p_content->'fields')='array'
  and jsonb_array_length(p_content->'fields') <= 100
  and (select count(*)=count(distinct field->'value'->>'key') from jsonb_array_elements(p_content->'fields') field)
  and not exists (
   select 1 from jsonb_array_elements(p_content->'fields') field
   where field->'value'->>'type'='member_states'
    or not exists (
      select 1 from jsonb_array_elements(public.m6_reporting_stage_field_definitions(p_obligation_type,p_stage_kind)) definition
      where definition->>'key'=field->'value'->>'key'
       and definition->>'type'=field->'value'->>'type'
       and (definition->>'templateEligible')::boolean
    )
  )
$$;
alter function public.m6_reporting_template_content_valid(jsonb,text,text) owner to postgres;
revoke all on function public.m6_reporting_template_content_valid(jsonb,text,text) from public,anon,authenticated;
