-- Dataset markers are deployment-local restore controls, not portable tenant
-- content. Preserve all prior M1 redaction, volatility, ownership and grants.
create or replace function public.m1_export_redact_jsonb(p_value jsonb)
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 case jsonb_typeof(p_value)
 when 'object' then
  select coalesce(jsonb_object_agg(item.key,public.m1_export_redact_jsonb(item.value)),'{}'::jsonb) into v_result
  from jsonb_each(p_value) item
  where item.key not in ('audit_dataset_epoch','audit_dataset_context')
   and item.key !~* '(token|password|secret|credential|otp|recovery|api[_-]?key|access[_-]?token|refresh[_-]?token|(encryption|private|signing|provider)[_-]?key)';
  return v_result;
 when 'array' then
  select coalesce(jsonb_agg(public.m1_export_redact_jsonb(item.value)),'[]'::jsonb) into v_result from jsonb_array_elements(p_value) item;
  return v_result;
 else return p_value;
 end case;
end;
$$;
