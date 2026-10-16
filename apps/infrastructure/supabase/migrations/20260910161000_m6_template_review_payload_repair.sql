-- A template-review marker is internal provenance, not a draft field.
create or replace function public.m6_reporting_draft_payload_valid(p_content jsonb,p_provenance jsonb,p_member_states jsonb,p_obligation_type text,p_stage_kind text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare v_def jsonb; v_value jsonb; v_key text;
begin
 if jsonb_typeof(p_content)<>'object' or jsonb_typeof(p_provenance)<>'object' or jsonb_typeof(p_member_states)<>'array' or jsonb_array_length(p_member_states)>27 or exists(select 1 from jsonb_array_elements(p_member_states) state where jsonb_typeof(state)<>'string' or trim(both '"' from state::text) !~ '^[A-Z]{2}$') or (select count(*)<>count(distinct trim(both '"' from state::text)) from jsonb_array_elements(p_member_states) state) then return false; end if;
 for v_key,v_value in select key,value from jsonb_each(p_content) loop
  select definition into v_def from jsonb_array_elements(public.m6_reporting_stage_field_definitions(p_obligation_type,p_stage_kind)) definition where definition->>'key'=v_key and definition->>'type'<>'member_states';
  if v_def is null or not p_provenance ? v_key then return false; end if;
  if jsonb_typeof(v_value)='null' then continue; end if;
  if v_def->>'type'='boolean' and jsonb_typeof(v_value)<>'boolean' then return false; end if;
  if v_def->>'type'='short_text' and (jsonb_typeof(v_value)<>'string' or char_length(v_value #>> '{}')>4000) then return false; end if;
  if v_def->>'type'='long_text' and (jsonb_typeof(v_value)<>'string' or char_length(v_value #>> '{}')>20000) then return false; end if;
 end loop;
 if exists(select 1 from jsonb_each(p_provenance) field where (field.key in ('_memberStates','_template') and jsonb_typeof(field.value)<>'object') or (field.key not in ('_memberStates','_template') and (not p_content ? field.key or jsonb_typeof(field.value)<>'object' or coalesce(field.value->>'origin','') not in ('human','platform','ai_accepted')))) then return false; end if;
 return true;
end $$;
alter function public.m6_reporting_draft_payload_valid(jsonb,jsonb,jsonb,text,text) owner to postgres;
revoke all on function public.m6_reporting_draft_payload_valid(jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.m6_reporting_draft_payload_valid(jsonb,jsonb,jsonb,text,text) to service_role;
