-- The helper deliberately raises a validation error for malformed resolved
-- values. PostgreSQL therefore correctly classifies it as STABLE rather than
-- IMMUTABLE (the previous declaration produced a schema-lint warning).
create or replace function public.m2_v2_sync_text_field_value(
  p_value jsonb,
  p_allow_null boolean,
  p_field_name text
) returns text
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_value) = 'string' then
    return p_value #>> '{}';
  end if;
  if p_allow_null and (p_value is null or p_value = 'null'::jsonb) then
    return null;
  end if;
  raise exception using errcode = '22023',
    message = format('sync commit rejected: malformed value for %s', p_field_name);
end;
$$;
