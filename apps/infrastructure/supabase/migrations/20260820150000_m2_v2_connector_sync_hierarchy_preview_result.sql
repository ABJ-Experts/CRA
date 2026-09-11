-- `preview_product_component_link` is a read API: its RPC outcome is `found`
-- and its decision is carried in `preview.outcome`. The prior connector commit
-- compared the transport outcome directly to `allowed`, which made every
-- valid reviewed hierarchy change fall back to review without mutation.
--
-- The immediately preceding hardening migration owns this function body. A
-- targeted replacement keeps this corrective migration additive while avoiding
-- a second, divergent copy of the long atomic commit implementation.
do $$
declare
  v_definition text;
  v_original text := 'if v_hierarchy_result.outcome <> ''allowed'' then';
  v_corrected text := 'if v_hierarchy_result.outcome <> ''found'' or coalesce(v_hierarchy_result.preview ->> ''outcome'', '''') <> ''allowed'' then';
begin
  select pg_get_functiondef(
    'public.commit_sync_run_atomic(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) into v_definition;
  if position(v_original in v_definition) = 0 then
    raise exception 'connector hierarchy preview guard was not found';
  end if;
  execute replace(v_definition, v_original, v_corrected);
end;
$$;

revoke all on function public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid)
  to service_role;
