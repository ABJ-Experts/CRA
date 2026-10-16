-- The primary key already implies UNIQUE (organization_id, user_id, session_id).
-- A second unique index can raise 23505 independently of the ON CONFLICT arbiter
-- when parallel authenticated requests first register the same session.
-- No inbound foreign keys reference this redundant constraint.
alter table public.organization_session_bindings
  drop constraint organization_session_bindings_organization_id_user_id_sessi_key;

create or replace function public.register_organization_session_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_issued_at timestamptz
)
  returns table (outcome text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_registered_count integer;
begin
  if not exists (select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_user_id) then
    return query select 'not_found'::text; return;
  end if;
  insert into public.organization_session_bindings (
    organization_id, session_id, user_id, issued_at
  ) values (p_organization_id, p_session_id, p_user_id, p_issued_at)
  on conflict (organization_id, session_id) do update
    set issued_at = excluded.issued_at, last_seen_at = now()
    where organization_session_bindings.user_id = excluded.user_id;
  get diagnostics v_registered_count = row_count;
  if v_registered_count = 0 then
    return query select 'not_found'::text; return;
  end if;
  return query select 'registered'::text;
end;
$$;
-- CREATE OR REPLACE preserves ownership and ACLs; make the existing boundary
-- explicit so subsequent replay also remains service-role-only.
revoke all on function public.register_organization_session_atomic(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_organization_session_atomic(uuid, uuid, uuid, timestamptz)
  to service_role;
