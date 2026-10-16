-- Notification preferences and dispatch outcomes are portable tenant records.
-- Digest batches are execution state. Remove an early local mapping if present;
-- the snapshot-record FK deliberately blocks removal of referenced evidence.
delete from public.organization_export_source_tables
where source_id = 'notification_delivery'
  and table_name = 'notification_digest_batches';

-- Keep the existing atomic snapshot materializer's lock set aligned with the
-- physical-source catalogue, without replacing its authorization or projection.
do $$
declare
  v_definition text;
  v_lock_section text;
  v_anchor text := E'\n  in share mode;';
  v_new_lock text := 'public.notification_preferences, public.notification_dispatches';
  v_table text;
  v_missing text[] := array[]::text[];
begin
  select pg_get_functiondef(
    to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')
  ) into v_definition;
  if v_definition is null or position(v_anchor in v_definition) = 0 then
    raise exception 'M12-03 export lock anchor is missing';
  end if;
  v_lock_section := split_part(split_part(v_definition, 'lock table', 2), 'in share mode;', 1);
  foreach v_table in array string_to_array(v_new_lock, ', ') loop
    if position(v_table in v_lock_section) = 0 then
      v_missing := array_append(v_missing, v_table);
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    execute replace(v_definition, v_anchor,
      ', ' || array_to_string(v_missing, ', ') || v_anchor);
  end if;
end;
$$;

-- Dispatch retry scheduling is local worker state. The existing business
-- projection already removes lease fields, attempt counts, and secret keys.
do $$
declare
  v_definition text;
  v_anchor text := E'\n  case p_table_name\n';
  v_branch text := E'\n  if p_table_name = ''notification_dispatches'' then\n    return v_record - array[''next_attempt_at''];\n  end if;\n';
begin
  select pg_get_functiondef(
    to_regprocedure('public.m1_export_business_record_jsonb(text,jsonb)')
  ) into v_definition;
  if v_definition is null or position(v_anchor in v_definition) = 0 then
    raise exception 'M12-03 export projection anchor is missing';
  end if;
  if position('notification_dispatches' in v_definition) = 0 then
    execute replace(v_definition, v_anchor, v_branch || v_anchor);
  end if;
end;
$$;
