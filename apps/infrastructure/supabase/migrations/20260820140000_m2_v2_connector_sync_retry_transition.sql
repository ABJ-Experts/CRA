-- A PL/pgSQL commit exception can restore the reviewed run row before its
-- handler records the retry. The retry/fail transition is therefore valid
-- from either actively-running work or a reviewed work item whose in-function
-- effects were rolled back. Both states remain service-role-only.
create or replace function public.enforce_sync_run_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'queued' and new.status in ('running', 'canceled', 'failed'))
    or (old.status = 'running' and new.status in ('waiting_for_review', 'queued', 'completed', 'retrying', 'failed', 'canceled'))
    or (old.status = 'waiting_for_review' and new.status in ('queued', 'retrying', 'failed', 'canceled'))
    or (old.status = 'retrying' and new.status in ('running', 'canceled', 'failed'))
    or (old.status = 'failed' and new.status = 'queued')
  ) then
    raise exception using
      errcode = '23514',
      message = 'invalid sync run status transition',
      detail = format('sync run state transition %s -> %s is not permitted', old.status, new.status);
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_sync_run_status_transition() from public, anon, authenticated;
grant execute on function public.enforce_sync_run_status_transition() to service_role;
