-- The first M5 migration was already applied in this local development
-- database before pgcrypto calls were schema-qualified. Keep the existing
-- security-definer paths pinned exactly as required while delegating that
-- legacy call shape to the extension implementation. New deployments use the
-- schema-qualified calls in the original migration directly.
create or replace function public.digest(p_value text, p_algorithm text)
returns bytea
language sql immutable strict set search_path = extensions, pg_temp as $$
  select extensions.digest(p_value, p_algorithm)
$$;
alter function public.digest(text, text) owner to postgres;
revoke all on function public.digest(text, text) from public, anon, authenticated;
grant execute on function public.digest(text, text) to service_role;

alter function public.create_finding_saved_view_atomic(uuid, uuid, text, jsonb, text, text, uuid, uuid)
  set search_path = public, pg_temp;
alter function public.update_finding_saved_view_atomic(uuid, uuid, uuid, integer, text, jsonb, text, text, uuid, uuid)
  set search_path = public, pg_temp;
alter function public.delete_finding_saved_view_atomic(uuid, uuid, uuid, integer, uuid, uuid)
  set search_path = public, pg_temp;
alter function public.set_finding_saved_view_default_atomic(uuid, uuid, uuid, uuid, uuid)
  set search_path = public, pg_temp;
